'use client';

import React from 'react';
import {
  TrendingUp,
  Zap,
  Layers,
  Brain,
  Settings
} from 'lucide-react';
import { Ticker24h } from '@/lib/types';

interface BottomToolbarProps {
  activeView: 'chart' | 'signal' | 'scanner' | 'pool' | 'settings';
  onChangeView: (view: 'chart' | 'signal' | 'scanner' | 'pool' | 'settings') => void;
  symbol: string;
  lastPrice: number;
  tickers: Ticker24h[];
  wsConnected: boolean;
  fundingRate: number | null;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export const BottomToolbar: React.FC<BottomToolbarProps> = ({
  activeView,
  onChangeView
}) => {
  const tabs: {
    id: 'chart' | 'signal' | 'scanner' | 'pool' | 'settings';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: 'chart',
      label: 'Grafik',
      icon: TrendingUp
    },
    {
      id: 'signal',
      label: 'Sinyal',
      icon: Zap
    },
    {
      id: 'scanner',
      label: 'Tarayıcı',
      icon: Layers
    },
    {
      id: 'pool',
      label: 'Havuz',
      icon: Brain
    },
    {
      id: 'settings',
      label: 'Ayarlar',
      icon: Settings
    }
  ];

  return (
    <footer
      id="bottom-navigation-toolbar"
      className="bg-[#10141b]/95 border-t border-[#1f252e] px-1 pb-[var(--sab)] flex items-center justify-around z-40 select-none shrink-0 backdrop-blur-lg"
      style={{ minHeight: 'calc(3.25rem + var(--sab))' }}
    >
      <nav id="bottom-tabs-menu" className="flex items-center justify-between w-full max-w-lg mx-auto py-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeView === tab.id;
          return (
            <button
              key={tab.id}
              id={`tab-button-${tab.id}`}
              onClick={() => onChangeView(tab.id)}
              className={`flex-1 min-w-0 h-11 flex flex-col items-center justify-center gap-0.5 rounded-lg transition-all active:scale-95 touch-manipulation ${
                isActive
                  ? 'text-emerald-400 font-bold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div
                className={`p-1 rounded-md transition-colors ${
                  isActive ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400'
                }`}
              >
                <Icon className={`w-5 h-5 shrink-0 transition-transform ${isActive ? 'scale-110' : ''}`} />
              </div>
              <span className="text-[10px] leading-none tracking-tight truncate max-w-full px-0.5">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>
    </footer>
  );
};
