'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { BottomToolbar } from '@/components/BottomToolbar';
import { ChartTerminal } from '@/components/ChartTerminal';
import { FlowMetricsPanel } from '@/components/FlowMetricsPanel';
import { SignalCard } from '@/components/SignalCard';
import { OrderFlowLog } from '@/components/OrderFlowLog';
import { MarketScanner } from '@/components/MarketScanner';
import { PatternPoolView } from '@/components/PatternPoolView';
import { SettingsModal } from '@/components/SettingsModal';
import {
  AppSettings,
  Candle,
  DecisionEvaluation,
  FlowEvent,
  FlowSnapshot,
  HeatmapFrame,
  LiquidationEvent,
  PatternEvent,
  PatternOverlayState,
  PatternStats,
  SignalLogEntry,
  SymbolInfo,
  Ticker24h,
  TradeEvent
} from '@/lib/types';
import {
  BinanceStreamClient,
  fetch24hTickers,
  fetchExchangeInfo,
  fetchKlines,
  fetchOpenInterest,
  fetchPremiumIndex
} from '@/lib/binance';
import { generateCommentary } from '@/lib/commentary';
import { soundEngine } from '@/lib/audio';
import {
  initPatternDB,
  intervalToSeconds,
  patternContext,
  patternCrossesAt,
  patternGetStats,
  patternGetStatsBest,
  patternOutcome,
  patternResolveSar,
  patternBackfillFromCandles,
  patternRecomputeStats,
  patternId,
  dbAdd,
  dbPut,
  dbIndexGet,
  dbIndexAll,
  dbAll,
  PPOOL_SCHEMA_VERSION
} from '@/lib/pattern-engine';

const DEFAULT_SETTINGS: AppSettings = {
  ma1: 9,
  ma2: 21,
  ma3: 50,
  sarStep: 0.02,
  sarMax: 0.2,
  nWindow: 3,
  dark: true,
  showMa: true,
  showSar: true,
  showVol: true,
  rawConfirm: true,
  showFlow: true,
  showLiq: true,
  liqMin: 50000,
  oiPollSec: 15,
  cascadePct: 0.8,
  showLadder: true,
  showHeatmap: true,
  whaleAlerts: true,
  whaleMin: 300000,
  wallPct: 90,
  showBB: false,
  showRsi: false,
  showMacd: false,
  showVwap: true,
  bbPeriod: 20,
  bbStd: 2,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  patternWinPct: 0.15,
  ma1Color: '#e0b64c',
  ma2Color: '#4c8ce0',
  ma3Color: '#b06ce0',
  ma1Width: 1,
  ma2Width: 1,
  ma3Width: 1,
  sarColor: '#9aa4ae',
  sarWidth: 1,
  bbColor: '#4c8ce0',
  bbWidth: 1,
  vwapColor: '#ff9800',
  vwapWidth: 2,
  rsiColor: '#fdd835',
  rsiWidth: 1,
  macdColor: '#00bcd4',
  macdWidth: 1,
  macdSignalColor: '#ff7043',
  macdSignalWidth: 1
};

export default function Home() {
  // Navigation & Core State
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<string>('5m');
  const [activeView, setActiveView] = useState<'chart' | 'signal' | 'scanner' | 'pool' | 'settings'>('chart');
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolInfos, setSymbolInfos] = useState<SymbolInfo[]>([]);
  const [tickers, setTickers] = useState<Ticker24h[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

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

  // Decision & Signals
  const [status, setStatus] = useState<'AL' | 'SAT' | 'IZLEMEDE' | 'NOTR'>('NOTR');
  const [statusRule, setStatusRule] = useState<string>('Tetikleyici aranıyor...');
  const [evaluation, setEvaluation] = useState<DecisionEvaluation | null>(null);
  const [commentary, setCommentary] = useState<string>('Piyasa taranıyor, veri akışı ısınıyor...');
  const [signals, setSignals] = useState<SignalLogEntry[]>([]);
  const [activePatternStats, setActivePatternStats] = useState<PatternStats | null>(null);
  const [activePatternId, setActivePatternId] = useState<string | null>(null);
  // P1.5: Desen overlay state'i (pool toggle veya sinyal-otomatik)
  const [patternOverlay, setPatternOverlay] = useState<PatternOverlayState | null>(null);

  // Stable references to prevent WebSocket reconnect storms
  const settingsRef = useRef<AppSettings>(settings);
  const lastPriceRef = useRef<number>(lastPrice);
  const candlesRef = useRef<Candle[]>(candles);
  const prevOiRef = useRef<number | null>(null);
  const latestOiRef = useRef<number | null>(null);
  const bidsBookRef = useRef<Map<number, number>>(bidsBook);
  const asksBookRef = useRef<Map<number, number>>(asksBook);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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

  const clientRef = useRef<BinanceStreamClient | null>(null);
  const tradesRef = useRef<TradeEvent[]>([]);
  const liqsRef = useRef<LiquidationEvent[]>([]);
  const lastHeatSampleRef = useRef<number>(0);
  const lastWhaleRef = useRef<number>(0);
  const lastSweepRef = useRef<number>(0);
  const lastAbsorbRef = useRef<number>(0);
  const lastBurstRef = useRef<number>(0);
  const lastDepthStateRef = useRef<number>(0);
  const lastRecordedEventTimeRef = useRef<number>(0);
  const lastRecordedPatIdRef = useRef<string>('');
  const prevWallsRef = useRef<Map<number, { notional: number; ts: number; side: 'B' | 'A' }>>(new Map());
  const pendingEngineRef = useRef<{
    dir: 'AL' | 'SAT';
    idx: number;
    flip: boolean;
    cross?: {
      dir: 'UP' | 'DOWN';
      filter: 'F1' | 'F0';
      pair: string;
      regime: { vol: 'LOW' | 'MID' | 'HIGH'; trend: 'UP' | 'DOWN' | 'FLAT'; key: string };
    };
  } | null>(null);
  const trackingEventsRef = useRef<Array<{ eventKey: string; candleIdx: number; dir: 'AL' | 'SAT' }>>([]);

  // UI / Layout States
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSignalOpen, setIsSignalOpen] = useState(false);

  // Initialize DB and load saved preferences on Mount (safe from SSR hydration mismatch)
  useEffect(() => {
    initPatternDB();
    const timer = setTimeout(() => {
      try {
        const savedSymbol = localStorage.getItem('fs_symbol');
        if (savedSymbol) setSymbol(savedSymbol);
        const savedInterval = localStorage.getItem('fs_interval');
        if (savedInterval) setInterval(savedInterval);
        const savedFavs = localStorage.getItem('fs_favs');
        if (savedFavs) {
          const parsed = JSON.parse(savedFavs);
          if (Array.isArray(parsed)) setFavs(parsed);
        }
        const savedSettings = localStorage.getItem('fs_settings');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (parsed && typeof parsed === 'object') {
            setSettings((prev) => ({ ...prev, ...parsed }));
          }
        }
      } catch (e) {
        console.warn('Failed to load localStorage preferences:', e);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Keyboard shortcut for Fullscreen (F key) and Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        setIsFullscreen((prev) => !prev);
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Save Settings & Favs on change
  const handleUpdateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('fs_settings', JSON.stringify(newSettings));
    } catch {}
  };

  const handleUpdateSingleSetting = (key: keyof AppSettings, val: any) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: val };
      try {
        localStorage.setItem('fs_settings', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleToggleFav = (sym: string) => {
    const nextFavs = favs.includes(sym) ? favs.filter((s) => s !== sym) : [sym, ...favs];
    setFavs(nextFavs);
    try {
      localStorage.setItem('fs_favs', JSON.stringify(nextFavs));
    } catch {}
  };

  // Settle open tracking events gracefully before switching context (F2-7 & F2-8)
  const settleOpenTrackingEvents = async (cs: Candle[]) => {
    const tracking = trackingEventsRef.current;
    if (!tracking.length || !cs.length) return;
    for (const tr of tracking) {
      try {
        const outcome = patternOutcome(cs, tr.candleIdx, tr.dir === 'AL' ? 'UP' : 'DOWN');
        const ev = await dbIndexGet<PatternEvent>('events', 'eventKey', tr.eventKey);
        if (ev && ev.status !== 'settled') {
          ev.status = 'settled';
          ev.settledAt = Date.now();
          if (outcome) {
            ev.ret5 = outcome.ret5;
            ev.ret10 = outcome.ret10;
            ev.ret20 = outcome.ret20;
            ev.mfe20 = outcome.mfe20;
            ev.mae20 = outcome.mae20;
            ev.rMultiple = outcome.rMultiple;
            ev.barsToMfe = outcome.barsToMfe;
            ev.barsToMae = outcome.barsToMae;
          }
          await dbPut('events', ev);
          if (ev.patternKey) {
            await patternRecomputeStats(ev.patternKey, settingsRef.current.patternWinPct || 0.15);
          }
          if (ev.coinPatternKey) {
            await patternRecomputeStats(ev.coinPatternKey, settingsRef.current.patternWinPct || 0.15);
          }
        }
      } catch {}
    }
    trackingEventsRef.current = [];
  };

  const handleSelectSymbol = (sym: string) => {
    if (sym === symbol) return;
    settleOpenTrackingEvents(candlesRef.current);
    setSymbol(sym);
    try {
      localStorage.setItem('fs_symbol', sym);
    } catch {}
    // Reset flow states for new symbol
    tradesRef.current = [];
    liqsRef.current = [];
    pendingEngineRef.current = null;
    trackingEventsRef.current = [];
    prevOiRef.current = null;
    latestOiRef.current = null;
    setTrades([]);
    setLiquidations([]);
    setSignals([]);
    setFlowEvents([]);
    setHeatmapFrames([]);
    setBidsBook(new Map());
    setAsksBook(new Map());
    setStatus('NOTR');
    setStatusRule('Yeni sembol yüklendi, taranıyor...');
    setEvaluation(null);
    setActivePatternStats(null);
    setActivePatternId(null);
    setPatternOverlay(null); // P1.5: overlay eski sembole ait
  };

  const handleSelectInterval = (tf: string) => {
    if (tf === interval) return;
    settleOpenTrackingEvents(candlesRef.current);
    setInterval(tf);
    try {
      localStorage.setItem('fs_interval', tf);
    } catch {}
    // Yeni zaman dilimi: sinyal/olay bağlamı değişir, grafik ve log temizlensin.
    setSignals([]);
    setFlowEvents([]);
    setLiquidations([]);
    setHeatmapFrames([]);
    pendingEngineRef.current = null;
    trackingEventsRef.current = [];
    setStatus('NOTR');
    setStatusRule('Zaman dilimi değiştirildi, taranıyor...');
    setEvaluation(null);
    setActivePatternStats(null);
    setActivePatternId(null);
    setPatternOverlay(null); // P1.5: overlay eski TF'e ait
  };

  // P1.5: Havuz görünümünden desen overlay toggle — boş events veya aynı key = kapat
  const handleToggleOverlay = useCallback((key: string, events: PatternEvent[]) => {
    setPatternOverlay((prev) => {
      if (!events.length || prev?.key === key) return null;
      return { key, source: 'pool', events };
    });
    if (events.length) setActiveView('chart'); // overlay açılınca grafiğe geç
  }, []);

  // P1.5: Sinyal ateşlenince aynı desenin son GEÇMİŞ örneğini otomatik grafikte göster
  // (pool kaynaklı manuel overlay aktifse ona dokunma)
  useEffect(() => {
    if (!activePatternId) {
      setPatternOverlay((prev) => (prev?.source === 'signal' ? null : prev));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const coinKey = `${symbol}:${interval}:${activePatternId}`;
        const evs = (await dbIndexAll<PatternEvent>('events', 'coinPatternKey', coinKey))
          .filter((e) => e.status === 'settled')
          .sort((a, b) => b.timestamp - a.timestamp);
        if (cancelled || !evs.length) return;
        setPatternOverlay((prev) =>
          prev && prev.source === 'pool' ? prev : { key: coinKey, source: 'signal', events: [evs[0]] }
        );
      } catch {
        // sessiz: overlay dekoratif, sinyal akışını asla bloklamasın
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePatternId, symbol, interval]);

  // 1. Load Exchange Info & 24h Tickers
  useEffect(() => {
    const loadMarketData = async () => {
      try {
        const [infos, tickerList] = await Promise.all([fetchExchangeInfo(), fetch24hTickers()]);
        setSymbolInfos(infos);
        setSymbols(infos.map((i) => i.symbol));
        setTickers(tickerList);
      } catch (e) {
        console.warn('Failed to load exchange info:', e);
      }
    };
    loadMarketData();
    const intervalId = window.setInterval(async () => {
      try {
        const tickerList = await fetch24hTickers();
        setTickers(tickerList);
      } catch {}
    }, 15000);
    return () => clearInterval(intervalId);
  }, []);

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
  }, [symbol, interval]);

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

  // 4. Compute Flow Snapshot Helper
  const computeFlowSnapshot = useCallback((): FlowSnapshot => {
    const now = Date.now();
    const recentTrades = tradesRef.current;
    const recentLiqs = liqsRef.current;
    const currPrice = lastPriceRef.current;
    const currSettings = settingsRef.current;
    const currCandles = candlesRef.current;
    const currBids = bidsBookRef.current;
    const currAsks = asksBookRef.current;

    // 60s CVD & notional
    let cvd60 = 0;
    let notional60 = 0;
    let cvdPrev = 0;
    let notionalPrev = 0;
    let taker30 = 0;

    for (let i = recentTrades.length - 1; i >= 0; i--) {
      const t = recentTrades[i];
      const age = now - t.ts;
      if (age <= 30000) taker30 += t.notional;
      if (age <= 60000) {
        cvd60 += t.delta;
        notional60 += t.notional;
      } else if (age <= 180000) {
        cvdPrev += t.delta;
        notionalPrev += t.notional;
      }
    }

    const cvdBias = notional60 > 0 ? cvd60 / notional60 : 0;
    const prevBias = notionalPrev > 0 ? cvdPrev / notionalPrev : 0;
    const cvdSlope = cvdBias - prevBias;

    // Liquidations 60s
    let longLiq60 = 0;
    let shortLiq60 = 0;
    for (let i = recentLiqs.length - 1; i >= 0; i--) {
      const l = recentLiqs[i];
      if (now - l.ts <= 60000) {
        if (l.type === 'LONG_LIQ') longLiq60 += l.notional;
        else shortLiq60 += l.notional;
      }
    }

    // OBI (Order Book Imbalance within 1% band)
    let bestBid = 0;
    let bestAsk = Infinity;
    currBids.forEach((_, p) => {
      if (p > bestBid) bestBid = p;
    });
    currAsks.forEach((_, p) => {
      if (p < bestAsk) bestAsk = p;
    });
    if (!Number.isFinite(bestAsk)) bestAsk = 0;

    const spread = bestAsk > bestBid && bestBid > 0 ? bestAsk - bestBid : 0;
    const mid = (bestBid + bestAsk) / 2 || currPrice;
    const lo = mid * 0.99;
    const hi = mid * 1.01;

    let bidVol = 0;
    let askVol = 0;
    currBids.forEach((q, p) => {
      if (p >= lo) bidVol += p * q;
    });
    currAsks.forEach((q, p) => {
      if (p <= hi) askVol += p * q;
    });

    const obi = bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;

    // OI Delta %
    const prevOiVal = prevOiRef.current;
    const oiChangePct = prevOiVal && openInterest ? ((openInterest - prevOiVal) / prevOiVal) * 100 : 0;

    // Range & ATR
    const win = currCandles.slice(-20);
    const hiP = Math.max(...win.map((c) => c.high), 1);
    const loP = Math.min(...win.map((c) => c.low), 1);
    const rangePct = currPrice > 0 ? (hiP - loP) / currPrice : 0;
    const atrPct =
      win.length > 0 ? win.reduce((a, c) => a + (c.high - c.low) / (c.close || 1), 0) / win.length : 0;
    const tightRange = rangePct > 0 && (rangePct < 0.006 || atrPct < 0.0012);

    const base5 = currCandles[Math.max(0, currCandles.length - 6)]?.close || currPrice;
    const change5 = base5 > 0 ? (currPrice - base5) / base5 : 0;
    const cascadeThr = (currSettings.cascadePct || 0.8) / 100;

    // Wall counts
    let wallBid = 0;
    let wallAsk = 0;
    const wallMin = (currSettings.whaleMin || 300000) * 0.7;
    currBids.forEach((q, p) => {
      if (p * q >= wallMin) wallBid++;
    });
    currAsks.forEach((q, p) => {
      if (p * q >= wallMin) wallAsk++;
    });

    return {
      cvd60,
      notional60,
      cvdBias,
      cvdSlope,
      obi,
      bidVol,
      askVol,
      longLiq60,
      shortLiq60,
      oi: openInterest,
      oiChangePct,
      funding: fundingRate,
      markPrice,
      nextFunding: nextFundingTime,
      bestBid,
      bestAsk,
      spread,
      taker30,
      takerSpike: taker30 > (notionalPrev / 4) * 1.8 && taker30 > 25000,
      rangePct,
      atrPct,
      tightRange,
      change5,
      cascadeDown: change5 < -cascadeThr || longLiq60 > (currSettings.liqMin || 50000) * 2,
      cascadeUp: change5 > cascadeThr || shortLiq60 > (currSettings.liqMin || 50000) * 2,
      wallCount: { bid: wallBid, ask: wallAsk }
    };
  }, [fundingRate, markPrice, nextFundingTime, openInterest]);

  // 5. Evaluate Raw Flow Scoring (Katman 2) & Pattern Pool Multi-Confluence (F1-4, F2-1)
  const evaluateRawFlow = useCallback(
    (dir: 'AL' | 'SAT', idx: number, patternStats?: PatternStats | null): DecisionEvaluation => {
      const currSettings = settingsRef.current;
      if (!currSettings.rawConfirm) {
        return {
          score: null,
          grade: 'HAM',
          summary: 'Ham mod — raw flow onayı kapalı.',
          reasons: ['Katman 2 kapatıldı: MA/SAR tetikleyicisi doğrudan grafik sinyali üretiyor.'],
          metrics: computeFlowSnapshot()
        };
      }

      const snap = computeFlowSnapshot();
      let score = 55;
      const reasons: string[] = [];

      if (snap.notional60 === 0) {
        score -= 6;
        reasons.push('CVD verisi ısınıyor; taker agresyon teyidi bekleniyor.');
      }
      if (snap.bidVol + snap.askVol === 0) {
        score -= 6;
        reasons.push('Derinlik orderbook senkronize ediliyor.');
      }

      // CVD Slope & Bias Multi-Timeframe Confluence (F1-4)
      if (dir === 'SAT') {
        if (snap.cvdBias < -0.12) {
          score += 14;
          reasons.push('Breakdown teyidi: CVD net satış baskısı altında.');
        } else if (snap.cvdBias < -0.03) {
          score += 7;
          reasons.push('CVD satış tarafına eğimli, düşüş yönünü destekliyor.');
        } else if (snap.cvdBias > 0.1) {
          score -= 12;
          reasons.push('Uyuşmazlık: CVD alıcı tarafta; SAT güveni zayıfladı.');
        }

        if (snap.cvdSlope < -0.05) {
          score += 8;
          reasons.push(`CVD Eğim İvmesi Negatif (%${(snap.cvdSlope * 100).toFixed(1)}); satış akışı ivmeleniyor.`);
        } else if (snap.cvdSlope > 0.08) {
          score -= 8;
          reasons.push(`CVD Eğim Uyuşmazlığı: Alış ivmesi toparlanıyor (+%${(snap.cvdSlope * 100).toFixed(1)}).`);
        }

        if (snap.obi < -0.1) {
          score += 10;
          reasons.push('OBI ask ağırlıklı; yukarıda satış duvarı baskın.');
        } else if (snap.obi > 0.1) {
          score -= 8;
          reasons.push('OBI bid tarafına dönmüş; satış kovalamaya dikkat.');
        }
      } else {
        // AL
        if (snap.cascadeDown) {
          if (snap.cvdBias > -0.05 || snap.cvdSlope > 0) {
            score += 10;
            reasons.push('Fade confirm: Satış baskısı tükeniyor, CVD toparlanıyor.');
          } else {
            score -= 8;
            reasons.push('Dump sonrası AL fakat CVD hâlâ satıcı; güven düşük.');
          }
          if (snap.obi > 0.08) {
            score += 10;
            reasons.push('OBI alış tarafına döndü; mean-reversion AL destekleniyor.');
          }
        } else {
          if (snap.cvdBias > 0.08) {
            score += 10;
            reasons.push('CVD alıcı tarafta; AL ivmesi güçlü.');
          } else if (snap.cvdBias < -0.1) {
            score -= 10;
            reasons.push('Uyuşmazlık: CVD satıcı tarafta; AL sinyali zayıfladı.');
          }

          if (snap.cvdSlope > 0.05) {
            score += 8;
            reasons.push(`CVD Eğim İvmesi Pozitif (+%${(snap.cvdSlope * 100).toFixed(1)}); alış akışı ivmeleniyor.`);
          } else if (snap.cvdSlope < -0.08) {
            score -= 8;
            reasons.push(`CVD Eğim Uyuşmazlığı: Satış ivmesi derinleşiyor (%${(snap.cvdSlope * 100).toFixed(1)}).`);
          }

          if (snap.obi > 0.1) {
            score += 8;
            reasons.push('OBI bid ağırlıklı; orderbook alış tarafı güçlü.');
          } else if (snap.obi < -0.1) {
            score -= 7;
            reasons.push('OBI ask ağırlıklı; yükseliş önünde direnç var.');
          }
        }
      }

      // Range Filter
      if (snap.tightRange) {
        score -= 12;
        reasons.push(`Range filtresi: Bant dar (%${(snap.rangePct * 100).toFixed(2)}); whipsaw riski.`);
      } else {
        score += 3;
        reasons.push('Fiyat aralığı açık; kurgu nefes alıyor.');
      }

      // Liquidation Clusters
      if (dir === 'SAT' && snap.longLiq60 >= (currSettings.liqMin || 50000)) {
        score += 12;
        reasons.push(`Likidasyon cascade: $${(snap.longLiq60 / 1000).toFixed(0)}k long liq tetiklendi.`);
      }
      if (dir === 'AL' && snap.shortLiq60 >= (currSettings.liqMin || 50000)) {
        score += 12;
        reasons.push(`Short squeeze cascade: $${(snap.shortLiq60 / 1000).toFixed(0)}k short liq tetiklendi.`);
      }

      // Reverse Liquidation Flow Penalty (F1-9)
      if (dir === 'SAT' && snap.shortLiq60 >= (currSettings.liqMin || 50000) * 0.75) {
        score -= 5;
        reasons.push('Ters likidasyon akışı (-5p): Karşı yönlü short likidasyonları satış baskısını kesebilir.');
      }
      if (dir === 'AL' && snap.longLiq60 >= (currSettings.liqMin || 50000) * 0.75) {
        score -= 5;
        reasons.push('Ters likidasyon akışı (-5p): Karşı yönlü long likidasyonları alış ivmesini kesebilir.');
      }

      // Absorption & Flow Detector Confluence
      const recentAbsorption = flowEvents.find((e) => e.type === 'ABSORPTION' && Date.now() - e.ts < 20000);
      if (recentAbsorption) {
        if ((dir === 'AL' && recentAbsorption.side === 'buy') || (dir === 'SAT' && recentAbsorption.side === 'sell')) {
          score += 10;
          reasons.push(`Duvar Absorption teyidi: Pasif ${recentAbsorption.side?.toUpperCase()} emilim gücü sinyali destekliyor.`);
        }
      }

      const recentBurst = flowEvents.find((e) => e.type === 'DELTA_BURST' && Date.now() - e.ts < 15000);
      if (recentBurst) {
        if ((dir === 'AL' && recentBurst.side === 'buy') || (dir === 'SAT' && recentBurst.side === 'sell')) {
          score += 8;
          reasons.push(`Delta Burst momentum: Agresif ${recentBurst.side?.toUpperCase()} patlaması arkamızda.`);
        }
      }

      // Open Interest Dynamic & Expansion (F1-9 / N2)
      if (snap.oiChangePct < -0.25 && snap.takerSpike) {
        score += dir === 'SAT' ? 8 : 4;
        reasons.push(`OI %${snap.oiChangePct.toFixed(2)} boşaldı + taker spike.`);
      } else if (snap.oiChangePct > 0.35) {
        const alignedWithCvd = (dir === 'AL' && snap.cvdBias > -0.05) || (dir === 'SAT' && snap.cvdBias < 0.05);
        if (alignedWithCvd) {
          score += 4;
          reasons.push(`Açık Pozisyon (OI) uyumlu artışı (+4p): Pozisyon birikimi trendi besliyor (+%${snap.oiChangePct.toFixed(2)}).`);
        } else {
          score -= 2;
          reasons.push(`Açık Pozisyon (OI) uyuşmazlığı (-2p): OI artarken CVD yönü desteklemiyor.`);
        }
      } else if (snap.oiChangePct < -0.4 && !snap.takerSpike) {
        score -= 2;
        reasons.push('Açık Pozisyon azalması (-2p): Pozisyon kapanışları trendin gücünü zayıflatıyor.');
      }

      // Data Freshness Check (F1-9)
      const lastTrade = tradesRef.current[tradesRef.current.length - 1];
      if (lastTrade && Date.now() - lastTrade.ts > 15000) {
        score -= 8;
        reasons.push('Veri tazeliği uyarısı (-8p): Son 15 saniyede akış gecikmesi var.');
      }

      // Funding Rate Bias
      if (snap.funding !== null) {
        if (snap.funding > 0.00025 && dir === 'SAT') {
          score += 8;
          reasons.push(`Aşırı pozitif funding (%${(snap.funding * 100).toFixed(4)}); long unwind/SAT lehine.`);
        } else if (snap.funding < -0.00025 && dir === 'AL') {
          score += 8;
          reasons.push(`Aşırı negatif funding (%${(snap.funding * 100).toFixed(4)}); short squeeze/AL lehine.`);
        }
      }

      // Pattern Pool Intelligence Confluence (F2-1: Wilson Lower Bound & MFE/MAE)
      if (patternStats && patternStats.n >= 4) {
        if (patternStats.wilsonLower >= 55) {
          const bonus = Math.min(15, Math.round((patternStats.wilsonLower - 50) * 0.75));
          score += bonus;
          reasons.push(`Desen Havuzu Güçlü (+${bonus}p): %${patternStats.winRate.toFixed(1)} WinRate (Wilson Alt: %${patternStats.wilsonLower.toFixed(1)}, n=${patternStats.n})`);
        } else if (patternStats.wilsonLower < 38) {
          const penalty = Math.min(15, Math.round((42 - patternStats.wilsonLower) * 0.75));
          score -= penalty;
          reasons.push(`Desen Havuzu Zayıf (-${penalty}p): Wilson alt sınırı %${patternStats.wilsonLower.toFixed(1)} (Geçmiş performans düşük, n=${patternStats.n})`);
        }

        if (patternStats.avgMfe20 > 0 && patternStats.avgMae20 > 0) {
          const rr = patternStats.avgMfe20 / (patternStats.avgMae20 || 0.01);
          if (rr >= 1.4) {
            score += 8;
            reasons.push(`MFE/MAE Oranı Üstün (+8p): ${rr.toFixed(2)}x (MFE: +%${patternStats.avgMfe20.toFixed(2)}, MAE: -%${patternStats.avgMae20.toFixed(2)})`);
          } else if (rr < 0.75) {
            score -= 8;
            reasons.push(`MFE/MAE Oranı Olumsuz (-8p): ${rr.toFixed(2)}x (Risk/Ödül negatif)`);
          }
        }
      }

      score = Math.round(Math.max(0, Math.min(100, score)));
      const grade =
        score >= 75 ? 'YÜKSEK' : score >= 60 ? 'ORTA+' : score >= 45 ? 'ORTA' : 'ZAYIF';

      return {
        score,
        grade,
        summary: `${grade} Güven (${score}/100)`,
        reasons,
        metrics: snap
      };
    },
    [computeFlowSnapshot, flowEvents]
  );

  // 6. Signal Trigger Engine (Katman 1 MA/SAR) + Live Pattern Pool Engine
  const runSignalEngine = useCallback(
    async (cs: Candle[]) => {
      const currSettings = settingsRef.current;
      if (cs.length < (currSettings.ma3 || 50) + 5) return;

      const ctx = patternContext(
        cs,
        currSettings.ma1 || 9,
        currSettings.ma2 || 21,
        currSettings.ma3 || 50,
        currSettings.sarStep || 0.02,
        currSettings.sarMax || 0.2
      );
      const i = cs.length - 1;
      const ma1 = ctx.ma[currSettings.ma1 || 9];
      const ma2 = ctx.ma[currSettings.ma2 || 21];
      const ma3 = ctx.ma[currSettings.ma3 || 50];

      if (!ma1 || !ma2 || !ma3 || ma1[i] === null || ma2[i - 1] === null || ma3[i] === null || ctx.trend[i] === null) {
        return;
      }

      // Check tracking pattern events for settlement (20 bars pass)
      const tracking = trackingEventsRef.current;
      if (tracking.length > 0) {
        const remaining: typeof tracking = [];
        for (const tr of tracking) {
          if (i - tr.candleIdx >= 20) {
            const outcome = patternOutcome(cs, tr.candleIdx, tr.dir === 'AL' ? 'UP' : 'DOWN');
            if (outcome) {
              const ev = await dbIndexGet<PatternEvent>('events', 'eventKey', tr.eventKey);
              if (ev && ev.status !== 'settled') {
                ev.status = 'settled';
                ev.settledAt = Date.now();
                ev.ret5 = outcome.ret5;
                ev.ret10 = outcome.ret10;
                ev.ret20 = outcome.ret20;
                ev.mfe20 = outcome.mfe20;
                ev.mae20 = outcome.mae20;
                ev.rMultiple = outcome.rMultiple;
                ev.barsToMfe = outcome.barsToMfe;
                ev.barsToMae = outcome.barsToMae;
                await dbPut('events', ev);
                // Recompute stats for the pattern
                if (ev.patternKey) {
                  await patternRecomputeStats(ev.patternKey, currSettings.patternWinPct || 0.15);
                }
                if (ev.coinPatternKey) {
                  await patternRecomputeStats(ev.coinPatternKey, currSettings.patternWinPct || 0.15);
                }
              }
            }
          } else {
            remaining.push(tr);
          }
        }
        trackingEventsRef.current = remaining;
      }

      const primaryPair = `${currSettings.ma1 || 9}x${currSettings.ma2 || 21}`;
      const crosses = patternCrossesAt(ctx, i, currSettings.ma1 || 9, currSettings.ma2 || 21, currSettings.ma3 || 50);
      const flipUp = ctx.trend[i - 1] === -1 && ctx.trend[i] === 1;
      const flipDown = ctx.trend[i - 1] === 1 && ctx.trend[i] === -1;

      const primaryCross = crosses.find((cr) => cr.pair === primaryPair);
      if (primaryCross) {
        pendingEngineRef.current = {
          dir: primaryCross.dir === 'UP' ? 'AL' : 'SAT',
          idx: i,
          flip: false,
          cross: primaryCross
        };
      }

      if (pendingEngineRef.current) {
        const p = pendingEngineRef.current;
        const elapsed = i - p.idx;
        if (elapsed > (currSettings.nWindow || 3)) {
          pendingEngineRef.current = null;
          setStatus('NOTR');
          setStatusRule('Pencere süresi doldu, tetikleyici iptal edildi.');
          const comment = generateCommentary('NOTR', null);
          setCommentary(comment);
        } else {
          if ((p.dir === 'AL' && flipUp) || (p.dir === 'SAT' && flipDown)) {
            p.flip = true;
          }
          if (p.flip) {
            const ok =
              p.dir === 'AL'
                ? ma2[i]! > ma3[i]! || ctx.closes[i] > ma3[i]!
                : ma2[i]! < ma3[i]! || ctx.closes[i] < ma3[i]!;

            if (ok) {
              // Query pattern stats first for dual-signal confirmation (F2-1)
              const sarBucket = elapsed === 0 ? 'SAR0' : elapsed === 1 ? 'SAR1' : elapsed <= 3 ? 'SAR2-3' : 'SARX';
              const crossInfo = p.cross;
              const filter: 'F1' | 'F0' = crossInfo ? crossInfo.filter : 'F1';
              const regimeVol = crossInfo ? crossInfo.regime.vol : 'MID';
              const regimeTrend = crossInfo ? crossInfo.regime.trend : (p.dir === 'AL' ? 'UP' : 'DOWN');
              const regimeKey = crossInfo ? crossInfo.regime.key : `MID_${p.dir === 'AL' ? 'UP' : 'DOWN'}`;

              const patKey = patternId(
                `${currSettings.ma1}x${currSettings.ma2}`,
                p.dir === 'AL' ? 'UP' : 'DOWN',
                sarBucket,
                filter
              );
              setActivePatternId(patKey);
              const { stats } = await patternGetStatsBest(symbol, interval, patKey);
              setActivePatternStats(stats);

              // Evaluate Raw Flow with Pattern Pool Dual-Signal Confluence (F2-1)
              const rule = `MA${currSettings.ma1}×MA${currSettings.ma2} ${p.dir === 'AL' ? 'Golden' : 'Death'} Cross + SAR Flip (${elapsed} mum sonra) + MA${currSettings.ma3} Trend Filtresi`;
              const evalRes = evaluateRawFlow(p.dir, i, stats);
              setStatus(p.dir);
              setStatusRule(rule);
              setEvaluation(evalRes);

              const comment = generateCommentary(p.dir, evalRes);
              setCommentary(comment);

              // Record Live Pattern Event to DB (Avoid duplicate writes within 3 candles) (F2-6)
              const intervalSec = intervalToSeconds(interval);
              const isDuplicate =
                lastRecordedPatIdRef.current === patKey &&
                cs[i].time - lastRecordedEventTimeRef.current < 3 * intervalSec;

              const eventKey = `${symbol}_${interval}_${cs[i].time}_${patKey}`;
              const globalKey = `${interval}:${patKey}`;
              const coinKey = `${symbol}:${interval}:${patKey}`;

              if (!isDuplicate) {
                lastRecordedEventTimeRef.current = cs[i].time;
                lastRecordedPatIdRef.current = patKey;

                const liveEvent: PatternEvent = {
                  schemaVersion: PPOOL_SCHEMA_VERSION,
                  source: 'live',
                  coin: symbol,
                  timeframe: interval,
                  timestamp: cs[i].time * 1000,
                  eventKey,
                  pair: `${currSettings.ma1}x${currSettings.ma2}`,
                  dir: p.dir === 'AL' ? 'UP' : 'DOWN',
                  filter: filter,
                  sarBucket,
                  patternId: patKey,
                  patternKey: globalKey,
                  coinPatternKey: coinKey,
                  volRegime: regimeVol,
                  trendRegime: regimeTrend,
                  regimeKey: regimeKey,
                  refClose: cs[i].close,
                  status: 'tracking',
                  createdAt: Date.now()
                };
                await dbAdd('events', liveEvent).catch(() => {});
                trackingEventsRef.current.push({ eventKey, candleIdx: i, dir: p.dir });
              }

              // Push to Signal Log
              setSignals((prev) => [
                {
                  id: `${Date.now()}-${Math.random()}`,
                  dir: p.dir,
                  rule,
                  price: cs[i].close,
                  ts: cs[i].time,
                  score: evalRes.score,
                  grade: evalRes.grade,
                  reasons: evalRes.reasons,
                  patternId: patKey
                },
                ...prev.slice(0, 30)
              ]);

              // Audio Alert Trigger
              if (p.dir === 'AL') {
                soundEngine.playBuySignal();
              } else {
                soundEngine.playSellSignal();
              }

              pendingEngineRef.current = null;
            } else {
              setStatus('IZLEMEDE');
              setStatusRule(
                `${p.dir} kurgusu: Cross + SAR flip tamam, MA${currSettings.ma3} trend filtresi bekleniyor.`
              );
              setCommentary(generateCommentary('IZLEMEDE', null));
            }
          } else {
            setStatus('IZLEMEDE');
            setStatusRule(
              `${p.dir === 'AL' ? 'Golden' : 'Death'} cross oluştu, SAR flip onayı bekleniyor (${elapsed}/${currSettings.nWindow} mum).`
            );
            setCommentary(generateCommentary('IZLEMEDE', null));
          }
        }
      } else {
        // F2-2: Check secondary MA pairs (e.g. 9x50, 21x50) or F0 patterns pool-approved (Wilson >= 50, n >= 15)
        const secondaryCrosses = crosses.filter((cr) => cr.pair !== primaryPair);
        for (const secCross of secondaryCrosses) {
          const sarBucket = 'SAR0';
          const secPatKey = patternId(
            secCross.pair,
            secCross.dir === 'UP' ? 'UP' : 'DOWN',
            sarBucket,
            secCross.filter
          );
          const { stats: secStats } = await patternGetStatsBest(symbol, interval, secPatKey);
          if (secStats && secStats.n >= 15 && secStats.wilsonLower >= 50) {
            const secDir: 'AL' | 'SAT' = secCross.dir === 'UP' ? 'AL' : 'SAT';
            const evalRes = evaluateRawFlow(secDir, i, secStats);
            if (evalRes.score !== null && evalRes.score >= 60) {
              const rule = `Havuz Onaylı İkincil Sinyal: MA ${secCross.pair} Cross (${secCross.filter}) [Wilson: %${secStats.wilsonLower.toFixed(0)}, N=${secStats.n}]`;
              setStatus(secDir);
              setStatusRule(rule);
              setEvaluation(evalRes);
              setActivePatternId(secPatKey);
              setActivePatternStats(secStats);
              setCommentary(generateCommentary(secDir, evalRes));

              setSignals((prev) => [
                {
                  id: `${Date.now()}-${Math.random()}`,
                  dir: secDir,
                  rule,
                  price: cs[i].close,
                  ts: cs[i].time,
                  score: evalRes.score,
                  grade: evalRes.grade,
                  reasons: evalRes.reasons,
                  patternId: secPatKey
                },
                ...prev.slice(0, 30)
              ]);

              if (secDir === 'AL') {
                soundEngine.playBuySignal();
              } else {
                soundEngine.playSellSignal();
              }
              break;
            }
          }
        }
      }
    },
    [evaluateRawFlow, interval, symbol]
  );

  const handleReconnect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.stop();
      clientRef.current.start();
    }
  }, []);

  // 7. Initialize Real-Time WebSocket Streaming Client (Stable Lifecycle)
  useEffect(() => {
    const client = new BinanceStreamClient(symbol, interval, {
      onKline: (candle, isClosed) => {
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
          // Trigger signal engine on closed candle
          runSignalEngine(candlesRef.current);
        }
      },
      onTrade: (trade) => {
        tradesRef.current.push(trade);
        const now = trade.ts;
        const tenMinAgo = now - 600000;
        if (tradesRef.current.length > 3000 || (tradesRef.current[0] && tradesRef.current[0].ts < tenMinAgo)) {
          tradesRef.current = tradesRef.current.filter((t) => t.ts >= tenMinAgo);
        }

        const whaleMin = settingsRef.current.whaleMin || 300000;

        // 1. Whale Detector
        if (trade.notional >= whaleMin && now - lastWhaleRef.current > 2000) {
          lastWhaleRef.current = now;
          soundEngine.playWhale();
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

        // 2. Sweep Detector (>=4 trades on same side in <1.8s totaling > whaleMin * 1.5)
        if (now - lastSweepRef.current > 4000) {
          const recent = tradesRef.current.filter((t) => now - t.ts < 1800);
          ['buy', 'sell'].forEach((side) => {
            const sameSide = recent.filter((t) => t.side === side);
            const total = sameSide.reduce((a, b) => a + b.notional, 0);
            if (total > whaleMin * 1.5 && sameSide.length >= 4) {
              lastSweepRef.current = now;
              soundEngine.playWhale();
              const ev: FlowEvent = {
                id: `${now}-${Math.random()}`,
                type: 'SWEEP',
                sev: 'high',
                text: `SWEEP ${side.toUpperCase()} $${(total / 1000).toFixed(0)}k (${sameSide.length} işlem)`,
                ts: now,
                side: side as 'buy' | 'sell'
              };
              setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
            }
          });
        }

        // 3. Delta Burst Detector (rapid CVD surge in <5s confirmed by 1-min cumulative cvdSlope) (F1-4)
        if (now - lastBurstRef.current > 8000) {
          const recent5s = tradesRef.current.filter((t) => now - t.ts < 5000);
          const cvd5s = recent5s.reduce((a, b) => a + b.delta, 0);
          const vol5s = recent5s.reduce((a, b) => a + b.notional, 0);
          if (vol5s > whaleMin * 1.8 && Math.abs(cvd5s) / vol5s > 0.75) {
            // Check 60s slope direction alignment
            const recent60s = tradesRef.current.filter((t) => now - t.ts < 60000);
            const cvd60s = recent60s.reduce((a, b) => a + b.delta, 0);
            const slopeAligned = (cvd5s > 0 && cvd60s >= 0) || (cvd5s < 0 && cvd60s <= 0);
            
            if (slopeAligned) {
              lastBurstRef.current = now;
              soundEngine.playWhale();
              const side = cvd5s > 0 ? 'buy' : 'sell';
              const ev: FlowEvent = {
                id: `${now}-${Math.random()}`,
                type: 'DELTA_BURST',
                sev: 'high',
                text: `DELTA BURST ${side.toUpperCase()} CVD: $${(cvd5s / 1000).toFixed(0)}k (Hacim: $${(vol5s / 1000).toFixed(0)}k, 1D Eğim Onaylı)`,
                ts: now,
                side
              };
              setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
            }
          }
        }

        // 4. Absorption Detector (High volume/CVD with minimal price movement < 0.08%)
        if (now - lastAbsorbRef.current > 6000) {
          const recent8s = tradesRef.current.filter((t) => now - t.ts < 8000);
          if (recent8s.length >= 10) {
            const vol8s = recent8s.reduce((a, b) => a + b.notional, 0);
            const cvd8s = recent8s.reduce((a, b) => a + b.delta, 0);
            const prices = recent8s.map((t) => t.price);
            const minP = Math.min(...prices);
            const maxP = Math.max(...prices);
            const spreadPct = minP > 0 ? (maxP - minP) / minP : 0;

            if (vol8s > whaleMin * 2.2 && Math.abs(cvd8s) > whaleMin * 0.8 && spreadPct < 0.0008) {
              lastAbsorbRef.current = now;
              const absorbSide = cvd8s > 0 ? 'sell' : 'buy'; // If buyers are aggressive but price won't rise, passive sellers absorb
              const ev: FlowEvent = {
                id: `${now}-${Math.random()}`,
                type: 'ABSORPTION',
                sev: 'high',
                text: `ABSORPTION: Pasif ${absorbSide.toUpperCase()} Duvarı $${(vol8s / 1000).toFixed(0)}k emdi (Fiyat kayması <%0.08)`,
                ts: now,
                side: absorbSide
              };
              setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
            }
          }
        }
      },
      onMarkPrice: (mark) => {
        setMarkPrice(mark.markPrice);
        setFundingRate(mark.fundingRate);
        setNextFundingTime(mark.nextFundingTime);
      },
      onLiquidation: (liq) => {
        liqsRef.current.push(liq);
        const tenMinAgo = liq.ts - 600000;
        if (liqsRef.current.length > 250 || (liqsRef.current[0] && liqsRef.current[0].ts < tenMinAgo)) {
          liqsRef.current = liqsRef.current.filter((l) => l.ts >= tenMinAgo);
        }
        setLiquidations((prev) => [liq, ...prev.slice(0, 50)]);

        if (liq.notional >= (settingsRef.current.liqMin || 50000)) {
          soundEngine.playLiquidation();
          const ev: FlowEvent = {
            id: `${liq.ts}-${Math.random()}`,
            type: 'LIQUIDATION',
            sev: 'high',
            text: `Likidasyon: ${liq.side === 'SELL' ? 'LONG' : 'SHORT'} $${(liq.notional / 1000).toFixed(0)}k @ $${liq.price}`,
            ts: liq.ts
          };
          setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
        }
      },
      onDepthUpdate: (depth) => {
        bidsBookRef.current = depth.bids;
        asksBookRef.current = depth.asks;

        const now = Date.now();
        // React state'i 250ms'de bir yay; hesaplamalar (spoof/heatmap) her tick'te calismaya devam eder.
        if (now - lastDepthStateRef.current >= 250) {
          lastDepthStateRef.current = now;
          setBidsBook(new Map(depth.bids));
          setAsksBook(new Map(depth.asks));
        }

        const whaleMin = settingsRef.current.whaleMin || 300000;

        // Spoofing Detector: Check if massive wall disappeared without significant trade volume
        const currentWalls = new Map<number, { notional: number; ts: number; side: 'B' | 'A' }>();
        depth.bids.forEach((q, p) => {
          const n = p * q;
          if (n >= whaleMin) currentWalls.set(p, { notional: n, ts: now, side: 'B' });
        });
        depth.asks.forEach((q, p) => {
          const n = p * q;
          if (n >= whaleMin) currentWalls.set(p, { notional: n, ts: now, side: 'A' });
        });

        prevWallsRef.current.forEach((prevWall, price) => {
          if (!currentWalls.has(price)) {
            // Wall was removed; check lifetime
            const age = now - prevWall.ts;
            if (age < 4000 && prevWall.notional >= whaleMin * 1.5) {
              const ev: FlowEvent = {
                id: `${now}-${Math.random()}`,
                type: 'SPOOF',
                sev: 'medium',
                text: `SPOOF Wall İptal: $${(prevWall.notional / 1000).toFixed(0)}k ${prevWall.side === 'B' ? 'BID' : 'ASK'} @ $${price} (${(age / 1000).toFixed(1)}s)`,
                ts: now,
                side: prevWall.side === 'B' ? 'buy' : 'sell'
              };
              setFlowEvents((prev) => [ev, ...prev.slice(0, 30)]);
            }
          }
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
            const bins: HeatmapFrame['bins'] = [];
            let maxN = 0;

            depth.bids.forEach((q, p) => {
              if (Math.abs(p - mid) / mid <= 0.015) {
                const notional = p * q;
                if (notional > maxN) maxN = notional;
                bins.push({ side: 'B', price: p, notional });
              }
            });

            depth.asks.forEach((q, p) => {
              if (Math.abs(p - mid) / mid <= 0.015) {
                const notional = p * q;
                if (notional > maxN) maxN = notional;
                bins.push({ side: 'A', price: p, notional });
              }
            });

            bins.sort((a, b) => b.notional - a.notional);
            const topBins = bins.slice(0, 180);

            setHeatmapFrames((prev) => {
              const next = [...prev, { t: Math.floor(now / 1000), bins: topBins, max: maxN }];
              if (next.length > 900) next.shift(); // 15-minute depth heatmap window
              return next;
            });
          }
        }
      },
      onStatusChange: (st) => {
        setWsConnected(st.connected);
        setMarketConnected(st.marketConnected);
        setDepthConnected(st.depthConnected);
        setWsMessage(st.message || '');
      }
    });

    clientRef.current = client;
    client.start();

    return () => {
      client.stop();
      clientRef.current = null;
    };
  }, [symbol, interval, runSignalEngine]);

  // Periodic flow snapshot calculation
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFlowSnapshot(computeFlowSnapshot());
    }, 500);
    return () => clearInterval(timer);
  }, [computeFlowSnapshot]);

  return (
    <div className="app-shell flex flex-col bg-[#0d1117] text-slate-100 antialiased font-sans">
      {/* Top Navbar (Hidden in Fullscreen mode for 100% pure chart immersion) */}
      {!isFullscreen && (
        <Navbar
          symbol={symbol}
          onSelectSymbol={handleSelectSymbol}
          symbols={symbols}
          tickers={tickers}
          favs={favs}
          onToggleFav={handleToggleFav}
          activeView={activeView}
          onChangeView={setActiveView}
          lastPrice={lastPrice}
          fundingRate={fundingRate}
          nextFundingTime={nextFundingTime}
          wsConnected={wsConnected}
          marketConnected={marketConnected}
          depthConnected={depthConnected}
          wsMessage={wsMessage}
          onReconnect={handleReconnect}
        />
      )}

      {/* Main View Router */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        {activeView === 'chart' && (
          <div className="flex-1 flex flex-col min-h-0 h-full relative">
            {/* Top Collapsible Flow Ribbon */}
            {!isFullscreen && (
              <FlowMetricsPanel flow={flowSnapshot} lastPrice={lastPrice} mode="collapsible" />
            )}

            {/* Middle: Interactive Candlestick + Canvas Overlays */}
            <div className="flex-1 min-h-0 relative h-full w-full">
              <ChartTerminal
                symbol={symbol}
                interval={interval}
                onSelectInterval={handleSelectInterval}
                candles={candles}
                settings={settings}
                flowSnapshot={flowSnapshot}
                heatmapFrames={heatmapFrames}
                bidsBook={bidsBook}
                asksBook={asksBook}
                signals={signals}
                liquidations={liquidations}
                flowEvents={flowEvents}
                lastPrice={lastPrice}
                symbolInfo={symbolInfos.find((s) => s.symbol === symbol) || null}
                activePatternStats={activePatternStats}
                patternOverlay={patternOverlay}
                onUpdateSetting={handleUpdateSingleSetting}
                isFullscreen={isFullscreen}
                onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
              />
            </div>

            {/* Bottom Collapsible Decision Engine Strip */}
            {!isFullscreen && (
              <div className="border-t border-[#22272e] bg-[#12161c] transition-all duration-200 shrink-0 select-none z-30">
                <div
                  onClick={() => setIsSignalOpen(!isSignalOpen)}
                  className="px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#161b22] text-xs"
                >
                  <div className="flex items-center gap-2 font-mono overflow-hidden">
                    <span
                      className={`px-2 py-0.5 rounded font-bold text-[11px] shrink-0 ${
                        status === 'AL'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : status === 'SAT'
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : status === 'IZLEMEDE'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-slate-500/20 text-slate-400 border border-slate-500/30'
                      }`}
                    >
                      {status}
                    </span>
                    <span className="text-slate-300 font-semibold truncate text-[11px] sm:text-xs">
                      {statusRule}
                    </span>
                    {evaluation && (
                      <span className="hidden sm:inline text-slate-500 text-[11px] shrink-0">
                        • Skor: <strong className="text-emerald-400">{evaluation.score}</strong>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-slate-400 text-[11px] shrink-0 ml-2">
                    <span className="hidden xs:inline">{isSignalOpen ? 'Gizle' : 'Karar Detayı'}</span>
                    {isSignalOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
                  </div>
                </div>

                {isSignalOpen && (
                  <div className="p-3 border-t border-[#22272e] bg-[#0d1117] max-h-56 overflow-y-auto">
                    <SignalCard
                      status={status}
                      statusRule={statusRule}
                      evaluation={evaluation}
                      commentary={commentary}
                      patternStats={activePatternStats}
                      patternId={activePatternId}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeView === 'signal' && (
          <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 flex flex-col gap-3 sm:gap-4 max-w-6xl mx-auto w-full">
            <SignalCard
              status={status}
              statusRule={statusRule}
              evaluation={evaluation}
              commentary={commentary}
              patternStats={activePatternStats}
              patternId={activePatternId}
            />

            <FlowMetricsPanel flow={flowSnapshot} lastPrice={lastPrice} />

            <OrderFlowLog flowEvents={flowEvents} signals={signals} />
          </div>
        )}

        {activeView === 'scanner' && (
          <MarketScanner
            tickers={tickers}
            favs={favs}
            onToggleFav={handleToggleFav}
            onSelectSymbol={(sym) => {
              handleSelectSymbol(sym);
              setActiveView('chart');
            }}
            selectedSymbol={symbol}
          />
        )}

        {activeView === 'pool' && (
          <PatternPoolView
            symbol={symbol}
            interval={interval}
            onToggleOverlay={handleToggleOverlay}
            overlayKey={patternOverlay?.key ?? null}
          />
        )}

        {activeView === 'settings' && (
          <SettingsModal
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onResetDefaults={() => handleUpdateSettings(DEFAULT_SETTINGS)}
          />
        )}
      </main>

      {/* Persistent Bottom Navigation Toolbar (Hidden in Fullscreen mode) */}
      {!isFullscreen && (
        <BottomToolbar
          activeView={activeView}
          onChangeView={setActiveView}
          symbol={symbol}
          lastPrice={lastPrice}
          tickers={tickers}
          wsConnected={wsConnected}
          fundingRate={fundingRate}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
        />
      )}
    </div>
  );
}
