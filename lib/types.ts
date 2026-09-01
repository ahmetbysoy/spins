export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeEvent {
  ts: number;
  price: number;
  qty: number;
  notional: number;
  delta: number; // positive for buy, negative for sell
  side: 'buy' | 'sell';
}

export interface LiquidationEvent {
  ts: number;
  price: number;
  qty: number;
  notional: number;
  side: 'BUY' | 'SELL'; // SELL = Long liquidated, BUY = Short liquidated
  type: 'LONG_LIQ' | 'SHORT_LIQ';
}

export interface FlowEvent {
  id: string;
  type: 'WHALE' | 'SWEEP' | 'ABSORPTION' | 'DELTA_BURST' | 'SPOOF' | 'LIQUIDATION';
  sev: 'high' | 'medium' | 'low';
  text: string;
  ts: number;
  side?: 'buy' | 'sell';
}

export interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  tickSize: number;
  stepSize: number;
  pricePrecision: number;
  quantityPrecision: number;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
  count: number;
}

export interface HeatmapBin {
  side: 'B' | 'A';
  price: number;
  notional: number;
}

export interface HeatmapFrame {
  t: number;
  bins: HeatmapBin[];
  max: number;
}

export interface WallRecord {
  side: 'B' | 'A';
  price: number;
  notional: number;
  established: boolean;
  ageSec: number;
}

export interface AppSettings {
  ma1: number;
  ma2: number;
  ma3: number;
  sarStep: number;
  sarMax: number;
  nWindow: number;
  dark: boolean;
  showMa: boolean;
  showSar: boolean;
  showVol: boolean;
  rawConfirm: boolean;
  showFlow: boolean;
  showLiq: boolean;
  liqMin: number;
  oiPollSec: number;
  cascadePct: number;
  showLadder: boolean;
  showHeatmap: boolean;
  whaleAlerts: boolean;
  whaleMin: number;
  wallPct: number;
  showBB: boolean;
  showRsi: boolean;
  showMacd: boolean;
  showVwap: boolean;
  bbPeriod: number;
  bbStd: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  patternWinPct: number;
  ma1Color: string;
  ma2Color: string;
  ma3Color: string;
  ma1Width: number;
  ma2Width: number;
  ma3Width: number;
  sarColor: string;
  sarWidth: number;
  bbColor: string;
  bbWidth: number;
  vwapColor: string;
  vwapWidth: number;
  rsiColor: string;
  rsiWidth: number;
  macdColor: string;
  macdWidth: number;
  macdSignalColor: string;
  macdSignalWidth: number;
}

export interface FlowSnapshot {
  cvd60: number;
  notional60: number;
  cvdBias: number;
  cvdSlope: number;
  obi: number;
  bidVol: number;
  askVol: number;
  longLiq60: number;
  shortLiq60: number;
  oi: number | null;
  oiChangePct: number;
  funding: number | null;
  markPrice: number | null;
  nextFunding: number | null;
  bestBid: number;
  bestAsk: number;
  spread: number;
  taker30: number;
  takerSpike: boolean;
  rangePct: number;
  atrPct: number;
  tightRange: boolean;
  change5: number;
  cascadeDown: boolean;
  cascadeUp: boolean;
  wallCount: { bid: number; ask: number };
}

export interface DecisionEvaluation {
  score: number | null;
  grade: 'YÜKSEK' | 'ORTA+' | 'ORTA' | 'ZAYIF' | 'HAM';
  summary: string;
  reasons: string[];
  metrics: FlowSnapshot;
}

export interface SignalLogEntry {
  id: string;
  dir: 'AL' | 'SAT';
  rule: string;
  price: number;
  ts: number;
  score: number | null;
  grade: string;
  reasons: string[];
  patternId?: string | null;
}

export interface PatternStats {
  key: string;
  schemaVersion: number;
  updatedAt: number;
  scope: 'global' | 'coin';
  coin?: string | null;
  timeframe: string;
  patternId: string;
  n: number;
  wins: number;
  winRate: number;
  wilsonLower: number;
  avgRet10: number;
  stdRet10: number;
  avgMfe20: number;
  avgMae20: number;
  avgRMultiple: number;
  medBarsToMfe: number;
  weightedWinRate: number;
  weightedAvgRet10: number;
  regimes: Record<string, {
    key: string;
    n: number;
    wins: number;
    ret10Sum: number;
    winRate: number;
    avgRet10: number;
  }>;
}

export interface PatternEvent {
  id?: number;
  schemaVersion: number;
  source: 'live' | 'backfill';
  coin: string;
  timeframe: string;
  timestamp: number;
  eventKey: string;
  pair: string;
  dir: 'UP' | 'DOWN';
  filter: 'F1' | 'F0';
  sarBucket?: 'SAR0' | 'SAR1' | 'SAR2-3' | 'SARX';
  patternId?: string;
  patternKey?: string;
  coinPatternKey?: string;
  volRegime: 'LOW' | 'MID' | 'HIGH';
  trendRegime: 'UP' | 'DOWN' | 'FLAT';
  regimeKey: string;
  refClose: number;
  status: 'pending' | 'tracking' | 'settled';
  createdAt: number;
  settledAt?: number;
  ret5?: number;
  ret10?: number;
  ret20?: number;
  mfe20?: number;
  mae20?: number;
  rMultiple?: number;
  barsToMfe?: number;
  barsToMae?: number;
}
