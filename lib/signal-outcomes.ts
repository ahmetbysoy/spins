// Canli sinyal oz-skor cekirdegi — PREDATOR TERMINAL'den port (birebir mantik).
// Sinyal uretildigi barin zamani (ts, sn) ve giris fiyatindan 3/5/7/15dk sonrasinin
// ILK KAPALI MUMUNDAN yon/doluluk hesaplanir; sonuc sinyale chip olarak yazilir.
// Backtest panelinden bagimsiz, canli akista calisir.
import type { Candle, SignalLogEntry, SignalOutcome } from './types';

export const SIGNAL_OUTCOME_MINUTES = [3, 5, 7, 15] as const;

/** Hedef dakikanin ilk kapali mumunu bulur; yoksa null (henuz olusmadi = bekliyor) */
export function computeSignalOutcome(
  candles: Candle[],
  entryTsSec: number,
  dir: 'AL' | 'SAT',
  entryPrice: number,
  minute: number
): SignalOutcome | null {
  if (!candles.length || !(entryPrice > 0)) return null;
  const target = entryTsSec + minute * 60;
  let c: Candle | undefined;
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].time <= target) {
      // mumlar artan sirali: target'dan buyuk/e$it ilk muma ileri bak
      c = candles[i + 1];
      if (candles[i].time === target) c = candles[i];
      break;
    }
  }
  if (!c) return null;
  const pct = ((c.close - entryPrice) / entryPrice) * 100;
  const hit = dir === 'AL' ? pct > 0 : pct < 0;
  return { hit, pct, price: c.close, time: c.time };
}

/**
 * Eksik sonuclari kapanan mumlarla cozumler (PREDATOR checkSignalOutcomes birebir:
 * interval yok, mum kapandikça/event icin cagirilir). DB'den gelen string anahtarli
 * outcomes eski kayitlari bozmadan tasinir. Degisiklik varsa guncellenmis liste.
 */
export function resolvePendingOutcomes(
  candles: Candle[],
  signals: SignalLogEntry[]
): { updated: SignalLogEntry[]; changed: boolean } {
  let changed = false;
  const updated = signals.map((sig) => {
    if (sig.dir !== 'AL' && sig.dir !== 'SAT') return sig;
    const existing = (sig.outcomes ?? {}) as Record<string, SignalOutcome>;
    let next: Record<string, SignalOutcome> | null = null;
    for (const m of SIGNAL_OUTCOME_MINUTES) {
      const key = String(m);
      if (existing[key]) continue;
      const o = computeSignalOutcome(candles, sig.ts, sig.dir, sig.price, m);
      if (o) {
        if (!next) next = { ...existing };
        next[key] = o;
        changed = true;
      }
    }
    return next ? { ...sig, outcomes: next } : sig;
  });
  return { updated, changed };
}
