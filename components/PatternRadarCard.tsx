'use client';

// Desen Radarı kartı — arka plan tarayıcının durumunu ve son kurgu hitlerini listeler.
// Scanner görünümünün en üstünde yer alır; hit satırına tıklayınca ilgili sembole geçilir.
import React from 'react';
import { Radar, Play, CheckCircle2, Radio, Star } from 'lucide-react';
import { ScannerHit } from '@/lib/scanner-engine';
import { patternName } from '@/lib/pattern-engine';
import { PatternRadarState } from '@/hooks/use-pattern-radar';

interface PatternRadarCardProps {
  radar: PatternRadarState;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  onSelectSymbol: (symbol: string) => void;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts * 1000) / 1000));
  if (s < 60) return `${s}sn`;
  if (s < 3600) return `${Math.floor(s / 60)}dk`;
  return `${Math.floor(s / 3600)}sa`;
}

export const PatternRadarCard: React.FC<PatternRadarCardProps> = ({
  radar,
  enabled,
  onToggle,
  onSelectSymbol
}) => {
  return (
    <div className="card-surface p-3 sm:p-4 flex flex-col gap-3 select-none">
      {/* Başlık */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Radar className="w-5 h-5 text-cyan-400 shrink-0" />
          <div>
            <h2 className="text-xs sm:text-sm font-bold text-slate-100 tracking-wide flex items-center gap-1.5">
              DESEN RADARI
              {radar.scanningSymbol && (
                <span className="flex items-center gap-1 text-[10px] font-mono text-cyan-400">
                  <Radio className="w-3 h-3 animate-pulse" />
                  {radar.scanningSymbol}
                </span>
              )}
            </h2>
            <span className="text-[10px] text-slate-500 font-mono">
              {enabled
                ? `${radar.universe.length} sembol · 1m+5m · favoriler + top hacim`
                : 'Kapalı — ayarlardan açabilirsin'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={radar.runOnce}
            disabled={!enabled}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-[#181d24] text-slate-300 hover:text-white border border-[#2a3038] hover:border-cyan-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-all min-h-[32px]"
          >
            <Play className="w-3 h-3" />
            Hemen Tara
          </button>
          <button
            onClick={() => onToggle(!enabled)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-all min-h-[32px] ${
              enabled
                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                : 'bg-[#181d24] text-slate-400 border-[#2a3038]'
            }`}
          >
            {enabled ? 'AÇIK' : 'KAPALI'}
          </button>
        </div>
      </div>

      {/* Evren chip'leri */}
      {enabled && radar.universe.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {radar.universe.slice(0, SCANNER_UNIVERSE_CHIP_LIMIT).map((s) => (
            <span
              key={s}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                radar.scanningSymbol === s
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                  : 'bg-[#161b22] text-slate-400 border-[#22272e]'
              }`}
            >
              {s.replace('USDT', '')}
            </span>
          ))}
          {radar.universe.length > SCANNER_UNIVERSE_CHIP_LIMIT && (
            <span className="text-[10px] text-slate-500 font-mono">
              +{radar.universe.length - SCANNER_UNIVERSE_CHIP_LIMIT}
            </span>
          )}
        </div>
      )}

      {/* Hit listesi */}
      <div className="flex flex-col gap-1.5 min-h-0">
        {radar.hits.length === 0 ? (
          <div className="text-[11px] text-slate-500 py-3 text-center border border-dashed border-[#22272e] rounded-lg">
            {enabled
              ? 'İlk tur taranıyor… Yeni kurgular (Golden/Death Cross + SAR) burada listelenecek.'
              : 'Radar kapalı.'}
          </div>
        ) : (
          radar.hits.slice(0, 8).map((hit, idx) => (
            <button
              key={`${hit.symbol}-${hit.timeframe}-${hit.patternId}-${hit.ts}-${idx}`}
              onClick={() => onSelectSymbol(hit.symbol)}
              className="flex items-center justify-between gap-2 bg-[#161b22] hover:bg-[#1b2129] border border-[#22272e] hover:border-[#2f3944] rounded-lg px-2.5 py-2 text-left transition-all"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`px-1.5 py-0.5 rounded font-bold text-[10px] shrink-0 border ${
                    hit.dir === 'AL'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border-rose-500/30'
                  }`}
                >
                  {hit.dir}
                </span>
                <span className="text-xs font-bold text-slate-200 font-mono shrink-0">
                  {hit.symbol.replace('USDT', '')}
                </span>
                <span className="text-[10px] text-slate-500 font-mono shrink-0">{hit.timeframe}</span>
                <span className="text-[10px] text-slate-400 truncate">
                  {patternName(hit.patternId).replace(' + Trend Uyumlu', '').replace(' + Trend Uyumsuz', ' ᶠ⁰')}
                </span>
                {hit.poolApproved && (
                  <span className="flex items-center gap-0.5 text-[9px] font-bold text-cyan-400 shrink-0">
                    <CheckCircle2 className="w-3 h-3" />
                    HAVUZ
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-slate-500 font-mono">
                  ${hit.price >= 1000 ? hit.price.toFixed(0) : hit.price.toPrecision(4)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">{timeAgo(hit.ts)}</span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Alt bilgi */}
      {enabled && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Star className="w-3 h-3" />
          Radar sinyalleri grafik (Katman 1) kurgusudur; orderflow teyidi (Katman 2) seçili sembolde çalışır.
        </div>
      )}
    </div>
  );
};

const SCANNER_UNIVERSE_CHIP_LIMIT = 14;
