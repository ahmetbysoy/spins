import { describe, it, expect } from 'vitest';
import { Candle } from './types';
import {
  patternOutcome,
  patternId,
  patternName,
  patternAllIds,
  intervalToSeconds,
  PATTERN_NAMES
} from './pattern-engine';
import { isAllowedBinancePath } from './proxy-allowlist';

function candles(closes: number[], spread = 0.5): Candle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 60,
    open: c,
    high: c + spread,
    low: c - spread,
    close: c,
    volume: 100
  }));
}

describe('pattern taksonomisi', () => {
  it('tam 48 desen üretir (3 pair × 2 yön × 4 SAR bucket × 2 filtre)', () => {
    expect(patternAllIds().length).toBe(48);
    expect(Object.keys(PATTERN_NAMES).length).toBe(48);
  });

  it('patternId ve patternName tutarlı', () => {
    const id = patternId('9x21', 'UP', 'SAR0', 'F1');
    expect(id).toBe('9x21_UP_SAR0_F1');
    expect(patternName(id)).toContain('Golden Cross');
    expect(patternName('9x21_DOWN_SARX_F0')).toContain('Death Cross');
  });

  it('bilinmeyen id için düşmeden okunabilir bir isim döner', () => {
    expect(patternName('')).toBe('—');
    expect(patternName('garip_id')).toBe('garip_id');
  });
});

describe('intervalToSeconds', () => {
  it('bilinen TF değerleri', () => {
    expect(intervalToSeconds('1m')).toBe(60);
    expect(intervalToSeconds('5m')).toBe(300);
  });
});

describe('patternOutcome', () => {
  it('ileriye 20 mum yoksa null döner', () => {
    const cs = candles(new Array(15).fill(100));
    expect(patternOutcome(cs, 5, 'UP')).toBeNull();
  });

  it('yükselen seride UP yönü pozitif getiri üretir', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const out = patternOutcome(candles(closes), 5, 'UP')!;
    expect(out).not.toBeNull();
    expect(out.ret10).toBeGreaterThan(0);
    expect(out.mfe20).toBeGreaterThan(0);
    expect(out.barsToMfe).toBe(20); // sürekli yükselişte MFE en son barda
  });

  it('yükselen seride DOWN yönü negatif getiri üretir (simetri)', () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const out = patternOutcome(candles(closes), 5, 'DOWN')!;
    expect(out.ret10).toBeLessThan(0);
    expect(out.mae20).toBeGreaterThan(0);
  });

  it('stop yiyen senaryoda rMultiple -1 olur', () => {
    // %0.3 stop: ilk barda ters yönde derin fitil
    const closes = new Array(40).fill(100);
    const cs = candles(closes, 2); // low = 98 → %2 aleyhte hareket, stop tetiklenir
    const out = patternOutcome(cs, 5, 'UP')!;
    expect(out.rMultiple).toBe(-1);
  });
});

describe('binance proxy allowlist', () => {
  it('geçerli fapi yollarına izin verir', () => {
    expect(isAllowedBinancePath('fapi/v1/klines')).toBe(true);
    expect(isAllowedBinancePath('fapi/v1/premiumIndex')).toBe(true);
    expect(isAllowedBinancePath('fapi/v2/positionRisk')).toBe(true);
    expect(isAllowedBinancePath('fapi/v1/ticker/24hr')).toBe(true);
  });

  it('allowlist dışını reddeder', () => {
    expect(isAllowedBinancePath('sapi/v1/capital')).toBe(false);
    expect(isAllowedBinancePath('fapi/v3/klines')).toBe(false);
    expect(isAllowedBinancePath('fapi/v1/../../evil')).toBe(false);
    expect(isAllowedBinancePath('fapi/v1/klines?symbol=X')).toBe(false);
    expect(isAllowedBinancePath('')).toBe(false);
    expect(isAllowedBinancePath('https://evil.com/fapi/v1/klines')).toBe(false);
  });
});
