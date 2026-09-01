'use client';

import React, { useState } from 'react';
import {
  Activity,
  Layers,
  TrendingUp,
  Percent,
  ShieldAlert,
  ArrowUpDown,
  Zap,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { FlowSnapshot } from '@/lib/types';

interface FlowMetricsPanelProps {
  flow: FlowSnapshot;
  lastPrice: number;
  mode?: 'full' | 'ribbon' | 'collapsible';
}

export const FlowMetricsPanel: React.FC<FlowMetricsPanelProps> = ({
  flow,
  lastPrice,
  mode = 'collapsible'
}) => {
  const [expanded, setExpanded] = useState(false);

  const compact = (n: number) => {
    const a = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1)}K`;
    return `${sign}${a.toFixed(1)}`;
  };

  // Full Grid View
  const renderFullGrid = () => (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
      {/* CVD 60s */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>CVD 60s</span>
          <Activity className="w-3 h-3 text-cyan-400" />
        </div>
        <div className="font-mono mt-1">
          <span
            className={`font-bold text-sm ${
              flow.cvd60 > 0 ? 'text-emerald-400' : flow.cvd60 < 0 ? 'text-rose-400' : 'text-slate-300'
            }`}
          >
            {flow.cvd60 > 0 ? '+' : ''}
            {compact(flow.cvd60)}
          </span>
          <div className="text-[10px] text-slate-500 font-mono">
            Tot: ${compact(flow.notional60)}
          </div>
        </div>
      </div>

      {/* OBI (Order Book Imbalance) */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>OBI Imbalance</span>
          <Layers className="w-3 h-3 text-emerald-400" />
        </div>
        <div className="font-mono mt-1">
          <span
            className={`font-bold text-sm ${
              flow.obi > 0 ? 'text-emerald-400' : flow.obi < 0 ? 'text-rose-400' : 'text-slate-300'
            }`}
          >
            {flow.obi > 0 ? '+' : ''}
            {(flow.obi * 100).toFixed(1)}%
          </span>
          <div className="text-[10px] text-slate-500 font-mono">
            B:{compact(flow.bidVol)} / A:{compact(flow.askVol)}
          </div>
        </div>
      </div>

      {/* Open Interest */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>Open Interest</span>
          <TrendingUp className="w-3 h-3 text-amber-400" />
        </div>
        <div className="font-mono mt-1">
          <span className="font-bold text-sm text-slate-200">
            {flow.oi ? compact(flow.oi) : '---'}
          </span>
          <div
            className={`text-[10px] font-semibold ${
              flow.oiChangePct > 0
                ? 'text-emerald-400'
                : flow.oiChangePct < 0
                ? 'text-rose-400'
                : 'text-slate-500'
            }`}
          >
            Δ {flow.oiChangePct > 0 ? '+' : ''}
            {flow.oiChangePct.toFixed(2)}%
          </div>
        </div>
      </div>

      {/* Funding Rate */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>Funding Rate</span>
          <Percent className="w-3 h-3 text-purple-400" />
        </div>
        <div className="font-mono mt-1">
          <span
            className={`font-bold text-sm ${
              flow.funding && flow.funding > 0
                ? 'text-amber-400'
                : flow.funding && flow.funding < 0
                ? 'text-emerald-400'
                : 'text-slate-300'
            }`}
          >
            {flow.funding !== null ? `${(flow.funding * 100).toFixed(4)}%` : '---'}
          </span>
          <div className="text-[10px] text-slate-500 font-mono">
            Mark: ${flow.markPrice ? (flow.markPrice >= 100 ? flow.markPrice.toFixed(2) : flow.markPrice.toFixed(4)) : '---'}
          </div>
        </div>
      </div>

      {/* Liquidation Volumes 60s */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>Likidasyon 60s</span>
          <ShieldAlert className="w-3 h-3 text-rose-400" />
        </div>
        <div className="font-mono mt-1">
          <div className="text-xs flex justify-between">
            <span className="text-rose-400">L: ${compact(flow.longLiq60)}</span>
          </div>
          <div className="text-xs flex justify-between">
            <span className="text-emerald-400">S: ${compact(flow.shortLiq60)}</span>
          </div>
        </div>
      </div>

      {/* Spread & Ticks */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>Spread / Best</span>
          <ArrowUpDown className="w-3 h-3 text-sky-400" />
        </div>
        <div className="font-mono mt-1">
          <span className="font-bold text-sm text-slate-200">
            {flow.spread > 0 ? (flow.spread >= 1 ? flow.spread.toFixed(2) : flow.spread.toFixed(4)) : '---'}
          </span>
          <div className="text-[10px] text-slate-500">
            Bid: {flow.bestBid ? (flow.bestBid >= 100 ? flow.bestBid.toFixed(1) : flow.bestBid.toFixed(4)) : '---'}
          </div>
        </div>
      </div>

      {/* Walls & Liquidity Clustered */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>Duvarlar (B/A)</span>
          <Zap className="w-3 h-3 text-amber-400" />
        </div>
        <div className="font-mono mt-1">
          <span className="font-bold text-sm text-slate-200">
            <span className="text-emerald-400">{flow.wallCount.bid}</span>
            <span className="text-slate-500 mx-1">/</span>
            <span className="text-rose-400">{flow.wallCount.ask}</span>
          </span>
          <div className="text-[10px] text-slate-500">
            {flow.wallCount.bid > flow.wallCount.ask ? 'Alış Duvarı' : flow.wallCount.ask > flow.wallCount.bid ? 'Satış Duvarı' : 'Dengeli'}
          </div>
        </div>
      </div>

      {/* Taker Momentum */}
      <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-2 flex flex-col justify-between transition-colors duration-500">
        <div className="flex items-center justify-between text-slate-400 text-[11px]">
          <span>Taker Hızı</span>
          <Activity className="w-3 h-3 text-emerald-400" />
        </div>
        <div className="font-mono mt-1">
          <span
            className={`font-bold text-sm ${
              flow.takerSpike ? 'text-amber-400 animate-pulse' : 'text-slate-200'
            }`}
          >
            ${compact(flow.taker30)}/30s
          </span>
          <div className="text-[10px] text-slate-500">
            {flow.takerSpike ? '⚡ SPIKE AKTİF' : 'Normal Hız'}
          </div>
        </div>
      </div>
    </div>
  );

  // Single-line compact ribbon view
  const renderRibbon = () => (
    <div className="flex items-center gap-2 overflow-x-auto no-scrollbar mask-fade-right py-0.5 text-[11px] font-mono whitespace-nowrap">
      <div className="flex items-center gap-1.5 bg-[#161b22] px-2 py-1 rounded-md border border-[#22272e] shrink-0">
        <span className="text-slate-500 font-bold">CVD:</span>
        <span className={`font-bold ${flow.cvd60 > 0 ? 'text-emerald-400' : flow.cvd60 < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
          {flow.cvd60 > 0 ? '+' : ''}{compact(flow.cvd60)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 bg-[#161b22] px-2 py-1 rounded-md border border-[#22272e] shrink-0">
        <span className="text-slate-500 font-bold">OBI:</span>
        <span className={`font-bold ${flow.obi > 0 ? 'text-emerald-400' : flow.obi < 0 ? 'text-rose-400' : 'text-slate-300'}`}>
          {flow.obi > 0 ? '+' : ''}{(flow.obi * 100).toFixed(1)}%
        </span>
      </div>

      <div className="flex items-center gap-1.5 bg-[#161b22] px-2 py-1 rounded-md border border-[#22272e] shrink-0">
        <span className="text-slate-500 font-bold">OI:</span>
        <span className="font-bold text-slate-200">{flow.oi ? compact(flow.oi) : '---'}</span>
        <span className={`text-[10px] ${flow.oiChangePct > 0 ? 'text-emerald-400' : flow.oiChangePct < 0 ? 'text-rose-400' : 'text-slate-500'}`}>
          ({flow.oiChangePct > 0 ? '+' : ''}{flow.oiChangePct.toFixed(1)}%)
        </span>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 bg-[#161b22] px-2 py-1 rounded-md border border-[#22272e] shrink-0">
        <span className="text-slate-500 font-bold">Fund:</span>
        <span className={`font-bold ${flow.funding && flow.funding > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
          {flow.funding !== null ? `${(flow.funding * 100).toFixed(4)}%` : '---'}
        </span>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 bg-[#161b22] px-2 py-1 rounded-md border border-[#22272e] shrink-0">
        <span className="text-slate-500 font-bold">Liq:</span>
        <span className="text-rose-400 font-bold">${compact(flow.longLiq60)}</span>
        <span className="text-slate-600">/</span>
        <span className="text-emerald-400 font-bold">${compact(flow.shortLiq60)}</span>
      </div>

      <div className="hidden sm:flex items-center gap-1.5 bg-[#161b22] px-2 py-1 rounded-md border border-[#22272e] shrink-0">
        <span className="text-slate-500 font-bold">Duvar:</span>
        <span className="text-emerald-400 font-bold">{flow.wallCount.bid}</span>
        <span className="text-slate-600">/</span>
        <span className="text-rose-400 font-bold">{flow.wallCount.ask}</span>
      </div>
    </div>
  );

  if (mode === 'full') {
    return (
      <div className="bg-[#12161c] border-b border-[#22272e] p-3 text-xs">
        {renderFullGrid()}
      </div>
    );
  }

  if (mode === 'ribbon') {
    return (
      <div className="bg-[#12161c] border-b border-[#22272e] px-2.5 py-1 text-xs">
        {renderRibbon()}
      </div>
    );
  }

  // Collapsible mode
  return (
    <div className="bg-[#12161c] border-b border-[#22272e] px-2 sm:px-3 py-1.5 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0 overflow-hidden">
          {renderRibbon()}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 px-2.5 py-1 bg-[#161b22] hover:bg-[#1f242c] border border-[#22272e] rounded-md text-slate-300 hover:text-white text-[11px] font-mono transition-colors shrink-0 touch-manipulation active:scale-95 min-h-[32px]"
          title="Metrik Detaylarını Genişlet"
        >
          <span>{expanded ? 'Kapat' : 'Detay'}</span>
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pt-2 border-t border-[#22272e] animate-in fade-in duration-150">
          {renderFullGrid()}
        </div>
      )}
    </div>
  );
};
