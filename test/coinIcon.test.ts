import { describe, expect, it } from 'vitest';
import { coinIconCode, coinIconUrl } from '../src/lib/coinIcon';
import { SidecarVelaProvider } from '../src/venues/vela';

const ICON = 'http://127.0.0.1:8787/icon';
const V = '?v=2';

const icon = (code: string) => `${ICON}/${code}${V}`;

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

  it('builds a versioned sidecar URL', () => {
    expect(coinIconUrl('1000PEPE')).toBe(icon('PEPE'));
    expect(coinIconUrl('TSLA')).toBe(icon('TSLA'));
    expect(coinIconUrl('   ')).toBeUndefined();
  });

  it('resolves chart icons from venue tickers', () => {
    const provider = new SidecarVelaProvider('okx');
    expect(provider.resolveSymbolIcon({ ticker: 'BTC-USDT-SWAP' })).toBe(icon('BTC'));
    expect(provider.resolveSymbolIcon({ ticker: 'AAPLUSDT' })).toBe(icon('AAPL'));
    expect(provider.resolveSymbolIcon({ ticker: 'BTC/USD' })).toBe(icon('BTC'));
    expect(provider.resolveSymbolIcon({ ticker: 'BTCUSDT.P' })).toBe(icon('BTC'));
    expect(provider.resolveSymbolIcon({ ticker: 'AAPLUSDT.P' })).toBe(icon('AAPL'));
    expect(provider.resolveSymbolIcon({ ticker: '1000PEPEUSDT.P' })).toBe(icon('PEPE'));
    expect(provider.resolveSymbolIcon({ ticker: 'kPEPE' })).toBe(icon('PEPE'));
    expect(
      provider.resolveSymbolIcon({
        ticker: '1000PEPE-USDT-SWAP',
        description: '1000PEPE / USDT Perpetual',
      }),
    ).toBe(icon('PEPE'));
  });
});
