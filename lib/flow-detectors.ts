// Saf orderflow dedektörleri — sayfa bileşeninden bağımsız, birim test edilebilir.
// Mantık, canlı akıştaki orijinal eşiklerle birebir aynıdır; throttle/state dışarıda kalır.
import { TradeEvent } from './types';

export interface WallInfo {
  notional: number;
  ts: number;
  side: 'B' | 'A';
}

export interface SweepResult {
  side: 'buy' | 'sell';
  total: number;
  count: number;
}

/** <1.8s içinde aynı yönde >=4 işlem ve toplam > whaleMin*1.5 */
export function detectSweep(trades: TradeEvent[], now: number, whaleMin: number): SweepResult | null {
  const recent = trades.filter((t) => now - t.ts < 1800);
  for (const side of ['buy', 'sell'] as const) {
    const sameSide = recent.filter((t) => t.side === side);
    const total = sameSide.reduce((a, b) => a + b.notional, 0);
    if (total > whaleMin * 1.5 && sameSide.length >= 4) {
      return { side, total, count: sameSide.length };
    }
  }
  return null;
}

export interface BurstResult {
  side: 'buy' | 'sell';
  cvd: number;
  vol: number;
}

/** <5s CVD patlaması (|cvd|/vol > 0.75, vol > whaleMin*1.8) + 60s eğim hizası */
export function detectDeltaBurst(trades: TradeEvent[], now: number, whaleMin: number): BurstResult | null {
  const recent5s = trades.filter((t) => now - t.ts < 5000);
  const cvd5s = recent5s.reduce((a, b) => a + b.delta, 0);
  const vol5s = recent5s.reduce((a, b) => a + b.notional, 0);
  if (!(vol5s > whaleMin * 1.8 && Math.abs(cvd5s) / vol5s > 0.75)) return null;

  const recent60s = trades.filter((t) => now - t.ts < 60000);
  const cvd60s = recent60s.reduce((a, b) => a + b.delta, 0);
  const slopeAligned = (cvd5s > 0 && cvd60s >= 0) || (cvd5s < 0 && cvd60s <= 0);
  if (!slopeAligned) return null;

  return { side: cvd5s > 0 ? 'buy' : 'sell', cvd: cvd5s, vol: vol5s };
}

export interface AbsorptionResult {
  /** Pasif emilim tarafı: agresif alıcı emen → pasif SATICI */
  side: 'buy' | 'sell';
  vol: number;
  cvd: number;
}

/** >=10 işlem, vol > whaleMin*2.2, |cvd| > whaleMin*0.8 ve fiyat kayması <%0.08 */
export function detectAbsorption(trades: TradeEvent[], now: number, whaleMin: number): AbsorptionResult | null {
  const recent8s = trades.filter((t) => now - t.ts < 8000);
  if (recent8s.length < 10) return null;

  const vol8s = recent8s.reduce((a, b) => a + b.notional, 0);
  const cvd8s = recent8s.reduce((a, b) => a + b.delta, 0);
  const prices = recent8s.map((t) => t.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const spreadPct = minP > 0 ? (maxP - minP) / minP : 0;

  if (vol8s > whaleMin * 2.2 && Math.abs(cvd8s) > whaleMin * 0.8 && spreadPct < 0.0008) {
    return { side: cvd8s > 0 ? 'sell' : 'buy', vol: vol8s, cvd: cvd8s };
  }
  return null;
}

/** Derinlik defterinden whale duvarlarını toplar (spoof takibi için anlık görüntü). */
export function collectWalls(
  bids: Map<number, number>,
  asks: Map<number, number>,
  whaleMin: number,
  now: number
): Map<number, WallInfo> {
  const walls = new Map<number, WallInfo>();
  bids.forEach((q, p) => {
    const n = p * q;
    if (n >= whaleMin) walls.set(p, { notional: n, ts: now, side: 'B' });
  });
  asks.forEach((q, p) => {
    const n = p * q;
    if (n >= whaleMin) walls.set(p, { notional: n, ts: now, side: 'A' });
  });
  return walls;
}

export interface SpoofRemoval {
  price: number;
  notional: number;
  side: 'B' | 'A';
  ageMs: number;
}

/** Kısa ömürlü (<8s) ve büyük (>= whaleMin*1.5) duvar iptalleri. (Stage-4 paritesi) */
export const SPOOF_MAX_AGE_MS = 8000;

export function detectSpoofRemovals(
  prevWalls: Map<number, WallInfo>,
  currentWalls: Map<number, WallInfo>,
  now: number,
  whaleMin: number
): SpoofRemoval[] {
  const out: SpoofRemoval[] = [];
  prevWalls.forEach((w, price) => {
    if (currentWalls.has(price)) return;
    const age = now - w.ts;
    if (age < SPOOF_MAX_AGE_MS && w.notional >= whaleMin * 1.5) {
      out.push({ price, notional: w.notional, side: w.side, ageMs: age });
    }
  });
  return out;
}
