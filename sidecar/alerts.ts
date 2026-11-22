import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compilePine } from '@screener/pine-engine';
import { parseAlertEvents, parseRunnerRules } from '../src/lib/alertRules';
import {
  fetchPineSeries,
  PineSession,
  type FetchSeries,
} from '../src/lib/pineVela/session';
import { findPineInstrument, marketOf, toPineBar } from '../src/lib/pineVela/seriesHost';
import { timeframeMs } from '../src/lib/timeframe';
import type { AlertEvent, AlertRunnerRule, VenueId } from '../src/types';
import type { Instrument } from '../src/venues/types';
import type { VenueHub } from './hub';

/** Enough history for typical `ta.*` warm-up while keeping a run cheap. */
const ALERT_BARS = 1_500;
const CLOSE_DELAY_MS = 2_500;
const RETRY_MS = 5_000;
const MAX_RETRIES = 3;
/** Same cap as the renderer log, so a replay can never overflow it. */
const MAX_STORED_EVENTS = 500;

type Program = ReturnType<typeof compilePine>;
type Send = (payload: unknown) => void;

interface Options {
  hubs: Map<VenueId, VenueHub>;
}

interface Job {
  rule: AlertRunnerRule;
  instrument: Instrument;
  program: Program;
  timer: NodeJS.Timeout | null;
  lastBar: number;
  retries: number;
  active: boolean;
}

interface Stored {
  version: 1;
  rules: AlertRunnerRule[];
  events: AlertEvent[];
}

/**
 * Same dir as the AI config: `%APPDATA%\screener-v2\alerts.json` on Windows,
 * `~/.config/screener-v2/alerts.json` elsewhere. Keep in sync with Electron's
 * `app.getPath('userData')`; a different name makes the dev sidecar and the
 * packaged app persist to different files.
 */
function alertsFile(env: NodeJS.ProcessEnv = process.env): string {
  if (env.ALERTS_FILE) return env.ALERTS_FILE;
  const base = env.APPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'screener-v2', 'alerts.json');
}

function loadStored(): Stored {
  try {
    const raw = JSON.parse(readFileSync(alertsFile(), 'utf8')) as Partial<Stored>;
    return {
      version: 1,
      rules: parseRunnerRules(raw.rules),
      events: parseAlertEvents(raw.events, MAX_STORED_EVENTS),
    };
  } catch {
    return { version: 1, rules: [], events: [] };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The one alert runner, owned by the sidecar process instead of a renderer
 * socket. Rules persist to `alerts.json` and jobs keep running with zero
 * connections; a connecting renderer receives a replay its `seen` set
 * deduplicates. The renderer's `alerts.config` is still the source of truth
 * for rules (renderer wins); the file is the restart cache and event log.
 */
export class AlertService {
  private jobs: Job[] = [];
  private disposed = false;
  private generation = 0;
  private stored: Stored;
  private readonly senders = new Set<Send>();
  /** ruleId:timeframe:velaSymbol → last evaluated bar. Survives re-arms. */
  private readonly lastEvaluated = new Map<string, number>();
  /** Unknown request venues already logged; the chart treats them as `na` too. */
  private readonly skippedVenues = new Set<string>();

  constructor(private readonly opts: Options) {
    this.stored = loadStored();
    void this.arm(this.stored.rules, 0);
  }

  /** One renderer connection. The replay is idempotent on the client. */
  subscribe(send: Send): () => void {
    this.senders.add(send);
    send({ op: 'alerts.replay', events: this.stored.events });
    return () => this.senders.delete(send);
  }

  setRules(value: unknown): void {
    if (this.disposed) return;
    this.generation += 1;
    this.clearJobs();
    const prev = new Map(this.stored.rules.map((rule) => [rule.id, rule]));
    const rules = parseRunnerRules(value).map((rule) => {
      const old = prev.get(rule.id);
      // A once-rule the runner already fired stays off while the incoming
      // copy is not newer than the runner's own retirement write; the first
      // config after a reconnect arrives before the replay does.
      if (old && !old.enabled && rule.enabled && rule.updatedAt <= old.updatedAt) {
        return { ...rule, enabled: false };
      }
      return rule;
    });
    this.stored = { ...this.stored, rules };
    this.persist();
    // Fresh enablements arm from the latest closed bar: only bars that close
    // after arming fire, a paused rule never shoots its downtime.
    const newlyEnabled = new Set(
      rules
        .filter((rule) => rule.enabled && prev.get(rule.id)?.enabled !== true)
        .map((rule) => rule.id),
    );
    void this.arm(rules, this.generation, newlyEnabled);
  }

  dispose(): void {
    this.disposed = true;
    this.clearJobs();
    this.senders.clear();
  }

  // ponytail: one file rewrites every script source on each event (200 KB x 20
  // rules); split rules/events files when the write cost shows up.
  private persist(): void {
    try {
      const file = alertsFile();
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.stored));
      renameSync(tmp, file);
    } catch {
      /* a failed write keeps the in-memory state */
    }
  }

  private broadcast(payload: unknown): void {
    for (const send of this.senders) send(payload);
  }

  private fail(ruleId: string, error: unknown): void {
    this.broadcast({ op: 'alerts.error', ruleId, error: errorMessage(error) });
  }

  /** Jobs stop; `lastEvaluated` deliberately survives the next arm. */
  private clearJobs(): void {
    for (const job of this.jobs) {
      job.active = false;
      if (job.timer) clearTimeout(job.timer);
    }
    this.jobs = [];
  }

  private async arm(
    rules: readonly AlertRunnerRule[],
    generation: number,
    newlyEnabled?: ReadonlySet<string>,
  ): Promise<void> {
    for (const rule of rules) {
      if (this.disposed || generation !== this.generation) return;
      if (!rule.enabled) continue;
      try {
        const hub = this.opts.hubs.get(rule.target.venue);
        if (!hub) throw new Error(`Unknown venue "${rule.target.venue}"`);
        const program = compilePine({ source: rule.script, inputs: rule.inputs });
        if (!program.ok) throw new Error(program.error ?? 'The script could not be compiled');
        const instruments = await hub.getInstruments();
        if (this.disposed || generation !== this.generation) return;
        for (const key of rule.targets) {
          const instrument = instruments.find((item) => item.velaSymbol === key);
          if (!instrument) {
            this.fail(rule.id, `Unknown instrument "${key}"`);
            continue;
          }
          const bars = await hub.getBars(instrument, rule.timeframe, ALERT_BARS, {
            includeForming: false,
            priority: 'background',
          });
          if (this.disposed || generation !== this.generation) return;
          const latest = bars[bars.length - 1]?.openTime ?? 0;
          const job: Job = {
            rule,
            instrument,
            program,
            timer: null,
            lastBar: newlyEnabled?.has(rule.id)
              ? latest
              : this.lastEvaluated.get(`${rule.id}:${rule.timeframe}:${key}`) ?? latest,
            retries: 0,
            active: true,
          };
          this.jobs.push(job);
          this.schedule(job);
        }
      } catch (error) {
        this.fail(rule.id, error);
      }
    }
  }

  private schedule(job: Job): void {
    if (!job.active || this.disposed) return;
    if (job.timer) clearTimeout(job.timer);
    let interval = 60_000;
    try {
      interval = timeframeMs(job.rule.timeframe);
    } catch {
      this.fail(job.rule.id, `Unsupported timeframe "${job.rule.timeframe}"`);
      job.active = false;
      return;
    }
    const now = Date.now();
    const anchor = job.lastBar > 0 ? job.lastBar : now;
    const delay = Math.max(1_000, anchor + interval + CLOSE_DELAY_MS - now);
    job.timer = setTimeout(() => {
      void this.evaluate(job);
    }, delay);
  }

  private retry(job: Job): void {
    if (!job.active || this.disposed) return;
    if (job.timer) clearTimeout(job.timer);
    if (job.retries >= MAX_RETRIES) {
      this.schedule(job);
      return;
    }
    job.retries += 1;
    job.timer = setTimeout(() => {
      void this.evaluate(job);
    }, RETRY_MS);
  }

  private async evaluate(job: Job): Promise<void> {
    if (!job.active || this.disposed) return;
    job.timer = null;
    const hub = this.opts.hubs.get(job.rule.target.venue);
    if (!hub) {
      job.active = false;
      return;
    }
    try {
      const bars = await hub.getBars(job.instrument, job.rule.timeframe, ALERT_BARS, {
        includeForming: false,
        priority: 'background',
      });
      if (!job.active || this.disposed) return;
      const last = bars[bars.length - 1];
      if (!last || last.openTime <= job.lastBar) {
        this.retry(job);
        return;
      }
      if (!job.program.ok) throw new Error(job.program.error ?? 'The script could not be compiled');
      const warned = new Set<string>();
      const warn = (symbol: string, timeframe: string, reason: string): void => {
        const key = `${symbol}@${timeframe}`;
        if (warned.has(key)) return;
        warned.add(key);
        this.broadcast({
          op: 'alerts.warning',
          ruleId: job.rule.id,
          message: `request.*(${symbol}, ${timeframe}): ${reason}`,
        });
      };
      const fetchSeries: FetchSeries = async (symbol, timeframe, range) => {
        try {
          const at = symbol.indexOf(':');
          const prefix =
            at > 0 ? symbol.slice(0, at).toLowerCase() : job.rule.target.venue;
          const seriesHub = this.opts.hubs.get(prefix as VenueId);
          if (!seriesHub) {
            // The app has no provider for this venue; the engine returns na, like the chart.
            if (!this.skippedVenues.has(prefix)) {
              this.skippedVenues.add(prefix);
              console.warn(
                `[alerts] request.*(${symbol}, ${timeframe}): no provider for "${prefix}"`,
              );
            }
            return [];
          }
          const instruments = await seriesHub.getInstruments();
          const target = findPineInstrument(instruments, symbol);
          if (!target) {
            warn(symbol, timeframe, 'no matching instrument');
            return [];
          }
          const series = await seriesHub.getBars(target, timeframe, range.limit, {
            includeForming: false,
            from: range.from,
            to: range.to,
            priority: 'background',
          });
          if (series.length === 0) {
            warn(symbol, timeframe, 'no bars');
            return [];
          }
          return series.map(toPineBar);
        } catch (error) {
          warn(symbol, timeframe, errorMessage(error));
          return [];
        }
      };
      const session = new PineSession({
        program: job.program,
        instanceId: job.rule.id,
        market: marketOf(job.instrument, job.rule.timeframe),
        bars: bars.map(toPineBar),
        inputs: job.rule.inputs,
      });
      let outcome = session.run();
      for (let round = 0; outcome.needs.length > 0 && round < 2; round += 1) {
        const series = await fetchPineSeries(
          outcome.needs,
          fetchSeries,
          (need) => warn(need.symbol, need.timeframe, 'no bars'),
          60_000,
        );
        session.resume(series);
        outcome = session.run();
      }
      const run = outcome.result;
      if (!run.ok) throw new Error(run.error ?? 'The script failed');
      const events: AlertEvent[] = [];
      for (const alert of run.alerts) {
        const selected = alert.title
          ? job.rule.sites.includes(alert.title)
          : job.rule.includeAlert;
        if (!selected) continue;
        const site = alert.title ?? alert.site ?? alert.message;
        events.push({
          id: `rule:${job.rule.id}:${job.instrument.velaSymbol}:${alert.time}:${site}`,
          kind: 'rule',
          ruleId: job.rule.id,
          venue: job.instrument.venue,
          velaSymbol: job.instrument.velaSymbol,
          symbol: job.rule.target.symbol,
          timeframe: job.rule.timeframe,
          source: job.rule.name,
          site,
          message: alert.message,
          price: last.close,
          time: alert.time || last.openTime,
          receivedAt: Date.now(),
        });
      }
      job.lastBar = last.openTime;
      job.retries = 0;
      const evalKey = `${job.rule.id}:${job.rule.timeframe}:${job.instrument.velaSymbol}`;
      this.lastEvaluated.set(evalKey, last.openTime);
      if (events.length > 0) {
        this.record(events);
        this.broadcast({ op: 'alerts.event', events });
        if (job.rule.frequency === 'once') {
          job.active = false;
          this.retireOnceRule(job.rule.id);
          return;
        }
      }
      this.schedule(job);
    } catch (error) {
      if (!job.active || this.disposed) return;
      this.fail(job.rule.id, error);
      this.retry(job);
    }
  }

  /** The renderer may be gone; a restart must not re-fire this rule. */
  private retireOnceRule(ruleId: string): void {
    let changed = false;
    const rules = this.stored.rules.map((rule) => {
      if (rule.id !== ruleId || !rule.enabled) return rule;
      changed = true;
      return { ...rule, enabled: false, updatedAt: Date.now() };
    });
    if (!changed) return;
    this.stored = { ...this.stored, rules };
    this.persist();
  }

  private record(events: AlertEvent[]): void {
    const known = new Map(this.stored.events.map((event) => [event.id, event]));
    // A re-evaluated bar keeps its original position and receivedAt.
    for (const event of events) {
      if (!known.has(event.id)) known.set(event.id, event);
    }
    this.stored = {
      ...this.stored,
      events: [...known.values()]
        .sort((left, right) => right.receivedAt - left.receivedAt)
        .slice(0, MAX_STORED_EVENTS),
    };
    this.persist();
  }
}
