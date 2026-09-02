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
import { BacktestPanel } from '@/components/BacktestPanel';
import { PatternRadarCard } from '@/components/PatternRadarCard';
import { SettingsModal } from '@/components/SettingsModal';
import { showToast } from '@/components/ui/toast';
import { usePatternRadar } from '@/hooks/use-pattern-radar';
import type { ScannerHit } from '@/lib/scanner-engine';
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
  AppView,
  HeatmapBin,
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
import { fetchAICommentary, buildFlowBrief, type AICommentaryContext } from '@/lib/ai-commentary';
import { computeFlowSnapshotCore } from '@/lib/flow-snapshot';
import {
  dataFreshnessRule,
  fadeObiRule,
  fundingCrowdedRule,
  liqClusterRule,
  reverseLiqRatioRule,
  whaleThreshold,
  type RuleResult
} from '@/lib/scoring-rules';
import {
  collectWalls,
  detectAbsorption,
  detectDeltaBurst,
  detectSpoofRemovals,
  detectSweep
} from '@/lib/flow-detectors';
import { soundEngine } from '@/lib/audio';
import {
  getNotifyEnabled,
  notifyPermission,
  pushNotify,
  requestNotifyPermission,
  setNotifyEnabled,
  type NotifyPermissionState
} from '@/lib/notifications';
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
  patternName,
  patternRecentExists,
  patternCompleteAllOpenEvents,
  dbAdd,
  dbPut,
  dbDelete,
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
  macdSignalWidth: 1,
  scanEnabled: true,
  scanTopN: 10
};

export default function Home() {
  // Navigation & Core State
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<string>('5m');
  const [activeView, setActiveView] = useState<AppView>('chart');
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
  // Görev C/D: veri tazeliği (depth/mark) + sembol tick boyutu (heatmap bucketing)
  const lastDepthTsRef = useRef<number>(0);
  const lastMarkTsRef = useRef<number>(0);
  const tickSizeRef = useRef<number>(0);

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

  useEffect(() => {
    const si = symbolInfos.find((x) => x.symbol === symbol);
    tickSizeRef.current = si && si.tickSize > 0 ? si.tickSize : 0;
  }, [symbolInfos, symbol]);

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

  // Tarayıcı bildirimleri
  const [notifyEnabled, setNotifyEnabledState] = useState(false);
  const [notifyPerm, setNotifyPerm] = useState<NotifyPermissionState>('unsupported');

  const handleToggleNotify = useCallback(async () => {
    if (notifyPerm === 'unsupported') return;
    if (!getNotifyEnabled()) {
      const perm = await requestNotifyPermission();
      setNotifyPerm(perm);
      if (perm !== 'granted') {
        showToast('Bildirim izni verilemedi — tarayıcı ayarlarından kontrol edebilirsin.', 'warning');
        return;
      }
      setNotifyEnabled(true);
      setNotifyEnabledState(true);
      showToast('Tarayıcı bildirimleri açıldı (sinyal, radar, whale).', 'success');
    } else {
      setNotifyEnabled(false);
      setNotifyEnabledState(false);
      showToast('Tarayıcı bildirimleri kapatıldı.', 'info');
    }
  }, [notifyPerm]);

  // Bildirim tercihini mount'ta oku (SSR-safe)
  useEffect(() => {
    setNotifyPerm(notifyPermission());
    setNotifyEnabledState(getNotifyEnabled() && notifyPermission() === 'granted');
  }, []);

  // Sinyal logu kalıcılığı: mevcut sembol+TF kayıtlarını yükle
  const signalsLoadedForRef = useRef<string>('');
  useEffect(() => {
    const key = `${symbol}:${interval}`;
    if (signalsLoadedForRef.current === key) return;
    signalsLoadedForRef.current = key;
    let cancelled = false;
    (async () => {
      try {
        await initPatternDB();
        const all = await dbAll<SignalLogEntry>('signalLog');
        if (cancelled) return;
        const mine = all
          .filter((s) => (s.symbol ?? '') === symbol && (s.timeframe ?? '') === interval)
          .sort((a, b) => b.ts - a.ts)
          .slice(0, 30);
        if (mine.length) setSignals(mine);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  // Yeni sinyal → IndexedDB'ye yaz (200+ kayıtta budama)
  const lastPersistedSignalIdRef = useRef<string>('');
  useEffect(() => {
    const s = signals[0];
    if (!s || s.id === lastPersistedSignalIdRef.current) return;
    lastPersistedSignalIdRef.current = s.id;
    dbPut('signalLog', { ...s, symbol, timeframe: interval }).catch(() => {});
    (async () => {
      try {
        const all = await dbAll<SignalLogEntry>('signalLog');
        if (all.length <= 200) return;
        const excess = [...all].sort((a, b) => a.ts - b.ts).slice(0, all.length - 200);
        for (const e of excess) {
          if (e.symbol === symbol && e.timeframe === interval) continue; // aktif logu budama
          await dbDelete('signalLog', e.id);
        }
      } catch {}
    })();
  }, [signals, symbol, interval]);

  // Initialize DB and load saved preferences on Mount (safe from SSR hydration mismatch)
  useEffect(() => {
    initPatternDB();
    // Görev E: bayat pending/tracking event'leri açılışta settle et (fire-and-forget)
    patternCompleteAllOpenEvents().catch(() => {});
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

  // Desen Radarı hit'i: toast + ses + sinyal loguna "RADAR" kaydı (score null → flow teyidi yok)
  const handleRadarHit = useCallback((hit: ScannerHit) => {
    showToast(
      `📡 Radar: ${hit.symbol} ${hit.dir} · ${hit.timeframe} · ${patternName(hit.patternId)}`,
      hit.dir === 'AL' ? 'success' : 'warning'
    );
    pushNotify(
      {
        title: `📡 Radar: ${hit.symbol} ${hit.dir} (${hit.timeframe})`,
        body: patternName(hit.patternId),
        tag: `radar-${hit.symbol}-${hit.timeframe}`
      },
      10000
    );
    if (hit.dir === 'AL') {
      soundEngine.playBuySignal();
    } else {
      soundEngine.playSellSignal();
    }
    setSignals((prev) => [
      {
        id: `radar-${Date.now()}-${Math.random()}`,
        dir: hit.dir,
        rule: hit.rule,
        price: hit.price,
        ts: hit.ts,
        score: null,
        grade: 'RADAR',
        reasons: [
          `Desen Radarı: ${patternName(hit.patternId)} (${hit.timeframe})`,
          hit.poolApproved
            ? 'Havuz onaylı ikincil kurgu (Wilson ≥ %50, n ≥ 15)'
            : 'Birincil kurgu (MA×MA cross + SAR flip)',
          `SAR: ${hit.sarBucket} · Filtre: ${hit.filter} · Orderflow teyidi için sembole geç`
        ],
        patternId: hit.patternId
      },
      ...prev.slice(0, 30)
    ]);
  }, []);

  // Desen Radarı — favoriler + top hacim, 1m/5m arka plan taraması
  const radar = usePatternRadar({
    enabled: settings.scanEnabled,
    topN: settings.scanTopN,
    tickers,
    favs,
    excludeSymbol: symbol,
    ma1: settings.ma1,
    ma2: settings.ma2,
    ma3: settings.ma3,
    sarStep: settings.sarStep,
    sarMax: settings.sarMax,
    onHit: handleRadarHit
  });

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

      // Görev C: saf kural modülünden gelen sonuçları uygular (lib/scoring-rules.ts)
      const applyRule = (r: RuleResult) => {
        if (r.reason) {
          score += r.delta;
          reasons.push(r.reason);
        }
      };

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
          // Görev C: fade-AL erken çıkış penaltısı (OBI hâlâ ask baskılı)
          applyRule(fadeObiRule(snap.cascadeDown, snap.obi));
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

      // Liquidation Clusters (Görev C: bonus yalnızca taker spike ile — Stage-4 paritesi)
      applyRule(liqClusterRule(dir, snap, currSettings.liqMin || 50000));

      // Reverse Liquidation Flow (Görev C: oran bazlı 1.5x — Stage-4 paritesi)
      applyRule(reverseLiqRatioRule(dir, snap, currSettings.liqMin || 50000));

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
      } else if (snap.oiChangePct > 0.25) {
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

      // Data Freshness Check (Görev C: trade + depth + mark'un en yenisi)
      const lastTradeTs = tradesRef.current[tradesRef.current.length - 1]?.ts || 0;
      applyRule(dataFreshnessRule(Math.max(lastTradeTs, lastDepthTsRef.current, lastMarkTsRef.current)));

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
      // Görev C: funding "kalabalık" penaltısı (sinyal yönündeki yığılma aleyhine)
      applyRule(fundingCrowdedRule(dir, snap.funding));

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

  // AI Yorum Katmanı: anında yerel fallback yaz, Gemini yanıtı gelirse yükselt.
  // fetchAICommentary cooldown + önbellek + sessiz fallback içerir; AI kapalıysa hiç hissedilmez.
  const publishSignalCommentary = useCallback(
    (dir: 'AL' | 'SAT', evalRes: DecisionEvaluation, stats: PatternStats | null, patId: string | null) => {
      const fallback = generateCommentary(dir, evalRes);
      setCommentary(fallback);

      const aiCtx: AICommentaryContext = {
        symbol,
        timeframe: interval,
        dir,
        score: evalRes.score,
        grade: evalRes.grade,
        reasons: evalRes.reasons.slice(0, 12),
        brief: buildFlowBrief(evalRes.metrics),
        pattern: stats
          ? {
              id: stats.patternId,
              name: patternName(stats.patternId),
              n: stats.n,
              winRate: stats.winRate,
              wilsonLower: stats.wilsonLower,
              avgMfe20: stats.avgMfe20,
              avgMae20: stats.avgMae20
            }
          : null
      };
      if (patId) setActivePatternId(patId);

      // Tarayıcı bildirimi (kapalıysa no-op; sekme arka plandayken özellikle değerli)
      pushNotify(
        { title: `📈 ${dir} Sinyali — ${symbol} (${interval})`, body: `${evalRes.grade} güven · ${symbol} @ ${evalRes.metrics.bestBid || '—'}`, tag: `signal-${symbol}` },
        4000
      );

      fetchAICommentary(aiCtx)
        .then((ai) => {
          if (ai) setCommentary(ai);
        })
        .catch(() => {});
    },
    [symbol, interval]
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

              // AI Yorum Katmanı: fallback anında, Gemini yanıtı gelirse yükseltir
              publishSignalCommentary(p.dir, evalRes, stats, patKey);

              // Record Live Pattern Event to DB (Avoid duplicate writes within 3 candles) (F2-6)
              const intervalSec = intervalToSeconds(interval);
              const isDuplicate =
                lastRecordedPatIdRef.current === patKey &&
                cs[i].time - lastRecordedEventTimeRef.current < 3 * intervalSec;

              const eventKey = `${symbol}_${interval}_${cs[i].time}_${patKey}`;
              const globalKey = `${interval}:${patKey}`;
              const coinKey = `${symbol}:${interval}:${patKey}`;

              // Görev E: DB seviyesinde ±3 mum dedupe (çapraz oturum koruması)
              const recentInDb = await patternRecentExists(
                symbol,
                interval,
                patKey,
                cs[i].time * 1000
              ).catch(() => false);

              if (!isDuplicate && !recentInDb) {
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
              setActivePatternStats(secStats);
              // AI Yorum Katmanı (ikincil sinyal): setActivePatternId publishSignalCommentary içinde yapılır
              publishSignalCommentary(secDir, evalRes, secStats, secPatKey);

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
    [evaluateRawFlow, interval, symbol, publishSignalCommentary]
  );

  // WS FIX: runSignalEngine her flowEvents guncellemesinde yeni identity aliyordu ve buna bagli
  // WebSocket client'i tekrar tekrar kurup yikiyordu (reconnect storm). Ref arkasindan cagir.
  const runSignalEngineRef = useRef(runSignalEngine);
  useEffect(() => {
    runSignalEngineRef.current = runSignalEngine;
  }, [runSignalEngine]);

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
          // Trigger signal engine on closed candle (ref: bagimlilik zincirinden ayristirildi)
          runSignalEngineRef.current(candlesRef.current);
        }
      },
      onTrade: (trade) => {
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
      },
      onMarkPrice: (mark) => {
        lastMarkTsRef.current = Date.now(); // Görev C: tazelik takibi
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
      },
      onDepthUpdate: (depth) => {
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
  }, [symbol, interval]);

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
          notifyEnabled={notifyEnabled}
          notifyPermissionState={notifyPerm}
          onToggleNotify={handleToggleNotify}
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
                symbols={symbols}
                onSelectSymbol={handleSelectSymbol}
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

        {activeView === 'backtest' && <BacktestPanel />}

        {activeView === 'scanner' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="shrink-0 px-2.5 sm:px-4 pt-2.5 sm:pt-4">
              <PatternRadarCard
                radar={radar}
                enabled={settings.scanEnabled}
                onToggle={(next) => handleUpdateSingleSetting('scanEnabled', next)}
                onSelectSymbol={(sym) => {
                  handleSelectSymbol(sym);
                  setActiveView('chart');
                }}
              />
            </div>
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
          </div>
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
