import { describe, expect, it } from 'vitest';
import { scanAlertSites, scriptTitle } from '../src/lib/alertSites';

describe('scanAlertSites', () => {
  it('reads positional and named titles in source order', () => {
    const scan = scanAlertSites(`//@version=6
indicator("Demo")
alertcondition(close > open, "Bullish")
alertcondition(close < open, title = "Bearish")
`);
    expect(scan.conditions).toEqual(['Bullish', 'Bearish']);
    expect(scan.untitled).toBe(0);
  });

  it('ignores calls inside comments and string literals', () => {
    const scan = scanAlertSites(`indicator("Demo")
// alertcondition(close > open, "Nope line")
/* alertcondition(close > open, "Nope block") */
s = "alertcondition(close > open, 'Nope')"
s2 = 'alert("Nope")'
`);
    expect(scan.conditions).toEqual([]);
    expect(scan.untitled).toBe(0);
    expect(scan.hasAlert).toBe(false);
  });

  it('counts alertcondition calls without a static title', () => {
    const scan = scanAlertSites(`indicator("Demo")
alertcondition(ta.crossover(fast, slow))
alertcondition(ta.crossunder(fast, slow), title = cond ? "A" : "B")
`);
    expect(scan.conditions).toEqual([]);
    expect(scan.untitled).toBe(2);
  });

  it('detects plain alert() calls but not alertcondition', () => {
    expect(scanAlertSites('indicator("a")\nalert("hi")\n').hasAlert).toBe(true);
    expect(
      scanAlertSites('indicator("a")\nalertcondition(close > open, "X")\n').hasAlert,
    ).toBe(false);
  });

  it('lists a repeated title once', () => {
    const scan = scanAlertSites(
      'indicator("a")\nalertcondition(close > open, "Dup")\nalertcondition(close < open, "Dup")\n',
    );
    expect(scan.conditions).toEqual(['Dup']);
  });
});

describe('scriptTitle', () => {
  it('reads positional and named titles of indicators and strategies', () => {
    expect(scriptTitle('indicator("RSI probe")')).toBe('RSI probe');
    expect(scriptTitle('strategy(title = "Bot")')).toBe('Bot');
  });

  it('returns null without a static title', () => {
    expect(scriptTitle('indicator(name)')).toBeNull();
    expect(scriptTitle('plot(close)')).toBeNull();
  });
});
