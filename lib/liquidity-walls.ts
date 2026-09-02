// Likidite duvari cekirdegi — PREDATOR TERMINAL'den port (birebir algoritma, saf fonksiyonlar).
// Sabit dolar esigi + slot-basina duvar yerine: gorunur satirlarin nonzero notional
// dagilimindan dinamik percentile esigi, bitisik satir birlestirme (merge) ve
// notional-agirlikli centroid konum. "Tek buyuk kirmizi blok" sorununun kok cozumu.

/** PREDATOR: WALLMINAGE = 30000 — bu suredir hayatta duvar "yerlesik" sayilir (⏱) */
export const WALL_ESTABLISHED_MS = 30000;
/** PREDATOR: WALL_TICK_GROUP = 10 — yas anahtari fiyat yuvarlama grubu */
export const WALL_TICK_GROUP = 10;
/** Ince kitaplarda percentile esiginin alt siniri (gurultu duvari korumasi) */
export const WALL_MIN_NOTIONAL = 5000;

export interface LiquidityWall {
  side: 'B' | 'A';
  start: number; // ilk satir (dahil)
  end: number; // son satir (dahil)
  y: number; // notional-agirlikli centroid pikseli
  notional: number; // run toplami
  dominance: number;
}

/** PREDATOR percentileFromBins birebir: <64 ornek kesin sirali; >=64 ornekte 64 kovali
 *  log1p-histogram ile O(n) yaklasik percentile (expm1 ile geri cozulur). */
export function percentileFromBins(values: number[], pct: number): number {
  if (!values.length) return 0;
  let min = Infinity;
  let max = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max <= 0) return 0;
  if (values.length < 64) {
    const a = values.slice().sort((x, y) => x - y);
    return a[Math.min(a.length - 1, Math.floor(a.length * pct))];
  }
  const buckets = new Uint32Array(64);
  const lm = Math.log1p(max);
  for (const v of values) {
    const idx = Math.min(63, Math.max(0, Math.floor((Math.log1p(v) / lm) * 63)));
    buckets[idx]++;
  }
  const target = Math.floor(values.length * pct);
  let acc = 0;
  let idx = 0;
  for (; idx < 64; idx++) {
    acc += buckets[idx];
    if (acc >= target) break;
  }
  return Math.expm1((idx / 63) * lm);
}

/** Gorunur satirlarin nonzero degerleri ve en buyugu */
export function nonzeroMax(bidBins: ArrayLike<number>, askBins: ArrayLike<number>): { nz: number[]; max: number } {
  const nz: number[] = [];
  let max = 0;
  const n = Math.max(bidBins.length, askBins.length);
  for (let i = 0; i < n; i++) {
    const v = Math.max(bidBins[i] || 0, askBins[i] || 0);
    if (v > 0) {
      nz.push(v);
      if (v > max) max = v;
    }
  }
  return { nz, max };
}

export interface MergeWallsOptions {
  threshold: number;
  maxNotional: number;
  binPx: number;
  dominanceMin?: number; // PREDATOR: 0.58
  intensityJumpMax?: number; // PREDATOR: 0.28 — bitisik run bu siradan buyukse kirilir
}

/** PREDATOR merge algoritmasi birebir: esik + dominance ile run baslat, ayni yonde ve
 *  esik ustunde ve dominance saglam ve intensite sicramasi kucuk oldukca uzat;
 *  centroid = sum(y_i * notional_i) / sum(notional_i). */
export function mergeWalls(
  bidBins: ArrayLike<number>,
  askBins: ArrayLike<number>,
  opts: MergeWallsOptions
): LiquidityWall[] {
  const rows = Math.max(bidBins.length, askBins.length);
  const { threshold, maxNotional, binPx } = opts;
  const dominanceMin = opts.dominanceMin ?? 0.58;
  const intensityJumpMax = opts.intensityJumpMax ?? 0.28;
  if (!(maxNotional > 0) || rows <= 0) return [];
  const logMax = Math.log1p(maxNotional);
  const walls: LiquidityWall[] = [];
  let i = 0;
  while (i < rows) {
    const bid = bidBins[i] || 0;
    const ask = askBins[i] || 0;
    const side = bid >= ask ? 'B' : 'A';
    const v = side === 'B' ? bid : ask;
    const other = side === 'B' ? ask : bid;
    const dom = v / (v + other || 1);
    if (v < threshold || v <= 0 || dom < dominanceMin) {
      i++;
      continue;
    }
    const dominant = side;
    let lastInt = Math.log1p(v) / logMax;
    let end = i;
    let sum = 0;
    let wy = 0;
    while (end < rows) {
      const b = bidBins[end] || 0;
      const a = askBins[end] || 0;
      const sde = b >= a ? 'B' : 'A';
      const nv = sde === 'B' ? b : a;
      const ov = sde === 'B' ? a : b;
      const d = nv / (nv + ov || 1);
      const inten = Math.log1p(nv) / logMax;
      if (sde !== dominant || nv < threshold || nv <= 0 || d < dominanceMin || Math.abs(inten - lastInt) > intensityJumpMax)
        break;
      lastInt = inten;
      const yy = end * binPx + binPx / 2;
      sum += nv;
      wy += yy * nv;
      end++;
    }
    const y = sum ? wy / sum : i * binPx + binPx / 2;
    walls.push({ side: dominant, start: i, end: end - 1, y, notional: sum, dominance: dom });
    i = end;
  }
  return walls;
}

/** PREDATOR wallAgeKey birebir: fiyat, tickSize*10 adimlarina yuvarlanir (kucuk oynamalar
 *  ayni duvari bozmaz). tickSize 0/bilinmiyorsa 0.01 dusus degeri. */
export function wallAgeKey(symbol: string, price: number, side: 'B' | 'A', tickSize: number): string {
  const fallback = Math.pow(10, -2);
  const step = Math.max(tickSize || fallback, Number.EPSILON) * WALL_TICK_GROUP;
  return `${symbol}|${side}|${Math.round(price / step)}`;
}

export interface WallAgeRecord {
  side: 'B' | 'A';
  first: number;
  last: number;
  peakNotional: number;
  currentNotional: number;
  decayRatio: number;
}

/** PREDATOR wallAges kayit mantigi birebir: ilk gorus, tepe, bozulma orani */
export function touchWallAge(
  map: Map<string, WallAgeRecord>,
  key: string,
  side: 'B' | 'A',
  notional: number,
  now: number
): WallAgeRecord {
  let rec = map.get(key);
  if (!rec) {
    rec = { side, first: now, last: now, peakNotional: 0, currentNotional: 0, decayRatio: 1 };
    map.set(key, rec);
  }
  rec.side = side;
  rec.last = now;
  rec.currentNotional = notional;
  rec.peakNotional = Math.max(rec.peakNotional || 0, notional);
  rec.decayRatio = rec.peakNotional ? notional / rec.peakNotional : 1;
  return rec;
}

/** 5sn'dir gorunmeyen duvar yas kayitlarini siler (PREDATOR birebir) */
export function pruneWallAges(map: Map<string, WallAgeRecord>, activeKeys: Set<string>, now: number, maxIdleMs = 5000): void {
  for (const [key, rec] of map) {
    if (!activeKeys.has(key) && now - rec.last > maxIdleMs) map.delete(key);
  }
}
