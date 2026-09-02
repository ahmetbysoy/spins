'use client';

// Mini Sembol Kartı — mini grid için hafif mum grafiği (REST 15s yenileme, WS yok).
// Tıklanınca sembol ana pane taşınır (swap). Ağır orderflow katmanları içermez.
import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from 'lightweight-charts';
import { X } from 'lucide-react';
import { Candle, Ticker24h } from '@/lib/types';
import { fetchKlines } from '@/lib/binance';

interface MiniChartCardProps {
  symbol: string;
  interval: string;
  tickers: Ticker24h[];
  isActive: boolean;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}

const POLL_MS = 15000;
const KLINE_LIMIT = 150;

export const MiniChartCard: React.FC<MiniChartCardProps> = ({
  symbol,
  interval,
  tickers,
  isActive,
  onSelect,
  onRemove
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const ticker = tickers.find((t) => t.symbol === symbol);
  const change = ticker?.priceChangePercent ?? 0;

  // Grafik kurulumu (bir kez)
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b949e',
        fontSize: 9,
        attributionLogo: false
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: 'rgba(34, 39, 46, 0.35)' }
      },
      rightPriceScale: { visible: false },
      timeScale: { visible: false, borderVisible: false },
      handleScale: false,
      handleScroll: false,
      crosshair: { mode: 0 }
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350'
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Veri çekme + yenileme (sembol/TF değişince yeniden)
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      // P2: kart arka plandayken poll atlanir (batarya); one donunce en gec 15sn sonra tazelenir
      if (typeof document !== 'undefined' && document.hidden) {
        if (!stopped) timer = setTimeout(load, POLL_MS);
        return;
      }
      try {
        const candles: Candle[] = await fetchKlines(symbol, interval, KLINE_LIMIT);
        if (stopped) return;
        if (candles.length) {
          seriesRef.current?.setData(
            candles.map((c) => ({
              time: c.time as UTCTimestamp,
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close
            }))
          );
          chartRef.current?.timeScale().fitContent();
          setError(false);
          setLoaded(true);
        }
      } catch {
        if (!stopped) setError(true);
      } finally {
        if (!stopped) timer = setTimeout(load, POLL_MS);
      }
    };

    setLoaded(false);
    load();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [symbol, interval]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(symbol)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSelect(symbol);
      }}
      aria-label={`${symbol} grafiğini ana pane taşı`}
      className={`relative rounded-lg border overflow-hidden cursor-pointer transition-all touch-manipulation active:scale-[0.98] flex flex-col ${
        isActive
          ? 'border-emerald-500/50 bg-[#101820]'
          : 'border-[#22272e] bg-[#10141b] hover:border-[#33404e]'
      }`}
    >
      {/* Başlık satırı */}
      <div className="flex items-center justify-between gap-1 px-1.5 pt-1 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] font-bold font-mono text-slate-200 truncate">{symbol.replace('USDT', '')}</span>
          <span className="text-[8px] text-slate-500 font-mono">{interval}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <span
            className={`text-[9px] font-bold font-mono ${
              change >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {change >= 0 ? '+' : ''}
            {change.toFixed(2)}%
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRemove(symbol);
            }}
            className="text-slate-600 hover:text-rose-400 px-1 min-h-[28px] leading-none"
            aria-label={`${symbol} kartını kaldır`}
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Mini grafik */}
      <div ref={containerRef} className="flex-1 min-h-0 w-full" />
      {!loaded && !error && (
        <div className="absolute inset-0 top-5 flex items-center justify-center text-[9px] text-slate-600 font-mono">
          yükleniyor…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 top-5 flex items-center justify-center text-[9px] text-slate-500 font-mono">
          veri alınamadı · {POLL_MS / 1000}sn{`'`}de tekrar
        </div>
      )}
    </div>
  );
};
