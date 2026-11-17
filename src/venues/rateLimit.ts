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

/**
 * Bulk work (screener warm-up, scans) stops at this share of a window's
 * budget. The rest stays for charts and the same IP's other clients;
 * interactive work may spend the whole window.
 */
const BACKGROUND_WINDOW_SHARE = 0.9;

/**
 * A response sent at the end of a window can arrive after the next one starts
 * with the closing window's usage. Ignore observations from this opening slice.
 */
const OBSERVE_GRACE_RATIO = 0.02;

interface BucketState {
  tokens: number;
  at: number;
  /** Our granted weight in the venue's current window. */
  spent: number;
  /** Venue-reported weight for that window, other clients on the IP included. */
  observed: number;
  /** Venue window this accounting belongs to. */
  window: number;
}

function windowOf(bucket: RateLimitBucket, now: number): number {
  return Math.floor(now / bucket.windowMs);
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
 * window and then freezing. The scheduler also keeps our grants plus the
 * venue-reported IP usage inside the venue's own window, so a bucket that
 * starts full cannot spend two windows' worth in the first minute. Waiting for
 * a bucket never holds a concurrency slot, and interactive work is granted
 * before background scans.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly pending: Pending[] = [];
  private active = 0;
  private pausedUntil = 0;
  private backgroundPausedUntil = 0;
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
      this.buckets.set(bucket.id, {
        tokens: bucket.limit,
        at: now,
        spent: 0,
        observed: 0,
        window: windowOf(bucket, now),
      });
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

  /**
   * Venue-reported usage for the current window (for example Binance's
   * `x-mbx-used-weight-1m`, which also counts other clients on the same IP).
   * It is treated as already spent, and near the cap background work waits for
   * the next window while interactive work keeps the remaining budget.
   */
  observe(bucketId: string, used: number): void {
    const bucket = this.bucketOf(bucketId);
    if (!Number.isFinite(used)) return;
    const state = this.buckets.get(bucketId)!;
    const now = this.clock.now();
    this.roll(bucket, state, now);
    // The header of a request sent just before the boundary belongs to the
    // closing window; counting it again would pause bulk work for a whole
    // extra window.
    if (now % bucket.windowMs < bucket.windowMs * OBSERVE_GRACE_RATIO) return;
    state.observed = Math.max(state.observed, used);
    if (used >= bucket.limit * BACKGROUND_WINDOW_SHARE) {
      const remaining = bucket.windowMs - (now % bucket.windowMs);
      this.backgroundPausedUntil = Math.max(this.backgroundPausedUntil, now + remaining);
    }
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
    const state = this.buckets.get(bucketId)!;
    this.roll(bucket, state, now);
    state.tokens -= cost;
    state.spent += cost;
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
    if (!state) return;
    state.tokens = Math.min(bucket.limit, state.tokens + cost);
    state.spent = Math.max(0, state.spent - cost);
  }

  /** Start the venue's next window with an empty spent/observed budget. */
  private roll(bucket: RateLimitBucket, state: BucketState, now: number): void {
    const window = windowOf(bucket, now);
    if (state.window === window) return;
    state.window = window;
    state.spent = 0;
    state.observed = 0;
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

  private nextGrantable(now: number): Pending | null {
    const interactive = this.hasInteractive();
    for (const entry of this.pending) {
      if (interactive && entry.priority !== 'interactive') continue;
      if (!this.grantable(entry, now)) continue;
      return entry;
    }
    return null;
  }

  private grantable(entry: Pending, now: number): boolean {
    const bucket = this.bucketOf(entry.bucket);
    const state = this.buckets.get(entry.bucket)!;
    if (state.tokens < entry.cost) return false;
    this.roll(bucket, state, now);
    if (entry.priority === 'background' && now < this.backgroundPausedUntil) return false;
    const cap = this.windowCap(entry);
    return Math.max(state.spent, state.observed) + entry.cost <= cap;
  }

  /** Background leaves the tail of the window to charts and other clients. */
  private windowCap(entry: Pending): number {
    const bucket = this.bucketOf(entry.bucket);
    const share = entry.priority === 'background' ? BACKGROUND_WINDOW_SHARE : 1;
    return Math.max(entry.cost, bucket.limit * share);
  }

  private nextWait(now: number): number | null {
    const interactive = this.hasInteractive();
    let wait = Number.POSITIVE_INFINITY;
    for (const entry of this.pending) {
      if (interactive && entry.priority !== 'interactive') continue;
      const bucket = this.bucketOf(entry.bucket);
      const state = this.buckets.get(entry.bucket)!;
      const deficit = entry.cost - state.tokens;
      const tokenWait = deficit <= 0 ? 0 : deficit / (bucket.limit / bucket.windowMs);
      const windowWait = bucket.windowMs - (now % bucket.windowMs);
      const pauseWait =
        entry.priority === 'background' ? Math.max(0, this.backgroundPausedUntil - now) : 0;
      this.roll(bucket, state, now);
      const capWait =
        Math.max(state.spent, state.observed) + entry.cost <= this.windowCap(entry)
          ? 0
          : windowWait;
      wait = Math.min(wait, Math.max(tokenWait, capWait, pauseWait));
    }
    if (!Number.isFinite(wait)) return null;
    return Math.max(0, Math.ceil(wait));
  }

  private bucketOf(id: string): RateLimitBucket {
    const bucket = this.policy.buckets.find((item) => item.id === id);
    if (!bucket) throw new Error(`Unknown rate limit bucket "${id}"`);
    return bucket;
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
          const entry = this.nextGrantable(now);
          if (!entry) break;
          this.removePending(entry);
          const state = this.buckets.get(entry.bucket)!;
          state.tokens -= entry.cost;
          state.spent += entry.cost;
          this.active += 1;
          entry.resolve();
        }

        if (this.pending.length === 0) return;
        if (this.active >= this.policy.maxConcurrent) return;

        const wait = this.nextWait(now);
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
