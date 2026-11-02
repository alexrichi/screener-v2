import type { RateLimitPolicy } from './types';

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
}

interface BucketState {
  charges: Array<{ at: number; amount: number }>;
}

/**
 * A small venue-agnostic request gate. Adapters declare their buckets (weight per
 * minute for Binance, request windows per endpoint for OKX); every request passes
 * through the same queue, concurrency cap, pause and ban state.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private pausedUntil = 0;
  private bannedUntil = 0;

  constructor(
    private readonly policy: RateLimitPolicy,
    private readonly clock: RateLimitClock = REAL_CLOCK,
  ) {
    if (!(policy.maxConcurrent > 0)) {
      throw new Error('RateLimitPolicy.maxConcurrent must be positive');
    }
    for (const bucket of policy.buckets) {
      if (!(bucket.limit > 0) || !(bucket.windowMs > 0)) {
        throw new Error(`RateLimit bucket "${bucket.id}" needs positive limit/window`);
      }
      this.buckets.set(bucket.id, { charges: [] });
    }
  }

  async run<T>(request: RateLimitRequest, fn: () => Promise<T>): Promise<T> {
    this.assertNotBanned();
    await this.waitForPause();
    await this.acquire();
    try {
      await this.reserve(request);
      this.assertNotBanned();
      await this.waitForPause();
      return await fn();
    } finally {
      this.release();
    }
  }

  /** A 429-style response: hold new work for `ms`. */
  pauseFor(ms: number): void {
    if (ms > 0) this.pausedUntil = Math.max(this.pausedUntil, this.clock.now() + ms);
  }

  /** A 418-style ban: fail requests fast until it expires. */
  banFor(ms: number): void {
    if (ms > 0) this.bannedUntil = Math.max(this.bannedUntil, this.clock.now() + ms);
  }

  get banRemainingMs(): number {
    return Math.max(0, this.bannedUntil - this.clock.now());
  }

  private assertNotBanned(): void {
    if (this.clock.now() < this.bannedUntil) {
      throw new VenueRateLimitError(
        `Venue IP banned for ~${Math.ceil(this.banRemainingMs / 1000)}s`,
        { banned: true, retryAfterMs: this.banRemainingMs },
      );
    }
  }

  private async waitForPause(): Promise<void> {
    this.assertNotBanned();
    for (;;) {
      const wait = this.pausedUntil - this.clock.now();
      if (wait <= 0) return;
      await this.clock.sleep(wait);
      this.assertNotBanned();
    }
  }

  private async reserve(request: RateLimitRequest): Promise<void> {
    const state = this.buckets.get(request.bucket);
    const bucket = this.policy.buckets.find((item) => item.id === request.bucket);
    if (!state || !bucket) {
      throw new Error(`Unknown rate limit bucket "${request.bucket}"`);
    }
    const amount = request.cost ?? 1;
    if (!(amount > 0)) throw new Error('Rate limit cost must be positive');
    if (amount > bucket.limit) {
      throw new Error(`Request cost ${amount} exceeds bucket "${bucket.id}" limit`);
    }

    for (;;) {
      this.assertNotBanned();
      await this.waitForPause();
      const now = this.clock.now();
      state.charges = state.charges.filter((charge) => charge.at > now - bucket.windowMs);
      const used = state.charges.reduce((sum, charge) => sum + charge.amount, 0);
      if (used + amount <= bucket.limit) {
        state.charges.push({ at: now, amount });
        return;
      }
      const earliest = state.charges[0];
      if (!earliest) throw new Error(`Rate limit bucket "${bucket.id}" is stuck`);
      const wait = earliest.at + bucket.windowMs - now + 1;
      await this.clock.sleep(Math.max(1, wait));
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.policy.maxConcurrent) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}
