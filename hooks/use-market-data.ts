'use client';

// Borsa meta verisi: exchange info + 24s ticker'lar (15sn yenile).
// Kod, app/page.tsx içinden birebir taşındı (davranış değişikliği yok).
import { useEffect, useState } from 'react';
import type { SymbolInfo, Ticker24h } from '@/lib/types';
import { fetch24hTickers, fetchExchangeInfo } from '@/lib/binance';

export interface MarketDataApi {
  symbols: string[];
  symbolInfos: SymbolInfo[];
  tickers: Ticker24h[];
}

export function useMarketData(): MarketDataApi {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [symbolInfos, setSymbolInfos] = useState<SymbolInfo[]>([]);
  const [tickers, setTickers] = useState<Ticker24h[]>([]);
  // 1. Load Exchange Info & 24h Tickers
  useEffect(() => {
    const loadMarketData = async () => {
      try {
        const [infos, tickerList] = await Promise.all([fetchExchangeInfo(), fetch24hTickers()]);
        setSymbolInfos(infos);
        setSymbols(infos.map((i) => i.symbol));
        setTickers(tickerList);
      } catch (e) {
        console.warn('Failed to load exchange info:', e);
      }
    };
    loadMarketData();
    const intervalId = window.setInterval(async () => {
      try {
        const tickerList = await fetch24hTickers();
        setTickers(tickerList);
      } catch {}
    }, 15000);
    return () => clearInterval(intervalId);
  }, []);

  return { symbols, symbolInfos, tickers };
}
