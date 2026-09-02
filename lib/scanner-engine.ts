// Çoklu sembol arka plan tarayıcı çekirdeği ("Desen Radarı").
// Saf fonksiyonlar: evren seçimi + klines üzerinde desen taraması. Birim test edilebilir.
import { Candle, PatternStats, Ticker24h } from './types';
import { patternContext, patternCrossesAt, patternResolveSar, patternId } from './pattern-engine';

export const SCANNER_TIMEFRAMES = ['1m', '5m'] as const;
export const SCANNER_MAX_SYMBOLS = 16;
export const SCANNER_HIT_COOLDOWN_MS = 30 * 60_000; // aynı desen için tekrar bildirim yasağı
export const SCANNER_POOL_MIN_N = 15;
export const SCANNER_POOL_MIN_WILSON = 50;

export interface ScannerHit {
  symbol: string;
  timeframe: string;
  dir: 'AL' | 'SAT';
  pair: string;
  patternId: string;
  sarBucket: string;
  filter: 'F1' | 'F0';
  poolApproved: boolean;
  price: number;
  ts: number; // tetik mumunun açılış zamanı (sn)
  rule: string;
}

export interface ScanParams {
  ma1: number;
  ma2: number;
  ma3: number;
  sarStep: number;
  sarMax: number;
  /** Son N kapalı mumda oluşan kurgular taranır */
  lookbackBars?: number;
}

export type StatsLookup = (coinKey: string, globalKey: string) => Promise<PatternStats | null>;

/**
 * Tarama evreni: favoriler (aktif listede olanlar) önce, ardından hacim liderleri.
 * Seçili sembol hariç tutulur (canlı motor zaten onu izler). Dedup + üst sınır uygulanır.
 */
export function pickScannerUniverse(
  tickers: Ticker24h[],
  opts: { favs?: string[]; topN?: number; exclude?: string; maxSymbols?: number } = {}
): string[] {
  const topN = Math.max(1, Math.min(30, opts.topN ?? 10));
  const maxSymbols = Math.max(1, Math.min(SCANNER_MAX_SYMBOLS, opts.maxSymbols ?? SCANNER_MAX_SYMBOLS));
  const byVol = [...tickers].sort((a, b) => b.quoteVolume - a.quoteVolume).map((t) => t.symbol);
  const active = new Set(byVol);

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string | undefined) => {
    if (!s || seen.has(s) || s === opts.exclude || !active.has(s)) return;
    if (out.length >= maxSymbols) return;
    seen.add(s);
    out.push(s);
  };

  let favCount = 0;
  (opts.favs ?? []).forEach((f) => {
    if (active.has(f)) {
      push(f);
      favCount++;
    }
  });

  const target = Math.min(maxSymbols, favCount + topN);
  for (const s of byVol) {
    if (out.length >= target) break;
    push(s);
  }
  return out;
}

/**
 * Bir sembolün mum serisinde son `lookbackBars` kapalı mumda oluşan desen kurgularını tarar.
 * - Birincil çift (ma1xma2) kurguları doğrudan hit'tir.
 * - İkincil çiftler yalnızca havuz istatistiği onaylıysa (n >= 15, Wilson >= %50) hit olur.
 * - SARX (onaysız/geç) kurguları atlanır; en güncel tek hit döndürülür.
 */
export async function scanCandlesForHits(
  symbol: string,
  timeframe: string,
  candles: Candle[],
  params: ScanParams,
  statsLookup?: StatsLookup
): Promise<ScannerHit[]> {
  const ma1 = params.ma1 || 9;
  const ma2 = params.ma2 || 21;
  const ma3 = params.ma3 || 50;
  const lookback = Math.max(1, params.lookbackBars ?? 3);
  const n = candles.length;
  if (n < Math.max(ma3 + 10, 60)) return [];

  const ctx = patternContext(candles, ma1, ma2, ma3, params.sarStep || 0.02, params.sarMax || 0.2);
  const lastClosed = n - 2; // REST klines'ta son mum hâlâ açık olabilir
  const start = Math.max(ma3 + 5, lastClosed - lookback + 1);
  const primaryPair = `${ma1}x${ma2}`;

  const hits: ScannerHit[] = [];
  for (let i = start; i <= lastClosed; i++) {
    const crosses = patternCrossesAt(ctx, i, ma1, ma2, ma3);
    for (const cr of crosses) {
      const sarRes = patternResolveSar(ctx, i, cr.dir, lastClosed);
      if (!sarRes || sarRes.bucket === 'SARX') continue;

      const patId = patternId(cr.pair, cr.dir, sarRes.bucket, cr.filter);
      let poolApproved = false;

      if (cr.pair !== primaryPair) {
        if (!statsLookup) continue;
        const stats = await statsLookup(`${symbol}:${timeframe}:${patId}`, `${timeframe}:${patId}`);
        poolApproved =
          !!stats && stats.n >= SCANNER_POOL_MIN_N && stats.wilsonLower >= SCANNER_POOL_MIN_WILSON;
        if (!poolApproved) continue;
      }

      hits.push({
        symbol,
        timeframe,
        dir: cr.dir === 'UP' ? 'AL' : 'SAT',
        pair: cr.pair,
        patternId: patId,
        sarBucket: sarRes.bucket,
        filter: cr.filter,
        poolApproved,
        price: candles[i].close,
        ts: candles[i].time,
        rule: `Radar: MA ${cr.pair} ${cr.dir === 'UP' ? 'Golden' : 'Death'} Cross + ${sarRes.bucket} + ${cr.filter}${poolApproved ? ' [Havuz Onaylı]' : ''}`
      });
    }
  }

  // Tüm hit'ler döner; çağıran (hook) sembol+TF başına en yenisini seçer ve tekilleştirir.
  return hits;
}
