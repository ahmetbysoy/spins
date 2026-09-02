'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  ArrowUpDown,
  Flame,
  TrendingUp,
  TrendingDown,
  Star,
  Zap
} from 'lucide-react';
import { Ticker24h } from '@/lib/types';

interface MarketScannerProps {
  tickers: Ticker24h[];
  favs: string[];
  onToggleFav: (symbol: string) => void;
  onSelectSymbol: (symbol: string) => void;
  selectedSymbol: string;
}

export const MarketScanner: React.FC<MarketScannerProps> = ({
  tickers,
  favs,
  onToggleFav,
  onSelectSymbol,
  selectedSymbol
}) => {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'gainers' | 'losers' | 'volume' | 'favs'>('volume');
  const [sortField, setSortField] = useState<'quoteVolume' | 'priceChangePercent' | 'lastPrice'>('quoteVolume');
  const [sortAsc, setSortAsc] = useState(false);
  const [volAsc, setVolAsc] = useState(false); // Hacim sekmesi gerçek yön toggle'ı
  const [visibleCount, setVisibleCount] = useState(100); // satır limiti

  const filteredTickers = useMemo(() => {
    let list = [...tickers];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((t) => t.symbol.toLowerCase().includes(q));
    }

    if (tab === 'favs') {
      list = list.filter((t) => favs.includes(t.symbol));
    } else if (tab === 'gainers') {
      list = list.filter((t) => t.priceChangePercent > 0).sort((a, b) => b.priceChangePercent - a.priceChangePercent);
    } else if (tab === 'losers') {
      list = list.filter((t) => t.priceChangePercent < 0).sort((a, b) => a.priceChangePercent - b.priceChangePercent);
    } else if (tab === 'volume') {
      list = list.sort((a, b) => (volAsc ? a.quoteVolume - b.quoteVolume : b.quoteVolume - a.quoteVolume));
    }

    if (tab === 'all') {
      list.sort((a, b) => {
        const valA = a[sortField];
        const valB = b[sortField];
        return sortAsc ? valA - valB : valB - valA;
      });
    }

    return list;
  }, [tickers, search, tab, favs, sortField, sortAsc, volAsc]);

  // Filtre/sekme değişince liste limitini sıfırla
  useEffect(() => {
    setVisibleCount(100);
  }, [search, tab, sortField, sortAsc, volAsc]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0d1117] p-2.5 sm:p-4 select-none">
      <div className="card-surface p-3 sm:p-4 flex flex-col gap-2.5 flex-1 min-h-0">
        {/* Header & Search */}
        <div className="flex flex-col gap-2 border-b border-[#1f252e] pb-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-emerald-400 shrink-0" />
              <div>
                <h2 className="text-xs sm:text-sm font-bold text-slate-100 tracking-wide">FUTURES TARAYICI</h2>
                <span className="text-[10px] text-slate-500 font-mono">
                  {tickers.length} Aktif USDT-M Perpetual
                </span>
              </div>
            </div>
          </div>

          {/* Search Input */}
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Coin ara (BTC, ETH, SOL...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#181d24] border border-[#2a3038] rounded-lg pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 font-mono uppercase touch-manipulation min-h-[38px]"
            />
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mask-fade-right py-0.5 shrink-0">
          <button
            onClick={() => (tab === 'volume' ? setVolAsc((v) => !v) : setTab('volume'))}
            aria-pressed={tab === 'volume' && volAsc}
            title="Hacim sıralaması (tekrar tıkla: yön değiştir)"
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all touch-manipulation ${
              tab === 'volume'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
                : 'text-slate-400 hover:text-slate-200 bg-[#161b22] border border-[#22272e]'
            }`}
          >
            <ArrowUpDown className={`w-3.5 h-3.5 transition-transform ${tab === 'volume' && volAsc ? 'rotate-180' : ''}`} />
            <span>Hacim</span>
          </button>

          <button
            onClick={() => setTab('gainers')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all touch-manipulation ${
              tab === 'gainers'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'text-slate-400 hover:text-slate-200 bg-[#161b22] border border-[#22272e]'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Artanlar</span>
          </button>

          <button
            onClick={() => setTab('losers')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all touch-manipulation ${
              tab === 'losers'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                : 'text-slate-400 hover:text-slate-200 bg-[#161b22] border border-[#22272e]'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5 text-rose-400" />
            <span>Düşenler</span>
          </button>

          <button
            onClick={() => setTab('favs')}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0 transition-all touch-manipulation ${
              tab === 'favs'
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                : 'text-slate-400 hover:text-slate-200 bg-[#161b22] border border-[#22272e]'
            }`}
          >
            <Star className="w-3.5 h-3.5 text-amber-400 fill-current" />
            <span>Favoriler ({favs.length})</span>
          </button>
        </div>

        {/* Mobile-First Card List (No horizontal overflow) */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#1e242d] border border-[#22272e] rounded-lg bg-[#0e1218]">
          {filteredTickers.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs">
              Eşleşen Futures çifti bulunamadı.
            </div>
          ) : (
            <React.Fragment>
            {filteredTickers.slice(0, visibleCount).map((t) => {
              const isF = favs.includes(t.symbol);
              const isSelected = t.symbol === selectedSymbol;
              const isPositive = t.priceChangePercent >= 0;

              return (
                <div
                  key={t.symbol}
                  onClick={() => onSelectSymbol(t.symbol)}
                  className={`p-3 flex items-center justify-between gap-2.5 hover:bg-[#161b22] active:bg-[#1b212a] cursor-pointer transition-colors touch-manipulation ${
                    isSelected ? 'bg-emerald-500/10 border-l-2 border-l-emerald-400' : ''
                  }`}
                >
                  {/* Left: Star + Symbol info */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFav(t.symbol);
                      }}
                      className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors shrink-0 touch-manipulation active:scale-95 ${
                        isF
                          ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                          : 'bg-[#181e26] border-[#29323f] text-slate-500'
                      }`}
                    >
                      <Star className="w-4 h-4 fill-current" />
                    </button>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-xs sm:text-sm text-slate-100 font-mono tracking-wide truncate">
                          {t.symbol}
                        </span>
                        <span className="text-[9px] font-bold text-emerald-400 px-1 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 shrink-0 font-mono">
                          PERP
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Hacim: <span className="text-slate-300 font-semibold">${(t.quoteVolume / 1e6).toFixed(1)}M</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Price & 24h Change */}
                  <div className="text-right font-mono shrink-0">
                    <div className="text-xs sm:text-sm font-bold text-slate-100">
                      ${t.lastPrice >= 100 ? t.lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.lastPrice.toFixed(4)}
                    </div>
                    <div
                      className={`text-[11px] font-bold inline-block px-1.5 py-0.5 rounded mt-0.5 ${
                        isPositive
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {isPositive ? '+' : ''}{t.priceChangePercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              );
            })}
            {filteredTickers.length > visibleCount && (
              <button
                onClick={() => setVisibleCount((c) => c + 100)}
                className="w-full py-3 text-xs font-bold text-emerald-400 hover:bg-[#161b22] transition-colors touch-manipulation min-h-[44px]"
              >
                Daha fazla göster ({filteredTickers.length - visibleCount} kaldı)
              </button>
            )}
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
};
