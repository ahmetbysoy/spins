'use client';

// Canlı akış hook'u — WS istemcisi, orderflow dedektörleri, heatmap örnekleme,
// OI/funding poller, klines yükleme + backfill ve akış anlık görüntüsü.
// Kod, app/page.tsx içinden birebir taşındı (davranış değişikliği yok);
// sinyal motoru callback'i ref üzerinden (onClosedCandle) beslenir.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppSettings,
  Candle,
  FlowEvent,
  FlowSnapshot,
  HeatmapBin,
  HeatmapFrame,
  LiquidationEvent,
  SymbolInfo,
  TradeEvent
} from '@/lib/types';
import { BinanceStreamClient, fetchKlines, fetchOpenInterest, fetchPremiumIndex, type StreamStatus } from '@/lib/binance';
import { fetchJsonRaced } from '@/lib/rest-race';
import { patternBackfillFromCandles } from '@/lib/pattern-engine';
import { soundEngine } from '@/lib/audio';
import { pushNotify } from '@/lib/notifications';
import { whaleThreshold } from '@/lib/scoring-rules';
import {
  collectWalls,
  detectAbsorption,
  detectDeltaBurst,
  detectSpoofRemovals,
  detectSweep
} from '@/lib/flow-detectors';
import { computeFlowSnapshotCore } from '@/lib/flow-snapshot';

export interface UseFlowStreamOptions {
  symbol: string;
  interval: string;
  settings: AppSettings;
  settingsRef: React.RefObject<AppSettings>;
  symbolInfos: SymbolInfo[];
  /** Kapalı mum geldiğinde sinyal motorunu tetikler (ref: WS lifecycle'tan ayrık) */
  onClosedCandle: React.RefObject<(cs: Candle[]) => void>;
}

export interface FlowStreamApi {
  candles: Candle[];
  lastPrice: number;
  fundingRate: number | null;
  markPrice: number | null;
  nextFundingTime: number | null;
  openInterest: number | null;
  wsConnected: boolean;
  marketConnected: boolean;
  depthConnected: boolean;
  wsMessage: string;
  liquidations: LiquidationEvent[];
  flowEvents: FlowEvent[];
  heatmapFrames: HeatmapFrame[];
  bidsBook: Map<number, number>;
  asksBook: Map<number, number>;
  flowSnapshot: FlowSnapshot;
  candlesRef: React.RefObject<Candle[]>;
  tradesRef: React.RefObject<TradeEvent[]>;
  liqsRef: React.RefObject<LiquidationEvent[]>;
  lastDepthTsRef: React.RefObject<number>;
  lastMarkTsRef: React.RefObject<number>;
  computeFlowSnapshot: () => FlowSnapshot;
  reconnect: () => void;
  resetStreams: () => void;
  clearEvents: () => void;
}

export function useFlowStream(opts: UseFlowStreamOptions): FlowStreamApi {
  const { symbol, interval, settings, settingsRef, symbolInfos, onClosedCandle } = opts;

  const [candles, setCandles] = useState<Candle[]>([]);

  // Real-time Flow State
  const [lastPrice, setLastPrice] = useState<number>(0);
  const [fundingRate, setFundingRate] = useState<number | null>(null);
  const [markPrice, setMarkPrice] = useState<number | null>(null);
  const [nextFundingTime, setNextFundingTime] = useState<number | null>(null);
  const [openInterest, setOpenInterest] = useState<number | null>(null);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [marketConnected, setMarketConnected] = useState<boolean>(false);
  const [depthConnected, setDepthConnected] = useState<boolean>(false);
  const [wsMessage, setWsMessage] = useState<string>('');

  // Flow Data Arrays
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [liquidations, setLiquidations] = useState<LiquidationEvent[]>([]);
  const [flowEvents, setFlowEvents] = useState<FlowEvent[]>([]);
  const [heatmapFrames, setHeatmapFrames] = useState<HeatmapFrame[]>([]);
  const [bidsBook, setBidsBook] = useState<Map<number, number>>(new Map());
  const [asksBook, setAsksBook] = useState<Map<number, number>>(new Map());
  const [flowSnapshot, setFlowSnapshot] = useState<FlowSnapshot>({
    cvd60: 0,
    notional60: 0,
    cvdBias: 0,
    cvdSlope: 0,
    obi: 0,
    bidVol: 0,
    askVol: 0,
    longLiq60: 0,
    shortLiq60: 0,
    oi: null,
    oiChangePct: 0,
    funding: null,
    markPrice: null,
    nextFunding: null,
    bestBid: 0,
    bestAsk: 0,
    spread: 0,
    taker30: 0,
    takerSpike: false,
    rangePct: 0,
    atrPct: 0,
    tightRange: false,
    change5: 0,
    cascadeDown: false,
    cascadeUp: false,
    wallCount: { bid: 0, ask: 0 }
  });


  // Refs
  const lastPriceRef = useRef<number>(lastPrice);
  const candlesRef = useRef<Candle[]>(candles);
  const prevOiRef = useRef<number | null>(null);
  const latestOiRef = useRef<number | null>(null);
  const bidsBookRef = useRef<Map<number, number>>(bidsBook);
  const asksBookRef = useRef<Map<number, number>>(asksBook);
  const lastDepthTsRef = useRef<number>(0);
  const lastMarkTsRef = useRef<number>(0);
  const tickSizeRef = useRef<number>(0);
  const clientRef = useRef<BinanceStreamClient | null>(null);
  const tradesRef = useRef<TradeEvent[]>([]);
  const liqsRef = useRef<LiquidationEvent[]>([]);
  const lastHeatSampleRef = useRef<number>(0);
  const lastWhaleRef = useRef<number>(0);
  const lastSweepRef = useRef<number>(0);
  const lastAbsorbRef = useRef<number>(0);
  const lastBurstRef = useRef<number>(0);
  const lastDepthStateRef = useRef<number>(0);
  const prevWallsRef = useRef<Map<number, { notional: number; ts: number; side: 'B' | 'A' }>>(new Map());

  useEffect(() => {
    lastPriceRef.current = lastPrice;
  }, [lastPrice]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    bidsBookRef.current = bidsBook;
    asksBookRef.current = asksBook;
  }, [bidsBook, asksBook]);

  useEffect(() => {
    const si = symbolInfos.find((x) => x.symbol === symbol);
    tickSizeRef.current = si && si.tickSize > 0 ? si.tickSize : 0;
  }, [symbolInfos, symbol]);

  // 2. Load Historical Klines & Run Pattern Backfill
  useEffect(() => {
    let active = true;
    const loadKlinesAndBackfill = async () => {
      try {
        const data = await fetchKlines(symbol, interval, 600);
        if (active) {
          setCandles(data);
          if (data.length) setLastPrice(data[data.length - 1].close);
          
          // Asynchronously learn & backfill pattern stats from current TF history
          const currSettings = settingsRef.current;
          patternBackfillFromCandles(
            symbol,
            interval,
            data,
            currSettings.ma1,
            currSettings.ma2,
            currSettings.ma3,
            currSettings.sarStep,
            currSettings.sarMax,
            currSettings.patternWinPct
          ).catch((err) => console.warn('Backfill error:', err));

          // Multi-Timeframe background backfill for 1m & 5m (F2-12)
          const extraTfs = ['1m', '5m'].filter((tf) => tf !== interval);
          extraTfs.forEach(async (tf) => {
            try {
              const extraData = await fetchKlines(symbol, tf, 400);
              if (extraData && extraData.length > 50) {
                await patternBackfillFromCandles(
                  symbol,
                  tf,
                  extraData,
                  currSettings.ma1,
                  currSettings.ma2,
                  currSettings.ma3,
                  currSettings.sarStep,
                  currSettings.sarMax,
                  currSettings.patternWinPct
                );
              }
            } catch {}
          });
        }
      } catch (e) {
        console.warn('Failed to load klines:', e);
      }
    };
    loadKlinesAndBackfill();
    return () => {
      active = false;
    };
  }, [symbol, interval, settingsRef]);

  // 3. Open Interest & Funding Rate Poller (Tracks poll-to-poll delta)
  useEffect(() => {
    const pollOI = async () => {
      try {
        const [oi, prem] = await Promise.all([fetchOpenInterest(symbol), fetchPremiumIndex(symbol)]);
        if (oi !== null) {
          if (latestOiRef.current !== null) {
            prevOiRef.current = latestOiRef.current;
          } else if (prevOiRef.current === null) {
            prevOiRef.current = oi; // ilk poll: karşılaştırma tabanı
          }
          latestOiRef.current = oi;
          setOpenInterest(oi);
        }
        if (prem.fundingRate !== null) setFundingRate(prem.fundingRate);
        if (prem.markPrice !== null) setMarkPrice(prem.markPrice);
        if (prem.nextFundingTime !== null) setNextFundingTime(prem.nextFundingTime);
      } catch {}
    };

    pollOI();
    const pollSec = Math.max(15, settings.oiPollSec || 15);
    const id = window.setInterval(pollOI, pollSec * 1000);
    return () => clearInterval(id);
  }, [symbol, settings.oiPollSec]);

  // 4. Compute Flow Snapshot Helper (saf çekirdek lib/flow-snapshot.ts içinde test ediliyor)
  const computeFlowSnapshot = useCallback((): FlowSnapshot => {
    const currSettings = settingsRef.current;
    return computeFlowSnapshotCore({
      now: Date.now(),
      trades: tradesRef.current,
      liquidations: liqsRef.current,
      candles: candlesRef.current,
      bids: bidsBookRef.current,
      asks: asksBookRef.current,
      lastPrice: lastPriceRef.current,
      oi: openInterest,
      oiPrev: prevOiRef.current,
      funding: fundingRate,
      markPrice,
      nextFunding: nextFundingTime,
      cascadePct: currSettings.cascadePct || 0.8,
      whaleMin: whaleThreshold(currSettings.whaleMin),
      liqMin: currSettings.liqMin || 50000
    });
  }, [fundingRate, markPrice, nextFundingTime, openInterest, settingsRef]);

  const reconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stop();
      clientRef.current.start();
    }
  }, []);

  // Sadece görünen olay dizilerini temizler (TF değişimi; ref'ler/book'lar korunur — orijinal davranış)
  const clearEvents = useCallback(() => {
    setFlowEvents([]);
    setLiquidations([]);
    setHeatmapFrames([]);
  }, []);

  const resetStreams = useCallback(() => {
    tradesRef.current = [];
    liqsRef.current = [];
    prevOiRef.current = null;
    latestOiRef.current = null;
    setTrades([]);
    setLiquidations([]);
    setFlowEvents([]);
    setHeatmapFrames([]);
    setBidsBook(new Map());
    setAsksBook(new Map());
  }, []);

  // 7. Initialize Real-Time WebSocket Streaming Client (Stable Lifecycle)
  useEffect(() => {
    // PREDATOR port'u — handler'lar hem WS istemcisine hem REST dusus moduna hizmet eder
    const handleKline = (candle: Candle, isClosed: boolean) => {
        setLastPrice(candle.close);
        setCandles((prev) => {
          if (!prev.length) return [candle];
          const last = prev[prev.length - 1];
          let updated: Candle[];
          if (last.time === candle.time) {
            updated = [...prev.slice(0, -1), candle];
          } else {
            updated = [...prev, candle];
            if (updated.length > 700) updated.shift();
          }
          return updated;
        });

        if (isClosed) {
          // Trigger signal engine on closed candle (ref: bagimlilik zincirinden ayristirildi)
          onClosedCandle.current(candlesRef.current);
        }
    };

    const handleTrade = (trade: TradeEvent) => {
        tradesRef.current.push(trade);
        const now = trade.ts;
        const tenMinAgo = now - 600000;
        if (tradesRef.current.length > 3000 || (tradesRef.current[0] && tradesRef.current[0].ts < tenMinAgo)) {
          tradesRef.current = tradesRef.current.filter((t) => t.ts >= tenMinAgo);
        }

        const whaleMin = whaleThreshold(settingsRef.current.whaleMin); // Görev C: 50k taban

        // 1. Whale Detector
        if (trade.notional >= whaleMin && now - lastWhaleRef.current > 2000) {
          lastWhaleRef.current = now;
          soundEngine.playWhale();
          if (trade.notional >= whaleMin * 2) {
            pushNotify(
              { title: `🐋 Whale ${trade.side.toUpperCase()} — $${(trade.notional / 1000).toFixed(0)}k`, body: `${symbol} @ $${trade.price}`, tag: `whale-${symbol}` },
              15000
            );
          }
          const ev: FlowEvent = {
            id: `${now}-${Math.random()}`,
            type: 'WHALE',
            sev: trade.notional >= whaleMin * 2 ? 'high' : 'medium',
            text: `Whale ${trade.side.toUpperCase()} $${(trade.notional / 1000).toFixed(0)}k @ $${trade.price}`,
            ts: now,
            side: trade.side
          };
          setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
        }

        // 2. Sweep Detector (saf çekirdek lib/flow-detectors.ts)
        if (now - lastSweepRef.current > 4000) {
          const sweep = detectSweep(tradesRef.current, now, whaleMin);
          if (sweep) {
            lastSweepRef.current = now;
            soundEngine.playWhale();
            const ev: FlowEvent = {
              id: `${now}-${Math.random()}`,
              type: 'SWEEP',
              sev: 'high',
              text: `SWEEP ${sweep.side.toUpperCase()} $${(sweep.total / 1000).toFixed(0)}k (${sweep.count} işlem)`,
              ts: now,
              side: sweep.side
            };
            setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
          }
        }

        // 3. Delta Burst Detector (saf çekirdek lib/flow-detectors.ts)
        if (now - lastBurstRef.current > 8000) {
          const burst = detectDeltaBurst(tradesRef.current, now, whaleMin);
          if (burst) {
            lastBurstRef.current = now;
            soundEngine.playWhale();
            const ev: FlowEvent = {
              id: `${now}-${Math.random()}`,
              type: 'DELTA_BURST',
              sev: 'high',
              text: `DELTA BURST ${burst.side.toUpperCase()} CVD: $${(burst.cvd / 1000).toFixed(0)}k (Hacim: $${(burst.vol / 1000).toFixed(0)}k, 1D Eğim Onaylı)`,
              ts: now,
              side: burst.side
            };
            setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
          }
        }

        // 4. Absorption Detector (saf çekirdek lib/flow-detectors.ts)
        if (now - lastAbsorbRef.current > 6000) {
          const absorb = detectAbsorption(tradesRef.current, now, whaleMin);
          if (absorb) {
            lastAbsorbRef.current = now;
            const ev: FlowEvent = {
              id: `${now}-${Math.random()}`,
              type: 'ABSORPTION',
              sev: 'high',
              text: `ABSORPTION: Pasif ${absorb.side.toUpperCase()} Duvarı $${(absorb.vol / 1000).toFixed(0)}k emdi (Fiyat kayması <%0.08)`,
              ts: now,
              side: absorb.side
            };
            setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
          }
        }
    };

    const handleMark = (mark: { markPrice: number; fundingRate: number; nextFundingTime: number }) => {
        lastMarkTsRef.current = Date.now(); // Görev C: tazelik takibi
        setMarkPrice(mark.markPrice);
        setFundingRate(mark.fundingRate);
        setNextFundingTime(mark.nextFundingTime);
    };

    const handleLiquidation = (liq: LiquidationEvent) => {
        liqsRef.current.push(liq);
        const tenMinAgo = liq.ts - 600000;
        if (liqsRef.current.length > 250 || (liqsRef.current[0] && liqsRef.current[0].ts < tenMinAgo)) {
          liqsRef.current = liqsRef.current.filter((l) => l.ts >= tenMinAgo);
        }
        setLiquidations((prev) => [liq, ...prev.slice(0, 50)]);

        if (liq.notional >= (settingsRef.current.liqMin || 50000)) {
          soundEngine.playLiquidation();
          if (liq.notional >= (settingsRef.current.liqMin || 50000) * 3) {
            pushNotify(
              { title: `💥 Büyük Likidasyon — ${liq.side === 'SELL' ? 'LONG' : 'SHORT'} $${(liq.notional / 1000).toFixed(0)}k`, body: `${symbol} @ $${liq.price}`, tag: `liq-${symbol}` },
              12000
            );
          }
          const ev: FlowEvent = {
            id: `${liq.ts}-${Math.random()}`,
            type: 'LIQUIDATION',
            sev: 'high',
            text: `Likidasyon: ${liq.side === 'SELL' ? 'LONG' : 'SHORT'} $${(liq.notional / 1000).toFixed(0)}k @ $${liq.price}`,
            ts: liq.ts
          };
          setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
        }
    };

    const handleDepth = (depth: { bids: Map<number, number>; asks: Map<number, number>; lastUpdateId: number }) => {
        lastDepthTsRef.current = Date.now(); // Görev C: tazelik takibi
        bidsBookRef.current = depth.bids;
        asksBookRef.current = depth.asks;

        const now = Date.now();
        // React state'i 250ms'de bir yay; hesaplamalar (spoof/heatmap) her tick'te calismaya devam eder.
        if (now - lastDepthStateRef.current >= 250) {
          lastDepthStateRef.current = now;
          setBidsBook(new Map(depth.bids));
          setAsksBook(new Map(depth.asks));
        }

        const whaleMin = whaleThreshold(settingsRef.current.whaleMin); // Görev C: 50k taban

        // Spoofing Detector (saf çekirdek lib/flow-detectors.ts)
        const currentWalls = collectWalls(depth.bids, depth.asks, whaleMin, now);
        const spoofs = detectSpoofRemovals(prevWallsRef.current, currentWalls, now, whaleMin);
        spoofs.forEach((s) => {
          const ev: FlowEvent = {
            id: `${now}-${Math.random()}`,
            type: 'SPOOF',
            sev: 'medium',
            text: `SPOOF Wall İptal: $${(s.notional / 1000).toFixed(0)}k ${s.side === 'B' ? 'BID' : 'ASK'} @ $${s.price} (${(s.ageMs / 1000).toFixed(1)}s)`,
            ts: now,
            side: s.side === 'B' ? 'buy' : 'sell'
          };
          setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
        });
        prevWallsRef.current = currentWalls;

        // Sample Heatmap frame every 1s
        if (now - lastHeatSampleRef.current >= 1000 && settingsRef.current.showHeatmap) {
          lastHeatSampleRef.current = now;
          let bestBid = 0;
          let bestAsk = Infinity;
          depth.bids.forEach((_, p) => {
            if (p > bestBid) bestBid = p;
          });
          depth.asks.forEach((_, p) => {
            if (p < bestAsk) bestAsk = p;
          });
          const mid = (bestBid + bestAsk) / 2 || lastPriceRef.current;

          if (mid > 0) {
            // Görev D: tick-bucket dedupe + gürültü kesimi (Stage-4 paritesi)
            const tick = tickSizeRef.current;
            const byKey = new Map<string, HeatmapBin>();
            const addBin = (side: 'B' | 'A', p: number, q: number) => {
              const notional = p * q;
              if (notional <= 0) return;
              const price = tick > 0 ? Math.round(p / tick) * tick : p;
              const k = `${side}|${price}`;
              const prevBin = byKey.get(k);
              if (prevBin) {
                prevBin.notional += notional;
                prevBin.price = (prevBin.price + price) / 2;
              } else {
                byKey.set(k, { side, price, notional });
              }
            };

            depth.bids.forEach((q, p) => {
              if (Math.abs(p - mid) / mid <= 0.015) addBin('B', p, q);
            });
            depth.asks.forEach((q, p) => {
              if (Math.abs(p - mid) / mid <= 0.015) addBin('A', p, q);
            });

            const sortedBins = [...byKey.values()].sort((a, b) => b.notional - a.notional);
            if (sortedBins.length) {
              const maxN = sortedBins[0].notional;
              const cut = maxN * 0.035; // %3.5 gürültü eşiği
              const topBins = sortedBins.filter((b) => b.notional >= cut).slice(0, 220);

              setHeatmapFrames((prev) => {
                const next = [...prev, { t: Math.floor(now / 1000), bins: topBins, max: maxN }];
                if (next.length > 900) next.shift(); // 15-minute depth heatmap window
                return next;
              });
            }
          }
        }
    };

    // REST dusus modu (PREDATOR port'u): WS 12sn icinde acilmazsa (cografi engel / guclu
    // firewall) akis, rest-race yaristirmasi uzerinden 5sn'lik polling ile ayakta kalir:
    // klines (mum + kapanista motor), aggTrades (CVD/whale/sweep, aggId dedupe),
    // premiumIndex (mark/funding) ve depth snapshot (kitap/OBI/ladder kaba taneli).
    let degradedTimer: number | null = null;
    let degradedPollCount = 0;
    let lastAggId = 0;
    let wsOpened = false;
    const stopDegraded = () => {
      if (degradedTimer !== null) {
        window.clearInterval(degradedTimer);
        degradedTimer = null;
      }
    };
    const pollDegraded = async () => {
      try {
        degradedPollCount++;
        const ks = await fetchJsonRaced<any[]>(`/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=2`);
        for (const k of ks) {
          handleKline(
            { time: Math.floor(k[0] / 1000), open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) },
            !!k[6]
          );
        }
        const trs = await fetchJsonRaced<any[]>(`/fapi/v1/aggTrades?symbol=${symbol}&limit=200`);
        const fresh = trs.filter((t) => (t.a as number) > lastAggId);
        if (fresh.length) {
          lastAggId = fresh[fresh.length - 1].a;
          for (const t of fresh) {
            const price = parseFloat(t.p);
            const qty = parseFloat(t.q);
            const notional = price * qty;
            handleTrade({ ts: t.T, price, qty, notional, delta: t.m ? -notional : notional, side: t.m ? 'sell' : 'buy' });
          }
        }
        if (degradedPollCount % 2 === 1) {
          const pi = await fetchJsonRaced<any>(`/fapi/v1/premiumIndex?symbol=${symbol}`);
          handleMark({
            markPrice: parseFloat(pi.markPrice) || 0,
            fundingRate: pi.lastFundingRate !== undefined ? parseFloat(pi.lastFundingRate) || 0 : 0,
            nextFundingTime: Number(pi.nextFundingTime) || 0
          });
        }
        if (degradedPollCount % 2 === 0) {
          const dp = await fetchJsonRaced<any>(`/fapi/v1/depth?symbol=${symbol}&limit=100`);
          const bids = new Map<number, number>(dp.bids.map((x: string[]) => [parseFloat(x[0]), parseFloat(x[1])] as [number, number]));
          const asks = new Map<number, number>(dp.asks.map((x: string[]) => [parseFloat(x[0]), parseFloat(x[1])] as [number, number]));
          handleDepth({ bids, asks, lastUpdateId: Number(dp.lastUpdateId) || 0 });
        }
      } catch {
        // dusus modu da olurse sonraki tur yeniden dener
      }
    };
    const armDegraded = window.setTimeout(() => {
      if (wsOpened) return;
      setWsMessage('REST dusus modu (WS engelli olabilir)');
      degradedTimer = window.setInterval(() => {
        void pollDegraded();
      }, 5000);
      void pollDegraded();
    }, 12000);

    const client = new BinanceStreamClient(symbol, interval, {
      onKline: handleKline,
      onTrade: handleTrade,
      onMarkPrice: handleMark,
      onLiquidation: handleLiquidation,
      onDepthUpdate: handleDepth,
      onStatusChange: (st: StreamStatus) => {

        setWsConnected(st.connected);
        setMarketConnected(st.marketConnected);
        setDepthConnected(st.depthConnected);
        setWsMessage(st.message || '');
        if (st.connected) {
          wsOpened = true;
          stopDegraded();
        }
      }
    });

    clientRef.current = client;
    client.start();

    return () => {
      window.clearTimeout(armDegraded);
      stopDegraded();
      client.stop();
      clientRef.current = null;
    };
  }, [symbol, interval, settingsRef, onClosedCandle]);

  // Periodic flow snapshot calculation
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFlowSnapshot(computeFlowSnapshot());
    }, 500);
    return () => clearInterval(timer);
  }, [computeFlowSnapshot]);

  return {
    candles,
    lastPrice,
    fundingRate,
    markPrice,
    nextFundingTime,
    openInterest,
    wsConnected,
    marketConnected,
    depthConnected,
    wsMessage,
    liquidations,
    flowEvents,
    heatmapFrames,
    bidsBook,
    asksBook,
    flowSnapshot,
    candlesRef,
    tradesRef,
    liqsRef,
    lastDepthTsRef,
    lastMarkTsRef,
    computeFlowSnapshot,
    reconnect,
    resetStreams,
    clearEvents
  };
}
