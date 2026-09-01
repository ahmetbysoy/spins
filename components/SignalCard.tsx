'use client';

import React, { useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  HelpCircle,
  BarChart3,
  Flame,
  Brain,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { DecisionEvaluation, PatternStats } from '@/lib/types';
import { patternName } from '@/lib/pattern-engine';

interface SignalCardProps {
  status: 'AL' | 'SAT' | 'IZLEMEDE' | 'NOTR';
  statusRule: string;
  evaluation: DecisionEvaluation | null;
  commentary: string;
  patternStats: PatternStats | null;
  patternId?: string | null;
}

export const SignalCard: React.FC<SignalCardProps> = ({
  status,
  statusRule,
  evaluation,
  commentary,
  patternStats,
  patternId
}) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const getStatusColor = () => {
    switch (status) {
      case 'AL':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'SAT':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      case 'IZLEMEDE':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      default:
        return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'AL':
        return <TrendingUp className="w-5 h-5 text-emerald-400" />;
      case 'SAT':
        return <TrendingDown className="w-5 h-5 text-rose-400" />;
      case 'IZLEMEDE':
        return <Clock className="w-5 h-5 text-amber-400 animate-pulse" />;
      default:
        return <HelpCircle className="w-5 h-5 text-slate-400" />;
    }
  };

  const score = evaluation?.score ?? null;
  const grade = evaluation?.grade ?? 'HAM';

  const getScoreGradient = (val: number) => {
    if (val >= 75) return 'from-emerald-500 to-teal-400';
    if (val >= 60) return 'from-cyan-500 to-blue-500';
    if (val >= 45) return 'from-amber-500 to-yellow-400';
    return 'from-rose-500 to-orange-500';
  };

  const getGlowClass = () => {
    if (status === 'AL') return 'glow-up';
    if (status === 'SAT') return 'glow-down';
    return '';
  };

  return (
    <div className={`card-surface p-4 flex flex-col gap-4 select-none transition-all duration-300 ${getGlowClass()}`}>
      {/* Top Banner: Status + Rule */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1f252e] pb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border flex items-center justify-center ${getStatusColor()}`}>
            {getStatusIcon()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-mono">KARAR STATÜSÜ</span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#1c222b] text-slate-400 border border-[#2a3038]">
                KATMAN 1 + 2
              </span>
            </div>
            <div className="text-2xl font-black font-mono tracking-tight text-slate-100">
              {status === 'IZLEMEDE' ? 'İZLEMEDE' : status === 'NOTR' ? 'NÖTR' : status}
            </div>
          </div>
        </div>

        {/* Confidence Meter */}
        <div className="bg-[#161b22] border border-[#252b34] rounded-xl p-2.5 min-w-[200px] flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-400 font-medium">Flow Güven Skoru</span>
            <span className="font-mono font-bold text-slate-100">
              {score !== null ? `${score}/100` : 'HAM MOD'}
            </span>
          </div>

          <div className="w-full h-2 bg-[#0e1217] rounded-full overflow-hidden border border-[#242a34]">
            <div
              className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${
                score !== null ? getScoreGradient(score) : 'from-slate-600 to-slate-500'
              }`}
              style={{ width: `${score !== null ? score : 0}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1 font-mono">
            <span>DERECE:</span>
            <span
              className={`font-bold ${
                grade === 'YÜKSEK'
                  ? 'text-emerald-400'
                  : grade === 'ORTA+' || grade === 'ORTA'
                  ? 'text-cyan-400'
                  : grade === 'ZAYIF'
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {grade}
            </span>
          </div>
        </div>
      </div>

      {/* Street Smart Jargon Commentary Banner */}
      <div className="bg-gradient-to-r from-amber-500/10 via-[#181d24] to-emerald-500/10 border border-[#2e3640] rounded-xl p-3 flex items-start gap-2.5">
        <Flame className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-200 leading-relaxed font-medium">
          {commentary}
        </div>
      </div>

      {/* Toggle Details Button for Mobile/Desktop */}
      <button
        onClick={() => setDetailsOpen(!detailsOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#161b22] hover:bg-[#1f252e] border border-[#22272e] rounded-xl text-xs font-semibold text-slate-300 transition-colors touch-manipulation min-h-[38px] active:scale-[0.99]"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Tetikleyici Kuralları, Nedenler & Havuz İstatistiği</span>
        </div>
        <div className="flex items-center gap-1 text-slate-500 font-mono text-[11px]">
          <span>{detailsOpen ? 'Gizle' : 'Genişlet'}</span>
          {detailsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </button>

      {/* Rule & Reasons Grid */}
      {detailsOpen && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Left: Trigger Explanation & Active Reasons */}
          <div className="bg-[#161b22] border border-[#22272e] rounded-xl p-3 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tetikleyici Kuralı & Nedenler</span>
            </div>
            <div className="text-xs text-slate-300 font-mono bg-[#11151b] p-2 rounded-lg border border-[#1e242d]">
              {statusRule}
            </div>

            <div className="flex flex-col gap-1.5 mt-1">
              {evaluation && evaluation.reasons && evaluation.reasons.length > 0 ? (
                evaluation.reasons.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-1.5 text-xs text-slate-300 bg-[#11151b] p-2 rounded-lg border border-[#1e242d]"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{r}</span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-500 italic p-2">
                  Raw flow analizi bekleniyor veya sinyal henüz tetiklenmedi.
                </div>
              )}
            </div>
          </div>

          {/* Right: Historical Pattern Performance Card */}
          <div className="bg-[#161b22] border border-[#22272e] rounded-xl p-3 flex flex-col justify-between gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-semibold">
                <Brain className="w-3.5 h-3.5 text-purple-400" />
                <span>Tarihsel Desen İstatistiği (Havuz)</span>
              </div>
              {patternStats && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                    patternStats.wilsonLower >= 50
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : patternStats.wilsonLower < 42
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {patternStats.n < 15
                    ? 'Veri Topluyor'
                    : patternStats.wilsonLower >= 50
                    ? 'Güvenilir'
                    : patternStats.wilsonLower < 42
                    ? 'Zayıf'
                    : 'Orta'}
                </span>
              )}
            </div>

            {patternStats && patternStats.n > 0 ? (
              <div className="flex flex-col gap-2 font-mono">
                <div className="text-xs font-bold text-slate-200">
                  {patternId ? patternName(patternId) : patternStats.patternId}
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#11151b] p-2 rounded border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Wilson Alt Sınır (%95):</span>
                    <span className="font-bold text-slate-200 text-sm">
                      %{patternStats.wilsonLower.toFixed(1)}
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      (Ham: %{patternStats.winRate.toFixed(0)} - N={patternStats.n})
                    </span>
                  </div>

                  <div className="bg-[#11151b] p-2 rounded border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Ort. Getiri (Ret10):</span>
                    <span
                      className={`font-bold text-sm ${
                        patternStats.avgRet10 > 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {patternStats.avgRet10 > 0 ? '+' : ''}
                      {patternStats.avgRet10.toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      Ağırlıklı: {patternStats.weightedAvgRet10.toFixed(2)}%
                    </span>
                  </div>

                  <div className="bg-[#11151b] p-2 rounded border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">MFE / MAE Oranı:</span>
                    <span className="font-bold text-slate-200 text-xs">
                      {patternStats.avgMfe20.toFixed(2)}% / {patternStats.avgMae20.toFixed(2)}%
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      R-Multiple: {patternStats.avgRMultiple.toFixed(2)}R
                    </span>
                  </div>

                  <div className="bg-[#11151b] p-2 rounded border border-[#1e242d]">
                    <span className="text-[10px] text-slate-500 block">Zirveye Ulaşma (MFE):</span>
                    <span className="font-bold text-slate-200 text-xs">
                      ~{patternStats.medBarsToMfe.toFixed(0)} mum sonra
                    </span>
                    <span className="text-[10px] text-slate-400 block">
                      TF: {patternStats.timeframe}
                    </span>
                  </div>
                </div>

                {/* F2-5: Regime-conditional insight */}
                {patternStats.regimes && Object.keys(patternStats.regimes).length > 0 && (
                  <div className="bg-[#11151b] p-2 rounded border border-[#1e242d] mt-1">
                    <span className="text-[10px] text-slate-500 block mb-1">Piyasa Rejimleri Gücü (Örnek Dağılımı):</span>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.values(patternStats.regimes)
                        .filter((r) => r.n >= 5)
                        .slice(0, 3)
                        .map((r) => (
                          <span
                            key={r.key}
                            className={`text-[10px] px-1.5 py-0.5 rounded border ${
                              r.winRate >= 50
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                            }`}
                          >
                            {r.key.replace('_', ' ')}: %{r.winRate.toFixed(0)} ({r.n}x, {r.avgRet10 > 0 ? '+' : ''}{r.avgRet10.toFixed(1)}%)
                          </span>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic p-3 bg-[#11151b] rounded-lg border border-[#1e242d] text-center">
                Bu desen için henüz yeterli kapanmış örnek havuzda birikmedi.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
