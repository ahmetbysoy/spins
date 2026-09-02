import { describe, expect, it } from 'vitest';
import { Candle, PatternStats, Ticker24h } from './types';
import { pickScannerUniverse, scanCandlesForHits, SCANNER_POOL_MIN_WILSON } from './scanner-engine';

// --- Yardımcılar -------------------------------------------------------------

function genSeries(segs: { n: number; from: number; to: number }[], startTs = 1_700_000_000): Candle[] {
  const out: Candle[] = [];
  let t = startTs;
  for (const seg of segs) {
    for (let k = 0; k < seg.n; k++) {
      const p = seg.from + (seg.to - seg.from) * (k / Math.max(1, seg.n - 1));
      out.push({ time: t, open: p, high: p * 1.0015, low: p * 0.9985, close: p, volume: 100 });
      t += 300; // 5m
    }
  }
  return out;
}

const tickers = (vols: Record<string, number>): Ticker24h[] =>
  Object.entries(vols).map(([symbol, quoteVolume]) => ({
    symbol,
    lastPrice: 1,
    priceChangePercent: 0,
    quoteVolume,
    highPrice: 1,
    lowPrice: 1,
    count: 1
  }));

// --- Evren seçimi -------------------------------------------------------------

describe('pickScannerUniverse', () => {
  const t = tickers({
    BTCUSDT: 5_000_000_000,
    ETHUSDT: 3_000_000_000,
    SOLUSDT: 1_500_000_000,
    XRPUSDT: 800_000_000,
    DOGEUSDT: 500_000_000,
    ADAUSDT: 300_000_000
  });

  it('favorileri öne alır, hacim liderlerini ekler, dedup uygular', () => {
    const uni = pickScannerUniverse(t, { favs: ['ADAUSDT', 'ETHUSDT'], topN: 3 });
    expect(uni[0]).toBe('ADAUSDT'); // favori önce
    expect(uni).toContain('ETHUSDT');
    expect(new Set(uni).size).toBe(uni.length);
    expect(uni).toContain('BTCUSDT'); // hacim lideri
  });

  it('listedede olmayan favoriyi yok sayar', () => {
    const uni = pickScannerUniverse(t, { favs: ['GARIPUSDT'], topN: 2 });
    expect(uni).not.toContain('GARIPUSDT');
    expect(uni[0]).toBe('BTCUSDT');
  });

  it('seçili sembolü hariç tutar', () => {
    const uni = pickScannerUniverse(t, { topN: 10, exclude: 'BTCUSDT' });
    expect(uni).not.toContain('BTCUSDT');
  });

  it('üst sınırı (maxSymbols) aşmaz', () => {
    const many = tickers(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`S${i}USDT`, 1000 - i])));
    const uni = pickScannerUniverse(many, { topN: 30, favs: [] });
    expect(uni.length).toBeLessThanOrEqual(16);
  });

  it('topN=2 → favori + en fazla 2 hacim lideri hedefi', () => {
    const uni = pickScannerUniverse(t, { favs: ['ADAUSDT'], topN: 2 });
    expect(uni.length).toBe(3); // 1 fav + 2 lider
    expect(uni).toEqual(['ADAUSDT', 'BTCUSDT', 'ETHUSDT']);
  });
});

// --- Desen taraması -------------------------------------------------------------

const BASE = { ma1: 9, ma2: 21, ma3: 50, sarStep: 0.02, sarMax: 0.2 };

describe('scanCandlesForHits', () => {
  it('düşüş→yükseliş serisinde AL kurgusu yakalar', async () => {
    const candles = genSeries([
      { n: 90, from: 80, to: 130 }, // yükseliş: 21MA ve 50MA üst bölgeye
      { n: 14, from: 130, to: 121 }, // sığ V dibi: 9MA, 21MA altına iner (21 > 50 korunur)
      { n: 16, from: 121, to: 150 } // tekrar yükseliş: 9x21 golden cross
    ]);
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, { ...BASE, lookbackBars: 30 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.dir === 'AL')).toBe(true);
    hits.forEach((h) => {
      expect(h.symbol).toBe('TESTUSDT');
      expect(h.pair).toBe('9x21');
      expect(h.sarBucket).not.toBe('SARX');
      expect(h.price).toBeGreaterThan(0);
    });
  });

  it('yükseliş→düşüş serisinde SAT kurgusu yakalar', async () => {
    const candles = genSeries([
      { n: 90, from: 130, to: 80 }, // düşüş: 21MA ve 50MA alt bölgeye
      { n: 14, from: 80, to: 89 }, // sığ A tepesi: 9MA, 21MA üstüne çıkar (21 < 50 korunur)
      { n: 16, from: 89, to: 60 } // tekrar düşüş: 9x21 death cross
    ]);
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, { ...BASE, lookbackBars: 30 });
    expect(hits.some((h) => h.dir === 'SAT')).toBe(true);
  });

  it('lookback dışındaki eski kurguları saymaz', async () => {
    const candles = genSeries([
      { n: 110, from: 130, to: 80 },
      { n: 45, from: 80, to: 135 },
      { n: 30, from: 135, to: 136 } // uzun düz seyir: son 30 mumda cross yok
    ]);
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, { ...BASE, lookbackBars: 3 });
    expect(hits).toHaveLength(0);
  });

  it('yetersiz mum verisinde boş döner', async () => {
    const candles = genSeries([{ n: 40, from: 100, to: 110 }]);
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, BASE);
    expect(hits).toHaveLength(0);
  });

  it('statsLookup yoksa yalnızca birincil çift (9x21) hit üretir', async () => {
    const candles = genSeries([
      { n: 90, from: 80, to: 130 },
      { n: 14, from: 130, to: 121 },
      { n: 16, from: 121, to: 150 }
    ]);
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, { ...BASE, lookbackBars: 60 });
    expect(hits.length).toBeGreaterThan(0);
    hits.forEach((h) => expect(h.pair).toBe('9x21'));
    hits.forEach((h) => expect(h.poolApproved).toBe(false));
  });

  it('güçlü havuz istatistiği ikincil çiftleri onaylar', async () => {
    // Derin V: 21MA, 50MA altına inip tekrar keser -> 21x50 ikincil cross'ları oluşur
    const candles = genSeries([
      { n: 90, from: 80, to: 130 },
      { n: 30, from: 130, to: 105 },
      { n: 25, from: 105, to: 145 }
    ]);
    const strong: PatternStats = {
      key: '5m:9x50_UP_SAR0_F1',
      schemaVersion: 1,
      updatedAt: Date.now(),
      scope: 'global',
      timeframe: '5m',
      patternId: '9x50_UP_SAR0_F1',
      n: 50,
      wins: 32,
      winRate: 64,
      wilsonLower: SCANNER_POOL_MIN_WILSON + 5,
      avgRet10: 0.3,
      stdRet10: 0.1,
      avgMfe20: 0.5,
      avgMae20: 0.3,
      avgRMultiple: 1.2,
      medBarsToMfe: 6,
      weightedWinRate: 64,
      weightedAvgRet10: 0.3,
      regimes: {}
    };
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, { ...BASE, lookbackBars: 60 }, async () => strong);
    expect(hits.some((h) => h.poolApproved)).toBe(true);
    expect(hits.some((h) => h.pair !== '9x21')).toBe(true);
  });

  it('zayıf havuz istatistiği ikincil çiftleri reddeder', async () => {
    const candles = genSeries([
      { n: 90, from: 80, to: 130 },
      { n: 30, from: 130, to: 105 },
      { n: 25, from: 105, to: 145 }
    ]);
    const weak = {
      n: 50,
      wins: 20,
      winRate: 40,
      wilsonLower: 30
    } as unknown as PatternStats;
    const hits = await scanCandlesForHits('TESTUSDT', '5m', candles, { ...BASE, lookbackBars: 60 }, async () => weak);
    hits.forEach((h) => expect(h.pair).toBe('9x21'));
  });
});
