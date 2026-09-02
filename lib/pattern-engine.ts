import { Candle, PatternEvent, PatternStats } from './types';
import { sma, psar, atrRatios, percentile, wilsonLower, avg, std, median } from './indicators';
import { fetchKlines } from './binance';

export const PPOOL_SCHEMA_VERSION = 1;
export const PPOOL_DB_NAME = 'fs_pattern_pool';
export const PPOOL_DB_VERSION = 2; // v2: signalLog store eklendi (sinyal kalıcılığı)
export const PPOOL_SAR_BUCKETS: ('SAR0' | 'SAR1' | 'SAR2-3' | 'SARX')[] = ['SAR0', 'SAR1', 'SAR2-3', 'SARX'];

let dbInstance: IDBDatabase | null = null;
let dbInitPromise: Promise<boolean> | null = null;

export function buildPatternNames(): Record<string, string> {
  const pairs: Record<string, string> = { '9x21': 'Hızlı/Orta', '9x50': 'Hızlı/Ana Trend', '21x50': 'Orta/Ana Trend' };
  const dirs: Record<string, string> = { UP: 'Golden Cross', DOWN: 'Death Cross' };
  const sar: Record<string, string> = {
    SAR0: 'Anında SAR Onayı',
    SAR1: '1 Mum Sonra SAR Onayı',
    'SAR2-3': '2-3 Mum Gecikmeli SAR Onayı',
    SARX: 'SAR Onaysız/Geç'
  };
  const filt: Record<string, string> = { F1: 'Trend Uyumlu', F0: 'Trend Uyumsuz' };
  const out: Record<string, string> = {};

  Object.keys(pairs).forEach((p) =>
    Object.keys(dirs).forEach((d) =>
      PPOOL_SAR_BUCKETS.forEach((s) =>
        Object.keys(filt).forEach((f) => {
          out[`${p}_${d}_${s}_${f}`] = `${pairs[p]} ${dirs[d]} + ${sar[s]} + ${filt[f]}`;
        })
      )
    )
  );
  return out;
}

export const PATTERN_NAMES = buildPatternNames();

export function patternName(id: string): string {
  if (PATTERN_NAMES[id]) return PATTERN_NAMES[id];
  const parts = String(id || '').split('_');
  if (parts.length !== 4) return id || '—';
  const dir = parts[1] === 'UP' ? 'Golden Cross' : 'Death Cross';
  const sarMap: Record<string, string> = {
    SAR0: 'Anında SAR Onayı',
    SAR1: '1 Mum Sonra SAR Onayı',
    'SAR2-3': '2-3 Mum SAR Onayı',
    SARX: 'SAR Onaysız/Geç'
  };
  const sar = sarMap[parts[2]] || parts[2];
  const flt = parts[3] === 'F1' ? 'Trend Uyumlu' : 'Trend Uyumsuz';
  return `${parts[0]} ${dir} + ${sar} + ${flt}`;
}

export function patternAllIds(): string[] {
  return Object.keys(PATTERN_NAMES).sort();
}

export function patternId(pair: string, dir: string, sar: string, filter: string): string {
  return `${pair}_${dir}_${sar}_${filter}`;
}

export function initPatternDB(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = new Promise((resolve) => {
    if (!('indexedDB' in window)) {
      resolve(false);
      return;
    }
    const req = indexedDB.open(PPOOL_DB_NAME, PPOOL_DB_VERSION);
    req.onupgradeneeded = (ev: IDBVersionChangeEvent) => {
      const db = (ev.target as IDBOpenDBRequest).result;
      let eventsStore: IDBObjectStore;
      if (!db.objectStoreNames.contains('events')) {
        eventsStore = db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      } else {
        eventsStore = (ev.target as IDBOpenDBRequest).transaction!.objectStore('events');
      }

      const indices: [string, string, boolean][] = [
        ['patternKey', 'patternKey', false],
        ['coinPatternKey', 'coinPatternKey', false],
        ['coin', 'coin', false],
        ['timeframe', 'timeframe', false],
        ['timestamp', 'timestamp', false],
        ['status', 'status', false],
        ['eventKey', 'eventKey', false]
      ];

      indices.forEach(([name, key, unique]) => {
        if (!eventsStore.indexNames.contains(name)) {
          eventsStore.createIndex(name, key, { unique });
        }
      });

      if (!db.objectStoreNames.contains('poolStats')) {
        db.createObjectStore('poolStats', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('metadata')) {
        db.createObjectStore('metadata', { keyPath: 'key' });
      }
      // v2: Sinyal logu (id string key; sembol/TF bazlı filtreleme uygulama tarafında)
      if (!db.objectStoreNames.contains('signalLog')) {
        const signalStore = db.createObjectStore('signalLog', { keyPath: 'id' });
        signalStore.createIndex('symbol', 'symbol', { unique: false });
        signalStore.createIndex('timeframe', 'timeframe', { unique: false });
      }
    };

    req.onsuccess = () => {
      dbInstance = req.result;
      resolve(true);
    };

    req.onerror = () => {
      resolve(false);
    };
  });

  return dbInitPromise;
}

function dbTx(store: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore | null {
  if (!dbInstance) return null;
  return dbInstance.transaction(store, mode).objectStore(store);
}

function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function dbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  const s = dbTx(store);
  if (!s) return null;
  return reqP(s.get(key));
}

export async function dbPut<T>(store: string, val: T): Promise<IDBValidKey | null> {
  const s = dbTx(store, 'readwrite');
  if (!s) return null;
  return reqP(s.put(val));
}

export async function dbAdd<T>(store: string, val: T): Promise<IDBValidKey | null> {
  const s = dbTx(store, 'readwrite');
  if (!s) return null;
  return reqP(s.add(val));
}

export async function dbDelete(store: string, key: IDBValidKey): Promise<void> {
  const s = dbTx(store, 'readwrite');
  if (!s) return;
  await reqP(s.delete(key));
}

export async function dbAll<T>(store: string): Promise<T[]> {
  const s = dbTx(store);
  if (!s) return [];
  return reqP(s.getAll());
}

export async function dbIndexAll<T>(store: string, index: string, key: IDBValidKey): Promise<T[]> {
  const s = dbTx(store);
  if (!s) return [];
  return reqP(s.index(index).getAll(key));
}

export async function dbIndexGet<T>(store: string, index: string, key: IDBValidKey): Promise<T | null> {
  const s = dbTx(store);
  if (!s) return null;
  return reqP(s.index(index).get(key));
}

export function intervalToSeconds(tf: string): number {
  const map: Record<string, number> = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1d': 86400
  };
  return map[tf] || 60;
}

export function patternPeriods(ma1: number = 9, ma2: number = 21, ma3: number = 50): [number, number, number] {
  return [
    Math.max(2, Math.round(ma1)),
    Math.max(3, Math.round(ma2)),
    Math.max(5, Math.round(ma3))
  ];
}

export function patternPairs(ma1: number = 9, ma2: number = 21, ma3: number = 50) {
  const [a, b, c] = patternPeriods(ma1, ma2, ma3);
  return [
    { pair: `${a}x${b}`, fast: a, slow: b },
    { pair: `${a}x${c}`, fast: a, slow: c },
    { pair: `${b}x${c}`, fast: b, slow: c }
  ];
}

export function patternContext(cs: Candle[], ma1: number = 9, ma2: number = 21, ma3: number = 50, sarStep: number = 0.02, sarMax: number = 0.2) {
  const closes = cs.map((c) => c.close);
  const periods = [...new Set([...patternPeriods(ma1, ma2, ma3), ...patternPairs(ma1, ma2, ma3).flatMap((p) => [p.fast, p.slow])])];
  const ma: Record<number, (number | null)[]> = {};
  periods.forEach((p) => {
    ma[p] = sma(closes, p);
  });
  const { trend } = psar(cs, sarStep, sarMax);
  const atr = atrRatios(cs, 14);
  return { cs, closes, ma, trend, atr };
}

export function patternRegimeAt(ctx: ReturnType<typeof patternContext>, i: number, ma3: number = 50) {
  const atrWin = ctx.atr.slice(Math.max(0, i - 99), i + 1).filter((v): v is number => v !== null && Number.isFinite(v));
  const p33 = percentile(atrWin, 0.33);
  const p66 = percentile(atrWin, 0.66);
  const val = ctx.atr[i];
  let vol: 'LOW' | 'MID' | 'HIGH' = 'MID';
  if (val !== null && Number.isFinite(val) && p33 !== null && p66 !== null) {
    vol = val <= p33 ? 'LOW' : val >= p66 ? 'HIGH' : 'MID';
  }
  const trendMa = ctx.ma[ma3] || ctx.ma[50];
  let trend: 'UP' | 'DOWN' | 'FLAT' = 'FLAT';
  if (trendMa && trendMa[i] !== null && i >= 10 && trendMa[i - 10] !== null) {
    const slope = (trendMa[i]! - trendMa[i - 10]!) / trendMa[i - 10]!;
    trend = slope > 0.001 ? 'UP' : slope < -0.001 ? 'DOWN' : 'FLAT';
  }
  return { vol, trend, key: `${vol}_${trend}` };
}

export function patternCrossesAt(ctx: ReturnType<typeof patternContext>, i: number, ma1: number = 9, ma2: number = 21, ma3: number = 50) {
  const out: {
    pair: string;
    dir: 'UP' | 'DOWN';
    filter: 'F1' | 'F0';
    regime: ReturnType<typeof patternRegimeAt>;
  }[] = [];
  const trendMa = ctx.ma[ma3] || ctx.ma[50];
  if (i < 1 || !trendMa || trendMa[i] === null) return out;

  // Multi-MA confirmation: 9x50 and 21x50 alignment
  const ma9 = ctx.ma[9] || ctx.ma[ma1];
  const ma21 = ctx.ma[21] || ctx.ma[ma2];
  if (!ma9 || !ma21 || ma9[i] === null || ma21[i] === null) return out;

  for (const p of patternPairs(ma1, ma2, ma3)) {
    const f = ctx.ma[p.fast];
    const sl = ctx.ma[p.slow];
    if (!f || !sl || f[i] === null || sl[i] === null || f[i - 1] === null || sl[i - 1] === null) continue;

    let dir: 'UP' | 'DOWN' | null = null;
    if (f[i - 1]! <= sl[i - 1]! && f[i]! > sl[i]!) dir = 'UP';
    if (f[i - 1]! >= sl[i - 1]! && f[i]! < sl[i]!) dir = 'DOWN';
    if (!dir) continue;

    // Trend alignment check: only allow signals aligned with 50MA
    if (dir === 'UP' && !(ma9[i]! > trendMa[i]! && ma21[i]! > trendMa[i]!)) continue;
    if (dir === 'DOWN' && !(ma9[i]! < trendMa[i]! && ma21[i]! < trendMa[i]!)) continue;

    const filter: 'F1' | 'F0' = dir === 'UP'
      ? ctx.cs[i].close > trendMa[i]! ? 'F1' : 'F0'
      : ctx.cs[i].close < trendMa[i]! ? 'F1' : 'F0';

    out.push({ pair: p.pair, dir, filter, regime: patternRegimeAt(ctx, i, ma3) });
  }
  return out;
}

export function patternResolveSar(
  ctx: ReturnType<typeof patternContext>,
  crossIdx: number,
  dir: 'UP' | 'DOWN',
  lastIdx: number
): { bucket: 'SAR0' | 'SAR1' | 'SAR2-3' | 'SARX'; finalIndex: number } | null {
  const desired = dir === 'UP' ? 1 : -1;
  if (ctx.trend[crossIdx] === desired) return { bucket: 'SAR0', finalIndex: crossIdx };
  const maxJ = Math.min(crossIdx + 3, lastIdx);
  for (let j = crossIdx + 1; j <= maxJ; j++) {
    if (ctx.trend[j] === desired && ctx.trend[j - 1] !== desired) {
      return { bucket: j - crossIdx === 1 ? 'SAR1' : 'SAR2-3', finalIndex: j };
    }
  }
  if (lastIdx >= crossIdx + 4) return { bucket: 'SARX', finalIndex: crossIdx + 4 };
  return null;
}

export function patternOutcome(cs: Candle[], idx: number, dir: 'UP' | 'DOWN') {
  if (idx + 20 >= cs.length) return null;
  const ref = cs[idx].close;
  if (!ref) return null;
  const sign = dir === 'UP' ? 1 : -1;
  const closeRet = (n: number) => sign * ((cs[idx + n].close - ref) / ref) * 100;

  let mfe = 0;
  let mae = 0;
  let barsToMfe = 0;
  let barsToMae = 0;
  let stopped = false;
  let bestBeforeStop = 0;
  const stopPct = 0.3;

  for (let j = 1; j <= 20; j++) {
    const fav = dir === 'UP' ? ((cs[idx + j].high - ref) / ref) * 100 : ((ref - cs[idx + j].low) / ref) * 100;
    const adv = dir === 'UP' ? ((ref - cs[idx + j].low) / ref) * 100 : ((cs[idx + j].high - ref) / ref) * 100;
    if (fav > mfe) {
      mfe = fav;
      barsToMfe = j;
    }
    if (adv > mae) {
      mae = adv;
      barsToMae = j;
    }
    if (!stopped && adv >= stopPct) {
      stopped = true;
    }
    if (!stopped && fav > bestBeforeStop) bestBeforeStop = fav;
  }

  return {
    ret5: closeRet(5),
    ret10: closeRet(10),
    ret20: closeRet(20),
    mfe20: mfe,
    mae20: mae,
    rMultiple: stopped ? -1 : bestBeforeStop / stopPct,
    barsToMfe,
    barsToMae
  };
}

export async function patternRecomputeStats(key: string, winThresholdPct: number = 0.15): Promise<PatternStats | null> {
  const parts = key.split(':');
  let events: PatternEvent[] = [];
  if (parts.length === 2) {
    events = (await dbIndexAll<PatternEvent>('events', 'patternKey', key)).filter((e) => e.status === 'settled');
  } else if (parts.length === 3) {
    events = (await dbIndexAll<PatternEvent>('events', 'coinPatternKey', key)).filter((e) => e.status === 'settled');
  }

  events.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const n = events.length;
  const wins = events.filter((e) => (e.ret10 || 0) > winThresholdPct).length;

  let wSum = 0;
  let wWins = 0;
  let wRet = 0;
  events.forEach((e, k) => {
    const w = Math.pow(0.98, k);
    wSum += w;
    if ((e.ret10 || 0) > winThresholdPct) wWins += w;
    wRet += (e.ret10 || 0) * w;
  });

  const ret10s = events.map((e) => e.ret10 || 0);
  const mfes = events.map((e) => e.mfe20 || 0);
  const maes = events.map((e) => e.mae20 || 0);
  const rms = events.map((e) => e.rMultiple || 0);
  const bars = events.map((e) => e.barsToMfe || 0);

  const regimes: PatternStats['regimes'] = {};
  events.forEach((e) => {
    const rk = e.regimeKey || `${e.volRegime || 'MID'}_${e.trendRegime || 'FLAT'}`;
    const r = regimes[rk] || (regimes[rk] = { key: rk, n: 0, wins: 0, ret10Sum: 0, winRate: 0, avgRet10: 0 });
    r.n++;
    if ((e.ret10 || 0) > winThresholdPct) r.wins++;
    r.ret10Sum += e.ret10 || 0;
  });

  Object.values(regimes).forEach((r) => {
    r.winRate = r.n ? (r.wins / r.n) * 100 : 0;
    r.avgRet10 = r.n ? r.ret10Sum / r.n : 0;
  });

  const coin = parts.length === 3 ? parts[0] : null;
  const tf = parts.length === 3 ? parts[1] : parts[0];
  const patId = parts.length === 3 ? parts[2] : parts[1];

  const stat: PatternStats = {
    key,
    schemaVersion: PPOOL_SCHEMA_VERSION,
    updatedAt: Date.now(),
    scope: coin ? 'coin' : 'global',
    coin,
    timeframe: tf,
    patternId: patId,
    n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    wilsonLower: wilsonLower(wins, n),
    avgRet10: avg(ret10s),
    stdRet10: std(ret10s),
    avgMfe20: avg(mfes),
    avgMae20: avg(maes),
    avgRMultiple: avg(rms),
    medBarsToMfe: median(bars),
    weightedWinRate: wSum ? (wWins / wSum) * 100 : 0,
    weightedAvgRet10: wSum ? wRet / wSum : 0,
    regimes
  };

  // Max 500 events per pool limit (F2-9)
  if (events.length > 500 && dbInstance) {
    const excess = events.slice(500);
    const tx = dbInstance.transaction('events', 'readwrite');
    const store = tx.objectStore('events');
    for (const ex of excess) {
      if (ex.id) store.delete(ex.id);
    }
  }

  await dbPut('poolStats', stat);
  return stat;
}

export async function patternGetStats(key: string): Promise<PatternStats | null> {
  return (await dbGet<PatternStats>('poolStats', key)) || null;
}

// Coin-vs-Global fallback (n>=30 coin stats -> coin stats, else global) (F2-4)
export async function patternGetStatsBest(
  coin: string,
  timeframe: string,
  patId: string
): Promise<{ stats: PatternStats | null; scope: 'coin' | 'global' }> {
  const coinKey = `${coin}:${timeframe}:${patId}`;
  const globalKey = `${timeframe}:${patId}`;

  const coinStats = await patternGetStats(coinKey);
  if (coinStats && coinStats.n >= 30) {
    return { stats: coinStats, scope: 'coin' };
  }

  const globalStats = await patternGetStats(globalKey);
  if (globalStats) {
    return { stats: globalStats, scope: 'global' };
  }

  return { stats: coinStats || null, scope: coinStats ? 'coin' : 'global' };
}

// --- Havuz sağlamlaştırma (Görev E, Stage-4 paritesi) ---

/**
 * DB seviyesinde ±3 mum dedupe: aynı coin+tf+desen için verilen zamana 3 mum
 * içinde kalmış bir event varsa true döner (çapraz oturum duplicate koruması).
 */
export async function patternRecentExists(
  coin: string,
  tf: string,
  patId: string,
  tsMs: number,
  excludeId?: number
): Promise<boolean> {
  const key = `${coin}:${tf}:${patId}`;
  let arr: PatternEvent[] = [];
  try {
    arr = await dbIndexAll<PatternEvent>('events', 'coinPatternKey', key);
  } catch {
    return false;
  }
  const winMs = intervalToSeconds(tf) * 3 * 1000;
  return arr.some((e) => e.id !== excludeId && Math.abs((e.timestamp || 0) - tsMs) <= winMs);
}

/**
 * Saf: açık (pending/tracking) event'i verilen mum serisiyle settle etmeye çalışır.
 * Event mumu seride bulunamazsa ya da 20 mum henüz dolmadıysa null (tracking kalmalı).
 */
export function settlePatternEventWithCandles(ev: PatternEvent, candles: Candle[]): PatternEvent | null {
  if (ev.status === 'settled') return ev;
  const tsSec = Math.floor((ev.timestamp || 0) / 1000);
  const idx = candles.findIndex((c) => c.time === tsSec);
  if (idx < 0) return null;
  const dir: 'UP' | 'DOWN' = ev.dir === 'UP' ? 'UP' : 'DOWN';
  const outcome = patternOutcome(candles, idx, dir);
  if (!outcome) return null;
  return {
    ...ev,
    status: 'settled',
    settledAt: Date.now(),
    ...outcome
  };
}

/**
 * Açılış temizliği: tüm pending/tracking event'leri coin+tf bazında gruplayıp
 * son mumlarla settle etmeye çalışır. Bayat kayıtlar havuz istatistiklerine
 * artık kirlilik katmaz. (Uygulama açılışında fire-and-forget çağrılır.)
 */
export async function patternCompleteAllOpenEvents(maxEvents = 200): Promise<number> {
  await initPatternDB();
  if (!dbInstance) return 0;

  let all: PatternEvent[] = [];
  try {
    all = await dbAll<PatternEvent>('events');
  } catch {
    return 0;
  }
  const open = all.filter((e) => e.status === 'pending' || e.status === 'tracking');
  if (!open.length) return 0;

  const groups = new Map<string, PatternEvent[]>();
  open.slice(0, maxEvents).forEach((e) => {
    if (!e.coin || !e.timeframe) return;
    const k = `${e.coin}:${e.timeframe}`;
    const arr = groups.get(k) || [];
    arr.push(e);
    groups.set(k, arr);
  });

  let settledCount = 0;
  for (const [groupKey, evs] of groups) {
    const [coin, tf] = groupKey.split(':');
    let candles: Candle[] = [];
    try {
      candles = await fetchKlines(coin, tf, 120);
    } catch {
      continue; // geo-block/ağ hatası: event tracking kalır, sonraki açılışta tekrar denenir
    }
    if (!candles.length) continue;

    for (const ev of evs) {
      const settled = settlePatternEventWithCandles(ev, candles);
      if (settled) {
        try {
          await dbPut('events', settled);
        } catch {
          continue;
        }
        if (settled.patternKey) {
          await patternRecomputeStats(settled.patternKey).catch(() => {});
        }
        if (settled.coinPatternKey) {
          await patternRecomputeStats(settled.coinPatternKey).catch(() => {});
        }
        settledCount++;
      }
    }
  }
  return settledCount;
}

export async function patternBackfillFromCandles(
  coin: string,
  timeframe: string,
  candles: Candle[],
  ma1: number = 9,
  ma2: number = 21,
  ma3: number = 50,
  sarStep: number = 0.02,
  sarMax: number = 0.2,
  winThreshold: number = 0.15
): Promise<{ added: number; settled: number }> {
  if (candles.length < Math.max(ma3 + 10, 60)) return { added: 0, settled: 0 };
  await initPatternDB();

  const ctx = patternContext(candles, ma1, ma2, ma3, sarStep, sarMax);
  const n = candles.length;
  let added = 0;
  let settled = 0;
  const affectedKeys = new Set<string>();

  // Fetch all existing events for this coin in one batch index query
  const existingEventsList = await dbIndexAll<PatternEvent>('events', 'coin', coin);
  const existingMap = new Map<string, PatternEvent>();
  existingEventsList.forEach((ev) => {
    if (ev.timeframe === timeframe && ev.eventKey) {
      existingMap.set(ev.eventKey, ev);
    }
  });

  const eventsToAdd: PatternEvent[] = [];
  const eventsToUpdate: PatternEvent[] = [];

  // Görev E: ±3 mum desen dedupe — aynı desen 3 mum içinde tekrar yazılmaz (RAM seviyesi;
  // mevcut kayıtlardan tohumlanır, çapraz oturum koruması DB seviyesinde patternRecentExists'te)
  const recentByPattern = new Map<string, number>();
  existingEventsList.forEach((ev) => {
    if (ev.patternId && ev.timestamp) {
      const prev = recentByPattern.get(ev.patternId);
      if (prev === undefined || ev.timestamp > prev) recentByPattern.set(ev.patternId, ev.timestamp);
    }
  });
  const dedupeWinMs = intervalToSeconds(timeframe) * 3 * 1000;

  for (let i = ma3 + 5; i < n; i++) {
    const crosses = patternCrossesAt(ctx, i, ma1, ma2, ma3);
    for (const cr of crosses) {
      const sarRes = patternResolveSar(ctx, i, cr.dir, n - 1);
      const sarBucket = sarRes ? sarRes.bucket : (n - 1 - i >= 4 ? 'SARX' : undefined);
      if (!sarBucket) continue; // Still in resolve window

      const patId = patternId(cr.pair, cr.dir, sarBucket, cr.filter);
      const globalKey = `${timeframe}:${patId}`;
      const coinKey = `${coin}:${timeframe}:${patId}`;
      const eventKey = `${coin}_${timeframe}_${candles[i].time}_${patId}`;

      const existing = existingMap.get(eventKey);
      const outcome = patternOutcome(candles, sarRes ? sarRes.finalIndex : i, cr.dir);

      if (existing) {
        if (existing.status !== 'settled' && outcome) {
          existing.status = 'settled';
          existing.settledAt = Date.now();
          existing.ret5 = outcome.ret5;
          existing.ret10 = outcome.ret10;
          existing.ret20 = outcome.ret20;
          existing.mfe20 = outcome.mfe20;
          existing.mae20 = outcome.mae20;
          existing.rMultiple = outcome.rMultiple;
          existing.barsToMfe = outcome.barsToMfe;
          existing.barsToMae = outcome.barsToMae;
          eventsToUpdate.push(existing);
          settled++;
          affectedKeys.add(globalKey);
          affectedKeys.add(coinKey);
        }
        continue;
      }

      const lastSameTs = recentByPattern.get(patId);
      if (lastSameTs !== undefined && Math.abs(candles[i].time * 1000 - lastSameTs) <= dedupeWinMs) {
        continue; // ±3 mum içinde aynı desen zaten kaydedilmiş
      }

      const ev: PatternEvent = {
        schemaVersion: PPOOL_SCHEMA_VERSION,
        source: 'backfill',
        coin,
        timeframe,
        timestamp: candles[i].time * 1000,
        eventKey,
        pair: cr.pair,
        dir: cr.dir,
        filter: cr.filter,
        sarBucket,
        patternId: patId,
        patternKey: globalKey,
        coinPatternKey: coinKey,
        volRegime: cr.regime.vol,
        trendRegime: cr.regime.trend,
        regimeKey: cr.regime.key,
        refClose: candles[sarRes ? sarRes.finalIndex : i].close,
        status: outcome ? 'settled' : 'tracking',
        createdAt: Date.now(),
        settledAt: outcome ? Date.now() : undefined,
        ...(outcome || {})
      };

      eventsToAdd.push(ev);
      existingMap.set(eventKey, ev);
      recentByPattern.set(patId, candles[i].time * 1000);
      added++;
      if (outcome) {
        settled++;
        affectedKeys.add(globalKey);
        affectedKeys.add(coinKey);
      }
    }
  }

  // Batch commit to IndexedDB
  if (eventsToAdd.length > 0 || eventsToUpdate.length > 0) {
    if (dbInstance) {
      const tx = dbInstance.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      for (const ev of eventsToAdd) {
        store.add(ev);
      }
      for (const ev of eventsToUpdate) {
        store.put(ev);
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      }).catch((e) => {
        console.warn('Batch commit error:', e);
      });
    }
  }

  // Recompute affected pattern keys
  for (const key of affectedKeys) {
    try {
      await patternRecomputeStats(key, winThreshold);
    } catch {}
  }

  return { added, settled };
}
