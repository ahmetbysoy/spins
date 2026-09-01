import { describe, it, expect } from 'vitest';
import { Candle } from './types';
import {
  sma,
  ema,
  psar,
  bollingerBands,
  rsi,
  macd,
  vwap,
  wilsonLower,
  percentile,
  median,
  std,
  avg
} from './indicators';

/** Sentetik mum üretici: closes dizisinden düz OHLCV mumları yapar. */
function candles(closes: number[], spread = 0.5, volume = 100): Candle[] {
  return closes.map((c, i) => ({
    time: 1_700_000_000 + i * 60,
    open: c,
    high: c + spread,
    low: c - spread,
    close: c,
    volume
  }));
}

describe('sma', () => {
  it('bilinen değerleri hesaplar (period=3)', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('period dizi uzunluğundan büyükse hepsi null döner', () => {
    expect(sma([1, 2], 5)).toEqual([null, null]);
  });
});

describe('ema', () => {
  it('seed olarak ilk period elemanın SMA\'sını kullanır, sonra üstel devam eder', () => {
    const out = ema([1, 2, 3, 4], 2); // k = 2/3
    expect(out[0]).toBeNull();
    expect(out[1]).toBeCloseTo(1.5, 10);
    expect(out[2]).toBeCloseTo(2.5, 10);
    expect(out[3]).toBeCloseTo(3.5, 10);
  });

  it('sabit seride sabit kalır ve null girdileri atlar', () => {
    const out = ema([null, 5, 5, 5, 5], 3);
    expect(out[0]).toBeNull();
    expect(out[4]).toBeCloseTo(5, 10);
  });
});

describe('psar', () => {
  it('V şeklinde dönüşte trend bayrağını çevirir', () => {
    const up = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const down = [108, 105, 102, 99, 96, 93, 90, 87, 84];
    const { sar, trend } = psar(candles([...up, ...down]), 0.02, 0.2);
    // Yükseliş bacağında boğa trendi
    expect(trend[8]).toBe(1);
    // Sert düşüş sonunda ayı trendine dönmüş olmalı
    expect(trend[trend.length - 1]).toBe(-1);
    // SAR değerleri warmup (ilk 2 bar) sonrası dolu
    expect(sar[2]).not.toBeNull();
  });

  it('3 mumdan kısa dizide null döner', () => {
    const { sar, trend } = psar(candles([1, 2]), 0.02, 0.2);
    expect(sar.every((v) => v === null)).toBe(true);
    expect(trend.every((v) => v === null)).toBe(true);
  });
});

describe('bollingerBands', () => {
  it('sabit seride upper = mid = lower', () => {
    const cs = candles(new Array(25).fill(50));
    const { upper, mid, lower } = bollingerBands(cs, 20, 2);
    const i = 24;
    expect(mid[i]).toBeCloseTo(50, 10);
    expect(upper[i]).toBeCloseTo(50, 10);
    expect(lower[i]).toBeCloseTo(50, 10);
  });
});

describe('rsi', () => {
  it('kesintisiz yükselen seride 100\'e yakınsar', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = rsi(closes, 14);
    expect(out[closes.length - 1]!).toBeGreaterThan(99);
  });

  it('period\'dan kısa seride null döner', () => {
    expect(rsi([1, 2, 3], 14).every((v) => v === null)).toBe(true);
  });
});

describe('macd', () => {
  it('fast >= slow verilirse slow otomatik düzeltilir ve değer üretir', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 3);
    const { line, signal, hist } = macd(closes, 26, 12, 9);
    const i = closes.length - 1;
    expect(line[i]).not.toBeNull();
    expect(signal[i]).not.toBeNull();
    expect(hist[i]).toBeCloseTo(line[i]! - signal[i]!, 10);
  });
});

describe('vwap', () => {
  it('sabit fiyat ve hacimde tipik fiyata eşittir', () => {
    const cs = candles(new Array(10).fill(200), 1); // typ = (201+199+200)/3 = 200
    const out = vwap(cs);
    expect(out[9]).toBeCloseTo(200, 10);
  });
});

describe('wilsonLower', () => {
  it('n=0 için 0 döner', () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(5, 0)).toBe(0);
  });

  it('10/10 kazanç bile %100 güven vermez', () => {
    const w = wilsonLower(10, 10);
    expect(w).toBeGreaterThan(60);
    expect(w).toBeLessThan(100);
  });

  it('aynı oranla örnek büyüdükçe alt sınır yükselir (daralan aralık)', () => {
    expect(wilsonLower(50, 100)).toBeGreaterThan(wilsonLower(5, 10));
    expect(wilsonLower(500, 1000)).toBeGreaterThan(wilsonLower(50, 100));
  });
});

describe('percentile / median / std / avg', () => {
  it('percentile null\'ları filtreler ve interpolasyon yapar', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBeCloseTo(5.5, 10);
    expect(percentile([null, 10, null, 20], 0.5)).toBeCloseTo(15, 10);
    expect(percentile([null, null], 0.5)).toBeNull();
  });

  it('median tek/çift eleman', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('sabit seride std=0, boş dizide avg=0', () => {
    expect(std([7, 7, 7, 7])).toBe(0);
    expect(avg([])).toBe(0);
  });
});
