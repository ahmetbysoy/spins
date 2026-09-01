'use client';

import React, { useState, useEffect } from 'react';
import { showToast } from '@/components/ui/toast';
import {
  Brain,
  Download,
  Upload,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff
} from 'lucide-react';
import { PatternStats, PatternEvent } from '@/lib/types';
import { fetchKlines } from '@/lib/binance';
import {
  initPatternDB,
  dbAll,
  dbIndexAll,
  patternAllIds,
  patternName,
  patternRecomputeStats,
  patternGetStats,
  patternBackfillFromCandles,
  dbAdd,
  dbIndexGet,
  PPOOL_SCHEMA_VERSION
} from '@/lib/pattern-engine';

interface PatternPoolViewProps {
  symbol: string;
  interval: string;
  /** P1.5: Desen overlay toggle — parent (page.tsx) overlay state'ini yönetir */
  onToggleOverlay?: (key: string, events: PatternEvent[]) => void;
  /** Aktif overlay'in coinPatternKey'i (yoksa null) */
  overlayKey?: string | null;
}

export const PatternPoolView: React.FC<PatternPoolViewProps> = ({ symbol, interval, onToggleOverlay, overlayKey }) => {
  const [statsList, setStatsList] = useState<PatternStats[]>([]);
  const [selectedPattern, setSelectedPattern] = useState<PatternStats | null>(null);
  const [recentEvents, setRecentEvents] = useState<PatternEvent[]>([]);
  const [tfFilter, setTfFilter] = useState<'all' | '1m' | '5m' | '15m' | '1h'>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'global' | 'coin'>('all');
  const [minN, setMinN] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);

  const loadStats = async () => {
    setLoading(true);
    try {
      await initPatternDB();
      const allStats = await dbAll<PatternStats>('poolStats');
      const map = new Map(allStats.map((s) => [s.key, s]));

      const defaultKeys: string[] = [];
      ['1m', '5m', '15m', '1h'].forEach((tf) =>
        patternAllIds().forEach((pid) => defaultKeys.push(`${tf}:${pid}`))
      );

      const list: PatternStats[] = allStats.length > 0
        ? allStats.slice()
        : defaultKeys.map((key) => ({
            key,
            schemaVersion: 1,
            updatedAt: Date.now(),
            scope: 'global' as const,
            timeframe: key.split(':')[0],
            patternId: key.split(':')[1],
            n: 0,
            wins: 0,
            winRate: 0,
            wilsonLower: 0,
            avgRet10: 0,
            stdRet10: 0,
            avgMfe20: 0,
            avgMae20: 0,
            avgRMultiple: 0,
            medBarsToMfe: 0,
            weightedWinRate: 0,
            weightedAvgRet10: 0,
            regimes: {}
          }));

      list.sort((a, b) => b.wilsonLower - a.wilsonLower || b.n - a.n);
      setStatsList(list);
    } catch (e) {
      console.warn('Load stats error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      setLoading(true);
      try {
        await initPatternDB();
        const allStats = await dbAll<PatternStats>('poolStats');
        if (!mounted) return;
        const defaultKeys: string[] = [];
        ['1m', '5m', '15m', '1h'].forEach((tf) =>
          patternAllIds().forEach((pid) => defaultKeys.push(`${tf}:${pid}`))
        );

        const list: PatternStats[] = allStats.length > 0
          ? allStats.slice()
          : defaultKeys.map((key) => ({
              key,
              schemaVersion: 1,
              updatedAt: Date.now(),
              scope: 'global' as const,
              timeframe: key.split(':')[0],
              patternId: key.split(':')[1],
              n: 0,
              wins: 0,
              winRate: 0,
              wilsonLower: 0,
              avgRet10: 0,
              stdRet10: 0,
              avgMfe20: 0,
              avgMae20: 0,
              avgRMultiple: 0,
              medBarsToMfe: 0,
              weightedWinRate: 0,
              weightedAvgRet10: 0,
              regimes: {}
            }));

        list.sort((a, b) => b.wilsonLower - a.wilsonLower || b.n - a.n);
        if (mounted) {
          setStatsList(list);
          setLoading(false);
        }
      } catch (e) {
        if (mounted) setLoading(false);
      }
    };
    init();
    return () => {
      mounted = false;
    };
  }, [symbol]);

  useEffect(() => {
    const loadRecentEvents = async () => {
      if (!selectedPattern) {
        setRecentEvents([]);
        return;
      }
      try {
        await initPatternDB();
        const evs = await dbIndexAll<PatternEvent>('events', 'patternKey', selectedPattern.key);
        const settled = evs
          .filter((e) => e.status === 'settled')
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 20);
        setRecentEvents(settled);
      } catch (e) {
        console.warn('Load recent events error:', e);
      }
    };
    loadRecentEvents();
  }, [selectedPattern]);

  const runBackfillScan = async () => {
    setBackfilling(true);
    try {
      // Fetch 600 klines with timeout protection and backfill for current symbol
      const cs = await fetchKlines(symbol, interval, 600);
      if (cs && cs.length > 0) {
        await patternBackfillFromCandles(symbol, interval, cs);
      }
      await loadStats();
    } catch (e) {
      console.warn('Backfill scan error:', e);
    } finally {
      setBackfilling(false);
    }
  };

  const filteredList = statsList.filter((s) => {
    if (tfFilter !== 'all' && s.timeframe !== tfFilter) return false;
    if (scopeFilter === 'global' && s.scope !== 'global') return false;
    if (scopeFilter === 'coin' && (s.scope !== 'coin' || s.coin !== symbol)) return false;
    if (s.n < minN) return false;
    return true;
  });

  const exportJSON = async () => {
    try {
      const events = await dbAll('events');
      const poolStats = await dbAll('poolStats');
      const data = {
        version: PPOOL_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        events,
        poolStats
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `binance-futures-pattern-pool-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Export error:', e);
    }
  };

  const importJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data || typeof data !== 'object') throw new Error('Geçersiz dosya formatı');
      if (data.version !== PPOOL_SCHEMA_VERSION) {
        // REV-9: uyar ama içe aktarmaya devam et (kullanıcı onaylı davranış)
        showToast(
          `Şema versiyonu farklı (dosya: ${data.version ?? 'yok'}, beklenen: ${PPOOL_SCHEMA_VERSION}) — yine de içe aktarılıyor.`,
          'warning'
        );
      }

      const affectedKeys = new Set<string>();
      let added = 0;
      let skipped = 0;

      if (Array.isArray(data.events)) {
        for (const ev of data.events) {
          const old = await dbIndexGet('events', 'eventKey', ev.eventKey);
          if (!old) {
            delete ev.id;
            await dbAdd('events', ev);
            added++;
            if (ev.patternKey) affectedKeys.add(ev.patternKey);
            if (ev.coinPatternKey) affectedKeys.add(ev.coinPatternKey);
          } else {
            skipped++;
          }
        }
      }

      // Re-calculate stats instead of importing stats directly
      for (const key of affectedKeys) {
        await patternRecomputeStats(key);
      }

      await loadStats();
      if (added === 0) {
        showToast(`0 kayıt eklendi (${skipped} duplicate atlandı) — dosya zaten içe aktarılmış olabilir.`, 'info');
      } else {
        showToast(`İçe aktarma tamam: ${added} kayıt eklendi, ${skipped} duplicate atlandı.`, 'success');
      }
    } catch (err) {
      console.warn('Import error:', err);
      showToast('İçe aktarma başarısız: ' + err, 'error');
    }
  };

  // P1.5: Seçili desenin bu coindeki geçmiş örneklerini grafikte göster/kapat
  const overlayCoinKey = React.useMemo(() => {
    if (!selectedPattern) return null;
    const parts = selectedPattern.key.split(':');
    const tf = parts.length === 3 ? parts[1] : parts[0];
    const patId = parts.length === 3 ? parts[2] : parts[1];
    return { key: `${symbol}:${tf}:${patId}`, tf };
  }, [selectedPattern, symbol]);

  const overlayActive = !!(overlayCoinKey && overlayKey === overlayCoinKey.key);

  const handleOverlayToggle = async () => {
    if (!overlayCoinKey || !onToggleOverlay) return;

    if (overlayActive) {
      onToggleOverlay(overlayCoinKey.key, []); // kapat
      return;
    }
    if (overlayCoinKey.tf !== interval) {
      showToast(
        `Bu desen ${overlayCoinKey.tf} zaman diliminde toplanmış; grafikte görmek için ${overlayCoinKey.tf} TF'ine geç.`,
        'warning'
      );
      return;
    }
    try {
      const evs = (await dbIndexAll<PatternEvent>('events', 'coinPatternKey', overlayCoinKey.key))
        .filter((e) => e.status === 'settled')
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 15); // grafik kalabalıklaşmasın diye son 15 örnek
      if (!evs.length) {
        showToast(`${symbol} için bu desenden settle olmuş örnek yok.`, 'info');
        return;
      }
      onToggleOverlay(overlayCoinKey.key, evs);
      showToast(`${symbol}: ${evs.length} geçmiş örnek grafikte gösteriliyor.`, 'success');
    } catch (err) {
      console.warn('Overlay yükleme hatası:', err);
      showToast('Overlay yüklenemedi: ' + err, 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0d1117] p-3 sm:p-4 select-none">
      <div className="card-surface p-4 flex flex-col gap-4 flex-1 min-h-0">
        {/* Header & Controls */}
        <div className="flex flex-col gap-2.5 border-b border-[#1f252e] pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-400 shrink-0" />
              <div>
                <h2 className="text-xs sm:text-sm font-bold text-slate-100 tracking-wide">
                  HAVUZ MOTORU (LEADERBOARD)
                </h2>
                <span className="text-[10px] text-slate-500 font-mono">
                  IndexedDB Kalıcı İstatistikler · Wilson %95 Modeli
                </span>
              </div>
            </div>

            <button
              onClick={loadStats}
              disabled={loading}
              className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center hover:bg-emerald-500/30 transition-all shrink-0 touch-manipulation active:scale-95"
              title="Yenile"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={exportJSON}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#181d24] text-slate-300 hover:text-white border border-[#2a3038] hover:border-slate-500 transition-all touch-manipulation min-h-[36px]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Dışa Aktar</span>
            </button>

            <label className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#181d24] text-slate-300 hover:text-white border border-[#2a3038] hover:border-slate-500 transition-all cursor-pointer touch-manipulation min-h-[36px]">
              <Upload className="w-3.5 h-3.5" />
              <span>İçe Aktar</span>
              <input type="file" accept="application/json" onChange={importJSON} className="hidden" />
            </label>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-fade-right py-0.5">
            <div className="flex items-center gap-1 bg-[#181d24] p-1 rounded-lg border border-[#262c34] text-xs shrink-0">
              <span className="text-slate-500 px-1.5 font-bold">TF:</span>
              {(['all', '1m', '5m', '15m', '1h'] as const).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTfFilter(tf)}
                  className={`px-2 py-0.5 rounded font-mono font-bold transition-colors touch-manipulation ${
                    tfFilter === tf
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tf === 'all' ? 'Hepsi' : tf}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-[#181d24] p-1 rounded-lg border border-[#262c34] text-xs shrink-0">
              <span className="text-slate-500 px-1.5 font-bold">Kapsam:</span>
              {(['all', 'global', 'coin'] as const).map((sc) => (
                <button
                  key={sc}
                  onClick={() => setScopeFilter(sc)}
                  className={`px-2 py-0.5 rounded font-mono font-bold transition-colors touch-manipulation ${
                    scopeFilter === sc
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {sc === 'all' ? 'Hepsi' : sc === 'global' ? 'Global' : symbol}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-[#181d24] p-1 rounded-lg border border-[#262c34] text-xs shrink-0">
              <span className="text-slate-500 px-1.5 font-bold">Min N:</span>
              {[0, 15, 30, 50].map((n) => (
                <button
                  key={n}
                  onClick={() => setMinN(n)}
                  className={`px-2 py-0.5 rounded font-mono font-bold transition-colors touch-manipulation ${
                    minN === n
                      ? 'bg-purple-500/20 text-purple-400 border border-purple-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {n === 0 ? 'Tümü' : `${n}+`}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={runBackfillScan}
            disabled={backfilling}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-emerald-600/30 to-cyan-600/30 text-emerald-300 hover:text-white border border-emerald-500/40 hover:border-emerald-400 transition-all shadow-sm disabled:opacity-50 touch-manipulation min-h-[38px]"
          >
            <Flame className={`w-3.5 h-3.5 text-amber-400 ${backfilling ? 'animate-bounce' : ''}`} />
            <span>{backfilling ? 'Taranıyor...' : `${symbol} (${interval}) Mumlarını Tara & Öğren`}</span>
          </button>
        </div>

        {/* Main Grid: Responsive Cards & Selected Detail */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 flex-1 min-h-0">
          {/* Pattern Cards List */}
          <div className="lg:col-span-2 overflow-y-auto divide-y divide-[#1e242d] border border-[#22272e] rounded-lg bg-[#0e1218]">
            {filteredList.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-mono text-xs">
                Kayıtlı desen istatistiği bulunamadı. Lütfen yukarıdaki &quot;Mumları Tara &amp; Öğren&quot; butonuna basın.
              </div>
            ) : (
              filteredList.map((st) => {
                const isSelected = selectedPattern?.key === st.key;
                return (
                  <div
                    key={st.key}
                    onClick={() => setSelectedPattern(st)}
                    className={`p-3 hover:bg-[#161b22] active:bg-[#1b212a] cursor-pointer transition-colors touch-manipulation flex flex-col gap-2 ${
                      isSelected ? 'bg-purple-500/10 border-l-2 border-l-purple-400' : ''
                    }`}
                  >
                    {/* Top Row: Title + TF + N */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-bold text-xs text-slate-200 line-clamp-2 leading-tight">
                          {patternName(st.patternId)}
                        </div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">
                          {st.patternId}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 font-mono text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-[#181d24] text-slate-300 border border-[#262c34]">
                          {st.timeframe}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[#181d24] text-purple-300 border border-[#262c34] font-bold">
                          N:{st.n}
                        </span>
                      </div>
                    </div>

                    {/* Bottom Row: Wilson Score + Ret10 + Status */}
                    <div className="flex items-center justify-between gap-2 font-mono text-xs pt-1 border-t border-[#1a2028]">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded font-extrabold border ${
                            st.wilsonLower >= 50
                              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                              : st.wilsonLower < 42
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                              : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                          }`}
                        >
                          Wilson: %{st.wilsonLower.toFixed(1)}
                        </span>
                        <span className={`font-bold ${st.avgRet10 > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {st.avgRet10 > 0 ? '+' : ''}{st.avgRet10.toFixed(2)}%
                        </span>
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          st.n < 15
                            ? 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                            : st.wilsonLower >= 50
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : st.wilsonLower < 42
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}
                      >
                        {st.n < 15
                          ? 'Topluyor'
                          : st.wilsonLower >= 50
                          ? 'Güvenilir'
                          : st.wilsonLower < 42
                          ? 'Zayıf'
                          : 'Orta'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Selected Pattern Detail Card (1 col) */}
          <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-4 flex flex-col gap-3 overflow-y-auto">
            <div className="flex items-center gap-2 border-b border-[#22272e] pb-2">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <h3 className="text-xs font-bold text-slate-200">SEÇİLİ DESEN DETAYI</h3>
            </div>

            {selectedPattern ? (
              <div className="flex flex-col gap-3 font-mono text-xs">
                <div>
                  <div className="font-bold text-sm text-slate-100">
                    {patternName(selectedPattern.patternId)}
                  </div>
                  <div className="text-[11px] text-purple-400 mt-0.5">{selectedPattern.key}</div>
                </div>

                {/* P1.5: Grafikte göster/kapat */}
                {onToggleOverlay && (
                  <button
                    onClick={handleOverlayToggle}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all touch-manipulation active:scale-95 ${
                      overlayActive
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40 hover:bg-purple-500/30'
                        : 'bg-[#181d24] text-slate-300 border-[#2a3038] hover:text-white hover:border-slate-500'
                    }`}
                  >
                    {overlayActive ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    <span>{overlayActive ? 'Grafikten Kaldır' : 'Grafikte Göster (son 15 örnek)'}</span>
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#11151b] p-2.5 rounded-lg border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Ham Win Rate:</span>
                    <span className="font-bold text-slate-100 text-sm">
                      %{selectedPattern.winRate.toFixed(1)}
                    </span>
                  </div>

                  <div className="bg-[#11151b] p-2.5 rounded-lg border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Ağırlıklı Win Rate:</span>
                    <span className="font-bold text-slate-100 text-sm">
                      %{selectedPattern.weightedWinRate.toFixed(1)}
                    </span>
                  </div>

                  <div className="bg-[#11151b] p-2.5 rounded-lg border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Wilson Alt Sınır:</span>
                    <span className="font-bold text-emerald-400 text-sm">
                      %{selectedPattern.wilsonLower.toFixed(1)}
                    </span>
                  </div>

                  <div className="bg-[#11151b] p-2.5 rounded-lg border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Toplam Örnek:</span>
                    <span className="font-bold text-slate-100 text-sm">{selectedPattern.n}</span>
                  </div>
                </div>

                {/* Regime breakdown */}
                <div className="flex flex-col gap-2 mt-2">
                  <span className="text-[11px] font-bold text-slate-400">Piyasa Rejimleri Dağılımı:</span>
                  <div className="border border-[#1e242d] rounded-lg overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-[#11151b] text-slate-400">
                        <tr>
                          <th className="p-2">Rejim (Vol/Trend)</th>
                          <th className="p-2 text-center">N</th>
                          <th className="p-2 text-center">Win %</th>
                          <th className="p-2 text-right">Ret10</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e242d]">
                        {Object.values(selectedPattern.regimes || {}).map((r) => (
                          <tr key={r.key}>
                            <td className="p-2 font-bold text-slate-300">{r.key.replace('_', ' / ')}</td>
                            <td className="p-2 text-center text-slate-400">{r.n}</td>
                            <td className="p-2 text-center text-emerald-400 font-bold">%{r.winRate.toFixed(0)}</td>
                            <td className="p-2 text-right text-slate-200">{r.avgRet10.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {/* Recent 20 Settled Transactions List (F2-10) */}
                <div className="flex flex-col gap-2 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-400">Son 20 İşlem Örneği:</span>
                    <span className="text-[10px] text-purple-400 font-mono">Settled ({recentEvents.length})</span>
                  </div>
                  <div className="border border-[#1e242d] rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                    {recentEvents.length > 0 ? (
                      <table className="w-full text-left text-[10px] font-mono">
                        <thead className="bg-[#11151b] text-slate-500 sticky top-0">
                          <tr>
                            <th className="p-1.5">Coin</th>
                            <th className="p-1.5">Tarih</th>
                            <th className="p-1.5">Rejim</th>
                            <th className="p-1.5 text-right">Ret10</th>
                            <th className="p-1.5 text-right">R-Mult</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#1e242d]">
                          {recentEvents.map((ev, i) => (
                            <tr key={ev.id || i} className="hover:bg-[#151a21]">
                              <td className="p-1.5 font-bold text-slate-300">{ev.coin}</td>
                              <td className="p-1.5 text-slate-500">
                                {new Date(ev.timestamp).toLocaleDateString('tr-TR', {
                                  day: '2-digit',
                                  month: '2-digit'
                                })}{' '}
                                {new Date(ev.timestamp).toLocaleTimeString('tr-TR', {
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </td>
                              <td className="p-1.5 text-slate-400">{ev.volRegime}/{ev.trendRegime}</td>
                              <td
                                className={`p-1.5 text-right font-bold ${
                                  (ev.ret10 ?? 0) > 0 ? 'text-emerald-400' : 'text-rose-400'
                                }`}
                              >
                                {(ev.ret10 ?? 0) > 0 ? '+' : ''}
                                {(ev.ret10 ?? 0).toFixed(2)}%
                              </td>
                              <td className="p-1.5 text-right text-slate-300">
                                {(ev.rMultiple ?? 0).toFixed(1)}R
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-3 text-center text-[10px] text-slate-500 italic">
                        Bu desene ait henüz kapanmış işlem örneği yok.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-slate-500">
                Detayları incelemek için tablodan bir desen seçin.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
