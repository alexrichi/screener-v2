import type { OrderFlowLevel } from '../../src/lib/orderflow';

export interface BookUpdate {
  bids?: Array<[number, number]>;
  asks?: Array<[number, number]>;
  snapshot?: boolean;
  /** Update id of this message, when the venue exposes one. */
  seq?: number | null;
  /** Previous update id, when the venue exposes one. */
  prevSeq?: number | null;
}

/** One venue's book: snapshots replace it, updates patch single levels. */
export class BookAccumulator {
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();

  apply(update: BookUpdate): void {
    if (update.snapshot) {
      this.bids.clear();
      this.asks.clear();
    }
    applyLevels(this.bids, update.bids);
    applyLevels(this.asks, update.asks);
  }

  clear(): void {
    this.bids.clear();
    this.asks.clear();
  }

  levels(limit = 5000): { bids: OrderFlowLevel[]; asks: OrderFlowLevel[] } {
    return {
      bids: sideLevels(this.bids, 'bid', limit),
      asks: sideLevels(this.asks, 'ask', limit),
    };
  }

  /** Keep the book bounded to the levels a ladder can still reach. */
  trim(limit = 5000): void {
    trimSide(this.bids, 'bid', limit);
    trimSide(this.asks, 'ask', limit);
  }
}

function trimSide(side: Map<number, number>, order: 'bid' | 'ask', limit: number): void {
  if (side.size <= limit) return;
  const keep = sideLevels(side, order, limit);
  side.clear();
  for (const level of keep) side.set(level.price, level.size);
}

function applyLevels(side: Map<number, number>, levels?: Array<[number, number]>): void {
  if (!levels) return;
  for (const [price, size] of levels) {
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (size > 0) side.set(price, size);
    else side.delete(price);
  }
}

function sideLevels(
  side: Map<number, number>,
  order: 'bid' | 'ask',
  limit: number,
): OrderFlowLevel[] {
  return [...side.entries()]
    .sort((left, right) => (order === 'bid' ? right[0] - left[0] : left[0] - right[0]))
    .slice(0, limit)
    .map(([price, size]) => ({ price, size }));
}
