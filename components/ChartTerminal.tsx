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
  type LineWidth
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

  // Overlay Canvases
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null);
  // Likidite overlay legend'i (kapatilabilir; tercih localStorage'da)
  const [legendOpen, setLegendOpen] = useState(true);
  const [fsSymOpen, setFsSymOpen] = useState(false);
  // Android geri tusu: sembol aramayi kapatir (tam ekrandan once)
  useAndroidBack(fsSymOpen, () => setFsSymOpen(false));
  const [fsQuery, setFsQuery] = useState('');
  useEffect(() => {
    try {
      setLegendOpen(localStorage.getItem('fs_legend_closed') !== 'true');
    } catch {}
  }, []);

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
        mode: 0
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#2a3038'
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
        const volColor = last.close >= last.open ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)';
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
        const volData: HistogramData<Time>[] = settings.showVol
          ? candles.map((c) => ({
              time: c.time as Time,
              value: c.volume,
              color: c.close >= c.open ? 'rgba(38, 166, 154, 0.4)' : 'rgba(239, 83, 80, 0.4)'
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

  useEffect(() => {
    if (!chartRef.current || !candleSeriesRef.current) return;

    const markers: SeriesMarker<Time>[] = [];
    const tfSec = intervalToSeconds(interval);

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

    // Liquidations
    if (settings.showLiq) {
      liquidations.slice(-20).forEach((liq) => {
        markers.push({
          time: snapToBarTime(liq.ts, tfSec) as Time,
          position: liq.side === 'BUY' ? 'belowBar' : 'aboveBar',
          color: liq.side === 'BUY' ? '#ef5350' : '#26a69a',
          shape: 'circle',
          text: `⚡${(liq.notional / 1e3).toFixed(0)}k`
        });
      });
    }

    // Whale / Flow Events (WHALE, SWEEP, DELTA_BURST, ABSORPTION) + SPOOF (birleşik marker)
    if (settings.whaleAlerts) {
      flowEvents
        .filter((e) => e.type === 'WHALE' || e.type === 'SWEEP' || e.type === 'DELTA_BURST' || e.type === 'ABSORPTION')
        .slice(-15)
        .forEach((w) => {
          const isBuy = w.side === 'buy';
          markers.push({
            time: snapToBarTime(w.ts, tfSec) as Time,
            position: isBuy ? 'belowBar' : 'aboveBar',
            color:
              w.type === 'ABSORPTION'
                ? '#06b6d4'
                : w.type === 'DELTA_BURST'
                  ? '#a855f7'
                  : isBuy
                    ? '#10b981'
                    : '#f59e0b',
            shape: 'square',
            text:
              w.type === 'ABSORPTION'
                ? '🛡️ABSORB'
                : w.type === 'DELTA_BURST'
                  ? '💥BURST'
                  : `🐋${w.type}`
          });
        });

      // SPOOF spam fix: ayni bara dusen eventler tek marker'da birlesir (xN sayaci),
      // 3 barlik pencerede en fazla 1 marker, metin sadece '👻' ('SPOOF' kelimesi yok).
      const spoofByBar = new Map<number, { buys: number; sells: number }>();
      flowEvents
        .filter((e) => e.type === 'SPOOF')
        .forEach((e) => {
          const bt = snapToBarTime(e.ts, tfSec);
          const cur = spoofByBar.get(bt) || { buys: 0, sells: 0 };
          if (e.side === 'buy') cur.buys++;
          else cur.sells++;
          spoofByBar.set(bt, cur);
        });
      let lastKeptSpoofBar = Infinity;
      [...spoofByBar.entries()]
        .sort((a, b) => b[0] - a[0]) // yeni -> eski
        .forEach(([bt, agg]) => {
          if (lastKeptSpoofBar - bt < 3 * tfSec) return; // son 3 bar icinde maks 1 SPOOF marker
          lastKeptSpoofBar = bt;
          const n = agg.buys + agg.sells;
          markers.push({
            time: bt as Time,
            position: agg.sells >= agg.buys ? 'aboveBar' : 'belowBar',
            color: '#ec4899',
            shape: 'circle',
            text: n > 1 ? `👻×${n}` : '👻'
          });
        });
    }

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
                if (x > width - axisWHm - 52) return;
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
      if (domOverlayCanvasRef.current && settings.showLadder) {
        const cv = domOverlayCanvasRef.current;
        const ctx = cv.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, width, height);

          // Dinamik fiyat ekseni genisligi (sembol hassasiyetine gore; sabit 58px yerine)
          const axisWidth = Math.max(58, chart.priceScale('right').width?.() ?? 58);
          const chartRight = width - axisWidth;
          const ladderWidth = 52;
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
            const now = Date.now();
            const activeKeys = new Set<string>();
            const rayStart = Math.max(0, chartRight - ladderWidth - 65);
            const wallRecs = new Map<LiquidityWall, WallAgeRecord>();

            // PREDATOR port'u (3/4) — placeLabelY koordinatörü: tüm canvas etiketleri tek
            // noktadan yerleşir. Blokeli bölgeler: üst sabit UI (legend/tam ekran sembol
            // seçici), canlı mid fiyat, alt bölge ve native marker'lı barlar (dünkü
            // 12px-shift hack'inin genel hali — etiket x-bandına düşen markerlar).
            const blockedZones: [number, number][] = [[0, isFullscreen ? 58 : 36], [height - 64, height]];
            if (flowSnapshot.bestBid && flowSnapshot.bestAsk) {
              const bbY = series.priceToCoordinate(flowSnapshot.bestBid);
              const baY = series.priceToCoordinate(flowSnapshot.bestAsk);
              if (bbY !== null && baY !== null) {
                const midY = (bbY + baY) / 2;
                blockedZones.push([midY - 12, midY + 14]);
              }
            }
            {
              const tfSecL = intervalToSeconds(interval);
              const candleByTime = new Map(candles.map((c) => [c.time, c] as const));
              const mtimes: number[] = [];
              if (settings.showLiq) liquidations.slice(-20).forEach((l) => mtimes.push(snapToBarTime(l.ts, tfSecL)));
              if (settings.whaleAlerts) flowEvents.slice(-15).forEach((e) => mtimes.push(snapToBarTime(e.ts, tfSecL)));
              signals.forEach((s) => mtimes.push(s.ts));
              const tsc = chart.timeScale();
              for (const t of mtimes) {
                const x = tsc.timeToCoordinate(t as Time);
                const c = candleByTime.get(t);
                const y = c ? series.priceToCoordinate(c.close) : null;
                if (x !== null && y !== null && x >= rayStart - 24 && x <= chartRight) blockedZones.push([y - 12, y + 12]);
              }
            }
            const placeLabelY = (base: number, takenList: number[]): number | null => {
              let y = Math.max(10, Math.min(height - 6, base + 3));
              for (let step = 0; step < 7; step++) {
                const cand = y + step * 12;
                const hit =
                  takenList.some((v) => Math.abs(v - cand) < 12) ||
                  blockedZones.some(([a, b]) => cand >= a && cand <= b);
                if (!hit && cand < height - 8) return cand;
              }
              return null; // yer yok → etiket hiç çizilmez (PREDATOR davranışı)
            };
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
            }
            // PREDATOR etiket seçimi: notional × (1 + dakika yaşı, tavan 3x) sıralı,
            // maks 10 etiket; sağa hizalı pill, ölçüm genişliği sığmıyorsa çizilmez.
            const labelX = chartRight - ladderWidth - 8;
            const taken: number[] = [];
            walls
              .slice()
              .sort((a, b) => {
                const ageMin = (w: LiquidityWall) => {
                  const r = wallRecs.get(w);
                  return r ? Math.min(3, (now - r.first) / 60000) : 0;
                };
                return b.notional * (1 + ageMin(b)) - a.notional * (1 + ageMin(a));
              })
              .slice(0, 10)
              .forEach((wall) => {
                const rec = wallRecs.get(wall);
                if (!rec) return;
                if (taken.some((y) => Math.abs(y - wall.y) < 12)) return;
                const established = now - rec.first >= WALL_ESTABLISHED_MS;
                const rgb = wall.side === 'B' ? '38, 166, 154' : '239, 83, 80';
                const label =
                  (wall.notional >= 1e6 ? `$${(wall.notional / 1e6).toFixed(1)}M` : `$${(wall.notional / 1e3).toFixed(0)}k`) +
                  (established ? ' ⏱' : '');
                ctx.font = (established ? 'bold ' : '') + '11px monospace';
                ctx.textAlign = 'right';
                const tw = ctx.measureText(label).width;
                const placed = placeLabelY(wall.y, taken);
                if (placed === null || tw + 8 > labelX) return;
                ctx.fillStyle = 'rgba(5,5,8,.78)';
                ctx.fillRect(labelX - tw - 4, placed - 9, tw + 8, 12);
                ctx.fillStyle = `rgba(${rgb},.95)`;
                ctx.fillText(label, labelX, placed);
                taken.push(placed);
              });
            ctx.textAlign = 'left';

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
          }
        }
      }
    });
  }, [bidsBook, asksBook, heatmapFrames, settings, flowSnapshot, signals, activePatternStats, interval, symbol, symbolInfo, candles, flowEvents, liquidations, isFullscreen]);

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

  return (
    <div
      ref={chartWrapperRef}
      className={`flex-1 flex flex-col min-h-0 bg-[#0d1117] relative select-none w-full ${
        isFullscreen ? 'fixed inset-0 z-50 h-[100dvh] w-full' : 'h-full'
      }`}
    >
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
        <div className="h-8 px-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar mask-fade-right text-xs font-mono">
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
      </div>

      {/* Main Chart Canvas Area */}
      <div className="chart-wrap flex-1 relative min-h-0 w-full h-full overflow-hidden" ref={containerRef}>
        {/* Heatmap Canvas */}
        <canvas
          ref={heatmapCanvasRef}
          className="absolute inset-0 pointer-events-none z-10 opacity-70 mix-blend-screen"
        />

        {/* DOM Ladder & Liquidity Wall Canvas */}
        <canvas
          ref={domOverlayCanvasRef}
          className="absolute inset-0 pointer-events-none z-20"
        />

        {/* Fullscreen Kompakt Sembol Seçici */}
        {isFullscreen && onSelectSymbol && (
          <div className="absolute top-2 left-2 z-30 select-none flex items-start gap-1.5">
            {/* P0: mobilde tam ekrandan cikis gorebilir (geri tusu da calisir) */}
            <button
              onClick={onToggleFullscreen}
              aria-label="Tam ekrandan çık"
              title="Tam ekrandan çık"
              className="bg-[#0d1117]/85 border border-[#22272e] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-300 backdrop-blur-sm touch-manipulation active:scale-95"
            >
              ↙
            </button>
            <button
              onClick={() => {
                setFsSymOpen((v) => !v);
                setFsQuery('');
              }}
              aria-haspopup="listbox"
              aria-expanded={fsSymOpen}
              className="bg-[#0d1117]/85 border border-[#22272e] rounded-lg px-2.5 py-1.5 text-xs font-mono font-bold text-slate-200 backdrop-blur-sm flex items-center gap-1.5 touch-manipulation active:scale-95"
            >
              {symbol}
              <span className={`text-slate-400 text-[9px] transition-transform ${fsSymOpen ? 'rotate-180' : ''}`}>▼</span>
            </button>
            {fsSymOpen && (
              <div className="absolute top-full left-0 mt-1.5 w-56 bg-[#14181f] border border-[#2a333f] rounded-xl shadow-2xl z-40 overflow-hidden">
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
                        className={`px-3 py-2.5 text-xs font-mono cursor-pointer hover:bg-[#1c222b] touch-manipulation ${
                          sym === symbol ? 'text-emerald-400 font-bold' : 'text-slate-300'
                        }`}
                      >
                        {sym}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Likidite Overlay Legend */}
        {legendOpen && (
          <div className={`absolute left-2 z-30 bg-[#0d1117]/85 border border-[#22272e] rounded-lg px-2.5 py-1.5 backdrop-blur-sm text-[10px] font-mono text-slate-400 flex items-center gap-2 select-none ${isFullscreen ? 'top-12' : 'top-2'}`}>
            <span className="text-slate-300 font-bold">LİKİDİTE</span>
            <span>
              <span className="text-emerald-400 font-bold">▲ BID</span>
              {' · '}
              <span className="text-rose-400 font-bold">▼ ASK</span>
            </span>
            <span>ışın=duvar ≥ P{settings.wallPct || 90}</span>
            <span>⏱ yerleşik 30s+</span>
            <button
              onClick={() => {
                setLegendOpen(false);
                try {
                  localStorage.setItem('fs_legend_closed', 'true');
                } catch {}
              }}
              className="text-slate-500 hover:text-slate-200 ml-1 px-2 min-h-[32px] touch-manipulation active:scale-95"
              aria-label="Açıklamayı kapat"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
