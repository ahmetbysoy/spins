'use client';

import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  createSeriesMarkers,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type SeriesMarker,
  type Time,
  type LineWidth,
  type MouseEventParams,
  TickMarkType
} from 'lightweight-charts';

// REV-6: LineWidth clamp helper
const clampWidth = (w: number | undefined): LineWidth => Math.min(4, Math.max(1, Math.round(w || 1))) as LineWidth;
import {
  LayoutGrid,
  Maximize2,
  Minimize2,
  Layers,
  Activity,
  Zap,
  TrendingUp,
  Sliders,
  Eye,
  EyeOff
} from 'lucide-react';
import { AppSettings, Candle, FlowSnapshot, HeatmapFrame, SignalLogEntry, LiquidationEvent, FlowEvent, SymbolInfo, PatternStats, PatternEvent, PatternOverlayState } from '@/lib/types';
import { bollingerBands, macd, psar, rsi, sma, vwap } from '@/lib/indicators';
import { intervalToSeconds } from '@/lib/pattern-engine';
import { useAndroidBack } from '@/hooks/use-android-back';
import { buzz } from '@/lib/haptics';
import { volumeBarColor, isVolumeSpike, VOL_SPIKE_LOOKBACK } from '@/lib/volume-spike';
import { pushTickerItem, priceTickText, metricsText, computeHype, fmtCompact, fmtNum, type TickerItem, type TickerKind } from '@/lib/ticker';
import {
  mergeWalls,
  nonzeroMax,
  percentileFromBins,
  pruneWallAges,
  touchWallAge,
  wallAgeKey,
  WALL_ESTABLISHED_MS,
  WALL_MIN_NOTIONAL,
  type LiquidityWall,
  type WallAgeRecord
} from '@/lib/liquidity-walls';

interface ChartTerminalProps {
  symbol: string;
  interval: string;
  onSelectInterval: (interval: string) => void;
  candles: Candle[];
  settings: AppSettings;
  flowSnapshot: FlowSnapshot;
  heatmapFrames: HeatmapFrame[];
  bidsBook: Map<number, number>;
  asksBook: Map<number, number>;
  signals: SignalLogEntry[];
  liquidations: LiquidationEvent[];
  flowEvents: FlowEvent[];
  lastPrice: number;
  symbolInfo?: SymbolInfo | null;
  /** Fullscreen modunda kompakt sembol geçişi için (opsiyonel) */
  symbols?: string[];
  onSelectSymbol?: (sym: string) => void;
  activePatternStats?: PatternStats | null;
  patternOverlay?: PatternOverlayState | null;
  onUpdateSetting?: (key: keyof AppSettings, val: any) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Bağlantı durumu (canlı nabız — dopamin 5) */
  wsConnected?: boolean;
  wsMessage?: string;
  /** Mini sembol grid'i aç/kapa (page.tsx state'i) */
  miniOn?: boolean;
  onToggleMini?: () => void;
}

const TFS = ['1m', '5m', '15m', '1h', '4h'];

// Olay zamanini (ms) en yakin mum acilis saniyesine yuvarlar.
function snapToBarTime(tsMs: number, tfSec: number): number {
  const sec = Math.floor(tsMs / 1000);
  return Math.floor(sec / tfSec) * tfSec;
}

// P1.5: Settle olmus desen event'inin MFE/MAE noktasini hesaplar (grafik zamani: saniye).
function patOutcomePoint(
  ev: PatternEvent,
  kind: 'mfe' | 'mae',
  tfSec: number
): { time: number; price: number } | null {
  if (!ev || !ev.refClose || !ev.timestamp) return null;
  const bars = kind === 'mfe' ? ev.barsToMfe : ev.barsToMae;
  if (bars == null) return null; // eski (barsToMae'siz) event'lerde nokta cizilemez
  const magnitude = kind === 'mfe' ? ev.mfe20 || 0 : ev.mae20 || 0;
  const favorable = kind === 'mfe';
  const goingUp = ev.dir === 'UP';
  const priceUpward = (goingUp && favorable) || (!goingUp && !favorable);
  return {
    time: Math.floor(ev.timestamp / 1000) + bars * tfSec,
    price: ev.refClose * (1 + (priceUpward ? 1 : -1) * (magnitude / 100))
  };
}

export const ChartTerminal: React.FC<ChartTerminalProps> = ({
  symbol,
  interval,
  onSelectInterval,
  candles,
  settings,
  flowSnapshot,
  heatmapFrames,
  bidsBook,
  asksBook,
  signals,
  liquidations,
  flowEvents,
  lastPrice,
  symbolInfo,
  symbols,
  onSelectSymbol,
  activePatternStats,
  patternOverlay,
  onUpdateSetting,
  isFullscreen = false,
  onToggleFullscreen,
  wsConnected = false,
  wsMessage = '',
  miniOn,
  onToggleMini,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma1SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma2SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma3SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const sarSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSigRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerPrimitiveRef = useRef<any>(null);
  const mfePriceLineRef = useRef<any>(null);
  const maePriceLineRef = useRef<any>(null);
  const patLineSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);

  const lastBarTimeRef = useRef<number | null>(null);
  const overlayRafRef = useRef<number | null>(null);
  const wallAgesRef = useRef<Map<string, WallAgeRecord>>(new Map());
  // Dopamin 2/4: fiyat flaşı + desen bandı durumları (drawOverlays içinde)
  const priceFlashRef = useRef<{ price: number; ts: number; dir: 1 | -1 }>({ price: 0, ts: 0, dir: 1 });
  const patternGlowRef = useRef<{ key: string; ts: number }>({ key: '', ts: 0 });
  const patternGlowRedrawRef = useRef(false);

  // Overlay Canvases
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  // Likidite overlay legend'i (kapatilabilir; tercih localStorage'da)
  // Pill satırı kaydırma göstergesi
  const [pillsAtEnd, setPillsAtEnd] = useState(false);
  const pillsRef = useRef<HTMLDivElement>(null);
  const lastTopSignalIdRef = useRef<string | null>(null);
  // Duvar tekeri (alt bant): drawOverlays içinden beslenir
  const [topTicker, setTopTicker] = useState<TickerItem[]>([]);
  const [botTicker, setBotTicker] = useState<TickerItem[]>([]);
  const [tickerPaused, setTickerPaused] = useState(false);
  const topTrackRef = useRef<HTMLDivElement | null>(null);
  const botTrackRef = useRef<HTMLDivElement | null>(null);
  const lastTickPriceRef = useRef<number | null>(null);
  const lastTickAtRef = useRef(0);
  const liqSeenRef = useRef<string | null>(null);
  const flowEvtSeenRef = useRef<string | null>(null);
  const spikeBarRef = useRef<number | null>(null);
  // Bant beslemeleri interval içinde güncel snapshot okur
  const fsSnapRef = useRef(flowSnapshot);
  fsSnapRef.current = flowSnapshot;
  const pushTop = useCallback((item: TickerItem) => setTopTicker((b) => pushTickerItem(b, item)), []);
  const pushBot = useCallback((item: TickerItem) => setBotTicker((b) => pushTickerItem(b, item)), []);
  const wallTickerRef = useRef('');
  const [fsSymOpen, setFsSymOpen] = useState(false);
  // Zaman ekseni rotuşları: crosshair mum okuma satırı + mum kapanış geri sayımı
  const [hoverBar, setHoverBar] = useState<{ time: number; o: number; h: number; l: number; c: number; vol?: number } | null>(null);
  // Dopamin tetikleyici 1: yeni AL/SAT sinyalinde glow-up/glow-down (halo halkasi + kenar flasi)
  const pulseCanvasRef = useRef<{ x: number; y: number; dir: 'AL' | 'SAT'; ts: number } | null>(null);
  const pulseRedrawRef = useRef(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const lastCandleRef = useRef<Candle | null>(null);
  lastCandleRef.current = candles.length ? candles[candles.length - 1] : null;
  // Android geri tusu: sembol aramayi kapatir (tam ekrandan once)
  useAndroidBack(fsSymOpen, () => setFsSymOpen(false));
  const [fsQuery, setFsQuery] = useState('');

  const domOverlayCanvasRef = useRef<HTMLCanvasElement>(null);

  // Browser Native Fullscreen Toggle
  const handleFullscreenToggle = () => {
    if (onToggleFullscreen) {
      onToggleFullscreen();
    } else {
      if (!document.fullscreenElement) {
        chartWrapperRef.current?.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Memoized Indicators (Recalculate only when candle count changes (new bar) or first candle time changes or settings change)
  const candleCount = candles.length;
  const firstCandleTime = candles[0]?.time ?? 0;
  const lastCandleTime = candles[candles.length - 1]?.time ?? 0;

  const indicatorData = useMemo(() => {
    if (!candles.length) return null;
    const closes = candles.map((c) => c.close);
    const times = candles.map((c) => c.time as Time);
    return {
      times,
      closes,
      ma1: sma(closes, settings.ma1 || 9),
      ma2: sma(closes, settings.ma2 || 21),
      ma3: sma(closes, settings.ma3 || 50),
      sar: psar(candles, settings.sarStep || 0.02, settings.sarMax || 0.2).sar,
      bb: bollingerBands(candles, settings.bbPeriod || 20, settings.bbStd || 2),
      vwap: vwap(candles),
      rsi: rsi(closes, settings.rsiPeriod || 14),
      macd: macd(closes, settings.macdFast || 12, settings.macdSlow || 26, settings.macdSignal || 9)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleCount, firstCandleTime, lastCandleTime, settings]);

  // Initialize Lightweight Charts
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#0d1117' },
        textColor: '#8b949e'
      },
      grid: {
        vertLines: { color: 'rgba(42, 48, 56, 0.4)' },
        horzLines: { color: 'rgba(42, 48, 56, 0.4)' }
      },
      crosshair: {
        // Dokunmatikte Magnet: crosshair fiyati mum kapanisina yapisir (yag parmak telafisi);
        // masaustunde Normal (serbest). Uzun basma inceleme asagidaki efektte.
        mode:
          typeof window !== 'undefined' &&
          window.matchMedia?.('(hover: none) and (pointer: coarse)').matches
            ? 1
            : 0
      },
      localization: {
        // crosshair zaman etiketi Turkce: "2 Eyl 14:05" (fiyat formati dokunulmaz)
        timeFormatter: (t: Time) =>
          typeof t === 'number'
            ? new Date(t * 1000).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : String(t)
      },
      // Zaman ekseni rötuşları: dakika hizali TF'lerde saniye ":00" gurultusudur
      // (secondsVisible:false bilincli); saniyelik ihtiyac kapanis geri sayimi +
      // crosshair okuma satiri karsilar (bkz. docs/TIME-AXIS-BRAINSTORM.md).
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a3038',
        tickMarkFormatter: (t: Time, tickType: TickMarkType) => {
          const d = typeof t === 'number' ? new Date(t * 1000) : null;
          if (!d) return String(t);
          if (tickType === TickMarkType.Year) return String(d.getFullYear());
          if (tickType === TickMarkType.Month) return d.toLocaleDateString('tr-TR', { month: 'short' });
          if (tickType === TickMarkType.DayOfMonth) return String(d.getDate());
          if (tickType === TickMarkType.TimeWithSeconds)
            return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
        }
      },
      rightPriceScale: {
        borderColor: '#2a3038',
        scaleMargins: {
          top: 0.04,
          bottom: settings.showRsi || settings.showMacd ? 0.30 : 0.08
        }
      }
    });

    chartRef.current = chart;

    // Candlesticks
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      ...(symbolInfo && symbolInfo.tickSize
        ? {
            priceFormat: {
              type: 'price',
              precision: symbolInfo.pricePrecision || 2,
              minMove: symbolInfo.tickSize
            }
          }
        : {})
    });
    candleSeriesRef.current = candleSeries as any;

    // Volume
    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol'
    });
    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
      borderVisible: false
    });
    volSeriesRef.current = volSeries as any;

    // MAs
    ma1SeriesRef.current = chart.addSeries(LineSeries, {
      color: settings.ma1Color || '#e0b64c',
      lineWidth: clampWidth(settings.ma1Width),
      priceLineVisible: false,
      lastValueVisible: false
    });
    ma2SeriesRef.current = chart.addSeries(LineSeries, {
      color: settings.ma2Color || '#4c8ce0',
      lineWidth: clampWidth(settings.ma2Width),
      priceLineVisible: false,
      lastValueVisible: false
    });
    ma3SeriesRef.current = chart.addSeries(LineSeries, {
      color: settings.ma3Color || '#b06ce0',
      lineWidth: clampWidth(settings.ma3Width),
      priceLineVisible: false,
      lastValueVisible: false
    });

    // SAR
    sarSeriesRef.current = chart.addSeries(LineSeries, {
      color: settings.sarColor || '#9aa4ae',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;

    // Bollinger Bands
    bbUpperRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(76, 140, 224, 0.6)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;
    bbMidRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(76, 140, 224, 0.3)',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;
    bbLowerRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(76, 140, 224, 0.6)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;

    // VWAP
    vwapSeriesRef.current = chart.addSeries(LineSeries, {
      color: settings.vwapColor || '#ff9800',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;

    // Sub-indicators: RSI & MACD
    rsiSeriesRef.current = chart.addSeries(LineSeries, {
      priceScaleId: 'rsi',
      color: '#fdd835',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;
    chart.priceScale('rsi').applyOptions({
      scaleMargins: { top: 0.72, bottom: 0.16 },
      borderVisible: false
    });

    macdHistRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: 'macd',
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;
    macdLineRef.current = chart.addSeries(LineSeries, {
      priceScaleId: 'macd',
      color: '#00bcd4',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;
    macdSigRef.current = chart.addSeries(LineSeries, {
      priceScaleId: 'macd',
      color: '#ff7043',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false
    }) as any;
    chart.priceScale('macd').applyOptions({
      scaleMargins: { top: 0.86, bottom: 0 },
      borderVisible: false
    });

    // Save pan/zoom logical range
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (range && typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(`fs_range_${symbol}_${interval}`, JSON.stringify(range));
        } catch {}
      }
    });

    // Resize Observer
    const handleResize = () => {
      if (!containerRef.current || !chartRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w <= 0 || h <= 0) return;
      chartRef.current.resize(w, h);

      // Resize overlay canvases with devicePixelRatio
      const dpr = window.devicePixelRatio || 1;
      [heatmapCanvasRef.current, domOverlayCanvasRef.current].forEach((cv) => {
        if (!cv) return;
        cv.width = w * dpr;
        cv.height = h * dpr;
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
        const ctx = cv.getContext('2d');
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);
    handleResize();

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update scale margins dynamically when RSI/MACD toggled
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.04,
        bottom: settings.showRsi || settings.showMacd ? 0.30 : 0.08
      }
    });
  }, [settings.showRsi, settings.showMacd]);

  // Crosshair OKLC+Zaman okuma satiri: imlecin uzerindeki mumu gosterir (yoksa son mum)
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const onMove = (param: MouseEventParams) => {
      const s = candleSeriesRef.current;
      if (!s || param.time === undefined || !param.point) {
        setHoverBar(null);
        return;
      }
      const d = param.seriesData.get(s) as { open: number; high: number; low: number; close: number } | undefined;
      if (!d) return;
      const v = volSeriesRef.current
        ? (param.seriesData.get(volSeriesRef.current) as { value: number } | undefined)
        : undefined;
      setHoverBar({ time: param.time as number, o: d.open, h: d.high, l: d.low, c: d.close, vol: v?.value });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [symbol, interval, settings.showRsi, settings.showMacd]);

  // Mobil crosshair (TradingView mobil kalibi): LWC crosshair'i fare olayiyle calisir,
  // dokunmatikte hic tetiklenmez. Uzun basma (300ms, 12px oynamayla iptal) inceleme
  // modunu acar: setCrosshairPosition ile yapay crosshair + OHLC satiri beslenir,
  // surukleyerek mumlar arasinda gezilir; parmak kalkinca kapanir ve kaydirma geri gelir.
  useEffect(() => {
    const el = containerRef.current;
    const chart = chartRef.current;
    const s = candleSeriesRef.current;
    if (!el || !chart || !s) return;
    if (!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches) return; // yalnizca dokunmatik

    let timer: number | null = null;
    let inspecting = false;
    let sx = 0;
    let sy = 0;
    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };
    const setPos = (x: number, y: number) => {
      const price = s.coordinateToPrice(y);
      const time = chart.timeScale().coordinateToTime(x);
      if (price !== null && time !== null) chart.setCrosshairPosition(price, time, s);
    };
    const exitInspect = () => {
      if (!inspecting) return;
      inspecting = false;
      chart.applyOptions({ handleScroll: true });
      chart.clearCrosshairPosition();
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      sx = e.clientX;
      sy = e.clientY;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        inspecting = true;
        chart.applyOptions({ handleScroll: false }); // inceleme sirasinda pan kilidi
        if (settings.haptics) buzz(10);
        const r = el.getBoundingClientRect();
        setPos(sx - r.left, sy - r.top);
      }, 300);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (inspecting) {
        const r = el.getBoundingClientRect();
        setPos(e.clientX - r.left, e.clientY - r.top);
      } else if (timer !== null && Math.hypot(e.clientX - sx, e.clientY - sy) > 12) {
        clearTimer(); // kullanici kaydirmak istedi — uzun basma iptal
      }
    };
    const onUp = () => {
      clearTimer();
      if (inspecting) window.setTimeout(exitInspect, 400);
    };
    const onCtx = (e: Event) => {
      if (inspecting) e.preventDefault(); // uzun basma baglam menusunu engelle
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('contextmenu', onCtx);
    return () => {
      clearTimer();
      exitInspect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('contextmenu', onCtx);
    };
  }, [symbol, interval, settings.haptics]);




  // Pill satiri kaydirma durumu (▸ ipucu)
  useEffect(() => {
    const el = pillsRef.current;
    if (!el) return;
    const check = () => setPillsAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 8);
    check();
    el.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, []);

  // Mum kapanis geri sayimi (1sn tick): son bar zamanindan sonraki cizgiye kalan sure
  useEffect(() => {
    const tfSec = intervalToSeconds(interval);
    const tick = () => {
      const last = lastCandleRef.current;
      if (!last) {
        setCountdown(null);
        return;
      }
      const left = Math.ceil(((last.time + tfSec) * 1000 - Date.now()) / 1000);
      setCountdown(left > 0 && left <= tfSec ? left : null);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [interval]);

  // Dynamic priceFormat update whenever symbolInfo changes (precision & minMove/tickSize)
  useEffect(() => {
    if (!candleSeriesRef.current || !symbolInfo) return;
    const precision = symbolInfo.pricePrecision || 2;
    const minMove = symbolInfo.tickSize || 0.01;
    const priceFormatOpt = {
      type: 'price' as const,
      precision,
      minMove
    };

    candleSeriesRef.current.applyOptions({ priceFormat: priceFormatOpt });
    ma1SeriesRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    ma2SeriesRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    ma3SeriesRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    sarSeriesRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    bbUpperRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    bbMidRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    bbLowerRef.current?.applyOptions({ priceFormat: priceFormatOpt });
    vwapSeriesRef.current?.applyOptions({ priceFormat: priceFormatOpt });
  }, [symbolInfo]);

  // Reset last bar tracking ref on symbol or interval switch so full setData is triggered
  useEffect(() => {
    lastBarTimeRef.current = null;
  }, [symbol, interval]);

  // 1. Candlestick & Volume Real-time Series Feed (Fast O(1) tick update on active candle)
  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current || !candles.length) return;

    const candleData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    const last = candles[candles.length - 1];
    const isUpdatingLastBar = lastBarTimeRef.current === last.time;
    lastBarTimeRef.current = last.time;

    if (isUpdatingLastBar && candleSeriesRef.current) {
      // Live tick on same active candle: O(1) single-point update
      const lastCandle = candleData[candleData.length - 1];
      candleSeriesRef.current.update(lastCandle);
      if (volSeriesRef.current && settings.showVol) {
        // Dopamin 3: 3x hacim spike'i altin (lib/volume-spike)
        const volsLive = candles.map((cc) => cc.volume);
        const volColor = volumeBarColor(volsLive, volsLive.length - 1, last.close >= last.open);
        volSeriesRef.current.update({ time: last.time as Time, value: last.volume, color: volColor });
      }
    } else {
      // Full batch setData on new candle arrival or symbol/interval switch
      candleSeriesRef.current.setData(candleData);
      
      // Restore range if available
      try {
        if (typeof window !== 'undefined') {
          const stored = sessionStorage.getItem(`fs_range_${symbol}_${interval}`);
          if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed.from === 'number' && typeof parsed.to === 'number') {
              chartRef.current.timeScale().setVisibleLogicalRange(parsed);
            }
          }
        }
      } catch {}

      if (volSeriesRef.current) {
        const volsBatch = candles.map((c) => c.volume);
        const volData: HistogramData<Time>[] = settings.showVol
          ? candles.map((c, i) => ({
              time: c.time as Time,
              value: c.volume,
              color: volumeBarColor(volsBatch, i, c.close >= c.open) // Dopamin 3: spike -> altin
            }))
          : [];
        volSeriesRef.current.setData(volData);
      }
    }
  }, [candles, settings.showVol, symbol, interval]);

  // 2. Technical Indicators Feed (Only runs on new closed candle / indicatorData changes or settings toggle)
  useEffect(() => {
    if (!chartRef.current || !indicatorData) return;

    const { times, ma1, ma2, ma3, sar, bb, vwap: vw, rsi: r, macd: m } = indicatorData;

    const mapLineData = (arr: (number | null)[]): LineData<Time>[] =>
      times
        .map((t, i) => (arr[i] !== null ? { time: t, value: arr[i]! } : null))
        .filter((d): d is LineData<Time> => d !== null);

    // MAs
    if (ma1SeriesRef.current) {
      ma1SeriesRef.current.applyOptions({ color: settings.ma1Color || '#e0b64c', lineWidth: clampWidth(settings.ma1Width) });
      ma1SeriesRef.current.setData(settings.showMa ? mapLineData(ma1) : []);
    }
    if (ma2SeriesRef.current) {
      ma2SeriesRef.current.applyOptions({ color: settings.ma2Color || '#4c8ce0', lineWidth: clampWidth(settings.ma2Width) });
      ma2SeriesRef.current.setData(settings.showMa ? mapLineData(ma2) : []);
    }
    if (ma3SeriesRef.current) {
      ma3SeriesRef.current.applyOptions({ color: settings.ma3Color || '#b06ce0', lineWidth: clampWidth(settings.ma3Width) });
      ma3SeriesRef.current.setData(settings.showMa ? mapLineData(ma3) : []);
    }

    // SAR
    if (sarSeriesRef.current) {
      sarSeriesRef.current.applyOptions({ color: settings.sarColor || '#9aa4ae' });
      sarSeriesRef.current.setData(settings.showSar ? mapLineData(sar) : []);
    }

    // Bollinger Bands
    if (bbUpperRef.current && bbMidRef.current && bbLowerRef.current) {
      bbUpperRef.current.setData(settings.showBB ? mapLineData(bb.upper) : []);
      bbMidRef.current.setData(settings.showBB ? mapLineData(bb.mid) : []);
      bbLowerRef.current.setData(settings.showBB ? mapLineData(bb.lower) : []);
    }

    // VWAP
    if (vwapSeriesRef.current) {
      vwapSeriesRef.current.setData(settings.showVwap ? mapLineData(vw) : []);
    }

    // RSI
    if (rsiSeriesRef.current) {
      rsiSeriesRef.current.setData(settings.showRsi ? mapLineData(r) : []);
    }

    // MACD
    if (macdLineRef.current && macdSigRef.current && macdHistRef.current) {
      macdLineRef.current.setData(settings.showMacd ? mapLineData(m.line) : []);
      macdSigRef.current.setData(settings.showMacd ? mapLineData(m.signal) : []);
      const histData: HistogramData<Time>[] = [];
      if (settings.showMacd) {
        times.forEach((t, i) => {
          if (m.hist[i] !== null) {
            histData.push({
              time: t,
              value: m.hist[i]!,
              color: m.hist[i]! >= 0 ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)'
            });
          }
        });
      }
      macdHistRef.current.setData(histData);
    }
  }, [indicatorData, settings]);

  // Markers: Signals + Liquidations + Whale Events (Separate effect - updates on events, not every tick)
  // P1.5: overlay cizimlerinde "yuklu mum araliginda mi" kontrolu icin ilk bar zamani (her tick degismez)
  const firstBarTime = candles.length ? candles[0].time : null;
    const tfSec = intervalToSeconds(interval);

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;

    const markers: SeriesMarker<Time>[] = [];

    // Signals
    signals.forEach((s) => {
      markers.push({
        time: s.ts as Time,
        position: s.dir === 'AL' ? 'belowBar' : 'aboveBar',
        color: s.dir === 'AL' ? '#26a69a' : '#ef5350',
        shape: s.dir === 'AL' ? 'arrowUp' : 'arrowDown',
        text: `${s.dir} ${s.score ? `${s.score}` : ''}`
      });
    });

    // P1.5: Pattern overlay markerlari (giris / MFE / MAE)
    if (patternOverlay && patternOverlay.events.length) {
      const firstBar = firstBarTime ?? Infinity;
      patternOverlay.events.forEach((ev) => {
        if (ev.timeframe !== interval) return;
        const entrySec = Math.floor(ev.timestamp / 1000);
        if (entrySec < firstBar) return; // yuklu mum araliginin disinda
        const dirUp = ev.dir === 'UP';
        markers.push({
          time: entrySec as Time,
          position: dirUp ? 'belowBar' : 'aboveBar',
          color: '#8b949e',
          shape: 'circle',
          text: `giriş ${dirUp ? 'AL' : 'SAT'}`
        });
        const mfe = patOutcomePoint(ev, 'mfe', tfSec);
        const mae = patOutcomePoint(ev, 'mae', tfSec);
        if (mfe) {
          markers.push({
            time: mfe.time as Time,
            position: dirUp ? 'aboveBar' : 'belowBar',
            color: '#26a69a',
            shape: 'circle',
            text: `MFE +${(ev.mfe20 || 0).toFixed(2)}%`
          });
        }
        if (mae) {
          markers.push({
            time: mae.time as Time,
            position: dirUp ? 'belowBar' : 'aboveBar',
            color: '#ef5350',
            shape: 'circle',
            text: `MAE -${(ev.mae20 || 0).toFixed(2)}%`
          });
        }
      });
    }

    markers.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));

    try {
      if (markerPrimitiveRef.current) {
        markerPrimitiveRef.current.setMarkers(markers);
      } else {
        markerPrimitiveRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      }
    } catch {
      // Fallback
    }
  }, [
    signals,
    liquidations,
    tfSec,
    flowEvents,
    interval,
    settings.showLiq,
    settings.whaleAlerts,
    patternOverlay,
    firstBarTime
  ]);

  // P1.5: Pattern overlay cizgileri — giris→MFE (yesil) ve giris→MAE (kirmizi) dotted
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Eski overlay cizgilerini temizle
    patLineSeriesRef.current.forEach((s) => {
      try {
        chart.removeSeries(s);
      } catch {
        // chart yeniden yaratildiysa seri zaten yok
      }
    });
    patLineSeriesRef.current = [];

    if (!patternOverlay || !patternOverlay.events.length || firstBarTime == null) return;

    const tfSec = intervalToSeconds(interval);
    const firstBar = firstBarTime;

    const addLine = (
      p1: { time: number; price: number },
      p2: { time: number; price: number },
      color: string
    ) => {
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        lineStyle: LineStyle.Dotted,
        crosshairMarkerVisible: false
      });
      const pts = [p1, p2].sort((a, b) => a.time - b.time);
      s.setData(pts.map((p) => ({ time: p.time as Time, value: p.price })));
      patLineSeriesRef.current.push(s);
    };

    patternOverlay.events.forEach((ev) => {
      if (ev.timeframe !== interval) return;
      const entrySec = Math.floor(ev.timestamp / 1000);
      if (entrySec < firstBar) return;
      const entry = { time: entrySec, price: ev.refClose };
      const mfe = patOutcomePoint(ev, 'mfe', tfSec);
      const mae = patOutcomePoint(ev, 'mae', tfSec);
      if (mfe) addLine(entry, mfe, '#26a69a');
      if (mae) addLine(entry, mae, '#ef5350');
    });
  }, [patternOverlay, interval, symbol, firstBarTime]);

  // Projected MFE / MAE Target Price Lines (F2-3)
  useEffect(() => {
    if (!candleSeriesRef.current) return;
    const series = candleSeriesRef.current;

    if (mfePriceLineRef.current) {
      try { series.removePriceLine(mfePriceLineRef.current); } catch {}
      mfePriceLineRef.current = null;
    }
    if (maePriceLineRef.current) {
      try { series.removePriceLine(maePriceLineRef.current); } catch {}
      maePriceLineRef.current = null;
    }

    const latestSig = signals[0];
    if (
      latestSig &&
      activePatternStats &&
      activePatternStats.avgMfe20 > 0 &&
      activePatternStats.avgMae20 > 0 &&
      (Date.now() / 1000 - latestSig.ts < intervalToSeconds(interval) * 25)
    ) {
      const isAl = latestSig.dir === 'AL';
      const mfePrice = isAl
        ? latestSig.price * (1 + activePatternStats.avgMfe20 / 100)
        : latestSig.price * (1 - activePatternStats.avgMfe20 / 100);
      const maePrice = isAl
        ? latestSig.price * (1 - activePatternStats.avgMae20 / 100)
        : latestSig.price * (1 + activePatternStats.avgMae20 / 100);

      mfePriceLineRef.current = series.createPriceLine({
        price: mfePrice,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `MFE Hedef (+${activePatternStats.avgMfe20.toFixed(2)}%)`
      });

      maePriceLineRef.current = series.createPriceLine({
        price: maePrice,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `MAE Risk (-${activePatternStats.avgMae20.toFixed(2)}%)`
      });
    }
  }, [signals, activePatternStats, interval]);

  // Canvas Heatmap & DOM Overlays with Raster Binning & requestAnimationFrame (F1-5 - F1-8)
  const drawOverlays = useCallback(() => {
    if (overlayRafRef.current) {
      cancelAnimationFrame(overlayRafRef.current);
    }

    overlayRafRef.current = requestAnimationFrame(() => {
      if (!chartRef.current || !candleSeriesRef.current || !containerRef.current) return;
      // P2: uygulama arka plandayken canvas cizimi atlanir (batarya) — donunce tekrar cizilir
      if (typeof document !== 'undefined' && document.hidden) {
        overlayRafRef.current = null;
        return;
      }

      const chart = chartRef.current;
      const series = candleSeriesRef.current;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      // 1. Draw Liquidity Heatmap with (X, Y) Raster Binning
      if (heatmapCanvasRef.current && settings.showHeatmap) {
        const cv = heatmapCanvasRef.current;
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, width, height);

          if (heatmapFrames.length > 0) {
            const timeScale = chart.timeScale();
            const rasterCells = new Map<string, { x: number; y: number; notional: number; buyNotional: number; sellNotional: number }>();

            heatmapFrames.forEach((frame) => {
              // Fix H1: frame.t is already in seconds, no need to divide by 1000
              const x = timeScale.timeToCoordinate(frame.t as Time);
              if (x === null || x < 0 || x > width) return;
              // Lader seridi cakismasi: heatmap kareleri fiyat ekseni + DOM ladder
              // alanina dusmesin — canli duvar ile gecmis isi noktalari ayrissin.
              if (settings.showLadder) {
                const axisWHm = Math.max(58, chart.priceScale('right').width?.() ?? 58);
                if (x > width - axisWHm - (width < 640 ? 38 : 52)) return;
              }
              const slotX = Math.round(x / 4) * 4;

              frame.bins.forEach((bin) => {
                const y = series.priceToCoordinate(bin.price);
                if (y === null || y < 0 || y > height) return;
                const slotY = Math.round(y / 3) * 3;
                const k = `${slotX}_${slotY}`;
                const cur = rasterCells.get(k);
                if (cur) {
                  cur.notional += bin.notional;
                  if (bin.side === 'B') cur.buyNotional += bin.notional;
                  else cur.sellNotional += bin.notional;
                } else {
                  rasterCells.set(k, {
                    x: slotX,
                    y: slotY,
                    notional: bin.notional,
                    buyNotional: bin.side === 'B' ? bin.notional : 0,
                    sellNotional: bin.side === 'A' ? bin.notional : 0
                  });
                }
              });
            });

            let globalMaxNotional = 1;
            heatmapFrames.forEach((frame) => {
              if (frame.max > globalMaxNotional) globalMaxNotional = frame.max;
            });
            const logMax = Math.log1p(globalMaxNotional);

            rasterCells.forEach((cell) => {
              const power = logMax > 0 ? Math.log1p(cell.notional) / logMax : 0.5;
              const alpha = Math.min(0.88, Math.max(0.08, power * 0.85));
              const isBuy = cell.buyNotional >= cell.sellNotional;
              ctx.fillStyle = isBuy ? `rgba(38, 166, 154, ${alpha})` : `rgba(239, 83, 80, ${alpha})`;
              ctx.fillRect(cell.x - 2, cell.y - 1.5, 4, 3);
            });
          }
        }
      } else if (heatmapCanvasRef.current) {
        const ctx = heatmapCanvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, width, height);
      }

      // 2. Draw DOM Ladder & Liquidity Walls with Compact Design (Fix H3, H4, H5)
      if (domOverlayCanvasRef.current) {
        const cv = domOverlayCanvasRef.current;
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, width, height);
          if (settings.showLadder) {

          // Dinamik fiyat ekseni genisligi (sembol hassasiyetine gore; sabit 58px yerine)
          const axisWidth = Math.max(58, chart.priceScale('right').width?.() ?? 58);
          const chartRight = width - axisWidth;
          // Responsive DOM ladder: dar ekranda (telefon) serit/isin/etiket kuculur,
          // grafik alani kazanir; masaustunde mevcut olculer korunur.
          const isNarrowLadder = width < 640;
          const ladderWidth = isNarrowLadder ? 38 : 52;
          const rayZone = isNarrowLadder ? 44 : 65;
          const ladderLeft = chartRight - ladderWidth;

          // Compact Ladder border divider
          ctx.strokeStyle = 'rgba(42, 48, 56, 0.4)';
          ctx.beginPath();
          ctx.moveTo(ladderLeft, 0);
          ctx.lineTo(ladderLeft, height);
          ctx.stroke();

          // PREDATOR port'u (2/4): dinamik percentile esigi + bitisik birlestirme (merge)
          // — sabit $15k/slot-duvar modeli emekli. Duvar artiki gorunur satirlarin nonzero
          // notional dagiliminda p(wallPct) percentile'ini asan, dominance saglam ve
          // intensitesi surekli run'dir; etiket notional-agirlikli centroid'e oturur.
          const BIN_PX = 2.5;
          const rowCount = Math.ceil(height / BIN_PX);
          const bidBins = new Float64Array(rowCount);
          const askBins = new Float64Array(rowCount);
          const rowPrice = new Float64Array(rowCount);
          const fillBins = (book: Map<number, number>, bins: Float64Array) => {
            book.forEach((qty, price) => {
              const y = series.priceToCoordinate(price);
              if (y === null || y < 0 || y > height) return;
              const row = Math.min(rowCount - 1, Math.max(0, Math.floor(y / BIN_PX)));
              bins[row] += price * qty;
              if (!rowPrice[row]) rowPrice[row] = price;
            });
          };
          fillBins(bidsBook, bidBins);
          fillBins(asksBook, askBins);

          const { nz, max: maxNotional } = nonzeroMax(bidBins, askBins);
          if (maxNotional > 0) {
            const threshold = Math.max(percentileFromBins(nz, (settings.wallPct || 90) / 100), WALL_MIN_NOTIONAL);
            const logMax = Math.log1p(maxNotional);

            // Ladder yogunluk satirlari (intensity = log1p/maxLog)
            for (let r = 0; r < rowCount; r++) {
              const isBid = bidBins[r] >= askBins[r];
              const notional = isBid ? bidBins[r] : askBins[r];
              if (notional <= 0) continue;
              const intensity = Math.log1p(notional) / logMax;
              const barLen = Math.min(ladderWidth, intensity * ladderWidth);
              ctx.fillStyle = isBid
                ? `rgba(38, 166, 154, ${(0.35 + intensity * 0.4).toFixed(2)})`
                : `rgba(239, 83, 80, ${(0.35 + intensity * 0.4).toFixed(2)})`;
              ctx.fillRect(chartRight - barLen, r * BIN_PX, barLen, BIN_PX);
            }

            // Duvarlar: merge + fiyat-bazli yas takibi (peak/decay, PREDATOR wallAges)
            const walls = mergeWalls(bidBins, askBins, { threshold, maxNotional, binPx: BIN_PX });
            const ticker: { price: number; side: 'B' | 'A'; notional: number; est: boolean }[] = [];
            const now = Date.now();
            const activeKeys = new Set<string>();
            const rayStart = Math.max(0, chartRight - ladderWidth - rayZone);
            const wallRecs = new Map<LiquidityWall, WallAgeRecord>();

            for (const wall of walls) {
              const price = rowPrice[Math.round(wall.y / BIN_PX)] || rowPrice[wall.start] || 0;
              const key = wallAgeKey(symbol, price, wall.side, symbolInfo?.tickSize || 0);
              const rec = touchWallAge(wallAgesRef.current, key, wall.side, wall.notional, now);
              activeKeys.add(key);
              const isEstablished = now - rec.first >= WALL_ESTABLISHED_MS;
              const isBidWall = wall.side === 'B';
              const rgb = isBidWall ? '38, 166, 154' : '239, 83, 80';

              // Duvar bar (parlak) + kisa isin (H5 stili korunur)
              const y0 = wall.start * BIN_PX;
              const hh = (wall.end - wall.start + 1) * BIN_PX;
              const wallInt = Math.log1p(wall.notional) / logMax;
              const wallLen = Math.min(ladderWidth, wallInt * ladderWidth);
              ctx.fillStyle = `rgba(${rgb}, ${(0.55 + wallInt * 0.3).toFixed(2)})`;
              ctx.fillRect(chartRight - wallLen, y0, wallLen, Math.max(2, hh));
              const grad = ctx.createLinearGradient(rayStart, y0, chartRight, y0);
              grad.addColorStop(0, `rgba(${rgb}, 0)`);
              grad.addColorStop(1, `rgba(${rgb}, 0.85)`);
              ctx.strokeStyle = grad;
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.moveTo(rayStart, wall.y);
              ctx.lineTo(chartRight, wall.y);
              ctx.stroke();

              wallRecs.set(wall, rec);
              ticker.push({ price, side: wall.side, notional: wall.notional, est: isEstablished });
            }
            // Alt bant tekeri: en büyük 3 duvar (etiketler canvas'ta değil bantta)
            {
              const top3 = ticker.slice().sort((a, b) => b.notional - a.notional).slice(0, 3);
              const lines3 = top3.map(
                (w) =>
                  `DUVAR ${w.price.toLocaleString('tr-TR')} ${w.side === 'B' ? 'ALIŞ' : 'SATIŞ'} ≥P${settings.wallPct || 90} · $${(
                    w.notional / 1e6
                  ).toFixed(1)}M${w.est ? ' ⏱' : ''}`
              );
              const joined = lines3.join(' · ');
              if (joined && joined !== wallTickerRef.current) {
                wallTickerRef.current = joined;
                const wt = Date.now();
                lines3.forEach((t, ix) =>
                  setBotTicker((b) => pushTickerItem(b, { id: `wall-${wt}-${ix}`, kind: 'wall', ts: wt, text: t }))
                );
              }
            }
            pruneWallAges(wallAgesRef.current, activeKeys, now);
          }

          // Current Spread Ray
          if (flowSnapshot.bestBid && flowSnapshot.bestAsk) {
            const bidY = series.priceToCoordinate(flowSnapshot.bestBid);
            const askY = series.priceToCoordinate(flowSnapshot.bestAsk);
            if (bidY !== null && askY !== null) {
              const my = (bidY + askY) / 2;
              const rayLeft = chartRight - 30;
              ctx.strokeStyle = 'rgba(245, 158, 11, 0.85)';
              ctx.lineWidth = 1;
              ctx.setLineDash([2, 2]);
              ctx.beginPath();
              ctx.moveTo(rayLeft, my);
              ctx.lineTo(chartRight, my);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }

          // 3. Draw Historical MFE / MAE Trajectory Vectors (F2-3)
          if (settings.showMfeMae && signals.length > 0 && activePatternStats && activePatternStats.avgMfe20 > 0) {
            const timeScale = chart.timeScale();
            const recentSignals = signals.slice(0, 8);

            recentSignals.forEach((sig) => {
              const isAl = sig.dir === 'AL';
              const tfSec = intervalToSeconds(interval);
              const barTime = snapToBarTime(sig.ts * 1000, tfSec);
              const startX = timeScale.timeToCoordinate(barTime as Time);
              const startY = series.priceToCoordinate(sig.price);

              if (startX === null || startY === null || startX < 0 || startX > width) return;

              const mfeBars = Math.max(3, Math.min(20, Math.round(activePatternStats.medBarsToMfe || 8)));
              const targetTime = (barTime + mfeBars * tfSec) as Time;
              const endX = timeScale.timeToCoordinate(targetTime);

              if (endX !== null && endX > startX && endX <= width + 120) {
                const targetMfePrice = isAl
                  ? sig.price * (1 + activePatternStats.avgMfe20 / 100)
                  : sig.price * (1 - activePatternStats.avgMfe20 / 100);
                const targetMaePrice = isAl
                  ? sig.price * (1 - activePatternStats.avgMae20 / 100)
                  : sig.price * (1 + activePatternStats.avgMae20 / 100);

                const mfeY = series.priceToCoordinate(targetMfePrice);
                const maeY = series.priceToCoordinate(targetMaePrice);

                ctx.save();
                ctx.setLineDash([4, 4]);

                // MFE Trajectory Vector (Emerald)
                if (mfeY !== null) {
                  ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
                  ctx.lineWidth = 1.2;
                  ctx.beginPath();
                  ctx.moveTo(startX, startY);
                  ctx.lineTo(endX, mfeY);
                  ctx.stroke();

                  ctx.fillStyle = 'rgba(16, 185, 129, 0.7)';
                  ctx.beginPath();
                  ctx.arc(endX, mfeY, 2.5, 0, 2 * Math.PI);
                  ctx.fill();
                }

                // MAE Trajectory Vector (Rose)
                if (maeY !== null) {
                  ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(startX, startY);
                  ctx.lineTo(endX, maeY);
                  ctx.stroke();

                  ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
                  ctx.beginPath();
                  ctx.arc(endX, maeY, 2, 0, 2 * Math.PI);
                  ctx.fill();
                }

                ctx.restore();
              }
            });
          } // MFE-if kapanisi
          } // showLadder guard kapanisi

          // Dopamin 2 — son fiyat flaşı (0.3s): anlamlı oynama (>=1bp) olduğunda fiyat
          // çizgisi yönlü renkte parlar; alpha zamanla söner, sonulme karesi için redraw planlanır.
          {
            const lastC = candles[candles.length - 1];
            if (lastC) {
              const pf = priceFlashRef.current;
              const nowMs = Date.now();
              if (lastC.close !== pf.price) {
                if (!pf.price || Math.abs(lastC.close - pf.price) / pf.price >= 0.0001) {
                  priceFlashRef.current = {
                    price: lastC.close,
                    ts: nowMs,
                    dir: lastC.close > (pf.price || lastC.close) ? 1 : -1
                  };
                  window.setTimeout(() => drawOverlays(), 340);
                } else {
                  priceFlashRef.current = { ...pf, price: lastC.close }; // ufak oynama: flaş yenilenmez
                }
              }
              const fl = priceFlashRef.current;
              const age = nowMs - fl.ts;
              if (age < 300) {
                const yFlash = series.priceToCoordinate(fl.price);
                if (yFlash !== null) {
                  const k = 1 - age / 300;
                  ctx.save();
                  ctx.strokeStyle =
                    fl.dir >= 0 ? `rgba(34, 197, 94, ${(0.6 * k).toFixed(3)})` : `rgba(239, 68, 68, ${(0.6 * k).toFixed(3)})`;
                  ctx.lineWidth = 1.6;
                  ctx.shadowColor = fl.dir >= 0 ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)';
                  ctx.shadowBlur = 10 * k;
                  ctx.beginPath();
                  ctx.moveTo(0, yFlash);
                  ctx.lineTo(width, yFlash);
                  ctx.stroke();
                  ctx.restore();
                }
              }
            }
          }

          // Dopamin 1 (canvas içi): sinyal halo halkası — DOM katmanı yok
          {
            const pc = pulseCanvasRef.current;
            if (pc) {
              const ageP = Date.now() - pc.ts;
              if (ageP < 1500) {
                const k = 1 - ageP / 1500;
                ctx.save();
                ctx.strokeStyle = pc.dir === 'AL' ? `rgba(34,197,94,${(0.9 * k).toFixed(3)})` : `rgba(239,68,68,${(0.9 * k).toFixed(3)})`;
                ctx.shadowColor = pc.dir === 'AL' ? 'rgba(34,197,94,0.8)' : 'rgba(239,68,68,0.8)';
                ctx.shadowBlur = 18 * k;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(pc.x, pc.y, 10 + (1 - k) * 46, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                if (!pulseRedrawRef.current) {
                  pulseRedrawRef.current = true;
                  window.setTimeout(() => {
                    pulseRedrawRef.current = false;
                    drawOverlays();
                  }, 300);
                }
              }
            }
          }

          // Dopamin 4 — desen buluntu bandı: overlay aktifken giriş barından 20 barlık
          // sonuç penceresine yumuşak yeşil bant; yeni tespitte 1.2sn parlaklayarak gelir.
          if (patternOverlay && patternOverlay.events.length) {
            const tfSecP = intervalToSeconds(interval);
            const tscP = chart.timeScale();
            patternOverlay.events.slice(-3).forEach((ev) => {
              if (ev.timeframe !== interval) return;
              const t0 = Math.floor(ev.timestamp / 1000);
              const x1 = tscP.timeToCoordinate(t0 as Time);
              if (x1 === null) return;
              const x2 = tscP.timeToCoordinate((t0 + 20 * tfSecP) as Time) ?? x1 + 140;
              const gKey = `${ev.eventKey ?? t0}`;
              const glow = patternGlowRef.current.key === gKey ? Math.max(0, 1 - (Date.now() - patternGlowRef.current.ts) / 1200) : 0;
              ctx.fillStyle = `rgba(34, 197, 94, ${(0.08 + 0.18 * glow).toFixed(3)})`;
              ctx.fillRect(x1, 0, Math.max(20, x2 - x1), height);
              if (glow > 0 && !patternGlowRedrawRef.current) {
                patternGlowRedrawRef.current = true;
                window.setTimeout(() => {
                  patternGlowRedrawRef.current = false;
                  drawOverlays();
                }, 1250);
              }
            });
          }
        }
      }
    });
  }, [bidsBook, asksBook, heatmapFrames, settings, flowSnapshot, signals, activePatternStats, interval, symbol, symbolInfo, candles, patternOverlay]);

  // Sinyal glow: signals[0] degisince (mount/restore degil) sinyal barinin piksel
  // konumunda halo tetikle; 1.6sn sonra kendini temizler.
  useEffect(() => {
    const top = signals[0];
    if (!top) {
      lastTopSignalIdRef.current = null;
      return;
    }
    if (lastTopSignalIdRef.current === top.id) return;
    const first = lastTopSignalIdRef.current === null;
    lastTopSignalIdRef.current = top.id;
    if (first) return; // ilk render / DB restore — eski sinyal icin yanip sonme
    const chart = chartRef.current;
    const s = candleSeriesRef.current;
    if (!chart || !s) return;
    const x = chart.timeScale().timeToCoordinate(top.ts as Time);
    const y = s.priceToCoordinate(top.price);
    if (x === null || y === null) return;
    pulseCanvasRef.current = { x, y, dir: top.dir, ts: Date.now() };
    drawOverlays();
    pushTop({
      id: `sig-${top.id}`,
      kind: top.dir === 'AL' ? 'signal-al' : 'signal-sat',
      ts: Date.now(),
      text: `⚡ SİNYAL ${top.dir} @ ${top.price}${top.grade ? ` · ${top.grade}` : ''}`
    });
  }, [signals, drawOverlays, pushTop]);

  // ============ Sürekli haber bandı beslemeleri ============
  // Üst: fiyat tikleri (250ms throttle, yön + önceki tike göre %)
  useEffect(() => {
    const now = Date.now();
    const prev = lastTickPriceRef.current;
    if (prev === lastPrice) return;
    if (now - lastTickAtRef.current < 250) return;
    lastTickAtRef.current = now;
    lastTickPriceRef.current = lastPrice;
    const { text, kind } = priceTickText(lastPrice, prev, symbolInfo?.pricePrecision ?? 1);
    pushTop({ id: `tk-${now}-${lastPrice}`, kind, text, ts: now });
  }, [lastPrice, symbolInfo, pushTop]);

  // Üst: ~10sn'de bir OHLC özet kartı akışa karışır
  useEffect(() => {
    const t = setInterval(() => {
      const c = lastCandleRef.current;
      if (!c) return;
      const chg = c.open ? ((c.close - c.open) / c.open) * 100 : 0;
      const pr = symbolInfo?.pricePrecision ?? 1;
      pushTop({
        id: `sum-${Date.now()}`,
        kind: 'info',
        ts: Date.now(),
        text: `${symbol} · O ${fmtNum(c.open, pr)} H ${fmtNum(c.high, pr)} L ${fmtNum(c.low, pr)} C ${fmtNum(c.close, pr)} (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%) · V ${fmtCompact(c.volume)}`
      });
    }, 10000);
    return () => clearInterval(t);
  }, [symbol, symbolInfo, pushTop]);

  // Alt: ~2sn'de bir CVD/OBI/OI metrik satırı
  useEffect(() => {
    const t = setInterval(() => {
      const fs = fsSnapRef.current;
      pushBot({
        id: `mx-${Date.now()}`,
        kind: 'metrics',
        ts: Date.now(),
        text: metricsText(fs.cvd60, fs.obi, fs.oi, fs.oiChangePct)
      });
    }, 2000);
    return () => clearInterval(t);
  }, [pushBot]);

  // Alt: ~12sn'de bir işaret hatırlatması
  useEffect(() => {
    const t = setInterval(() => {
      pushBot({
        id: `hint-${Date.now()}`,
        kind: 'info',
        ts: Date.now(),
        text: `işaret: ışın=duvar ≥P${settings.wallPct || 90} · ⏱=yerleşik 30s+ · banda dokun=duraklat`
      });
    }, 12000);
    return () => clearInterval(t);
  }, [settings.wallPct, pushBot]);

  // Alt: likidasyon olayları
  useEffect(() => {
    if (!liquidations.length) return;
    const l = [...liquidations].sort((x, y) => y.ts - x.ts)[0];
    const key = `${l.ts}-${l.notional}`;
    if (liqSeenRef.current === key) return;
    liqSeenRef.current = key;
    const isLong = l.type === 'LONG_LIQ';
    pushBot({
      id: `liq-${key}`,
      kind: isLong ? 'liq-long' : 'liq-short',
      ts: Date.now(),
      text: `⚡ LİKİDASYON ${isLong ? 'LONG' : 'SHORT'} $${fmtCompact(l.notional)} @ ${l.price}`
    });
  }, [liquidations, pushBot]);

  // Alt: whale/spoof/sweep/absorption/delta akış kartları
  useEffect(() => {
    if (!flowEvents.length) return;
    const e = [...flowEvents].sort((x, y) => y.ts - x.ts)[0];
    if (flowEvtSeenRef.current === e.id) return;
    flowEvtSeenRef.current = e.id;
    const icon =
      e.type === 'WHALE' ? '🐋' : e.type === 'SPOOF' ? '👻' : e.type === 'SWEEP' ? '🌊' : e.type === 'ABSORPTION' ? '🛡' : e.type === 'DELTA_BURST' ? '💥' : '⚡';
    pushBot({ id: `fe-${e.id}`, kind: 'flow', ts: Date.now(), text: `${icon} ${e.text}` });
  }, [flowEvents, pushBot]);

  // Alt: kapanan barda hacim spike'ı (3x ortalama → altın bar)
  useEffect(() => {
    if (candles.length < 3) return;
    const i = candles.length - 2; // son KAPANAN bar
    const bar = candles[i];
    if (spikeBarRef.current === bar.time) return;
    spikeBarRef.current = bar.time;
    const vols = candles.map((x2) => x2.volume);
    if (!isVolumeSpike(vols, i)) return;
    const prev = vols.slice(Math.max(0, i - VOL_SPIKE_LOOKBACK), i);
    const mean = prev.reduce((x2, y2) => x2 + y2, 0) / prev.length;
    const ratio = mean > 0 ? bar.volume / mean : 0;
    pushBot({
      id: `spk-${bar.time}`,
      kind: 'spike',
      ts: Date.now(),
      text: `🔥 HACİM SPİKE ${fmtCompact(bar.volume)} · ${ratio.toFixed(1)}x ort · C ${bar.close}`
    });
  }, [candles, pushBot]);

  // Bant hızı (dopamin): volatilite/hacim arttıkça hızlanır — playbackRate ile,
  // animation-duration'a dokunulmaz → hız değişiminde görüntü sıçramaz.
  const volRatio = useMemo(() => {
    const vols = candles.slice(-21, -1).map((x2) => x2.volume);
    const lastV = candles.length ? candles[candles.length - 1].volume : 0;
    const mean = vols.length ? vols.reduce((x2, y2) => x2 + y2, 0) / vols.length : 0;
    return mean > 0 ? lastV / mean : 1;
  }, [candles]);
  const tickerHype = useMemo(
    () => computeHype(flowSnapshot.rangePct, flowSnapshot.atrPct, volRatio),
    [flowSnapshot.rangePct, flowSnapshot.atrPct, volRatio]
  );
  useEffect(() => {
    for (const ref of [topTrackRef, botTrackRef]) {
      const el = ref.current;
      if (!el || typeof el.getAnimations !== 'function') continue;
      for (const a of el.getAnimations()) {
        try {
          a.playbackRate = Math.max(0.1, tickerHype);
        } catch {}
      }
    }
  }, [tickerHype]);
  const setTickerRunning = useCallback((run: boolean) => {
    setTickerPaused(!run);
    for (const ref of [topTrackRef, botTrackRef]) {
      const el = ref.current;
      if (!el || typeof el.getAnimations !== 'function') continue;
      for (const a of el.getAnimations()) {
        try {
          if (run) a.play();
          else a.pause();
        } catch {}
      }
    }
  }, []);


  // Dopamin 4: overlay set edilirken (yeni tespit/kullanici acilisi) glow damgasi
  useEffect(() => {
    if (!patternOverlay?.events.length) return;
    const ev = patternOverlay.events[patternOverlay.events.length - 1];
    patternGlowRef.current = { key: `${ev.eventKey ?? Math.floor(ev.timestamp / 1000)}`, ts: Date.now() };
    drawOverlays();
  }, [patternOverlay, drawOverlays]);

  // Clean up RAF on unmount
  useEffect(() => {
    return () => {
      if (overlayRafRef.current) {
        cancelAnimationFrame(overlayRafRef.current);
      }
    };
  }, []);

  // Subscribe chart timeScale to redraw canvas overlays on pan/zoom
  useEffect(() => {
    if (!chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const handleRangeChange = () => drawOverlays();
    ts.subscribeVisibleLogicalRangeChange(handleRangeChange);
    // P2: aplikasyon one donunce canvas guncel cizilsin (arkadayken atlandi)
    const onVis = () => {
      if (!document.hidden) drawOverlays();
    };
    document.addEventListener('visibilitychange', onVis);
    drawOverlays();
    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [drawOverlays]);

  const toggleInd = (key: keyof AppSettings) => {
    if (onUpdateSetting) {
      onUpdateSetting(key, !settings[key]);
    }
  };

  // Akış rozetleri (yan sütun): likidasyon + flow olayları, yeniden eskiye
    // Bant öğeleri: tür -> renk sınıfı (canvas dışı DOM bantları)
    const tickerKindCls = (k: TickerKind): string =>
      k === 'up'
        ? 'text-emerald-400'
        : k === 'down'
          ? 'text-rose-400'
          : k === 'flat'
            ? 'text-slate-400'
            : k === 'signal-al'
              ? 'text-emerald-300 font-bold bg-emerald-500/15 border border-emerald-500/40'
              : k === 'signal-sat'
                ? 'text-rose-300 font-bold bg-rose-500/15 border border-rose-500/40'
                : k === 'liq-long'
                  ? 'text-rose-400 font-bold'
                  : k === 'liq-short'
                    ? 'text-emerald-400 font-bold'
                    : k === 'wall'
                      ? 'text-amber-300 font-bold'
                      : k === 'spike'
                        ? 'text-yellow-300 font-bold'
                        : k === 'flow'
                          ? 'text-purple-300'
                          : k === 'metrics'
                            ? 'text-cyan-300'
                            : 'text-slate-500';

    const renderTickerHalf = (items: TickerItem[], hidden: boolean) => (
      <span className="ticker-half" aria-hidden={hidden || undefined}>
        {items.length ? (
          items.map((it) => (
            <span key={it.id} className={`tick-flash ${tickerKindCls(it.kind)}`}>
              {it.text}
            </span>
          ))
        ) : (
          <span className="text-slate-600">akış bekleniyor…</span>
        )}
      </span>
    );


  const flowChips = [
    ...liquidations.slice(0, 6).map((l) => ({
      k: `liq-${l.ts}-${l.notional}`,
      ts: l.ts,
      icon: '⚡',
      txt: `${(l.notional / 1e3).toFixed(0)}k`,
      cls: l.side === 'BUY' ? 'text-rose-400' : 'text-emerald-400',
      tip: `Likidasyon ${l.side === 'BUY' ? 'LONG' : 'SHORT'} $${(l.notional / 1e3).toFixed(0)}k @ ${l.price}`
    })),
    ...flowEvents
      .filter((e) => e.type === 'WHALE' || e.type === 'SPOOF' || e.type === 'SWEEP' || e.type === 'ABSORPTION' || e.type === 'DELTA_BURST')
      .slice(0, 6)
      .map((e) => ({
        k: e.id,
        ts: e.ts,
        icon: e.type === 'WHALE' ? '🐋' : e.type === 'SPOOF' ? '👻' : e.type === 'SWEEP' ? '🌊' : e.type === 'ABSORPTION' ? '🛡' : '💥',
        txt: '',
        cls:
          e.type === 'SPOOF'
            ? 'text-pink-400'
            : e.type === 'ABSORPTION'
              ? 'text-cyan-400'
              : e.type === 'DELTA_BURST'
                ? 'text-purple-400'
                : 'text-amber-400',
        tip: e.text
      }))
  ]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 9);

  const chromeBar = (
    <>
      {/* Timeframe & Indicator Quick Bar (Two-Row Mobile-First Design) */}
      <div className="border-b border-[#1f252e] bg-[#12161c] divide-y divide-[#1a2028] shrink-0">
        {/* Row 1: Timeframes + Fullscreen Action */}
        <div className="h-9 px-2 sm:px-3 flex items-center justify-between gap-2">
          {/* Timeframes */}
          <div className="flex items-center gap-1">
            {TFS.map((tf) => (
              <button
                key={tf}
                onClick={() => onSelectInterval(tf)}
                className={`px-2.5 py-1 rounded-md font-mono text-xs font-bold transition-all touch-manipulation active:scale-95 ${
                  interval === tf
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-[#181d24]'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>


          {/* Mini Symbol Grid Toggle */}
          {onToggleMini && (
            <button
              onClick={onToggleMini}
              className={`px-2.5 py-1 rounded-md border flex items-center gap-1 text-xs font-mono font-bold transition-all touch-manipulation active:scale-95 ${
                miniOn
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200 bg-[#161b22] border-[#22272e]'
              }`}
              title="Mini sembol grid'i aç/kapat"
              aria-label="Mini sembol gridini aç veya kapat"
              aria-pressed={!!miniOn}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="text-[10px] hidden sm:inline">MINI</span>
            </button>
          )}

          {/* Fullscreen Trigger */}
          <button
            onClick={handleFullscreenToggle}
            className={`px-2.5 py-1 rounded-md border flex items-center gap-1 text-xs font-mono font-bold transition-all touch-manipulation active:scale-95 ${
              isFullscreen
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                : 'text-slate-400 hover:text-slate-200 bg-[#161b22] border-[#22272e]'
            }`}
            title={isFullscreen ? 'Tam Ekrandan Çık (Esc)' : 'Tam Ekran Grafik Modu'}
            aria-label={isFullscreen ? 'Tam Ekrandan Çık' : 'Tam Ekran Grafik Modu'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span className="text-[10px] hidden sm:inline">{isFullscreen ? 'Kapat' : 'Genişlet'}</span>
          </button>
        </div>

        {/* Row 2: Scrollable Indicator Pills (With Fade Mask & Smooth Touch Scroll) */}
        <div className="relative">
        <div
          ref={pillsRef}
          className="h-8 px-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar mask-fade-right text-xs font-mono"
        >
          <button
            onClick={() => toggleInd('showMa')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showMa
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="Moving Averages (MA 9/21/50)"
            aria-label="Moving Averages (MA 9/21/50)"
            aria-pressed={settings.showMa}
          >
            MA 9/21/50
          </button>

          <button
            onClick={() => toggleInd('showSar')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showSar
                ? 'font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            style={
              settings.showSar
                ? { color: settings.sarColor, borderColor: `${settings.sarColor}66`, background: `${settings.sarColor}22` }
                : undefined
            }
            title="Parabolic SAR"
            aria-label="Parabolic SAR"
            aria-pressed={settings.showSar}
          >
            SAR
          </button>

          <button
            onClick={() => toggleInd('showVwap')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showVwap
                ? 'bg-orange-500/20 text-orange-300 border-orange-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="VWAP"
            aria-label="VWAP"
            aria-pressed={settings.showVwap}
          >
            VWAP
          </button>

          <button
            onClick={() => toggleInd('showHeatmap')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showHeatmap
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="Likidite Isı Haritası (Heatmap)"
            aria-label="Likidite Isı Haritası (Heatmap)"
            aria-pressed={settings.showHeatmap}
          >
            HEATMAP
          </button>

          <button
            onClick={() => toggleInd('showLadder')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showLadder
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="DOM Ladder & Duvarlar"
            aria-label="DOM Ladder & Duvarlar"
            aria-pressed={settings.showLadder}
          >
            DOM LADDER
          </button>

          <button
            onClick={() => toggleInd('showMfeMae')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showMfeMae
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="MFE/MAE Yörünge Vektörleri"
            aria-label="MFE/MAE Yörünge Vektörleri"
            aria-pressed={settings.showMfeMae}
          >
            MFE/MAE
          </button>

          <button
            onClick={() => toggleInd('showBB')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showBB
                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="Bollinger Bands"
            aria-label="Bollinger Bands"
            aria-pressed={settings.showBB}
          >
            BB
          </button>

          <button
            onClick={() => toggleInd('showRsi')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showRsi
                ? 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="RSI Oscillator"
            aria-label="RSI Oscillator"
            aria-pressed={settings.showRsi}
          >
            RSI
          </button>

          <button
            onClick={() => toggleInd('showMacd')}
            className={`px-2.5 py-1.5 leading-none min-h-[28px] flex items-center rounded-md border text-[11px] font-bold shrink-0 transition-colors touch-manipulation ${
              settings.showMacd
                ? 'bg-teal-500/20 text-teal-300 border-teal-500/40 font-bold'
                : 'text-slate-500 border-[#22272e] hover:text-slate-300'
            }`}
            title="MACD"
            aria-label="MACD"
            aria-pressed={settings.showMacd}
          >
            MACD
          </button>
        </div>

          {/* Madde 3: kaydırılabilir ipucu — sağda içerik varsa ▸ */}
          {!pillsAtEnd && (
            <button
              onClick={() => pillsRef.current?.scrollBy({ left: 240, behavior: 'smooth' })}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-7 px-1.5 flex items-center bg-gradient-to-l from-[#12161c] via-[#12161c] to-transparent text-slate-400 touch-manipulation active:scale-95"
              aria-label="Göstergeleri sağa kaydır"
              title="Daha fazla gösterge (kaydırılabilir)"
            >
              ▸
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <div
      ref={chartWrapperRef}
      className={`flex-1 flex flex-col min-h-0 bg-[#0d1117] relative select-none w-full ${
        isFullscreen ? 'fixed inset-0 z-50 h-[100dvh] w-full' : 'h-full'
      }`}
    >
      {!isFullscreen && chromeBar}

      {/* ÜST HABER BANDI (canvas dışı, h-6): SOLDA SABİT blok (nabız + OHLC okuması + ⏱ + LİKİDİTE lejantı) + SAĞDA sürekli kayan fiyat/sinyal akışı — iki ayrı flex öğesi, chart'a değmiyor */}
      <div className="h-6 shrink-0 border-b border-[#1f252e] bg-[#0d1117] flex items-center gap-1.5 px-1.5">
        {isFullscreen && onToggleFullscreen && (
          <button
            onClick={onToggleFullscreen}
            className="shrink-0 bg-[#161b22] border border-[#22272e] rounded-md px-2 py-1 text-[11px] font-mono font-bold text-slate-300 touch-manipulation active:scale-95"
            aria-label="Tam ekrandan çık"
            title="Tam ekrandan çık (geri tuşu da çalışır)"
          >
            ↙
          </button>
        )}
        {isFullscreen && onSelectSymbol && (
          <div className="relative shrink-0">
            <button
              onClick={() => {
                setFsSymOpen((v) => !v);
                setFsQuery('');
              }}
              aria-haspopup="listbox"
              aria-expanded={fsSymOpen}
              className="bg-[#161b22] border border-[#22272e] rounded-md px-2 py-1 text-[11px] font-mono font-bold text-slate-200 touch-manipulation active:scale-95"
            >
              {symbol} <span className="text-slate-500 text-[8px]">▼</span>
            </button>
            {fsSymOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-56 bg-[#14181f] border border-[#2a333f] rounded-xl shadow-2xl z-50 overflow-hidden">
                <input
                  autoFocus
                  value={fsQuery}
                  onChange={(e) => setFsQuery(e.target.value)}
                  placeholder="Coin ara"
                  aria-label="Coin ara"
                  className="w-full bg-[#181e26] border-b border-[#2b3542] px-3 py-2 text-xs font-mono uppercase outline-none text-slate-100 placeholder-slate-500"
                />
                <div role="listbox" aria-label="Sembol sonuçları" className="max-h-56 overflow-y-auto divide-y divide-[#1e242d]">
                  {(symbols || [])
                    .filter((q) => q.toLowerCase().includes(fsQuery.toLowerCase()))
                    .slice(0, 8)
                    .map((sym) => (
                      <div
                        key={sym}
                        role="option"
                        aria-selected={sym === symbol}
                        onClick={() => {
                          onSelectSymbol(sym);
                          setFsSymOpen(false);
                        }}
                        className={`px-3 py-2.5 text-xs font-mono cursor-pointer hover:bg-[#1c222b] touch-manipulation ${sym === symbol ? 'text-emerald-400 font-bold' : 'text-slate-300'}`}
                      >
                        {sym}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Dopamin 5 — canlı veri nabzı */}
        <div
          className="flex items-center gap-1.5 shrink-0 select-none"
          title={wsMessage || (wsConnected ? 'Canlı veri akışı aktif' : 'Yeniden bağlanıyor…')}
        >
          <span className="relative flex h-2.5 w-2.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                wsConnected ? 'fs-live-dot' : wsMessage ? 'bg-amber-400' : 'bg-rose-500'
              }`}
            />
          </span>
          <span className={`text-[10px] font-bold ${wsConnected ? 'text-emerald-400' : 'text-slate-500'}`}>
            {wsConnected ? 'CANLI' : wsMessage ? 'REST' : 'OFFLINE'}
          </span>
        </div>
        {/* SABİT OHLC okuması: crosshair hover ?? son mum — bantta durur, akışa karışmaz */}
        {(() => {
          const b = hoverBar ?? (lastCandleRef.current
            ? { time: lastCandleRef.current.time, o: lastCandleRef.current.open, h: lastCandleRef.current.high, l: lastCandleRef.current.low, c: lastCandleRef.current.close, vol: lastCandleRef.current.volume }
            : null);
          if (!b) return null;
          const up = b.c >= b.o;
          const chg = b.o ? ((b.c - b.o) / b.o) * 100 : 0;
          const pr = symbolInfo?.pricePrecision ?? 1;
          const volTxt = b.vol != null ? fmtCompact(b.vol) : '—';
          return (
            <>
              <span className="hidden sm:flex items-center gap-1.5 shrink-0 text-[11px] font-mono text-slate-500 whitespace-nowrap">
                <span>{new Date(b.time * 1000).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
                <span>O <span className="text-slate-300">{fmtNum(b.o, pr)}</span></span>
                <span>H <span className="text-slate-300">{fmtNum(b.h, pr)}</span></span>
                <span>L <span className="text-slate-300">{fmtNum(b.l, pr)}</span></span>
                <span className={up ? 'text-emerald-400' : 'text-rose-400'}>C {fmtNum(b.c, pr)} ({up ? '+' : ''}{chg.toFixed(2)}%)</span>
                <span>V <span className="text-slate-300">{volTxt}</span></span>
              </span>
              <span className={`sm:hidden shrink-0 text-[11px] font-mono font-bold ${up ? 'text-emerald-400' : 'text-rose-400'}`}>
                {fmtNum(b.c, pr)} {up ? '▲' : '▼'}{Math.abs(chg).toFixed(2)}%
              </span>
            </>
          );
        })()}
        {countdown !== null && (
          <span className={`shrink-0 text-[11px] font-mono font-bold ${countdown <= 10 ? 'text-amber-400' : 'text-slate-400'}`}>
            ⏱ {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
          </span>
        )}
        {/* LİKİDİTE lejantı (SABİT, akmaz — lg+ ekranda): işaret açıklaması */}
        <div className="hidden lg:flex items-center gap-1 shrink-0 text-[11px] font-mono text-slate-500 whitespace-nowrap" title="LİKİDİTE işaretleri">
          <b className="text-emerald-400">▲ BID</b>
          <b className="text-rose-400">▼ ASK</b>
          <span>· ışın=duvar ≥P{settings.wallPct || 90} · ⏱=yerleşik 30s+</span>
        </div>
        {/* KAYAN AKIŞ (bant sağı): fiyat tikleri + sinyal kartları */}
        <div
          className={`ticker ${tickerPaused ? 'paused' : ''}`}
          onPointerDown={() => setTickerRunning(false)}
          onPointerUp={() => setTickerRunning(true)}
          onPointerCancel={() => setTickerRunning(true)}
          onPointerLeave={() => setTickerRunning(true)}
          title="Banda dokun = duraklat, bırak = kaldığı hızdan devam"
        >
          <div ref={topTrackRef} className="ticker-track text-[11px] font-mono">
            {renderTickerHalf(topTicker, false)}
            {renderTickerHalf(topTicker, true)}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-row">
      {/* Main Chart Canvas Area */}
      <div className="chart-wrap flex-1 relative min-h-0 w-full h-full overflow-hidden" ref={containerRef}>
        {/* chart-wrap = YALNIZCA canvas'lar: fiyat/hacim (lightweight-charts, containerRef'e runtime enjekte) + heatmap z-10 + domOverlay z-20. Metin/bant/rozet canvas üstünde DOM yok. */}
        <canvas
          ref={heatmapCanvasRef}
          className="absolute inset-0 pointer-events-none z-10 opacity-70 mix-blend-screen"
        />

        {/* DOM Ladder & Liquidity Wall Canvas */}
        <canvas
          ref={domOverlayCanvasRef}
          className="absolute inset-0 pointer-events-none z-20"
        />

      </div>
        {/* Akış rozetleri (canvas'ın YANI): ⚡/👻/🐋 mumların üstünde değil yanında */}
        <div className="flex w-12 shrink-0 flex-col gap-1 p-1 border-l border-[#1f252e] bg-[#0d1117] overflow-hidden">
          {flowChips.map((c) => (
            <span key={c.k} title={c.tip} className={`text-[10px] font-mono font-bold leading-tight ${c.cls}`}>
              {c.icon}{c.txt}
            </span>
          ))}
        </div>
      </div>

      {/* ALT HABER BANDI (canvas dışı, h-6): CVD/OBI/OI + duvar + spike/likidasyon akışı — durmadan akar, dokun = duraklat */}
      <div className="h-6 shrink-0 border-t border-[#1f252e] bg-[#0d1117] flex">
        <div
          className={`ticker ${tickerPaused ? 'paused' : ''}`}
          onPointerDown={() => setTickerRunning(false)}
          onPointerUp={() => setTickerRunning(true)}
          onPointerCancel={() => setTickerRunning(true)}
          onPointerLeave={() => setTickerRunning(true)}
          title="Banda dokun = duraklat, bırak = kaldığı hızdan devam"
        >
          <div ref={botTrackRef} className="ticker-track text-[11px] font-mono">
            {renderTickerHalf(botTicker, false)}
            {renderTickerHalf(botTicker, true)}
          </div>
        </div>
      </div>
    </div>
  );
};
