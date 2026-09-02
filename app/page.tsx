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
import { MiniChartCard } from '@/components/MiniChartCard';
import { SettingsModal } from '@/components/SettingsModal';
import { showToast } from '@/components/ui/toast';
import { resolvePendingOutcomes } from '@/lib/signal-outcomes';
import { buzz, SIGNAL_BUZZ } from '@/lib/haptics';
import { DEFAULT_SETTINGS, useAppSettings } from '@/hooks/use-app-settings';
import { useMarketData } from '@/hooks/use-market-data';
import { useNotifications } from '@/hooks/use-notifications';
import { useAndroidBack } from '@/hooks/use-android-back';
import { useFlowStream } from '@/hooks/use-flow-stream';
import { usePatternRadar } from '@/hooks/use-pattern-radar';
import type { ScannerHit } from '@/lib/scanner-engine';
import { Candle, DecisionEvaluation, PatternEvent, PatternOverlayState, PatternStats, SignalLogEntry, AppView } from '@/lib/types';

import { generateCommentary } from '@/lib/commentary';
import { fetchAICommentary, buildFlowBrief, type AICommentaryContext } from '@/lib/ai-commentary';

import { dataFreshnessRule, fadeObiRule, fundingCrowdedRule, liqClusterRule, reverseLiqRatioRule, type RuleResult } from '@/lib/scoring-rules';

import { soundEngine } from '@/lib/audio';
import { pushNotify } from '@/lib/notifications';
import { initPatternDB, intervalToSeconds, patternContext, patternCrossesAt, patternGetStatsBest, patternOutcome, patternRecomputeStats, patternId, patternName, patternRecentExists, patternCompleteAllOpenEvents, dbAdd, dbPut, dbDelete, dbIndexGet, dbIndexAll, dbAll, PPOOL_SCHEMA_VERSION } from '@/lib/pattern-engine';


export default function Home() {
  // Navigation & Core State
  const [symbol, setSymbol] = useState<string>('BTCUSDT');
  const [interval, setInterval] = useState<string>('5m');
  const [activeView, setActiveView] = useState<AppView>('chart');
  const [favs, setFavs] = useState<string[]>([]);

  const { settings, settingsRef, updateSettings: handleUpdateSettings, updateSingleSetting: handleUpdateSingleSetting } = useAppSettings();
  const { notifyEnabled, notifyPerm, toggleNotify: handleToggleNotify } = useNotifications();
  const { symbols, symbolInfos, tickers } = useMarketData();
  const onClosedCandleRef = useRef<(cs: Candle[]) => void>(() => {});
  const {
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
    lastDepthTsRef,
    lastMarkTsRef,
    computeFlowSnapshot,
    reconnect: handleReconnect,
    resetStreams,
    clearEvents
  } = useFlowStream({
    symbol,
    interval,
    settings,
    settingsRef,
    symbolInfos,
    onClosedCandle: onClosedCandleRef
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

  const lastRecordedEventTimeRef = useRef<number>(0);
  const lastRecordedPatIdRef = useRef<string>('');
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
  // Android geri tusu: once tam ekran, sonra grafik disi gorunum kapanir (LIFO)
  useAndroidBack(isFullscreen, () => setIsFullscreen(false));
  useAndroidBack(activeView !== 'chart', () => setActiveView('chart'));
  const [isSignalOpen, setIsSignalOpen] = useState(false);

  // Mini sembol grid'i (çoklu düzen): ana grafik altında 3 hafif kart
  const [miniOn, setMiniOn] = useState(true);
  const [miniSyms, setMiniSyms] = useState<string[]>([]);
  const miniInitRef = useRef(false);


  // Mini grid tercihleri (persist)
  useEffect(() => {
    try {
      const on = localStorage.getItem('fs_mini_on');
      if (on !== null) setMiniOn(on === 'true');
      const syms = localStorage.getItem('fs_mini_symbols');
      if (syms) {
        const arr = JSON.parse(syms);
        if (Array.isArray(arr)) {
          setMiniSyms(arr.filter((x: unknown): x is string => typeof x === 'string').slice(0, 3));
          miniInitRef.current = true;
        }
      }
    } catch {}
  }, []);

  // Ticker'lar gelince varsayılan slotları doldur (yalnız ilk sefer)
  useEffect(() => {
    if (miniInitRef.current || miniSyms.length || !tickers.length) return;
    miniInitRef.current = true;
    const def = tickers
      .filter((t) => t.symbol !== symbol && t.symbol.endsWith('USDT'))
      .slice(0, 3)
      .map((t) => t.symbol);
    if (def.length) setMiniSyms(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers]);

  useEffect(() => {
    try {
      localStorage.setItem('fs_mini_on', String(miniOn));
    } catch {}
  }, [miniOn]);

  useEffect(() => {
    try {
      localStorage.setItem('fs_mini_symbols', JSON.stringify(miniSyms));
    } catch {}
  }, [miniSyms]);

  // Ana sembol mini listesinde kalmasın (swap sonrası emniyet)
  useEffect(() => {
    setMiniSyms((prev) => (prev.includes(symbol) ? prev.filter((x) => x !== symbol) : prev));
  }, [symbol]);


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

  // PREDATOR port'u (4/4): canlı sinyal öz-skor — mum kapandıkça 3/5/7/15dk sonrasının
  // ✓/✗ sonucu çözümlenir (backtest'ten bağımsız), signalLog'a kalıcı yazılır.
  useEffect(() => {
    if (!candles.length || !signals.length) return;
    const { updated, changed } = resolvePendingOutcomes(candles, signals);
    if (!changed) return;
    setSignals(updated);
    for (const s of updated) {
      if (!s.outcomes) continue;
      dbPut('signalLog', { ...s, symbol, timeframe: interval }).catch(() => {});
    }
  }, [candles, signals, symbol, interval]);

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
    // P1: haptik geri bildirim (ayarli — settings.haptics)
    if (settingsRef.current.haptics) buzz(SIGNAL_BUZZ);
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
  }, [settingsRef]);

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
  // Sadece ref/db erişimi — dep dizisi boş bilinçli (stabil identity)
  const settleOpenTrackingEvents = useCallback(async (cs: Candle[]) => {
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
  }, [settingsRef]);

  const handleSelectSymbol = useCallback((sym: string) => {
    if (sym === symbol) return;
    settleOpenTrackingEvents(candlesRef.current);
    setSymbol(sym);
    try {
      localStorage.setItem('fs_symbol', sym);
    } catch {}
    // Reset flow + engine states for new symbol
    resetStreams();
    pendingEngineRef.current = null;
    trackingEventsRef.current = [];
    setSignals([]);
    setStatus('NOTR');
    setStatusRule('Yeni sembol yüklendi, taranıyor...');
    setEvaluation(null);
    setActivePatternStats(null);
    setActivePatternId(null);
    setPatternOverlay(null); // P1.5: overlay eski sembole ait
  }, [symbol, settleOpenTrackingEvents, candlesRef, resetStreams]);

  // Mini karta tıkla → ana sembolle takas
  const handleSelectMini = useCallback(
    (sym: string) => {
      if (sym === symbol) return;
      const oldMain = symbol;
      handleSelectSymbol(sym);
      setMiniSyms((prev) => prev.map((x) => (x === sym ? oldMain : x)));
    },
    [symbol, handleSelectSymbol]
  );

  const handleRemoveMini = useCallback((sym: string) => {
    setMiniSyms((prev) => prev.filter((x) => x !== sym));
  }, []);

  const handleAddMini = useCallback(
    (sym: string) => {
      if (!sym || sym === symbol) return;
      setMiniSyms((prev) => (prev.includes(sym) || prev.length >= 3 ? prev : [...prev, sym]));
    },
    [symbol]
  );

  const handleSelectInterval = (tf: string) => {
    if (tf === interval) return;
    settleOpenTrackingEvents(candlesRef.current);
    setInterval(tf);
    try {
      localStorage.setItem('fs_interval', tf);
    } catch {}
    // Yeni zaman dilimi: sinyal/olay bağlamı değişir, grafik ve log temizlensin.
    setSignals([]);
    clearEvents();
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
    [computeFlowSnapshot, flowEvents, settingsRef, tradesRef, lastDepthTsRef, lastMarkTsRef]
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
              // P1: haptik geri bildirim (ayarli — settings.haptics)
              if (settingsRef.current.haptics) buzz(SIGNAL_BUZZ);

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
              // P1: haptik geri bildirim (ayarli — settings.haptics)
              if (settingsRef.current.haptics) buzz(SIGNAL_BUZZ);
              break;
            }
          }
        }
      }
    },
    [evaluateRawFlow, interval, symbol, publishSignalCommentary, settingsRef]
  );

  // WS FIX: runSignalEngine her flowEvents guncellemesinde yeni identity aliyordu ve buna bagli
  // WebSocket client'i tekrar tekrar kurup yikiyordu (reconnect storm). Ref arkasindan cagir.
  useEffect(() => {
    onClosedCandleRef.current = runSignalEngine;
  }, [runSignalEngine]);



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
                wsConnected={wsConnected}
          wsMessage={wsMessage}
          miniOn={miniOn}
                onToggleMini={() => setMiniOn((v) => !v)}
              />
            </div>

            {/* Mini Sembol Grid'i (çoklu düzen) */}
            {!isFullscreen && miniOn && (
              <div className="border-t border-[#22272e] bg-[#12161c] shrink-0 px-2 py-1.5 select-none z-20">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[9px] font-bold text-slate-500 font-mono tracking-wide">
                    MİNİ İZLEME · {miniSyms.length}/3
                  </span>
                  {miniSyms.length < 3 && (
                    <select
                      value=""
                      onChange={(e) => handleAddMini(e.target.value)}
                      aria-label="Mini izlemeye sembol ekle"
                      className="bg-[#11151b] border border-[#2e3640] rounded px-1.5 py-0.5 text-[9px] text-slate-300 font-mono outline-none focus:border-emerald-500 min-h-[22px]"
                    >
                      <option value="">+ ekle</option>
                      {tickers
                        .filter((t) => t.symbol !== symbol && !miniSyms.includes(t.symbol))
                        .slice(0, 30)
                        .map((t) => (
                          <option key={t.symbol} value={t.symbol}>
                            {t.symbol.replace('USDT', '')}
                          </option>
                        ))}
                    </select>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-1.5 h-24 sm:h-32">
                  {miniSyms.map((sym) => (
                    <MiniChartCard
                      key={sym}
                      symbol={sym}
                      interval={interval}
                      tickers={tickers}
                      isActive={sym === symbol}
                      onSelect={handleSelectMini}
                      onRemove={handleRemoveMini}
                    />
                  ))}
                  {miniSyms.length === 0 && (
                    <div className="col-span-3 flex items-center justify-center h-full text-[10px] text-slate-600 font-mono border border-dashed border-[#22272e] rounded-lg">
                      Kart ekle (+) ya da Tarayıcı{`'`}dan sembol seç
                    </div>
                  )}
                </div>
              </div>
            )}

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
