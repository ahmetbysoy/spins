'use client';

import React from 'react';
import {
  ShieldAlert,
  Flame,
  Zap,
  Activity,
  AlertCircle,
  Clock,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { FlowEvent, SignalLogEntry } from '@/lib/types';

interface OrderFlowLogProps {
  flowEvents: FlowEvent[];
  signals: SignalLogEntry[];
}

export const OrderFlowLog: React.FC<OrderFlowLogProps> = ({ flowEvents, signals }) => {
  const getEventBadge = (type: FlowEvent['type'], sev: FlowEvent['sev']) => {
    switch (type) {
      case 'WHALE':
        return (
          <span className="pill bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
            <Zap className="w-3 h-3" /> WHALE
          </span>
        );
      case 'SWEEP':
        return (
          <span className="pill bg-purple-500/10 text-purple-400 border-purple-500/30">
            <Flame className="w-3 h-3" /> SWEEP
          </span>
        );
      case 'ABSORPTION':
        return (
          <span className="pill bg-amber-500/10 text-amber-400 border-amber-500/30">
            <Activity className="w-3 h-3" /> ABSORPTION
          </span>
        );
      case 'DELTA_BURST':
        return (
          <span className="pill bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
            <Flame className="w-3 h-3" /> BURST
          </span>
        );
      case 'SPOOF':
        return (
          <span className="pill bg-rose-500/10 text-rose-400 border-rose-500/30">
            <AlertCircle className="w-3 h-3" /> SPOOF
          </span>
        );
      case 'LIQUIDATION':
        return (
          <span className="pill bg-rose-500/10 text-rose-400 border-rose-500/30">
            <ShieldAlert className="w-3 h-3" /> LIQ
          </span>
        );
      default:
        return (
          <span className="pill bg-slate-500/10 text-slate-400 border-slate-500/30">
            EVENT
          </span>
        );
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Left: Real-time Order Flow Olayları */}
      <div className="card-surface p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-[#1f252e] pb-2.5">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-200 tracking-wider">ORDER FLOW CANLI AKIŞ</h3>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Whale / Sweep / Spoof Radar</span>
        </div>

        <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-[#1e242d] pr-1">
          {flowEvents.length > 0 ? (
            flowEvents.map((ev, idx) => (
              <div
                key={ev.id}
                className={`py-2 px-1 rounded-lg flex items-start justify-between gap-3 text-xs transition-colors ${
                  idx === 0
                    ? ev.side === 'buy'
                      ? 'flash-up'
                      : ev.side === 'sell'
                      ? 'flash-down'
                      : ''
                    : ''
                }`}
              >
                <div className="flex items-start gap-2">
                  {getEventBadge(ev.type, ev.sev)}
                  <div>
                    <div className="text-slate-200 font-mono font-medium">{ev.text}</div>
                    <div className="text-[10px] text-slate-500 font-mono flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3" />
                      {new Date(ev.ts).toLocaleTimeString('tr-TR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit'
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">
              Henüz büyük whale, sweep veya spoof olayı tespit edilmedi...
            </div>
          )}
        </div>
      </div>

      {/* Right: Sinyal Geçmişi */}
      <div className="bg-[#12161c] border border-[#22272e] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between border-b border-[#1f252e] pb-2.5">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <h3 className="text-xs font-bold text-slate-200 tracking-wider">SİNYAL GEÇMİŞİ</h3>
          </div>
          <span className="text-[10px] text-slate-500 font-mono">Kapanmış Mum Sinyalleri</span>
        </div>

        <div className="flex-1 overflow-y-auto max-h-72 divide-y divide-[#1e242d] pr-1">
          {signals.length > 0 ? (
            signals.map((sig) => (
              <div key={sig.id} className="py-2.5 flex flex-col gap-1 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-extrabold font-mono flex items-center gap-1 ${
                        sig.dir === 'AL'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {sig.dir === 'AL' ? (
                        <ArrowUpRight className="w-3 h-3" />
                      ) : (
                        <ArrowDownRight className="w-3 h-3" />
                      )}
                      {sig.dir}
                    </span>
                    <span className="font-mono font-bold text-slate-200">
                      ${sig.price >= 100 ? sig.price.toLocaleString() : sig.price.toFixed(4)}
                    </span>
                  </div>

                  <span className="text-[10px] text-slate-500 font-mono">
                    {new Date(sig.ts * 1000).toLocaleString('tr-TR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>

                <div className="text-[11px] text-slate-400 font-mono">{sig.rule}</div>

                <div className="text-[10px] text-slate-500 flex items-center gap-2">
                  <span>
                    Güven:{' '}
                    <strong className="text-slate-300">
                      {sig.score !== null ? `${sig.score}/100` : 'HAM'}
                    </strong>
                  </span>
                  <span>•</span>
                  <span>
                    Derece: <strong className="text-cyan-400">{sig.grade}</strong>
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-slate-500 font-mono">
              Bu oturumda henüz sinyal üretilmedi.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
