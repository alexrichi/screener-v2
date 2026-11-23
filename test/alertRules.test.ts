import { describe, expect, it } from 'vitest';
import {
  MAX_ALERT_RULES,
  MAX_ALERT_SCRIPT_CHARS,
  parseAlertRule,
  parseAlertRules,
  parseRunnerRules,
  runnerRules,
} from '../src/lib/alertRules';

function rulePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'r1',
    kind: 'chart',
    name: 'Probe',
    target: {
      kind: 'instrument',
      venue: 'binance',
      velaSymbol: 'BINANCE:BTCUSDT.P',
      symbol: 'BTCUSDT.P',
    },
    timeframe: '15',
    script: 'indicator("a")\nalert("hi")\n',
    inputs: { length: 14 },
    sites: ['Bullish'],
    includeAlert: false,
    frequency: 'once-per-bar-close',
    notify: { toast: true, sound: false, system: false },
    indicatorTitle: 'Probe indicator',
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    lastFiredAt: null,
    fireCount: 0,
    ...overrides,
  };
}

describe('parseAlertRule', () => {
  it('accepts a full rule and trims display strings', () => {
    const rule = parseAlertRule(
      rulePayload({ name: 'x'.repeat(200), indicatorTitle: 'y'.repeat(200) }),
    );
    expect(rule).not.toBeNull();
    expect(rule!.name).toHaveLength(120);
    if (rule!.kind !== 'chart') throw new Error('expected a chart rule');
    expect(rule!.indicatorTitle).toHaveLength(120);
    expect(rule!.notify).toEqual({ toast: true, sound: false, system: false });
    expect(rule!.lastFiredAt).toBeNull();
    expect(rule!.fireCount).toBe(0);
  });

  it('keeps a finite lastFiredAt and floors a negative fireCount', () => {
    const rule = parseAlertRule(rulePayload({ lastFiredAt: 123, fireCount: -1 }));
    expect(rule!.lastFiredAt).toBe(123);
    expect(rule!.fireCount).toBe(0);
  });

  it('drops malformed rules', () => {
    expect(parseAlertRule(rulePayload({ kind: 'screener' }))).toBeNull();
    expect(
      parseAlertRule(
        rulePayload({
          target: { kind: 'instrument', venue: 'nasdaq', velaSymbol: 'X', symbol: 'X' },
        }),
      ),
    ).toBeNull();
    expect(parseAlertRule(rulePayload({ script: '' }))).toBeNull();
    expect(parseAlertRule(rulePayload({ script: 'x'.repeat(MAX_ALERT_SCRIPT_CHARS + 1) }))).toBeNull();
    expect(parseAlertRule(rulePayload({ frequency: 'always' }))).toBeNull();
    expect(parseAlertRule(rulePayload({ sites: [], includeAlert: false }))).toBeNull();
    expect(parseAlertRule(rulePayload({ createdAt: 'x' }))).toBeNull();
  });

  it('accepts includeAlert without sites and filters non-scalar inputs', () => {
    const rule = parseAlertRule(
      rulePayload({
        sites: [],
        includeAlert: true,
        inputs: { a: 1, b: 's', c: true, d: null, e: Number.NaN },
      }),
    );
    expect(rule).not.toBeNull();
    if (rule!.kind !== 'chart') throw new Error('expected a chart rule');
    expect(rule!.sites).toEqual([]);
    expect(rule!.inputs).toEqual({ a: 1, b: 's', c: true });
  });
});

function pricePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'p1',
    kind: 'price',
    name: 'BTCUSDT.P Crossing 61 733.2',
    target: {
      kind: 'instrument',
      venue: 'binance',
      velaSymbol: 'BINANCE:BTCUSDT.P',
      symbol: 'BTCUSDT.P',
    },
    timeframe: '15',
    price: 61733.2,
    priceText: '61 733.2',
    condition: 'crossing',
    frequency: 'once',
    message: '  swept the level  ',
    notify: { toast: true, sound: false, system: false },
    enabled: true,
    createdAt: 1,
    updatedAt: 2,
    lastFiredAt: null,
    fireCount: 0,
    ...overrides,
  };
}

describe('parse price alert rules', () => {
  it('accepts crossing rules and trims the message', () => {
    const rule = parseAlertRule(pricePayload());
    expect(rule).not.toBeNull();
    if (rule?.kind !== 'price') throw new Error('expected a price rule');
    expect(rule.price).toBe(61733.2);
    expect(rule.priceText).toBe('61 733.2');
    expect(rule.condition).toBe('crossing');
    expect(rule.frequency).toBe('once');
    expect(rule.message).toBe('swept the level');
  });

  it('accepts every-time and both directions', () => {
    for (const condition of ['crossing-up', 'crossing-down'] as const) {
      const rule = parseAlertRule(
        pricePayload({ condition, frequency: 'every-time' }),
      );
      expect(rule?.kind).toBe('price');
    }
  });

  it('drops an invalid level, condition, frequency or display text', () => {
    expect(parseAlertRule(pricePayload({ price: 0 }))).toBeNull();
    expect(parseAlertRule(pricePayload({ priceText: '' }))).toBeNull();
    expect(parseAlertRule(pricePayload({ condition: 'above' }))).toBeNull();
    expect(parseAlertRule(pricePayload({ frequency: 'once-per-bar-close' }))).toBeNull();
  });
});

describe('parseAlertRules', () => {
  it('caps at MAX_ALERT_RULES and drops malformed entries inside the cap', () => {
    const many = Array.from({ length: MAX_ALERT_RULES + 5 }, (_, index) =>
      rulePayload({ id: `r${index}` }),
    );
    many[3] = { broken: true };
    const parsed = parseAlertRules(many);
    expect(parsed).toHaveLength(MAX_ALERT_RULES - 1);
    expect(parsed.some((rule) => rule.id === 'r3')).toBe(false);
    expect(parsed.some((rule) => rule.id === `r${MAX_ALERT_RULES - 1}`)).toBe(true);
    expect(parsed.some((rule) => rule.id === `r${MAX_ALERT_RULES}`)).toBe(false);
  });
});

describe('parseRunnerRules', () => {
  it('requires targets and caps the target list', () => {
    const noTargets = rulePayload({ id: 'no-targets' });
    const many = rulePayload({
      id: 'many',
      targets: Array.from({ length: 60 }, (_, index) => `BINANCE:S${index}`),
    });
    const parsed = parseRunnerRules([noTargets, many]);
    expect(parsed.map((rule) => rule.id)).toEqual(['many']);
    expect(parsed[0]!.targets).toHaveLength(50);
  });
});

describe('runnerRules', () => {
  it('resolves the chart target into a single-key target list', () => {
    const rule = parseAlertRule(rulePayload());
    expect(rule).not.toBeNull();
    const runner = runnerRules([rule!]);
    expect(runner[0]!.targets).toEqual(['BINANCE:BTCUSDT.P']);
  });
});
