import { describe, expect, it } from "vitest";
import { computeSignalOutcome, resolvePendingOutcomes, SIGNAL_OUTCOME_MINUTES } from "./signal-outcomes";
import type { Candle, SignalLogEntry } from "./types";

const mkCandles = (times: number[], close = 100): Candle[] =>
  times.map((t) => ({ time: t, open: close, high: close, low: close, close, volume: 1 }));

describe("computeSignalOutcome (PREDATOR port)", () => {
  // 60sn'lik mumlar: 10:00 barindan sinyal, +3dk = 10:03 barindan okunur
  const candles = mkCandles([0, 60, 120, 180, 240, 300].map((t) => 1000 + t), 100);

  it("hedef dakikanin ilk kapali mumundan hesaplar (3dk -> 180sn)", () => {
    const o = computeSignalOutcome(candles, 1000, "AL", 100, 3)!;
    expect(o).not.toBeNull();
    expect(o.time).toBe(1180);
  });

  it("hedef henuz olusmadiysa null (bekliyor)", () => {
    expect(computeSignalOutcome(candles, 1000, "AL", 100, 15)).toBeNull();
  });

  it("yön gore hit: AL pozitifte isabet, SAT negatifte isabet", () => {
    // hedef mumun (1180) kapanisi yone gore 110 / 90
    const up = candles.map((c) => (c.time === 1180 ? { ...c, close: 110 } : c));
    const oAl = computeSignalOutcome(up, 1000, "AL", 100, 3)!;
    expect(oAl.hit).toBe(true);
    expect(oAl.pct).toBeCloseTo(10, 6);
    const down = candles.map((c) => (c.time === 1180 ? { ...c, close: 90 } : c));
    const oSat = computeSignalOutcome(down, 1000, "SAT", 100, 3)!;
    expect(oSat.hit).toBe(true);
    expect(oSat.pct).toBeCloseTo(-10, 6);
    expect(computeSignalOutcome(down, 1000, "AL", 100, 3)!.hit).toBe(false);
  });

  it("giris fiyati 0/yoksa null", () => {
    expect(computeSignalOutcome(candles, 1000, "AL", 0, 3)).toBeNull();
  });
});

describe("resolvePendingOutcomes", () => {
  const candles = mkCandles([0, 60, 120, 180].map((t) => 2000 + t), 100);
  const sig: SignalLogEntry = {
    id: "s1",
    dir: "AL",
    rule: "test",
    price: 100,
    ts: 2000,
    score: null,
    grade: "HAM",
    reasons: []
  };

  it("eksikleri cozer, ikinci gecis degisiklik uretmez", () => {
    const r1 = resolvePendingOutcomes(candles, [sig]);
    expect(r1.changed).toBe(true);
    expect(Object.keys(r1.updated[0].outcomes ?? {}).sort()).toEqual(["3"]);
    const r2 = resolvePendingOutcomes(candles, r1.updated);
    expect(r2.changed).toBe(false);
  });

  it("DB'den gelen string-anahtarli eski sonuclar korunur (tekrar hesaplanmaz)", () => {
    const persisted: SignalLogEntry = {
      ...sig,
      outcomes: { "3": { hit: true, pct: 5, price: 105, time: 2180 } } as unknown as Record<number, import("./types").SignalOutcome>
    };
    const r = resolvePendingOutcomes(candles, [persisted]);
    expect(r.changed).toBe(false);
    expect(r.updated[0].outcomes?.["3"].pct).toBe(5);
  });

  it("tum pencereler dolunca 4 chip", () => {
    const full = mkCandles(Array.from({ length: 17 }, (_, i) => 3000 + i * 60), 101); // 15dk hedefi (3900) dahil
    const r = resolvePendingOutcomes(full, [{ ...sig, ts: 3000 }]);
    expect(Object.keys(r.updated[0].outcomes ?? {}).length).toBe(SIGNAL_OUTCOME_MINUTES.length);
  });
});
