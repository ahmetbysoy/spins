// Saf orderflow anlık görüntü hesabı — bileşenden bağımsız, birim test edilebilir.
// Mantık, canlı akıştaki orijinal hesaplamayla birebir aynıdır.
import { Candle, FlowSnapshot, LiquidationEvent, TradeEvent } from './types';

export interface FlowSnapshotInput {
  now: number;
  trades: TradeEvent[];
  liquidations: LiquidationEvent[];
  candles: Candle[];
  bids: Map<number, number>;
  asks: Map<number, number>;
  lastPrice: number;
  oi: number | null;
  oiPrev: number | null;
  funding: number | null;
  markPrice: number | null;
  nextFunding: number | null;
  cascadePct: number; // yüzde (örn. 0.8)
  whaleMin: number;
  liqMin: number;
}

export function computeFlowSnapshotCore(input: FlowSnapshotInput): FlowSnapshot {
  const { now, trades, liquidations, candles, bids, asks, lastPrice } = input;

  // 60s CVD & notional (+ önceki 2 dk karşılaştırma penceresi)
  let cvd60 = 0;
  let notional60 = 0;
  let cvdPrev = 0;
  let notionalPrev = 0;
  let taker30 = 0;

  for (let i = trades.length - 1; i >= 0; i--) {
    const t = trades[i];
    const age = now - t.ts;
    if (age <= 30000) taker30 += t.notional;
    if (age <= 60000) {
      cvd60 += t.delta;
      notional60 += t.notional;
    } else if (age <= 180000) {
      cvdPrev += t.delta;
      notionalPrev += t.notional;
    }
  }

  const cvdBias = notional60 > 0 ? cvd60 / notional60 : 0;
  const prevBias = notionalPrev > 0 ? cvdPrev / notionalPrev : 0;
  const cvdSlope = cvdBias - prevBias;

  // Liquidations 60s
  let longLiq60 = 0;
  let shortLiq60 = 0;
  for (let i = liquidations.length - 1; i >= 0; i--) {
    const l = liquidations[i];
    if (now - l.ts <= 60000) {
      if (l.type === 'LONG_LIQ') longLiq60 += l.notional;
      else shortLiq60 += l.notional;
    }
  }

  // OBI (Order Book Imbalance within 1% band)
  let bestBid = 0;
  let bestAsk = Infinity;
  bids.forEach((_, p) => {
    if (p > bestBid) bestBid = p;
  });
  asks.forEach((_, p) => {
    if (p < bestAsk) bestAsk = p;
  });
  if (!Number.isFinite(bestAsk)) bestAsk = 0;

  const spread = bestAsk > bestBid && bestBid > 0 ? bestAsk - bestBid : 0;
  const mid = (bestBid + bestAsk) / 2 || lastPrice;
  const lo = mid * 0.99;
  const hi = mid * 1.01;

  let bidVol = 0;
  let askVol = 0;
  bids.forEach((q, p) => {
    if (p >= lo) bidVol += p * q;
  });
  asks.forEach((q, p) => {
    if (p <= hi) askVol += p * q;
  });

  const obi = bidVol + askVol > 0 ? (bidVol - askVol) / (bidVol + askVol) : 0;

  // OI Delta %
  const oiChangePct =
    input.oiPrev && input.oi ? ((input.oi - input.oiPrev) / input.oiPrev) * 100 : 0;

  // Range & ATR
  const win = candles.slice(-20);
  const hiP = Math.max(...win.map((c) => c.high), 1);
  const loP = Math.min(...win.map((c) => c.low), 1);
  const rangePct = lastPrice > 0 ? (hiP - loP) / lastPrice : 0;
  const atrPct =
    win.length > 0 ? win.reduce((a, c) => a + (c.high - c.low) / (c.close || 1), 0) / win.length : 0;
  const tightRange = rangePct > 0 && (rangePct < 0.006 || atrPct < 0.0012);

  const base5 = candles[Math.max(0, candles.length - 6)]?.close || lastPrice;
  const change5 = base5 > 0 ? (lastPrice - base5) / base5 : 0;
  const cascadeThr = input.cascadePct / 100;

  // Wall counts
  let wallBid = 0;
  let wallAsk = 0;
  const wallMin = input.whaleMin * 0.7;
  bids.forEach((q, p) => {
    if (p * q >= wallMin) wallBid++;
  });
  asks.forEach((q, p) => {
    if (p * q >= wallMin) wallAsk++;
  });

  return {
    cvd60,
    notional60,
    cvdBias,
    cvdSlope,
    obi,
    bidVol,
    askVol,
    longLiq60,
    shortLiq60,
    oi: input.oi,
    oiChangePct,
    funding: input.funding,
    markPrice: input.markPrice,
    nextFunding: input.nextFunding,
    bestBid,
    bestAsk,
    spread,
    taker30,
    takerSpike: taker30 > (notionalPrev / 4) * 1.8 && taker30 > 25000,
    rangePct,
    atrPct,
    tightRange,
    change5,
    cascadeDown: change5 < -cascadeThr || longLiq60 > input.liqMin * 2,
    cascadeUp: change5 > cascadeThr || shortLiq60 > input.liqMin * 2,
    wallCount: { bid: wallBid, ask: wallAsk }
  };
}
