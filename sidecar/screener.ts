import {
  barsPerDay,
  computeMetrics,
  type MetricBar,
  type ScreenerMetrics,
} from '../src/lib/screenerMetrics';
import type {
  ScreenerConfig,
  ScreenerPatch,
  ScreenerRow,
  ScreenerSnapshot,
  ScreenerStatus,
  VenueId,
} from '../src/types';
import type { Instrument, Unsubscribe, VenueBar, VenueTicker } from '../src/venues/types';
import { VENUE_IDS } from '../src/venues/catalog';
import type { VenueHub } from './hub';
import type { BarsStream } from './stream';

const TICKER_INTERVAL_MS = 5_000;
const TICKER_TIMEOUT_MS = 30_000;
const PATCH_INTERVAL_MS = 2_000;
const TAIL_REFRESH_MS = 120_000;
const VISIBLE_REFRESH_MS = 20_000;
const WARMUP_CONCURRENCY = 4;
const REFRESH_CONCURRENCY = 4;
const MAX_BARS = 5_000;
const MAX_WATCHED = 2_000;

const DEFAULT_CONFIG: ScreenerConfig = {
  timeframe: '15',
  rvolDays: 7,
  rsiPeriod: 14,
  minVolume: 1_000_000,
};

const METRIC_IDS: Array<keyof ScreenerMetrics> = [
  'sessionRangePct',
  'volumeChange24hPct',
  'rvol',
  'vwapZ',
  'rsi',
];

interface SeriesEntry {
  bars: MetricBar[];
  at: number;
}

interface ScreenerOptions {
  hubs: Map<VenueId, VenueHub>;
  streams: Map<VenueId, BarsStream>;
  config?: Partial<ScreenerConfig>;
}

type PatchListener = (patch: ScreenerPatch) => void;

function metricBar(bar: VenueBar): MetricBar {
  return {
    time: bar.openTime,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  };
}

function mergeBars(cached: readonly MetricBar[], next: readonly MetricBar[]): MetricBar[] {
  const byTime = new Map<number, MetricBar>();
  for (const bar of cached) byTime.set(bar.time, bar);
  for (const bar of next) byTime.set(bar.time, bar);
  return [...byTime.values()]
    .sort((left, right) => left.time - right.time)
    .slice(-MAX_BARS);
}

function emptyMetrics(): ScreenerMetrics {
  return {
    sessionRangePct: null,
    volumeChange24hPct: null,
    rvol: null,
    vwapZ: null,
    rsi: null,
  };
}

/** A venue call that never settles must not stall the ticker poll loop. */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function invalidConfig(config: ScreenerConfig): string | null {
  if (!['15', '30', '60'].includes(config.timeframe)) {
    return `Unsupported screener timeframe: ${config.timeframe}`;
  }
  if (!Number.isFinite(config.rvolDays) || config.rvolDays < 1 || config.rvolDays > 30) {
    return 'rvolDays must be between 1 and 30';
  }
  if (!Number.isFinite(config.rsiPeriod) || config.rsiPeriod < 2 || config.rsiPeriod > 50) {
    return 'rsiPeriod must be between 2 and 50';
  }
  if (!Number.isFinite(config.minVolume) || config.minVolume < 0) {
    return 'minVolume must be non-negative';
  }
  for (const [venue, volume] of Object.entries(config.minVolumeByVenue ?? {})) {
    if (!VENUE_IDS.includes(venue as VenueId)) {
      return `minVolumeByVenue has an unknown venue: ${venue}`;
    }
    if (!Number.isFinite(volume) || (volume as number) < 0) {
      return `minVolumeByVenue.${venue} must be non-negative`;
    }
  }
  if (config.venues && config.venues.some((venue) => !VENUE_IDS.includes(venue))) {
    return 'venues must be known venue ids';
  }
  return null;
}

function sameVolumes(
  left: Partial<Record<VenueId, number>> | undefined,
  right: Partial<Record<VenueId, number>> | undefined,
): boolean {
  const a = left ?? {};
  const b = right ?? {};
  const venues = new Set([...Object.keys(a), ...Object.keys(b)] as VenueId[]);
  for (const venue of venues) if (a[venue] !== b[venue]) return false;
  return true;
}

function sameVenues(left: readonly VenueId[] | undefined, right: readonly VenueId[] | undefined): boolean {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((venue, index) => venue === b[index]);
}

/**
 * Server-owned watched table. Tickers decide activation; bars for every
 * watched instrument are backfilled once and then updated by the venue stream
 * (or a slow REST tail for venues without candle WebSockets).
 */
export class ScreenerService {
  private readonly hubs: Map<VenueId, VenueHub>;
  private readonly streams: Map<VenueId, BarsStream>;
  private config: ScreenerConfig;
  private readonly rows = new Map<string, ScreenerRow>();
  private readonly watched = new Set<string>();
  private readonly series = new Map<string, SeriesEntry>();
  private readonly visible = new Set<string>();
  private readonly subscriptions = new Map<string, Unsubscribe>();
  private readonly patches = new Map<string, ScreenerRow>();
  private readonly removed = new Set<string>();
  /** A completed poll changed the venue status even if no row did. */
  private statusDirty = false;
  private readonly listeners = new Set<PatchListener>();
  /** One queue and one slot pool per venue: rate limits never cross exchanges. */
  private readonly warmQueues = new Map<VenueId, Instrument[]>();
  private readonly refreshQueues = new Map<VenueId, Instrument[]>();
  private readonly warmActive = new Map<VenueId, number>();
  private readonly refreshActive = new Map<VenueId, number>();
  private readonly refreshing = new Set<string>();
  private readonly venueErrors = new Map<VenueId, string>();
  private tickerTimer: NodeJS.Timeout | null = null;
  private patchTimer: NodeJS.Timeout | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private polling = false;
  private lastUpdate: number | null = null;
  private degraded = new Set<VenueId>();
  /** Bumped on a config change so in-flight warm results from the old config are dropped. */
  private warmGeneration = 0;

  constructor(private readonly options: ScreenerOptions) {
    this.hubs = options.hubs;
    this.streams = options.streams;
    const config = { ...DEFAULT_CONFIG, ...options.config };
    this.config = {
      ...config,
      venues: config.venues ?? [...options.hubs.keys()],
    };
    const error = invalidConfig(this.config);
    if (error) throw new Error(error);
  }

  start(): void {
    if (this.tickerTimer) return;
    void this.poll();
    this.tickerTimer = setInterval(() => void this.poll(), TICKER_INTERVAL_MS);
    this.patchTimer = setInterval(() => this.flushPatches(), PATCH_INTERVAL_MS);
    this.refreshTimer = setInterval(() => this.refreshDue(), 5_000);
  }

  stop(): void {
    if (this.tickerTimer) clearInterval(this.tickerTimer);
    if (this.patchTimer) clearInterval(this.patchTimer);
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    this.tickerTimer = null;
    this.patchTimer = null;
    this.refreshTimer = null;
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
  }

  snapshot(): ScreenerSnapshot {
    return {
      rows: [...this.watched]
        .map((key) => this.rows.get(key))
        .filter((row): row is ScreenerRow => row !== undefined)
        .sort((left, right) => (right.quoteVolume ?? -1) - (left.quoteVolume ?? -1)),
      status: this.status(),
    };
  }

  onPatch(listener: PatchListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Flush pending row changes now; the sidecar normally calls this every 2 s. */
  flush(): void {
    this.flushPatches();
  }

  setViewport(keys: readonly string[]): void {
    this.visible.clear();
    for (const key of keys.slice(0, 500)) this.visible.add(key);
  }

  setConfig(next: Partial<ScreenerConfig>): void {
    const candidate = { ...this.config, ...next };
    const error = invalidConfig(candidate);
    if (error) throw new Error(error);
    const timeframeChanged = candidate.timeframe !== this.config.timeframe;
    const periodChanged =
      candidate.rvolDays !== this.config.rvolDays ||
      candidate.rsiPeriod !== this.config.rsiPeriod;
    const venuesChanged = !sameVenues(candidate.venues, this.config.venues);
    const volumesChanged =
      candidate.minVolume !== this.config.minVolume ||
      !sameVolumes(candidate.minVolumeByVenue, this.config.minVolumeByVenue);
    const previousVenues = this.config.venues ?? [...this.hubs.keys()];
    const nextVenues = candidate.venues ?? [...this.hubs.keys()];
    this.config = candidate;

    if (venuesChanged) {
      const enabled = new Set(nextVenues);
      for (const venue of previousVenues) {
        if (enabled.has(venue)) continue;
        this.warmQueues.delete(venue);
        this.refreshQueues.delete(venue);
        this.hubs.get(venue)?.stopFunding?.();
      }
    }

    if (venuesChanged || volumesChanged) {
      this.pruneVenues();
      this.pruneVolume();
      this.flushPatches();
    }

    if (!timeframeChanged && !periodChanged) return;

    this.warmGeneration += 1;
    this.warmQueues.clear();
    this.refreshQueues.clear();
    this.refreshing.clear();
    for (const unsubscribe of this.subscriptions.values()) unsubscribe();
    this.subscriptions.clear();
    this.series.clear();
    for (const key of this.watched) {
      const row = this.rows.get(key);
      if (!row) continue;
      row.metrics = emptyMetrics();
      row.warming = true;
      this.patches.set(key, row);
      this.ensureStream(row.instrument);
      this.enqueueWarm(row.instrument);
    }
    this.flushPatches();
  }

  /** Drop rows of venues the user unchecked; their streams and series go too. */
  private pruneVenues(): void {
    for (const key of [...this.watched]) {
      const row = this.rows.get(key);
      if (row && this.wants(row.instrument.venue)) continue;
      this.watched.delete(key);
      this.rows.delete(key);
      this.series.delete(key);
      this.subscriptions.get(key)?.();
      this.subscriptions.delete(key);
      this.patches.delete(key);
      this.removed.add(key);
    }
  }

  private wants(venue: VenueId): boolean {
    return this.config.venues?.includes(venue) ?? true;
  }

  private volumeThreshold(venue: VenueId): number {
    return this.config.minVolumeByVenue?.[venue] ?? this.config.minVolume;
  }

  /** Drop watched rows the venue's threshold no longer covers. */
  private pruneVolume(): void {
    for (const key of [...this.watched]) {
      const row = this.rows.get(key);
      if (!row) continue;
      if ((row.quoteVolume ?? 0) >= this.volumeThreshold(row.instrument.venue)) continue;
      this.watched.delete(key);
      this.series.delete(key);
      this.subscriptions.get(key)?.();
      this.subscriptions.delete(key);
      this.patches.delete(key);
      this.removed.add(key);
    }
  }

  private status(): ScreenerStatus {
    const watchedByVenue = new Map<VenueId, number>();
    let warming = 0;
    for (const key of this.watched) {
      const row = this.rows.get(key);
      if (!row) continue;
      if (row.warming) warming += 1;
      watchedByVenue.set(
        row.instrument.venue,
        (watchedByVenue.get(row.instrument.venue) ?? 0) + 1,
      );
    }

    return {
      ready: this.lastUpdate !== null,
      watched: this.watched.size,
      warming,
      lastUpdate: this.lastUpdate,
      venues: [...this.hubs.keys()].map((venue) => {
        const error = this.venueErrors.get(venue);
        const watched = watchedByVenue.get(venue) ?? 0;
        return {
          venue,
          state: error ? 'error' : this.degraded.has(venue) ? 'degraded' : 'ok',
          watched,
          lastUpdate: this.lastUpdate,
          ...(error ? { message: error } : {}),
        };
      }),
    };
  }

  private baseRow(instrument: Instrument, ticker: VenueTicker): ScreenerRow {
    return {
      instrument,
      price: ticker.last,
      change24h: ticker.change24h,
      quoteVolume: ticker.quoteVolume,
      funding: ticker.funding,
      nextFunding: ticker.nextFunding,
      metrics: emptyMetrics(),
      updatedAt: Date.now(),
      warming: true,
      missing: [...METRIC_IDS],
      staleMetrics: [],
    };
  }

  private recompute(row: ScreenerRow, series: SeriesEntry | undefined): ScreenerRow {
    if (!series) return row;
    const last = row.price ?? series.bars.at(-1)?.close ?? Number.NaN;
    if (!Number.isFinite(last)) return row;
    const metrics = computeMetrics(series.bars, last, Date.now(), {
      timeframe: this.config.timeframe,
      rvolDays: this.config.rvolDays,
      rsiPeriod: this.config.rsiPeriod,
    });
    const missing = METRIC_IDS.filter((id) => metrics[id] === null);
    const staleAfter = 2 * 60_000 * Number(this.config.timeframe);
    return {
      ...row,
      metrics,
      missing,
      warming: false,
      staleMetrics: Date.now() - series.at > staleAfter ? [...METRIC_IDS] : [],
    };
  }

  private maxBars(): number {
    return Math.min(
      MAX_BARS,
      barsPerDay(this.config.timeframe) * (this.config.rvolDays + 1) + 50,
    );
  }

  private enqueueWarm(instrument: Instrument): void {
    if (!this.wants(instrument.venue) || !this.watched.has(instrument.key)) return;
    const queue = this.warmQueues.get(instrument.venue) ?? [];
    if (queue.some((item) => item.key === instrument.key)) return;
    queue.push(instrument);
    this.warmQueues.set(instrument.venue, queue);
    this.pumpWarm(instrument.venue);
  }

  private pumpWarm(venue: VenueId): void {
    if (!this.wants(venue)) {
      this.warmQueues.delete(venue);
      return;
    }
    const queue = this.warmQueues.get(venue);
    if (!queue) return;
    while ((this.warmActive.get(venue) ?? 0) < WARMUP_CONCURRENCY && queue.length > 0) {
      const instrument = this.takeWarm(queue);
      if (!instrument) return;
      const hub = this.hubs.get(venue);
      if (!hub) continue;
      this.warmActive.set(venue, (this.warmActive.get(venue) ?? 0) + 1);
      const generation = this.warmGeneration;
      void hub
        .getSeries(instrument, this.config.timeframe, {
          limit: this.maxBars(),
          includeForming: true,
          priority: 'background',
        })
        .then((bars) => {
          if (generation !== this.warmGeneration) return;
          if (!this.wants(instrument.venue) || !this.watched.has(instrument.key)) return;
          this.series.set(instrument.key, { bars: bars.map(metricBar), at: Date.now() });
          const row = this.rows.get(instrument.key);
          if (!row) return;
          const next = this.recompute(row, this.series.get(instrument.key));
          this.rows.set(instrument.key, next);
          this.patches.set(instrument.key, next);
        })
        .catch((error) => {
          if (!this.wants(instrument.venue)) return;
          this.venueErrors.set(
            instrument.venue,
            error instanceof Error ? error.message : String(error),
          );
          const row = this.rows.get(instrument.key);
          if (row) {
            const next = { ...row, warming: false };
            this.rows.set(instrument.key, next);
            this.patches.set(instrument.key, next);
          }
        })
        .finally(() => {
          this.warmActive.set(
            venue,
            Math.max(0, (this.warmActive.get(venue) ?? 0) - 1),
          );
          this.pumpWarm(venue);
        });
    }
  }

  /** Rows on screen first, then the queue's order (highest volume first). */
  private takeWarm(queue: Instrument[]): Instrument | undefined {
    const visible = queue.findIndex((item) => this.visible.has(item.key));
    return queue.splice(visible < 0 ? 0 : visible, 1)[0];
  }

  private ensureStream(instrument: Instrument): void {
    if (!this.wants(instrument.venue)) return;
    if (this.subscriptions.has(instrument.key)) return;
    // Coinbase has no candle WebSocket; its rows refresh through the REST tail.
    if (instrument.venue === 'coinbase') {
      this.degraded.add(instrument.venue);
      return;
    }
    const stream = this.streams.get(instrument.venue);
    if (!stream) {
      this.degraded.add(instrument.venue);
      return;
    }
    const unsubscribe = stream.subscribe(
      instrument,
      this.config.timeframe,
      (bar) => this.onBar(instrument, bar),
      { fallbackPoll: false },
    );
    this.subscriptions.set(instrument.key, unsubscribe);
  }

  private onBar(instrument: Instrument, bar: VenueBar): void {
    const next = metricBar(bar);
    const series = this.series.get(instrument.key);
    const bars = mergeBars(series?.bars ?? [], [next]);
    const entry = { bars, at: Date.now() };
    this.series.set(instrument.key, entry);
    const row = this.rows.get(instrument.key);
    if (!row || !this.watched.has(instrument.key)) return;
    const updated = this.recompute(row, entry);
    this.rows.set(instrument.key, updated);
    this.patches.set(instrument.key, updated);
  }

  private refreshDue(): void {
    const now = Date.now();
    for (const key of this.watched) {
      const instrument = this.rows.get(key)?.instrument;
      const series = this.series.get(key);
      if (!instrument || !series) continue;
      const age = now - series.at;
      const maxAge = this.visible.has(key) ? VISIBLE_REFRESH_MS : TAIL_REFRESH_MS;
      if (age < maxAge) continue;
      if (this.refreshing.has(key)) continue;
      const queue = this.refreshQueues.get(instrument.venue) ?? [];
      if (queue.some((item) => item.key === key)) continue;
      queue.push(instrument);
      this.refreshQueues.set(instrument.venue, queue);
    }
    for (const venue of this.refreshQueues.keys()) this.pumpRefresh(venue);
  }

  private pumpRefresh(venue: VenueId): void {
    if (!this.wants(venue)) {
      this.refreshQueues.delete(venue);
      return;
    }
    const queue = this.refreshQueues.get(venue);
    if (!queue) return;
    while ((this.refreshActive.get(venue) ?? 0) < REFRESH_CONCURRENCY && queue.length > 0) {
      const instrument = queue.shift();
      if (!instrument) return;
      const hub = this.hubs.get(venue);
      if (!hub) continue;
      this.refreshActive.set(venue, (this.refreshActive.get(venue) ?? 0) + 1);
      this.refreshing.add(instrument.key);
      const generation = this.warmGeneration;
      void hub
        .getSeries(instrument, this.config.timeframe, {
          limit: this.maxBars(),
          refresh: true,
          refreshBars: 3,
          includeForming: true,
          priority: this.visible.has(instrument.key) ? 'interactive' : 'background',
        })
        .then((bars) => {
          if (generation !== this.warmGeneration) return;
          if (!this.wants(instrument.venue) || !this.watched.has(instrument.key)) return;
          const entry = { bars: bars.map(metricBar), at: Date.now() };
          this.series.set(instrument.key, entry);
          const row = this.rows.get(instrument.key);
          if (!row) return;
          const updated = this.recompute(row, entry);
          this.rows.set(instrument.key, updated);
          this.patches.set(instrument.key, updated);
        })
        .catch(() => {
          // Keep the last known series; the next tick retries.
        })
        .finally(() => {
          this.refreshing.delete(instrument.key);
          this.refreshActive.set(
            venue,
            Math.max(0, (this.refreshActive.get(venue) ?? 0) - 1),
          );
          this.pumpRefresh(venue);
        });
    }
  }

  private activate(instrument: Instrument, ticker: VenueTicker): void {
    if (!this.wants(instrument.venue)) return;
    if (this.watched.has(instrument.key)) return;
    if (this.watched.size >= MAX_WATCHED) {
      this.degraded.add(instrument.venue);
      return;
    }
    this.watched.add(instrument.key);
    const row = this.baseRow(instrument, ticker);
    this.rows.set(instrument.key, row);
    this.ensureStream(instrument);
    this.enqueueWarm(instrument);
    this.patches.set(instrument.key, row);
  }

  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      // One slow or failing venue must not delay the others' activation, so
      // each venue applies its tickers as soon as its own call settles.
      const venues = [...this.hubs].filter(([venue]) => this.wants(venue));
      await Promise.allSettled(
        venues.map(async ([venue, hub]) => {
          try {
            const tickers = await withTimeout(
              hub.getTickers(),
              TICKER_TIMEOUT_MS,
              'ticker fetch timed out',
            );
            this.venueErrors.delete(venue);
            this.applyTickers(venue, tickers);
          } catch (error) {
            this.venueErrors.set(
              venue,
              error instanceof Error ? error.message : String(error),
            );
          }
        }),
      );
      this.lastUpdate = Date.now();
      this.statusDirty = true;
    } catch (error) {
      console.error('[screener] poll failed', error);
    } finally {
      this.polling = false;
    }
  }

  private applyTickers(venue: VenueId, tickers: readonly VenueTicker[]): void {
    // A poll that started before the venue was unchecked must not bring it back.
    if (!this.wants(venue)) return;
    for (const ticker of tickers) {
      const instrument = ticker.instrument;
      const row = this.rows.get(instrument.key);
      const next = row
        ? {
            ...row,
            price: ticker.last,
            change24h: ticker.change24h,
            quoteVolume: ticker.quoteVolume,
            funding: ticker.funding,
            nextFunding: ticker.nextFunding,
            updatedAt: Date.now(),
          }
        : this.baseRow(instrument, ticker);
      this.rows.set(instrument.key, next);

      if (
        (ticker.quoteVolume ?? 0) >= this.volumeThreshold(venue) &&
        !this.watched.has(instrument.key)
      ) {
        this.activate(instrument, ticker);
      } else if (this.watched.has(instrument.key)) {
        this.patches.set(instrument.key, next);
      }
    }
    // The table is sorted by 24h volume; warm its top rows first.
    this.warmQueues.get(venue)?.sort(
      (left, right) =>
        (this.rows.get(right.key)?.quoteVolume ?? 0) -
        (this.rows.get(left.key)?.quoteVolume ?? 0),
    );
  }

  private flushPatches(): void {
    if (this.patches.size === 0 && this.removed.size === 0 && !this.statusDirty) {
      return;
    }
    const patch: ScreenerPatch = {
      rows: [...this.patches.values()],
      removed: [...this.removed],
      status: this.status(),
    };
    this.patches.clear();
    this.removed.clear();
    this.statusDirty = false;
    for (const listener of this.listeners) listener(patch);
  }
}
