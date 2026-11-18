import { describe, expect, it } from 'vitest';
import { coinIconCode, coinIconUrl } from '../src/lib/coinIcon';
import { SidecarVelaProvider } from '../src/venues/vela';

const ICON = 'http://127.0.0.1:8787/icon';

describe('coin icons', () => {
  it('keeps a plain base asset', () => {
    expect(coinIconCode('BTC')).toBe('BTC');
    expect(coinIconCode('aapl')).toBe('AAPL');
  });

  it('drops contract multipliers', () => {
    expect(coinIconCode('1000PEPE')).toBe('PEPE');
    expect(coinIconCode('10000SATS')).toBe('SATS');
    expect(coinIconCode('1MBABYDOGE')).toBe('BABYDOGE');
    expect(coinIconCode('kPEPE')).toBe('PEPE');
  });

  it('leaves tickers that merely start with a digit or K alone', () => {
    expect(coinIconCode('1INCH')).toBe('1INCH');
    expect(coinIconCode('KAS')).toBe('KAS');
    expect(coinIconCode('KAVA')).toBe('KAVA');
  });

  it('builds a sidecar URL', () => {
    expect(coinIconUrl('1000PEPE')).toBe(`${ICON}/PEPE`);
    expect(coinIconUrl('TSLA')).toBe(`${ICON}/TSLA`);
    expect(coinIconUrl('   ')).toBeUndefined();
  });

  it('resolves chart icons from venue tickers', () => {
    const provider = new SidecarVelaProvider('okx');
    expect(provider.resolveSymbolIcon({ ticker: 'BTC-USDT-SWAP' })).toBe(`${ICON}/BTC`);
    expect(provider.resolveSymbolIcon({ ticker: 'AAPLUSDT' })).toBe(`${ICON}/AAPL`);
    expect(provider.resolveSymbolIcon({ ticker: 'BTC/USD' })).toBe(`${ICON}/BTC`);
    expect(provider.resolveSymbolIcon({ ticker: 'BTCUSDT.P' })).toBe(`${ICON}/BTC`);
    expect(provider.resolveSymbolIcon({ ticker: 'AAPLUSDT.P' })).toBe(`${ICON}/AAPL`);
    expect(provider.resolveSymbolIcon({ ticker: '1000PEPEUSDT.P' })).toBe(`${ICON}/PEPE`);
    expect(provider.resolveSymbolIcon({ ticker: 'kPEPE' })).toBe(`${ICON}/PEPE`);
    expect(
      provider.resolveSymbolIcon({
        ticker: '1000PEPE-USDT-SWAP',
        description: '1000PEPE / USDT Perpetual',
      }),
    ).toBe(`${ICON}/PEPE`);
  });
});
