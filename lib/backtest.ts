// Desen havuzu backtest analitiği — saf fonksiyonlar, birim test edilebilir.
// Girdi: IndexedDB 'events' store'undaki settled PatternEvent kayıtları.
import { PatternEvent } from './types';
import { wilsonLower, avg, std, median } from './indicators';

export interface BacktestFilters {
  coin?: string | 'ALL';
  timeframe?: string | 'ALL';
  dir?: 'ALL' | 'UP' | 'DOWN';
  sarBucket?: 'ALL' | 'SAR0' | 'SAR1' | 'SAR2-3' | 'SARX';
  filter?: 'ALL' | 'F1' | 'F0';
  source?: 'ALL' | 'live' | 'backfill';
  /** ms, dahil */
  fromTs?: number;
  /** ms, dahil */
  toTs?: number;
}

/** Settled event'leri filtreleyip zamana göre artan sıralar. */
export function filterBacktestEvents(events: PatternEvent[], f: BacktestFilters = {}): PatternEvent[] {
  return events
    .filter((e) => e.status === 'settled')
    .filter((e) => (f.coin && f.coin !== 'ALL' ? e.coin === f.coin : true))
    .filter((e) => (f.timeframe && f.timeframe !== 'ALL' ? e.timeframe === f.timeframe : true))
    .filter((e) => (f.dir && f.dir !== 'ALL' ? e.dir === f.dir : true))
    .filter((e) => (f.sarBucket && f.sarBucket !== 'ALL' ? e.sarBucket === f.sarBucket : true))
    .filter((e) => (f.filter && f.filter !== 'ALL' ? e.filter === f.filter : true))
    .filter((e) => (f.source && f.source !== 'ALL' ? e.source === f.source : true))
    .filter((e) => (f.fromTs ? e.timestamp >= f.fromTs : true))
    .filter((e) => (f.toTs ? e.timestamp <= f.toTs : true))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export interface BacktestStats {
  n: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
  totalRet10: number;
  avgRet10: number;
  medRet10: number;
  stdRet10: number;
  /** toplam pozitif ret10 / |toplam negatif ret10| — negatif yoksa null (sonsuz) */
  profitFactor: number | null;
  avgMfe20: number;
  avgMae20: number;
  avgRMultiple: number;
  /** equity eğrisindeki en büyük tepe-dip düşüşü (ret10 puanı cinsinden, pozitif) */
  maxDrawdown: number;
  bestStreak: number;
  worstStreak: number;
}

export function computeBacktestStats(events: PatternEvent[], winThreshold = 0.15): BacktestStats {
  const n = events.length;
  const rets = events.map((e) => e.ret10 ?? 0);
  const wins = rets.filter((r) => r > winThreshold).length;

  const grossPos = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const grossNeg = rets.filter((r) => r < 0).reduce((a, b) => a + b, 0);

  // Kümülatif eğriden max drawdown ve seriler
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let bestStreak = 0;
  let worstStreak = 0;
  for (const r of rets) {
    cum += r;
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDd) maxDd = dd;

    if (r > winThreshold) {
      streak = streak > 0 ? streak + 1 : 1;
    } else if (r <= 0) {
      streak = streak < 0 ? streak - 1 : -1;
    } else {
      streak = 0; // eşik altı ama pozitif: nötr
    }
    if (streak > bestStreak) bestStreak = streak;
    if (streak < worstStreak) worstStreak = streak;
  }

  return {
    n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    wilsonLower: wilsonLower(wins, n),
    totalRet10: cum,
    avgRet10: avg(rets),
    medRet10: median(rets),
    stdRet10: std(rets),
    profitFactor: grossNeg < 0 ? grossPos / Math.abs(grossNeg) : null,
    avgMfe20: avg(events.map((e) => e.mfe20 ?? 0)),
    avgMae20: avg(events.map((e) => e.mae20 ?? 0)),
    avgRMultiple: avg(events.map((e) => e.rMultiple ?? 0)),
    maxDrawdown: maxDd,
    bestStreak,
    worstStreak: Math.abs(worstStreak)
  };
}

export interface EquityPoint {
  time: number; // unix saniye
  value: number; // kümülatif ret10
}

/** Settled event'lerden kümülatif ret10 eğrisi üretir (yerleşim zamanına göre). */
export function buildEquityCurve(events: PatternEvent[]): EquityPoint[] {
  const sorted = [...events].sort(
    (a, b) => (a.settledAt || a.timestamp) - (b.settledAt || b.timestamp)
  );
  let cum = 0;
  return sorted.map((e) => {
    cum += e.ret10 ?? 0;
    return { time: Math.floor((e.settledAt || e.timestamp) / 1000), value: cum };
  });
}

export interface MonthCell {
  ym: string; // YYYY-MM
  n: number;
  sum: number;
  wins: number;
  winRate: number;
}

/** Ay bazlı toplam ret10 kırılımı. */
export function monthlyBreakdown(events: PatternEvent[], winThreshold = 0.15): MonthCell[] {
  const map = new Map<string, MonthCell>();
  events.forEach((e) => {
    const ym = new Date(e.timestamp).toISOString().slice(0, 7);
    const cell = map.get(ym) || { ym, n: 0, sum: 0, wins: 0, winRate: 0 };
    cell.n++;
    cell.sum += e.ret10 ?? 0;
    if ((e.ret10 ?? 0) > winThreshold) cell.wins++;
    map.set(ym, cell);
  });
  const cells = [...map.values()].sort((a, b) => a.ym.localeCompare(b.ym));
  cells.forEach((c) => (c.winRate = c.n ? (c.wins / c.n) * 100 : 0));
  return cells;
}

export interface PatternRow {
  patternId: string;
  n: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
  avgRet10: number;
  avgMfe20: number;
  avgMae20: number;
}

/** Desen bazlı agregasyon (havuz istatistiklerinden bağımsız, anlık filtre duyarlı). */
export function patternBreakdown(events: PatternEvent[], winThreshold = 0.15): PatternRow[] {
  const map = new Map<string, PatternEvent[]>();
  events.forEach((e) => {
    if (!e.patternId) return;
    const arr = map.get(e.patternId) || [];
    arr.push(e);
    map.set(e.patternId, arr);
  });

  return [...map.entries()]
    .map(([patternId, evs]) => {
      const rets = evs.map((e) => e.ret10 ?? 0);
      const wins = rets.filter((r) => r > winThreshold).length;
      return {
        patternId,
        n: evs.length,
        wins,
        winRate: evs.length ? (wins / evs.length) * 100 : 0,
        wilsonLower: wilsonLower(wins, evs.length),
        avgRet10: avg(rets),
        avgMfe20: avg(evs.map((e) => e.mfe20 ?? 0)),
        avgMae20: avg(evs.map((e) => e.mae20 ?? 0))
      };
    })
    .sort((a, b) => b.wilsonLower - a.wilsonLower || b.n - a.n);
}

export interface HistBucket {
  label: string;
  count: number;
}

/** R-multiple dağılımı (stop = -1R varsayımıyla). */
export function rMultipleHistogram(events: PatternEvent[]): HistBucket[] {
  const edges: { label: string; min: number; max: number }[] = [
    { label: '≤-1R', min: -Infinity, max: -1 },
    { label: '-1..0R', min: -1, max: 0 },
    { label: '0..0.5R', min: 0, max: 0.5 },
    { label: '0.5..1R', min: 0.5, max: 1 },
    { label: '1..2R', min: 1, max: 2 },
    { label: '2..3R', min: 2, max: 3 },
    { label: '>3R', min: 3, max: Infinity }
  ];
  return edges.map(({ label, min, max }) => ({
    label,
    count: events.filter((e) => {
      const r = e.rMultiple ?? 0;
      return r > min && r <= max;
    }).length
  }));
}
