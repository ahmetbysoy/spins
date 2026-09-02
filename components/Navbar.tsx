'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Star,
  Search,
  ChevronDown,
  RefreshCw,
  Volume2,
  VolumeX,
  Bell,
  BellOff,
  BellRing,
  History
} from 'lucide-react';
import { AppView, Ticker24h } from '@/lib/types';
import { soundEngine } from '@/lib/audio';

interface NavbarProps {
  symbol: string;
  onSelectSymbol: (symbol: string) => void;
  symbols: string[];
  tickers: Ticker24h[];
  favs: string[];
  onToggleFav: (symbol: string) => void;
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  lastPrice: number;
  fundingRate: number | null;
  nextFundingTime: number | null;
  wsConnected: boolean;
  marketConnected?: boolean;
  depthConnected?: boolean;
  wsMessage?: string;
  onReconnect?: () => void;
  notifyEnabled?: boolean;
  notifyPermissionState?: 'granted' | 'denied' | 'default' | 'unsupported';
  onToggleNotify?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  symbol,
  onSelectSymbol,
  symbols,
  tickers,
  favs,
  onToggleFav,
  lastPrice,
  wsConnected,
  marketConnected = true,
  depthConnected = true,
  onReconnect,
  notifyEnabled = false,
  notifyPermissionState = 'unsupported',
  onToggleNotify
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [soundActive, setSoundActive] = useState(() => soundEngine.isEnabled());
  const [recents, setRecents] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedRecents = localStorage.getItem('fs_recents');
        if (storedRecents) return JSON.parse(storedRecents);
      } catch {}
    }
    return [];
  });
  const [isReconnecting, setIsReconnecting] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const isFav = favs.includes(symbol);
  const currentTicker = tickers.find((t) => t.symbol === symbol);
  const priceChange = currentTicker?.priceChangePercent || 0;

  const handleSelectWithRecent = (sym: string) => {
    onSelectSymbol(sym);
    setSearchOpen(false);
    setSearchQuery('');
    setRecents((prev) => {
      const next = [sym, ...prev.filter((s) => s !== sym)].slice(0, 8);
      if (typeof window !== 'undefined') {
        localStorage.setItem('fs_recents', JSON.stringify(next));
      }
      return next;
    });
  };

  const toggleSound = () => {
    const next = !soundActive;
    setSoundActive(next);
    soundEngine.setEnabled(next);
  };

  const handleReconnectClick = () => {
    if (onReconnect) {
      setIsReconnecting(true);
      onReconnect();
      setTimeout(() => setIsReconnecting(false), 1000);
    }
  };

  // Click outside to close search dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredSymbols = searchQuery
    ? symbols.filter((s) => s.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 30)
    : [
        ...favs,
        ...tickers.slice(0, 20).map((t) => t.symbol).filter((s) => !favs.includes(s))
      ].slice(0, 25);

  return (
    <header className="safe-top bg-[#10141b] border-b border-[#1e242d] px-2.5 sm:px-4 flex items-center justify-between gap-2 z-40 select-none shrink-0 min-h-[3.25rem]">
      {/* Left: Symbol Selector & Star */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        {/* Symbol Search Trigger */}
        <div className="relative min-w-0 flex-1 max-w-xs" ref={searchRef}>
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="w-full flex items-center justify-between gap-1.5 bg-[#161b22] active:bg-[#1f252f] hover:bg-[#1a2029] border border-[#27303c] rounded-lg px-2.5 py-1.5 transition-all text-left min-h-[40px] touch-manipulation"
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-mono font-bold text-sm text-slate-100 tracking-wide truncate min-w-[61px]">{symbol}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${searchOpen ? 'rotate-180' : ''}`} />
            </div>
          </button>

          {/* Search Dropdown Modal */}
          {searchOpen && (
            <div className="absolute top-full left-0 mt-1.5 w-72 sm:w-80 bg-[#14181f] border border-[#2a333f] rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[70vh] backdrop-blur-xl">
              <div className="p-2 border-b border-[#212832] bg-[#0e1117]">
                <input
                  type="text"
                  placeholder="Coin ara (BTC, ETH, SOL...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                  className="w-full bg-[#181e26] border border-[#2b3542] rounded-lg px-3 py-2 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-emerald-500 font-mono uppercase"
                />
              </div>
              {recents.length > 0 && !searchQuery && (
                <div className="p-2 border-b border-[#212832] bg-[#11151b]">
                  <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1 mb-1.5 px-1">
                    <History className="w-3 h-3 text-cyan-400" /> Son Bakılanlar
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {recents.map((rc) => (
                      <button
                        key={rc}
                        onClick={() => handleSelectWithRecent(rc)}
                        className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                          rc === symbol
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-bold'
                            : 'bg-[#181e26] text-slate-300 border-[#2b3542] hover:border-slate-500'
                        }`}
                      >
                        {rc}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="overflow-y-auto flex-1 divide-y divide-[#1e242d]">
                {filteredSymbols.map((sym) => {
                  const t = tickers.find((x) => x.symbol === sym);
                  const chg = t?.priceChangePercent || 0;
                  const isF = favs.includes(sym);
                  return (
                    <div
                      key={sym}
                      onClick={() => handleSelectWithRecent(sym)}
                      className="px-3 py-2.5 hover:bg-[#1c222b] active:bg-[#222935] cursor-pointer flex items-center justify-between group transition-colors touch-manipulation"
                    >
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFav(sym);
                          }}
                          className={`p-1.5 rounded hover:bg-slate-700/50 ${isF ? 'text-amber-400' : 'text-slate-500'}`}
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                        <div>
                          <div className="font-mono font-bold text-xs text-slate-200 group-hover:text-emerald-400 transition-colors">
                            {sym}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            Vol: ${((t?.quoteVolume || 0) / 1e6).toFixed(1)}M
                          </div>
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="text-xs text-slate-200">${t?.lastPrice ? t.lastPrice.toLocaleString() : '---'}</div>
                        <div className={`text-[10px] font-semibold ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Favorite Star Button (40x40 Touch Target) */}
        <button
          onClick={() => onToggleFav(symbol)}
          className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-colors shrink-0 touch-manipulation active:scale-95 ${
            isFav
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              : 'bg-[#161b22] border-[#27303c] text-slate-500 hover:text-slate-300'
          }`}
          title={isFav ? 'Favorilerden çıkar' : 'Favorilere ekle'}
        >
          <Star className="w-4 h-4 fill-current" />
        </button>
      </div>

      {/* Right: Price, Audio, Status & Reconnect */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Quick Price Display */}
        <div className="font-mono text-right pr-1">
          <div className="text-xs sm:text-sm font-extrabold text-slate-100 tracking-tight">
            ${lastPrice > 0 ? (lastPrice >= 100 ? lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : lastPrice.toFixed(4)) : '---'}
          </div>
          <div className={`text-[10px] font-mono font-bold ${priceChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(1)}%
          </div>
        </div>

        {/* Audio Alerts Toggle (40x40 Touch Target) */}
        <button
          onClick={toggleSound}
          className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-colors shrink-0 touch-manipulation active:scale-95 ${
            soundActive
              ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400'
              : 'bg-[#161b22] border-[#27303c] text-slate-500'
          }`}
          title={soundActive ? 'Sesli Uyarılar: Açık' : 'Sesli Uyarılar: Kapalı'}
        >
          {soundActive ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>

        {/* Browser Notifications Toggle (40x40 Touch Target) */}
        {onToggleNotify && (
          <button
            onClick={onToggleNotify}
            className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-colors shrink-0 touch-manipulation active:scale-95 ${
              notifyEnabled && notifyPermissionState === 'granted'
                ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                : notifyPermissionState === 'denied'
                  ? 'bg-[#161b22] border-rose-500/30 text-rose-400/70'
                  : 'bg-[#161b22] border-[#27303c] text-slate-500'
            }`}
            title={
              notifyPermissionState === 'unsupported'
                ? 'Tarayıcı bildirimleri desteklenmiyor'
                : notifyPermissionState === 'denied'
                  ? 'Bildirim izni reddedilmiş — tarayıcı ayarlarından açabilirsin'
                  : notifyEnabled
                    ? 'Tarayıcı Bildirimleri: Açık'
                    : 'Tarayıcı Bildirimleri: Kapalı (sinyal/radar/whale push)'
            }
          >
            {notifyEnabled && notifyPermissionState === 'granted' ? (
              <BellRing className="w-4 h-4" />
            ) : notifyPermissionState === 'denied' ? (
              <BellOff className="w-4 h-4" />
            ) : (
              <Bell className="w-4 h-4" />
            )}
          </button>
        )}

        {/* Manual WS Reconnect Button (40x40 Touch Target) */}
        {onReconnect && (
          <button
            onClick={handleReconnectClick}
            disabled={isReconnecting}
            className={`w-10 h-10 rounded-lg border bg-[#161b22] border-[#27303c] flex items-center justify-center text-slate-400 hover:text-emerald-400 transition-colors shrink-0 touch-manipulation active:scale-95 ${
              isReconnecting ? 'animate-spin text-emerald-400' : ''
            }`}
            title="Bağlantıyı Yenile (Force WS Reconnect)"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}
      </div>
    </header>
  );
};
