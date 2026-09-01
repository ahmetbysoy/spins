import { Candle, DepthUpdateEvent, FlowEvent, FlowSnapshot, LiquidationEvent, SymbolInfo, Ticker24h, TradeEvent } from './types';

export const REST_BASE = typeof window !== 'undefined' ? '/api/binance' : 'https://fapi.binance.com';
export const WS_BASE = 'wss://fstream.binance.com';
export const WS_MARKET_BASE = 'wss://fstream.binance.com/market';
export const WS_PUBLIC_BASE = 'wss://fstream.binance.com/public';

function fetchWithTimeout(url: string, timeoutMs: number = 8000): Promise<Response> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  return fetch(url, { signal: controller?.signal })
    .then((res) => {
      if (timer) clearTimeout(timer);
      return res;
    })
    .catch((err) => {
      if (timer) clearTimeout(timer);
      throw err;
    });
}

export async function fetchExchangeInfo(): Promise<SymbolInfo[]> {
  const res = await fetchWithTimeout(`${REST_BASE}/fapi/v1/exchangeInfo`);
  if (!res.ok) throw new Error(`exchangeInfo HTTP ${res.status}`);
  const data = await res.json();
  const symbols: SymbolInfo[] = [];

  for (const s of data.symbols) {
    if (s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING') {
      const priceFilter = s.filters.find((f: { filterType: string }) => f.filterType === 'PRICE_FILTER');
      const lotFilter = s.filters.find((f: { filterType: string }) => f.filterType === 'LOT_SIZE');
      const tick = priceFilter && priceFilter.tickSize ? parseFloat(priceFilter.tickSize) : 0.0001;
      const step = lotFilter && lotFilter.stepSize ? parseFloat(lotFilter.stepSize) : 0.001;
      symbols.push({
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        tickSize: tick,
        stepSize: step,
        pricePrecision: Math.max(0, Math.round(-Math.log10(tick))),
        quantityPrecision: Math.max(0, Math.round(-Math.log10(step)))
      });
    }
  }
  return symbols.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export async function fetchKlines(symbol: string, interval: string, limit: number = 600): Promise<Candle[]> {
  const res = await fetchWithTimeout(`${REST_BASE}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`klines HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Invalid klines response');

  return data.map((k) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

export async function fetch24hTickers(): Promise<Ticker24h[]> {
  const res = await fetchWithTimeout(`${REST_BASE}/fapi/v1/ticker/24hr`);
  if (!res.ok) throw new Error(`ticker/24hr HTTP ${res.status}`);
  const data = await res.json();
  return (data as { symbol: string; lastPrice: string; priceChangePercent: string; quoteVolume: string; highPrice: string; lowPrice: string; count: number }[])
    .filter((t) => t.symbol.endsWith('USDT'))
    .map((t) => ({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChangePercent: parseFloat(t.priceChangePercent),
      quoteVolume: parseFloat(t.quoteVolume),
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
      count: t.count
    }))
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
}

export async function fetchOpenInterest(symbol: string): Promise<number | null> {
  try {
    const res = await fetchWithTimeout(`${REST_BASE}/fapi/v1/openInterest?symbol=${symbol}`, 5000);
    if (!res.ok) return null;
    const data = await res.json();
    const val = parseFloat(data.openInterest);
    return Number.isFinite(val) && val > 0 ? val : null;
  } catch {
    return null;
  }
}

export async function fetchPremiumIndex(symbol: string): Promise<{ fundingRate: number | null; markPrice: number | null; nextFundingTime: number | null }> {
  try {
    const res = await fetchWithTimeout(`${REST_BASE}/fapi/v1/premiumIndex?symbol=${symbol}`, 5000);
    if (!res.ok) return { fundingRate: null, markPrice: null, nextFundingTime: null };
    const data = await res.json();
    return {
      fundingRate: data.lastFundingRate ? parseFloat(data.lastFundingRate) : null,
      markPrice: data.markPrice ? parseFloat(data.markPrice) : null,
      nextFundingTime: data.nextFundingTime ? parseInt(data.nextFundingTime, 10) : null
    };
  } catch {
    return { fundingRate: null, markPrice: null, nextFundingTime: null };
  }
}

export async function fetchDepthSnapshot(symbol: string, limit: number = 1000): Promise<{
  lastUpdateId: number;
  bids: [number, number][];
  asks: [number, number][];
}> {
  const res = await fetchWithTimeout(`${REST_BASE}/fapi/v1/depth?symbol=${symbol}&limit=${limit}`, 6000);
  if (!res.ok) throw new Error(`depth snapshot HTTP ${res.status}`);
  const snap = await res.json();
  const bids: [number, number][] = (snap.bids || []).map((x: [string, string]) => [parseFloat(x[0]), parseFloat(x[1])]);
  const asks: [number, number][] = (snap.asks || []).map((x: [string, string]) => [parseFloat(x[0]), parseFloat(x[1])]);
  return {
    lastUpdateId: parseInt(snap.lastUpdateId, 10) || 0,
    bids,
    asks
  };
}

export interface StreamStatus {
  connected: boolean;
  marketConnected: boolean;
  depthConnected: boolean;
  message?: string;
}

export interface StreamCallbacks {
  onKline?: (candle: Candle, isClosed: boolean) => void;
  onTrade?: (trade: TradeEvent) => void;
  onMarkPrice?: (mark: { markPrice: number; fundingRate: number; nextFundingTime: number }) => void;
  onLiquidation?: (liq: LiquidationEvent) => void;
  onDepthUpdate?: (depth: { bids: Map<number, number>; asks: Map<number, number>; lastUpdateId: number }) => void;
  onStatusChange?: (status: StreamStatus) => void;
}

/**
 * Binance Futures Routed WebSocket Client (2026+ Architecture)
 * - Market Stream: wss://fstream.binance.com/market/stream?streams=... (kline, aggTrade, markPrice, forceOrder)
 * - Public Stream: wss://fstream.binance.com/public/ws/... (depth@100ms + snapshot diff sync)
 */
export class BinanceStreamClient {
  private symbol: string = 'BTCUSDT';
  private interval: string = '5m';
  private callbacks: StreamCallbacks = {};
  private active = false;

  // Sockets
  private marketWs: WebSocket | null = null;
  private publicWs: WebSocket | null = null;

  // Connection tracking & timers
  private marketConnected = false;
  private depthConnected = false;
  private marketRetry = 0;
  private publicRetry = 0;
  private marketReconnectTimer: NodeJS.Timeout | null = null;
  private publicReconnectTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private marketLastMsg = 0;
  private publicLastMsg = 0;
  private marketConnectTime = 0;
  private publicConnectTime = 0;

  // Depth Sync State
  public bidsBook = new Map<number, number>();
  public asksBook = new Map<number, number>();
  public depthSynced = false;
  public depthLastUpdate = 0;
  private depthBuffer: DepthUpdateEvent[] = [];
  private syncGen = 0;

  constructor(symbol: string, interval: string, callbacks: StreamCallbacks) {
    this.symbol = symbol.toUpperCase();
    this.interval = interval;
    this.callbacks = callbacks;
  }

  public setCallbacks(callbacks: StreamCallbacks) {
    this.callbacks = callbacks;
  }

  public updateConfig(symbol: string, interval: string) {
    const symbolChanged = this.symbol !== symbol.toUpperCase();
    const intervalChanged = this.interval !== interval;

    this.symbol = symbol.toUpperCase();
    this.interval = interval;

    if (symbolChanged || intervalChanged) {
      this.reconnect();
    }
  }

  public start() {
    this.active = true;
    this.connectMarket();
    this.connectPublic();
    this.startWatchdog();
  }

  public stop() {
    this.active = false;
    this.cleanupMarket();
    this.cleanupPublic();
    if (this.marketReconnectTimer) clearTimeout(this.marketReconnectTimer);
    if (this.publicReconnectTimer) clearTimeout(this.publicReconnectTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.depthSynced = false;
    this.depthBuffer = [];
  }

  public reconnect() {
    this.cleanupMarket();
    this.cleanupPublic();
    this.depthSynced = false;
    this.depthBuffer = [];
    this.bidsBook.clear();
    this.asksBook.clear();
    this.marketRetry = 0;
    this.publicRetry = 0;
    this.connectMarket();
    this.connectPublic();
  }

  private notifyStatus(msg?: string) {
    const isConn = this.marketConnected && this.depthConnected;
    const fallbackMsg = isConn
      ? 'Bağlandı (Market✓ | Depth✓)'
      : this.marketConnected
        ? 'Market bağlı, Depth bekleniyor...'
        : this.depthConnected
          ? 'Depth bağlı, Market bekleniyor...'
          : 'Bağlanıyor...';

    this.callbacks.onStatusChange?.({
      connected: isConn || this.marketConnected,
      marketConnected: this.marketConnected,
      depthConnected: this.depthConnected,
      message: msg || fallbackMsg
    });
  }

  // --- Watchdog & 23h proactive reconnect ---
  private startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.active) return;
      const now = Date.now();

      // Market watchdog (30s idle)
      if (this.marketWs && this.marketLastMsg > 0 && now - this.marketLastMsg > 30000) {
        console.warn('[MarketWS] Idle timeout, reconnecting...');
        this.connectMarket();
      }

      // Public depth watchdog (30s idle)
      if (this.publicWs && this.publicLastMsg > 0 && now - this.publicLastMsg > 30000) {
        console.warn('[PublicDepthWS] Idle timeout, reconnecting...');
        this.connectPublic();
      }

      // 23-hour proactive connection refresh (Binance 24h hard disconnect avoidance)
      const TWENTY_THREE_HOURS = 23 * 60 * 60 * 1000;
      if (this.marketConnectTime > 0 && now - this.marketConnectTime > TWENTY_THREE_HOURS) {
        console.info('[MarketWS] 23h proactive refresh');
        this.connectMarket();
      }
      if (this.publicConnectTime > 0 && now - this.publicConnectTime > TWENTY_THREE_HOURS) {
        console.info('[PublicDepthWS] 23h proactive refresh');
        this.connectPublic();
      }
    }, 10000);
  }

  // --- Market Stream: Kline + AggTrade + MarkPrice + ForceOrder ---
  private cleanupMarket() {
    if (this.marketWs) {
      this.marketWs.onopen = null;
      this.marketWs.onclose = null;
      this.marketWs.onerror = null;
      this.marketWs.onmessage = null;
      try {
        this.marketWs.close();
      } catch {}
      this.marketWs = null;
    }
    this.marketConnected = false;
  }

  private connectMarket() {
    if (!this.active) return;
    this.cleanupMarket();

    const sym = this.symbol.toLowerCase();
    const streams = [
      `${sym}@kline_${this.interval}`,
      `${sym}@aggTrade`,
      `${sym}@markPrice@1s`,
      `!forceOrder@arr`
    ].join('/');

    const url = `${WS_MARKET_BASE}/stream?streams=${streams}`;
    this.notifyStatus('Market bağlanıyor...');

    try {
      this.marketWs = new WebSocket(url);
    } catch {
      this.scheduleMarketReconnect();
      return;
    }

    this.marketWs.onopen = () => {
      this.marketRetry = 0;
      this.marketLastMsg = Date.now();
      this.marketConnectTime = Date.now();
      this.marketConnected = true;
      this.notifyStatus();
    };

    this.marketWs.onmessage = (ev) => {
      this.marketLastMsg = Date.now();
      let payload: any;
      try {
        payload = JSON.parse(ev.data);
      } catch {
        return;
      }

      const data = payload.data || payload;
      if (!data) return;

      const eventType = data.e;
      if (eventType === 'kline' && data.s === this.symbol) {
        const k = data.k;
        if (k) {
          const candle: Candle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v)
          };
          this.callbacks.onKline?.(candle, !!k.x);
        }
      } else if (eventType === 'aggTrade' && data.s === this.symbol) {
        const price = parseFloat(data.p);
        const qty = parseFloat(data.q);
        const notional = price * qty;
        const isSell = !!data.m;
        const trade: TradeEvent = {
          ts: data.T || data.E || Date.now(),
          price,
          qty,
          notional,
          delta: isSell ? -notional : notional,
          side: isSell ? 'sell' : 'buy'
        };
        this.callbacks.onTrade?.(trade);
      } else if (eventType === 'markPriceUpdate' && data.s === this.symbol) {
        this.callbacks.onMarkPrice?.({
          markPrice: parseFloat(data.p),
          fundingRate: parseFloat(data.r),
          nextFundingTime: data.T ? parseInt(data.T, 10) : 0
        });
      } else if (eventType === 'forceOrder') {
        const o = data.o || {};
        if (o.s === this.symbol) {
          const price = parseFloat(o.ap || o.p);
          const qty = parseFloat(o.z || o.q);
          const notional = price * qty;
          const side = o.S as 'BUY' | 'SELL';
          const liq: LiquidationEvent = {
            ts: o.T || data.E || Date.now(),
            price,
            qty,
            notional,
            side,
            type: side === 'SELL' ? 'LONG_LIQ' : 'SHORT_LIQ'
          };
          this.callbacks.onLiquidation?.(liq);
        }
      }
    };

    this.marketWs.onclose = () => {
      this.marketConnected = false;
      this.notifyStatus('Market koptu, tekrar deneniyor...');
      this.scheduleMarketReconnect();
    };

    this.marketWs.onerror = () => {
      try {
        this.marketWs?.close();
      } catch {}
    };
  }

  private scheduleMarketReconnect() {
    if (!this.active) return;
    if (this.marketReconnectTimer) clearTimeout(this.marketReconnectTimer);
    const delay = Math.min(25000, 1000 * Math.pow(1.5, this.marketRetry++));
    this.marketReconnectTimer = setTimeout(() => {
      this.connectMarket();
    }, delay);
  }

  // --- Public Stream: Depth 100ms + Snapshot Diff Sync ---
  private cleanupPublic() {
    if (this.publicWs) {
      this.publicWs.onopen = null;
      this.publicWs.onclose = null;
      this.publicWs.onerror = null;
      this.publicWs.onmessage = null;
      try {
        this.publicWs.close();
      } catch {}
      this.publicWs = null;
    }
    this.depthConnected = false;
  }

  private connectPublic() {
    if (!this.active) return;
    this.cleanupPublic();

    const sym = this.symbol.toLowerCase();
    const url = `${WS_PUBLIC_BASE}/ws/${sym}@depth@100ms`;

    const gen = ++this.syncGen;
    try {
      this.publicWs = new WebSocket(url);
    } catch {
      this.schedulePublicReconnect();
      return;
    }

    this.publicWs.onopen = () => {
      this.publicRetry = 0;
      this.publicLastMsg = Date.now();
      this.publicConnectTime = Date.now();
      this.depthConnected = true;
      this.notifyStatus();
      this.initDepthSync(gen);
    };

    this.publicWs.onmessage = (ev) => {
      this.publicLastMsg = Date.now();
      let data: any;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }

      if (data.e === 'depthUpdate' && data.s === this.symbol) {
        this.handleDepthMessage(data, gen);
      }
    };

    this.publicWs.onclose = () => {
      this.depthConnected = false;
      this.notifyStatus('Depth koptu, tekrar deneniyor...');
      this.schedulePublicReconnect();
    };

    this.publicWs.onerror = () => {
      try {
        this.publicWs?.close();
      } catch {}
    };
  }

  private schedulePublicReconnect() {
    if (!this.active) return;
    if (this.publicReconnectTimer) clearTimeout(this.publicReconnectTimer);
    const delay = Math.min(25000, 1000 * Math.pow(1.5, this.publicRetry++));
    this.publicReconnectTimer = setTimeout(() => {
      this.connectPublic();
    }, delay);
  }

  private async initDepthSync(gen: number) {
    try {
      const snap = await fetchDepthSnapshot(this.symbol, 1000);
      if (gen !== this.syncGen || !this.active) return;

      this.bidsBook.clear();
      this.asksBook.clear();
      snap.bids.forEach(([p, q]) => {
        if (q > 0) this.bidsBook.set(p, q);
      });
      snap.asks.forEach(([p, q]) => {
        if (q > 0) this.asksBook.set(p, q);
      });

      this.depthLastUpdate = snap.lastUpdateId;

      // Apply buffered diffs with u >= lastUpdateId + 1
      for (const m of this.depthBuffer) {
        const U = m.U;
        const u = m.u;
        if (u < this.depthLastUpdate + 1) continue;
        if (U > this.depthLastUpdate + 1) {
          // Gap detected, re-sync snapshot
          this.depthBuffer = [];
          this.initDepthSync(gen);
          return;
        }
        this.applyDepthDiff(m);
        this.depthLastUpdate = u;
      }

      this.depthBuffer = [];
      this.depthSynced = true;
      this.callbacks.onDepthUpdate?.({
        bids: this.bidsBook,
        asks: this.asksBook,
        lastUpdateId: this.depthLastUpdate
      });
    } catch (e) {
      console.warn('[DepthSync] Snapshot failed, retrying in 2s...', e);
      if (gen === this.syncGen && this.active) {
        setTimeout(() => this.initDepthSync(gen), 2000);
      }
    }
  }

  private handleDepthMessage(data: DepthUpdateEvent, gen: number) {
    if (!this.depthSynced) {
      this.depthBuffer.push(data);
      if (this.depthBuffer.length > 2000) {
        this.depthBuffer = this.depthBuffer.slice(-1500);
      }
      return;
    }

    const finalId = data.u;
    if (finalId <= this.depthLastUpdate) return;

    this.applyDepthDiff(data);
    this.depthLastUpdate = finalId;

    this.callbacks.onDepthUpdate?.({
      bids: this.bidsBook,
      asks: this.asksBook,
      lastUpdateId: this.depthLastUpdate
    });
  }

  private applyDepthDiff(data: DepthUpdateEvent) {
    const bids = data.b || [];
    const asks = data.a || [];

    for (const [pStr, qStr] of bids) {
      const p = parseFloat(pStr);
      const q = parseFloat(qStr);
      if (q === 0) this.bidsBook.delete(p);
      else this.bidsBook.set(p, q);
    }

    for (const [pStr, qStr] of asks) {
      const p = parseFloat(pStr);
      const q = parseFloat(qStr);
      if (q === 0) this.asksBook.delete(p);
      else this.asksBook.set(p, q);
    }
  }
}
