import { describe, expect, it } from 'vitest';
import { Candle, LiquidationEvent, TradeEvent } from './types';
import { computeFlowSnapshotCore, type FlowSnapshotInput } from './flow-snapshot';

const now = 1_700_000_000_000;

function baseInput(over: Partial<FlowSnapshotInput> = {}): FlowSnapshotInput {
  return {
    now,
    trades: [],
    liquidations: [],
    candles: [],
    bids: new Map(),
    asks: new Map(),
    lastPrice: 100,
    oi: null,
    oiPrev: null,
    funding: null,
    markPrice: null,
    nextFunding: null,
    cascadePct: 0.8,
    whaleMin: 300_000,
    liqMin: 50_000,
    ...over
  };
}

const t = (ts: number, side: 'buy' | 'sell', notional: number, price = 100): TradeEvent => ({
  ts,
  price,
  qty: notional / price,
  notional,
  delta: side === 'buy' ? notional : -notional,
  side
});

const c = (close: number, time: number): Candle => ({
  time,
  open: close,
  high: close * 1.001,
  low: close * 0.999,
  close,
  volume: 10
});

describe('computeFlowSnapshotCore', () => {
  it('boş veride güvenli sıfır snapshot döner', () => {
    const s = computeFlowSnapshotCore(baseInput());
    expect(s.cvd60).toBe(0);
    expect(s.obi).toBe(0);
    expect(s.cascadeDown).toBe(false);
    expect(s.cascadeUp).toBe(false);
    expect(s.oi).toBeNull();
  });

  it('60s CVD bias ve eğimini doğru hesaplar', () => {
    // Son 60s: +200k alım/-50k satım → bias +0.6; önceki pencere dengeli → slope pozitif
    const trades = [
      t(now - 10000, 'buy', 200_000),
      t(now - 20000, 'sell', 50_000),
      t(now - 90000, 'buy', 100_000),
      t(now - 100000, 'sell', 100_000)
    ];
    const s = computeFlowSnapshotCore(baseInput({ trades }));
    expect(s.cvd60).toBe(150_000);
    expect(s.notional60).toBe(250_000);
    expect(s.cvdBias).toBeCloseTo(0.6, 5);
    expect(s.cvdSlope).toBeGreaterThan(0);
  });

  it('OBI: 1% bandındaki bid/ask hacimlerinden hesaplanır', () => {
    const bids = new Map([
      [99.5, 1000], // band içinde: 99.5k
      [90, 1000] // bant dışı
    ]);
    const asks = new Map([
      [100.5, 500], // band içinde: 50.25k
      [120, 1000] // bant dışı
    ]);
    const s = computeFlowSnapshotCore(baseInput({ bids, asks, lastPrice: 100 }));
    expect(s.bestBid).toBe(99.5);
    expect(s.bestAsk).toBe(100.5);
    expect(s.obi).toBeGreaterThan(0.3); // bidasknce baskın
    expect(s.obi).toBeLessThan(0.35);
  });

  it('likidasyonlar 60s penceresinde toplanır', () => {
    const liqs: LiquidationEvent[] = [
      { ts: now - 5000, price: 100, qty: 1, notional: 120_000, side: 'SELL', type: 'LONG_LIQ' },
      { ts: now - 30000, price: 100, qty: 1, notional: 60_000, side: 'BUY', type: 'SHORT_LIQ' },
      { ts: now - 120000, price: 100, qty: 1, notional: 999_000, side: 'SELL', type: 'LONG_LIQ' } // pencere dışı
    ];
    const s = computeFlowSnapshotCore(baseInput({ liquidations: liqs }));
    expect(s.longLiq60).toBe(120_000);
    expect(s.shortLiq60).toBe(60_000);
    // longLiq > liqMin*2 → cascadeDown
    expect(s.cascadeDown).toBe(true);
  });

  it('OI değişim yüzdesi doğru hesaplanır', () => {
    const s = computeFlowSnapshotCore(baseInput({ oi: 101_000, oiPrev: 100_000 }));
    expect(s.oiChangePct).toBeCloseTo(1, 5);
  });

  it('change5 eşik aşımında cascade yönü verir', () => {
    const candles = Array.from({ length: 10 }, (_, i) => c(100 - i * 0.01, now / 1000 - i));
    // lastPrice 100, base5 ~100.05 → change5 ≈ -0.05% eşik altı; balast: liq ile zorla
    const s1 = computeFlowSnapshotCore(baseInput({ candles, lastPrice: 99.9 }));
    expect(s1.cascadeDown).toBe(false);
    const s2 = computeFlowSnapshotCore(baseInput({ candles, lastPrice: 98 })); // ≈ -2%
    expect(s2.cascadeDown).toBe(true);
    expect(s2.cascadeUp).toBe(false);
  });

  it('duvar sayımı whaleMin*0.7 eşiğiyle yapılır', () => {
    const bids = new Map([
      [100, 210], // 21k < 210k eşik altı
      [99, 2500], // 247.5k duvar
      [98, 2500] // 245k duvar
    ]);
    const asks = new Map([[101, 3000]]); // 303k duvar
    const s = computeFlowSnapshotCore(baseInput({ bids, asks, whaleMin: 300_000 }));
    expect(s.wallCount).toEqual({ bid: 2, ask: 1 });
  });
});
