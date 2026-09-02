import { describe, expect, it } from 'vitest';
import { PatternEvent } from './types';
import {
  buildEquityCurve,
  computeBacktestStats,
  filterBacktestEvents,
  monthlyBreakdown,
  patternBreakdown,
  rMultipleHistogram
} from './backtest';

let idSeq = 1;
function ev(over: Partial<PatternEvent> = {}): PatternEvent {
  return {
    id: idSeq++,
    schemaVersion: 1,
    source: 'backfill',
    coin: 'BTCUSDT',
    timeframe: '5m',
    timestamp: 1_700_000_000_000,
    eventKey: `k${idSeq}`,
    pair: '9x21',
    dir: 'UP',
    filter: 'F1',
    sarBucket: 'SAR0',
    patternId: '9x21_UP_SAR0_F1',
    patternKey: '5m:9x21_UP_SAR0_F1',
    coinPatternKey: 'BTCUSDT:5m:9x21_UP_SAR0_F1',
    volRegime: 'MID',
    trendRegime: 'UP',
    regimeKey: 'MID_UP',
    refClose: 100,
    status: 'settled',
    createdAt: 1_700_000_000_000,
    settledAt: 1_700_001_200_000,
    ret10: 0.3,
    mfe20: 0.6,
    mae20: 0.2,
    rMultiple: 1.5,
    ...over
  };
}

describe('filterBacktestEvents', () => {
  it('yalnızca settled kayıtları zamana göre artan sıralar', () => {
    const events = [
      ev({ timestamp: 3000, status: 'tracking' }),
      ev({ timestamp: 2000 }),
      ev({ timestamp: 1000 })
    ];
    const out = filterBacktestEvents(events);
    expect(out).toHaveLength(2);
    expect(out[0].timestamp).toBe(1000);
    expect(out[1].timestamp).toBe(2000);
  });

  it('coin/timeframe/yön/sar/filter/source filtreleri uygular', () => {
    const events = [
      ev({ coin: 'BTCUSDT', timeframe: '5m', dir: 'UP' }),
      ev({ coin: 'ETHUSDT', timeframe: '5m', dir: 'DOWN' }),
      ev({ coin: 'BTCUSDT', timeframe: '1m', dir: 'UP', source: 'live' }),
      ev({ coin: 'BTCUSDT', timeframe: '5m', dir: 'UP', sarBucket: 'SARX' })
    ];
    expect(filterBacktestEvents(events, { coin: 'BTCUSDT' })).toHaveLength(3);
    expect(filterBacktestEvents(events, { coin: 'ETHUSDT' })).toHaveLength(1);
    expect(filterBacktestEvents(events, { timeframe: '1m' })).toHaveLength(1);
    expect(filterBacktestEvents(events, { dir: 'DOWN' })).toHaveLength(1);
    expect(filterBacktestEvents(events, { sarBucket: 'SARX' })).toHaveLength(1);
    expect(filterBacktestEvents(events, { source: 'live' })).toHaveLength(1);
    expect(filterBacktestEvents(events, { filter: 'F1' })).toHaveLength(4);
  });

  it('tarih aralığı uygular (dahil sınırlar)', () => {
    const events = [ev({ timestamp: 1000 }), ev({ timestamp: 2000 }), ev({ timestamp: 3000 })];
    expect(filterBacktestEvents(events, { fromTs: 2000 })).toHaveLength(2);
    expect(filterBacktestEvents(events, { toTs: 2000 })).toHaveLength(2);
    expect(filterBacktestEvents(events, { fromTs: 1000, toTs: 3000 })).toHaveLength(3);
  });
});

describe('computeBacktestStats', () => {
  it('temel istatistikleri doğru hesaplar', () => {
    const events = [
      ev({ ret10: 0.5, rMultiple: 2 }),
      ev({ ret10: -0.2, rMultiple: -1 }),
      ev({ ret10: 0.4, rMultiple: 1.5 }),
      ev({ ret10: -0.1, rMultiple: -1 })
    ];
    const s = computeBacktestStats(events, 0.15);
    expect(s.n).toBe(4);
    expect(s.wins).toBe(2);
    expect(s.winRate).toBe(50);
    expect(s.totalRet10).toBeCloseTo(0.6, 10);
    expect(s.avgRet10).toBeCloseTo(0.15, 10);
    expect(s.profitFactor).toBeCloseTo(0.9 / 0.3, 10); // 0.5+0.4 / 0.2+0.1
    expect(s.wilsonLower).toBeGreaterThan(0);
  });

  it('negatif yoksa profitFactor null', () => {
    const s = computeBacktestStats([ev({ ret10: 0.5 }), ev({ ret10: 0.2 })]);
    expect(s.profitFactor).toBeNull();
  });

  it('max drawdown tepe-dip düşüşünü yakalar', () => {
    // +1, -0.6, +0.1 → eğri: 1, 0.4, 0.5 → dd = 0.6
    const s = computeBacktestStats([ev({ ret10: 1 }), ev({ ret10: -0.6 }), ev({ ret10: 0.1 })]);
    expect(s.maxDrawdown).toBeCloseTo(0.6, 10);
  });

  it('galibiyet/mağlubiyet serilerini sayar', () => {
    const events = [
      ev({ ret10: 0.5 }),
      ev({ ret10: 0.4 }),
      ev({ ret10: 0.3 }),
      ev({ ret10: -0.2 }),
      ev({ ret10: -0.1 })
    ];
    const s = computeBacktestStats(events, 0.15);
    expect(s.bestStreak).toBe(3);
    expect(s.worstStreak).toBe(2);
  });

  it('boş girdide güvenli döner', () => {
    const s = computeBacktestStats([]);
    expect(s.n).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.maxDrawdown).toBe(0);
    expect(s.profitFactor).toBeNull();
  });
});

describe('buildEquityCurve', () => {
  it('kümülatif eğriyi yerleşim zamanına göre kurar', () => {
    const events = [
      ev({ timestamp: 3000, settledAt: 4200, ret10: 0.3 }),
      ev({ timestamp: 1000, settledAt: 2200, ret10: 0.2 }),
      ev({ timestamp: 2000, settledAt: 3200, ret10: -0.1 })
    ];
    const curve = buildEquityCurve(events);
    expect(curve.map((p) => p.value)).toEqual([0.2, 0.1, 0.4]);
    expect(curve[0].time).toBe(2); // 2200ms → 2sn
  });
});

describe('monthlyBreakdown', () => {
  it('ay hücrelerini toplar ve sıralar', () => {
    const events = [
      ev({ timestamp: Date.UTC(2026, 0, 15), ret10: 0.5 }),
      ev({ timestamp: Date.UTC(2026, 0, 20), ret10: -0.1 }),
      ev({ timestamp: Date.UTC(2026, 1, 5), ret10: 0.3 })
    ];
    const cells = monthlyBreakdown(events, 0.15);
    expect(cells).toHaveLength(2);
    expect(cells[0].ym).toBe('2026-01');
    expect(cells[0].n).toBe(2);
    expect(cells[0].sum).toBeCloseTo(0.4, 10);
    expect(cells[0].winRate).toBe(50);
    expect(cells[1].ym).toBe('2026-02');
  });
});

describe('patternBreakdown', () => {
  it('desen bazlı agregasyon ve Wilson sıralaması', () => {
    const events = [
      ...Array.from({ length: 10 }, () => ev({ patternId: 'A', ret10: 0.4 })),
      ...Array.from({ length: 10 }, () => ev({ patternId: 'B', ret10: -0.2 }))
    ];
    const rows = patternBreakdown(events, 0.15);
    expect(rows).toHaveLength(2);
    expect(rows[0].patternId).toBe('A');
    expect(rows[0].winRate).toBe(100);
    expect(rows[1].patternId).toBe('B');
    expect(rows[1].winRate).toBe(0);
    expect(rows[0].wilsonLower).toBeGreaterThan(rows[1].wilsonLower);
  });

  it("patternId'siz kayıtları atlar", () => {
    expect(patternBreakdown([ev({ patternId: undefined })])).toHaveLength(0);
  });
});

describe('rMultipleHistogram', () => {
  it('kovmaları doğru sayar', () => {
    const events = [
      ev({ rMultiple: -1 }),
      ev({ rMultiple: 0.3 }),
      ev({ rMultiple: 0.7 }),
      ev({ rMultiple: 1.5 }),
      ev({ rMultiple: 2.5 }),
      ev({ rMultiple: 4 })
    ];
    const h = rMultipleHistogram(events);
    const byLabel = Object.fromEntries(h.map((b) => [b.label, b.count]));
    expect(byLabel['≤-1R']).toBe(1); // r=-1 ilk kovaya düşer (r <= -1)
    expect(byLabel['-1..0R']).toBe(0);
    expect(byLabel['0..0.5R']).toBe(1);
    expect(byLabel['0.5..1R']).toBe(1);
    expect(byLabel['1..2R']).toBe(1);
    expect(byLabel['2..3R']).toBe(1);
    expect(byLabel['>3R']).toBe(1);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(events.length);
  });
});
