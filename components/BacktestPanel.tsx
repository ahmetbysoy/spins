'use client';

// Backtest Paneli — desen havuzundaki settled event'lerle interaktif performans analizi.
// Veri: IndexedDB 'events' store'u (canlı + backfill kurgular). Tüm hesap lib/backtest.ts'te (testli).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from 'lightweight-charts';
import { FlaskConical, RefreshCw, TrendingUp, TrendingDown, Trophy, Skull } from 'lucide-react';
import { PatternEvent } from '@/lib/types';
import { initPatternDB, dbAll, patternName } from '@/lib/pattern-engine';
import {
  buildEquityCurve,
  computeBacktestStats,
  filterBacktestEvents,
  monthlyBreakdown,
  patternBreakdown,
  rMultipleHistogram,
  type BacktestFilters
} from '@/lib/backtest';

type Tf = string;
type Coin = string;

const TF_OPTIONS = ['ALL', '1m', '3m', '5m', '15m', '30m', '1h'] as const;

function fmtPct(x: number, digits = 2): string {
  return `${x >= 0 ? '+' : ''}${x.toFixed(digits)}%`;
}

function fmtPf(pf: number | null): string {
  if (pf === null) return '∞';
  return pf.toFixed(2);
}

function heatColor(sum: number, maxAbs: number): string {
  if (!maxAbs || sum === 0) return 'bg-[#161b22] text-slate-500';
  const ratio = Math.min(1, Math.abs(sum) / maxAbs);
  if (sum > 0) return `bg-emerald-500/${Math.round(15 + ratio * 45)} text-emerald-300`;
  return `bg-rose-500/${Math.round(15 + ratio * 45)} text-rose-300`;
}

const selectCls =
  'bg-[#11151b] border border-[#2e3640] rounded-lg px-2 py-1.5 text-[11px] text-slate-200 font-mono outline-none focus:border-emerald-500 min-h-[32px]';

export const BacktestPanel: React.FC = () => {
  const [allEvents, setAllEvents] = useState<PatternEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [coin, setCoin] = useState<Coin | 'ALL'>('ALL');
  const [tf, setTf] = useState<Tf | 'ALL'>('ALL');
  const [dir, setDir] = useState<'ALL' | 'UP' | 'DOWN'>('ALL');
  const [sarBucket, setSarBucket] = useState<'ALL' | 'SAR0' | 'SAR1' | 'SAR2-3' | 'SARX'>('ALL');
  const [source, setSource] = useState<'ALL' | 'live' | 'backfill'>('ALL');
  const [winThr, setWinThr] = useState(0.15);

  const load = async () => {
    setLoading(true);
    try {
      await initPatternDB();
      const events = await dbAll<PatternEvent>('events');
      setAllEvents(events);
    } catch (e) {
      console.warn('Backtest load error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const coins = useMemo(() => {
    const set = new Set(allEvents.filter((e) => e.status === 'settled').map((e) => e.coin));
    return [...set].sort();
  }, [allEvents]);

  const filters: BacktestFilters = useMemo(
    () => ({ coin, timeframe: tf, dir, sarBucket, source }),
    [coin, tf, dir, sarBucket, source]
  );

  const events = useMemo(
    () => filterBacktestEvents(allEvents, filters),
    [allEvents, filters]
  );
  const stats = useMemo(() => computeBacktestStats(events, winThr), [events, winThr]);
  const months = useMemo(() => monthlyBreakdown(events, winThr), [events, winThr]);
  const patterns = useMemo(() => patternBreakdown(events, winThr), [events, winThr]);
  const hist = useMemo(() => rMultipleHistogram(events), [events]);
  const equity = useMemo(() => buildEquityCurve(events), [events]);

  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Grafiği bir kez kur
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 240,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8b949e',
        fontSize: 10,
        attributionLogo: false
      },
      grid: {
        vertLines: { color: 'rgba(34, 39, 46, 0.5)' },
        horzLines: { color: 'rgba(34, 39, 46, 0.5)' }
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: false },
      handleScale: false,
      handleScroll: false
    });
    const series = chart.addSeries(LineSeries, {
      color: '#26a69a',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
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

  // Veri güncellenince seriye bas (aynı saniyede tek değer: sonuncusu)
  useEffect(() => {
    if (!seriesRef.current) return;
    const dedup = new Map<number, number>();
    equity.forEach((p) => dedup.set(p.time, p.value));
    const data = [...dedup.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [equity]);

  const maxMonthAbs = Math.max(1, ...months.map((m) => Math.abs(m.sum)));
  const maxHist = Math.max(1, ...hist.map((h) => h.count));
  const topPatterns = patterns.filter((p) => p.n >= 5).slice(0, 5);
  const bottomPatterns = patterns.filter((p) => p.n >= 5).slice(-5).reverse();

  return (
    <div className="flex-1 overflow-y-auto p-2.5 sm:p-4 flex flex-col gap-3 sm:gap-4 max-w-6xl mx-auto w-full select-none">
      {/* Başlık & Filtreler */}
      <div className="card-surface p-3 sm:p-4 flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-purple-400 shrink-0" />
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-slate-100 tracking-wide">DESEN BACKTEST PANELİ</h2>
              <span className="text-[10px] text-slate-500 font-mono">
                {loading ? 'Yükleniyor…' : `${stats.n} settled kurgu · havuz: ${allEvents.length} kayıt`}
              </span>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#181d24] text-slate-300 hover:text-white border border-[#2a3038] disabled:opacity-40 transition-all min-h-[32px]"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            Yenile
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <select value={coin} onChange={(e) => setCoin(e.target.value)} className={selectCls} aria-label="Coin">
            <option value="ALL">Tüm Coinler</option>
            {coins.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select value={tf} onChange={(e) => setTf(e.target.value)} className={selectCls} aria-label="Periyot">
            {TF_OPTIONS.map((t) => (
              <option key={t} value={t}>{t === 'ALL' ? 'Tüm TF' : t}</option>
            ))}
          </select>
          <select value={dir} onChange={(e) => setDir(e.target.value as 'ALL')} className={selectCls} aria-label="Yön">
            <option value="ALL">AL+SAT</option>
            <option value="UP">Sadece AL</option>
            <option value="DOWN">Sadece SAT</option>
          </select>
          <select value={sarBucket} onChange={(e) => setSarBucket(e.target.value as 'ALL')} className={selectCls} aria-label="SAR">
            <option value="ALL">Tüm SAR</option>
            <option value="SAR0">SAR0 (anında)</option>
            <option value="SAR1">SAR1</option>
            <option value="SAR2-3">SAR2-3</option>
            <option value="SARX">SARX (geç)</option>
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value as 'ALL')} className={selectCls} aria-label="Kaynak">
            <option value="ALL">Canlı+Backfill</option>
            <option value="live">Sadece Canlı</option>
            <option value="backfill">Sadece Backfill</option>
          </select>
          <label className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
            Kazanç eşiği %
            <input
              type="number"
              min={0}
              max={2}
              step={0.05}
              value={winThr}
              onChange={(e) => setWinThr(Math.min(2, Math.max(0, parseFloat(e.target.value) || 0.15)))}
              className="w-14 bg-[#11151b] border border-[#2e3640] rounded px-1.5 py-1 text-center text-slate-200 outline-none focus:border-emerald-500"
            />
          </label>
        </div>
      </div>

      {stats.n === 0 ? (
        <div className="card-surface p-6 text-center text-xs text-slate-500">
          {loading
            ? 'Havuz okunuyor…'
            : 'Filtreye uyan settled kurgu yok. Grafik görünümü açık kaldıkça (ve radar tararken) desen havuzu dolar; ya da Havuz sekmesinden "Tarihsel Tara" çalıştır.'}
        </div>
      ) : (
        <>
          {/* Özet Kartları */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {[
              { label: 'İşlem', value: String(stats.n), tone: '' },
              { label: 'Win Rate', value: `%${stats.winRate.toFixed(1)}`, sub: `Wilson ≥ %${stats.wilsonLower.toFixed(1)}`, tone: stats.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400' },
              { label: 'Toplam ret10', value: fmtPct(stats.totalRet10, 1), tone: stats.totalRet10 >= 0 ? 'text-emerald-400' : 'text-rose-400' },
              { label: 'Ort. ret10', value: fmtPct(stats.avgRet10), sub: `σ ${stats.stdRet10.toFixed(2)}`, tone: stats.avgRet10 >= 0 ? 'text-emerald-400' : 'text-rose-400' },
              { label: 'Profit Factor', value: fmtPf(stats.profitFactor), sub: 'pos/neg', tone: (stats.profitFactor ?? 99) >= 1 ? 'text-emerald-400' : 'text-rose-400' },
              { label: 'Max Düşüş', value: `${stats.maxDrawdown.toFixed(1)}pp`, sub: `seri +${stats.bestStreak}/-${stats.worstStreak}`, tone: 'text-amber-400' }
            ].map((c) => (
              <div key={c.label} className="card-surface p-2.5 flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-500 font-semibold tracking-wide">{c.label}</span>
                <span className={`text-sm font-bold font-mono ${c.tone}`}>{c.value}</span>
                {c.sub && <span className="text-[9px] text-slate-500 font-mono">{c.sub}</span>}
              </div>
            ))}
          </div>

          {/* Equity Eğrisi */}
          <div className="card-surface p-3 sm:p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                KÜMÜLATİF ret10 EĞRİSİ
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                Ort. MFE +%{stats.avgMfe20.toFixed(2)} · Ort. MAE -%{stats.avgMae20.toFixed(2)} · Ort. R {stats.avgRMultiple.toFixed(2)}
              </span>
            </div>
            <div ref={containerRef} className="w-full h-[240px]" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            {/* Aylık Kırılım */}
            <div className="card-surface p-3 sm:p-4 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <TrendingDown className="w-4 h-4 text-amber-400 rotate-180" />
                AYLIK KIRILIM (toplam ret10)
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
                {months.map((m) => (
                  <div
                    key={m.ym}
                    className={`rounded-lg border border-[#22272e] p-2 flex flex-col ${heatColor(m.sum, maxMonthAbs)}`}
                    title={`${m.ym}: ${m.n} işlem, %${m.winRate.toFixed(0)} win rate`}
                  >
                    <span className="text-[10px] font-mono font-bold">{m.ym}</span>
                    <span className="text-xs font-mono font-bold">{fmtPct(m.sum, 1)}</span>
                    <span className="text-[9px] font-mono opacity-70">{m.n} işlem</span>
                  </div>
                ))}
              </div>
            </div>

            {/* R-Multiple Dağılımı */}
            <div className="card-surface p-3 sm:p-4 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <Trophy className="w-4 h-4 text-cyan-400" />
                R-MULTIPLE DAĞILIMI
              </div>
              <div className="flex items-end gap-1.5 h-[120px]">
                {hist.map((b) => (
                  <div key={b.label} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${b.label}: ${b.count}`}>
                    <span className="text-[9px] text-slate-400 font-mono">{b.count}</span>
                    <div
                      className={`w-full rounded-t ${b.label.startsWith('≤') || b.label.startsWith('-') ? 'bg-rose-500/60' : 'bg-emerald-500/60'}`}
                      style={{ height: `${Math.max(2, (b.count / maxHist) * 88)}px` }}
                    />
                    <span className="text-[8px] text-slate-500 font-mono truncate w-full text-center">{b.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Desen Tabloları */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <div className="card-surface p-3 sm:p-4 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <Trophy className="w-4 h-4 text-emerald-400" />
                EN İYİ 5 DESEN (n ≥ 5)
              </div>
              <PatternMiniTable rows={topPatterns} />
            </div>
            <div className="card-surface p-3 sm:p-4 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-200">
                <Skull className="w-4 h-4 text-rose-400" />
                EN ZAYIF 5 DESEN (n ≥ 5)
              </div>
              <PatternMiniTable rows={bottomPatterns} />
            </div>
          </div>

          <p className="text-[10px] text-slate-600 font-mono text-center pb-2">
            ret10: kurgudan 10 mum sonraki yön-düzeltmeli getiri (%) · MFE/MAE: 20 mum içinde en iyi/en kötü sapma ·
            R: 0.3% stop varsayımıyla kat · Geçmiş performans gelecek getiriyi garanti etmez.
          </p>
        </>
      )}
    </div>
  );
};

function PatternMiniTable({ rows }: { rows: { patternId: string; n: number; winRate: number; wilsonLower: number; avgRet10: number }[] }) {
  if (!rows.length) {
    return <div className="text-[11px] text-slate-500 py-3 text-center border border-dashed border-[#22272e] rounded-lg">Yeterli örnek yok (n ≥ 5)</div>;
  }
  return (
    <div className="flex flex-col gap-1">
      {rows.map((r) => (
        <div key={r.patternId} className="flex items-center justify-between gap-2 bg-[#161b22] border border-[#22272e] rounded-lg px-2.5 py-1.5">
          <span className="text-[10px] text-slate-300 truncate flex-1" title={patternName(r.patternId)}>
            {patternName(r.patternId)}
          </span>
          <span className="text-[10px] text-slate-500 font-mono shrink-0">n={r.n}</span>
          <span className={`text-[10px] font-mono font-bold shrink-0 w-12 text-right ${r.winRate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
            %{r.winRate.toFixed(0)}
          </span>
          <span className="text-[10px] text-slate-400 font-mono shrink-0 w-16 text-right">{fmtPct(r.avgRet10)}</span>
        </div>
      ))}
    </div>
  );
}
