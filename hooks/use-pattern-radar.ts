'use client';

// Desen Radarı — arka planda çoklu sembol tarayan, throttled ve görünürlük-duyarlı döngü.
// - Evren: favoriler + hacim liderleri (pickScannerUniverse), her turda tazelenir.
// - İlk tur "baseline"dır: sessiz doldurur, böylece uygulama açılışında eski kurgular için
//   spam bildirim patlamaz. Sonraki turlarda yalnızca yeni kurgular bildirilir.
// - Sekme gizliyken istek atılmaz; sembol/TF başına nazik bekleme Binance limitlerini korur.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Candle, Ticker24h } from '@/lib/types';
import { fetchKlines } from '@/lib/binance';
import {
  SCANNER_HIT_COOLDOWN_MS,
  SCANNER_TIMEFRAMES,
  ScannerHit,
  pickScannerUniverse,
  scanCandlesForHits
} from '@/lib/scanner-engine';
import { initPatternDB, patternGetStats, patternGetStatsBest } from '@/lib/pattern-engine';

export interface PatternRadarOptions {
  enabled: boolean;
  topN: number;
  tickers: Ticker24h[];
  favs: string[];
  excludeSymbol: string;
  ma1: number;
  ma2: number;
  ma3: number;
  sarStep: number;
  sarMax: number;
  onHit: (hit: ScannerHit) => void;
}

export interface PatternRadarState {
  hits: ScannerHit[];
  universe: string[];
  scanningSymbol: string | null;
  lastCycleAt: number | null;
  runOnce: () => void;
}

const SYMBOL_DELAY_MS = 1500;
const TF_DELAY_MS = 600;
const MIN_CYCLE_MS = 60_000; // tam tur minimum süresi (hızlı spam turları önler)

function sleep(ms: number, signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (signal.stopped) return resolve();
      const remaining = ms - (Date.now() - start);
      if (remaining <= 0) return resolve();
      setTimeout(tick, Math.min(remaining, 300));
    };
    setTimeout(tick, 0);
  });
}

function waitWhileHidden(signal: { stopped: boolean }): Promise<void> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || !document.hidden) {
      resolve();
      return;
    }
    let poll: ReturnType<typeof setInterval> | null = null;
    const finish = () => {
      document.removeEventListener('visibilitychange', onVis);
      if (poll) clearInterval(poll);
      resolve();
    };
    const onVis = () => {
      if (!document.hidden) finish();
    };
    document.addEventListener('visibilitychange', onVis);
    poll = setInterval(() => {
      if (signal.stopped) finish();
    }, 500);
  });
}

export function usePatternRadar(opts: PatternRadarOptions): PatternRadarState {
  const [hits, setHits] = useState<ScannerHit[]>([]);
  const [universe, setUniverse] = useState<string[]>([]);
  const [scanningSymbol, setScanningSymbol] = useState<string | null>(null);
  const [lastCycleAt, setLastCycleAt] = useState<number | null>(null);
  const [runToken, setRunToken] = useState(0);

  // Sık değişen girdiler ref arkasında: döngü sürekli resetlenmesin
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  const runOnce = useCallback(() => setRunToken((t) => t + 1), []);

  useEffect(() => {
    if (!opts.enabled) {
      setScanningSymbol(null);
      return;
    }

    const signal = { stopped: false };
    const hitCooldown = new Map<string, number>();
    let baselineDone = false;

    const statsLookup = async (coinKey: string, globalKey: string) => {
      const [coin, tf, patId] = coinKey.split(':');
      if (!coin || !tf || !patId) return null;
      const { stats } = await patternGetStatsBest(coin, tf, patId);
      return stats || patternGetStats(globalKey);
    };

    const recordHit = (hit: ScannerHit, silent: boolean) => {
      const key = `${hit.symbol}:${hit.timeframe}:${hit.patternId}`;
      const now = Date.now();
      const last = hitCooldown.get(key) || 0;
      if (now - last < SCANNER_HIT_COOLDOWN_MS) return;
      hitCooldown.set(key, now);
      if (silent) return; // baseline turu: sadece cooldown doldur

      setHits((prev) => [hit, ...prev].slice(0, 40));
      try {
        optsRef.current.onHit(hit);
      } catch {}
    };

    const cycle = async () => {
      const o = optsRef.current;
      if (!o.tickers.length) return;

      const uni = pickScannerUniverse(o.tickers, {
        favs: o.favs,
        topN: o.topN,
        exclude: o.excludeSymbol
      });
      setUniverse(uni);
      if (!uni.length) return;

      await initPatternDB().catch(() => {});

      for (const sym of uni) {
        if (signal.stopped) return;
        setScanningSymbol(sym);
        await waitWhileHidden(signal);
        if (signal.stopped) return;

        for (const tf of SCANNER_TIMEFRAMES) {
          if (signal.stopped) return;
          let candles: Candle[] = [];
          try {
            candles = await fetchKlines(sym, tf, 200);
          } catch {
            candles = [];
          }
          if (signal.stopped) return;

          if (candles.length) {
            const p = optsRef.current;
            const found = await scanCandlesForHits(
              sym,
              tf,
              candles,
              {
                ma1: p.ma1,
                ma2: p.ma2,
                ma3: p.ma3,
                sarStep: p.sarStep,
                sarMax: p.sarMax,
                lookbackBars: 3
              },
              statsLookup
            ).catch(() => [] as ScannerHit[]);

            if (signal.stopped) return;
            // Sembol+TF başına yalnızca en güncel kurgu bildirilir (spam önleme)
            if (found.length) {
              recordHit(found[found.length - 1], !baselineDone);
            }
          }
          await sleep(TF_DELAY_MS, signal);
        }
        await sleep(SYMBOL_DELAY_MS, signal);
      }

      setScanningSymbol(null);
      setLastCycleAt(Date.now());
      baselineDone = true;
    };

    (async () => {
      // Başlangıç: ticker verisi hazır olana kadar bekle
      let waited = 0;
      while (!signal.stopped && !optsRef.current.tickers.length && waited < 20000) {
        await sleep(1000, signal);
        waited += 1000;
      }
      while (!signal.stopped) {
        await cycle();
        if (signal.stopped) break;
        // Tur sonu bekleme: minimum döngü süresi kadar
        await sleep(Math.max(2000, MIN_CYCLE_MS), signal);
      }
    })();

    return () => {
      signal.stopped = true;
    };
  }, [opts.enabled, runToken]);

  return { hits, universe, scanningSymbol, lastCycleAt, runOnce };
}
