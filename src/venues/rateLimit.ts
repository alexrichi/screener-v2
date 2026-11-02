import type { RateLimitBucket, RateLimitPolicy, RequestPriority } from './types';

export interface RateLimitClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const REAL_CLOCK: RateLimitClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** The venue rejected a request because of a rate limit or an IP ban. */
export class VenueRateLimitError extends Error {
  constructor(
    message: string,
    readonly options: { banned: boolean; retryAfterMs: number },
  ) {
    super(message);
    this.name = 'VenueRateLimitError';
  }
}

export interface RateLimitRequest {
  /** Bucket id declared by the adapter. */
  bucket: string;
  /** Weight/cost of this request; defaults to 1. */
  cost?: number;
  /** Interactive work wins over background scans while both are queued. */
  priority?: RequestPriority;
  /** Cancels a request that has not started its network call yet. */
  signal?: AbortSignal;
}

export interface RateLimitSnapshot {
  active: number;
  pending: number;
  pausedForMs: number;
  bannedForMs: number;
  buckets: Array<{
    id: string;
    limit: number;
    windowMs: number;
    tokens: number;
    queued: number;
  }>;
}

interface BucketState {
  tokens: number;
  at: number;
}

interface Pending {
  bucket: string;
  cost: number;
  priority: RequestPriority;
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * A weighted token bucket with one scheduler for every bucket of a venue.
 *
 * A bucket starts full (`tokens = limit`) and refills continuously at
 * `limit / windowMs`. Under budget a request is granted immediately; beyond it
 * the scheduler paces requests evenly instead of letting a burst exhaust the
 * window and then freezing. Waiting for tokens never holds a concurrency slot,
 * and interactive work is granted before background scans.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly pending: Pending[] = [];
  private active = 0;
  private pausedUntil = 0;
  private bannedUntil = 0;
  private pumping = false;
  private wakeRequested = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly clock: RateLimitClock = REAL_CLOCK,
  ) {
    if (!(policy.maxConcurrent > 0)) {
      throw new Error('RateLimitPolicy.maxConcurrent must be positive');
    }
    const now = clock.now();
    for (const bucket of policy.buckets) {
      if (!(bucket.limit > 0) || !(bucket.windowMs > 0)) {
        throw new Error(`RateLimit bucket "${bucket.id}" needs positive limit/window`);
      }
      this.buckets.set(bucket.id, { tokens: bucket.limit, at: now });
    }
  }

  async run<T>(request: RateLimitRequest, fn: () => Promise<T>): Promise<T> {
    this.assertNotBanned();
    const bucket = this.policy.buckets.find((item) => item.id === request.bucket);
    if (!bucket) {
      throw new Error(`Unknown rate limit bucket "${request.bucket}"`);
    }
    const cost = request.cost ?? 1;
    if (!(cost > 0)) throw new Error('Rate limit cost must be positive');
    if (cost > bucket.limit) {
      throw new Error(`Request cost ${cost} exceeds bucket "${bucket.id}" limit`);
    }
    if (request.signal?.aborted) throw abortError();

    let resolveGrant!: () => void;
    let rejectGrant!: (error: Error) => void;
    const granted = new Promise<void>((resolve, reject) => {
      resolveGrant = resolve;
      rejectGrant = reject;
    });
    const entry: Pending = {
      bucket: bucket.id,
      cost,
      priority: request.priority ?? 'interactive',
      resolve: resolveGrant,
      reject: rejectGrant,
      signal: request.signal,
    };
    if (request.signal) {
      entry.onAbort = () => {
        if (this.removePending(entry)) {
          this.schedulePump();
          entry.reject(abortError());
        }
      };
      request.signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    this.pending.push(entry);
    this.schedulePump();

    try {
      await granted;
    } catch (error) {
      this.detach(entry);
      throw error;
    }

    this.detach(entry);
    if (request.signal?.aborted) {
      this.refund(bucket, cost);
      this.active -= 1;
      this.schedulePump();
      throw abortError();
    }

    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.schedulePump();
    }
  }

  /** A 429-style response: hold new work for `ms`. */
  pauseFor(ms: number): void {
    if (ms <= 0) return;
    this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
    this.schedulePump();
  }

  /** A 418-style ban: fail requests fast until it expires. */
  banFor(ms: number): void {
    if (ms <= 0) return;
    this.bannedUntil = Math.max(this.bannedUntil, this.clock.now() + ms);
    this.rejectPending(new VenueRateLimitError(
      `Venue IP banned for ~${Math.ceil(this.banRemainingMs / 1000)}s`,
      { banned: true, retryAfterMs: this.banRemainingMs },
    ));
    this.schedulePump();
  }

  /** Post-response weight debit (Hyperliquid adds weight for large responses). */
  debit(bucketId: string, cost: number): void {
    if (!(cost > 0)) return;
    const bucket = this.policy.buckets.find((item) => item.id === bucketId);
    if (!bucket) throw new Error(`Unknown rate limit bucket "${bucketId}"`);
    const now = this.clock.now();
    this.refill(bucket, now);
    this.buckets.get(bucketId)!.tokens -= cost;
  }

  get banRemainingMs(): number {
    return Math.max(0, this.bannedUntil - this.clock.now());
  }

  snapshot(): RateLimitSnapshot {
    const now = this.clock.now();
    return {
      active: this.active,
      pending: this.pending.length,
      pausedForMs: Math.max(0, this.pausedUntil - now),
      bannedForMs: Math.max(0, this.bannedUntil - now),
      buckets: this.policy.buckets.map((bucket) => {
        const state = this.buckets.get(bucket.id)!;
        const elapsed = Math.max(0, now - state.at);
        return {
          id: bucket.id,
          limit: bucket.limit,
          windowMs: bucket.windowMs,
          tokens: Math.min(bucket.limit, state.tokens + elapsed * (bucket.limit / bucket.windowMs)),
          queued: this.pending.filter((entry) => entry.bucket === bucket.id).length,
        };
      }),
    };
  }

  private assertNotBanned(): void {
    if (this.clock.now() < this.bannedUntil) {
      throw new VenueRateLimitError(
        `Venue IP banned for ~${Math.ceil(this.banRemainingMs / 1000)}s`,
        { banned: true, retryAfterMs: this.banRemainingMs },
      );
    }
  }

  private detach(entry: Pending): void {
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
      entry.onAbort = undefined;
    }
  }

  private removePending(entry: Pending): boolean {
    const index = this.pending.indexOf(entry);
    if (index < 0) return false;
    this.pending.splice(index, 1);
    return true;
  }

  private rejectPending(error: Error): void {
    for (const entry of this.pending.splice(0)) {
      this.detach(entry);
      entry.reject(error);
    }
  }

  private refund(bucket: RateLimitBucket, cost: number): void {
    const state = this.buckets.get(bucket.id);
    if (state) state.tokens = Math.min(bucket.limit, state.tokens + cost);
  }

  private refill(bucket: RateLimitBucket, now: number): void {
    const state = this.buckets.get(bucket.id)!;
    const elapsed = now - state.at;
    if (elapsed <= 0) return;
    state.tokens = Math.min(
      bucket.limit,
      state.tokens + elapsed * (bucket.limit / bucket.windowMs),
    );
    state.at = now;
  }

  private refillAll(now: number): void {
    for (const bucket of this.policy.buckets) this.refill(bucket, now);
  }

  private hasInteractive(): boolean {
    return this.pending.some((entry) => entry.priority === 'interactive');
  }

  private nextGrantable(): Pending | null {
    const interactive = this.hasInteractive();
    for (const entry of this.pending) {
      if (interactive && entry.priority !== 'interactive') continue;
      if (this.buckets.get(entry.bucket)!.tokens >= entry.cost) return entry;
    }
    return null;
  }

  private nextWait(): number | null {
    const interactive = this.hasInteractive();
    let wait = Number.POSITIVE_INFINITY;
    for (const entry of this.pending) {
      if (interactive && entry.priority !== 'interactive') continue;
      const bucket = this.policy.buckets.find((item) => item.id === entry.bucket)!;
      const tokens = this.buckets.get(entry.bucket)!.tokens;
      const deficit = entry.cost - tokens;
      const ms = deficit <= 0 ? 0 : deficit / (bucket.limit / bucket.windowMs);
      wait = Math.min(wait, ms);
    }
    if (!Number.isFinite(wait)) return null;
    return Math.max(0, Math.ceil(wait));
  }

  private schedulePump(): void {
    this.wakeRequested = true;
    const wake = this.wake;
    this.wake = null;
    wake?.();
    if (!this.pumping) {
      this.wakeRequested = false;
      void this.pump();
    }
  }

  private async sleepUntil(deadline: number): Promise<void> {
    const wait = Math.max(1, deadline - this.clock.now());
    let wake!: () => void;
    const woken = new Promise<void>((resolve) => {
      wake = resolve;
    });
    this.wake = wake;
    await Promise.race([this.clock.sleep(wait), woken]);
    if (this.wake === wake) this.wake = null;
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (;;) {
        const now = this.clock.now();
        this.refillAll(now);
        if (this.pending.length === 0) return;

        if (now < this.bannedUntil) {
          this.rejectPending(new VenueRateLimitError(
            `Venue IP banned for ~${Math.ceil((this.bannedUntil - now) / 1000)}s`,
            { banned: true, retryAfterMs: this.bannedUntil - now },
          ));
          return;
        }

        if (now < this.pausedUntil) {
          await this.sleepUntil(this.pausedUntil);
          continue;
        }

        while (this.active < this.policy.maxConcurrent) {
          const entry = this.nextGrantable();
          if (!entry) break;
          this.removePending(entry);
          this.buckets.get(entry.bucket)!.tokens -= entry.cost;
          this.active += 1;
          entry.resolve();
        }

        if (this.pending.length === 0) return;
        if (this.active >= this.policy.maxConcurrent) return;

        const wait = this.nextWait();
        if (wait === null) return;
        if (wait > 0) await this.sleepUntil(this.clock.now() + wait);
      }
    } finally {
      this.pumping = false;
      if (this.wakeRequested) {
        this.wakeRequested = false;
        void this.pump();
      }
    }
  }
}
