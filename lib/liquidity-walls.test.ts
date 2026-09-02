import { describe, expect, it } from "vitest";
import {
  mergeWalls,
  nonzeroMax,
  percentileFromBins,
  pruneWallAges,
  touchWallAge,
  wallAgeKey,
  type WallAgeRecord
} from "./liquidity-walls";

describe("percentileFromBins (PREDATOR port)", () => {
  it("64 altinda kesin sirali percentile", () => {
    const vals = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentileFromBins(vals, 0.5)).toBe(6); // sorted[5]
    expect(percentileFromBins(vals, 0)).toBe(1);
    expect(percentileFromBins([], 0.9)).toBe(0);
  });

  it("64+ ornekte histogram yaklasimi tolerans icinde", () => {
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    const approx = percentileFromBins(vals, 0.9);
    expect(Math.abs(approx - 90)).toBeLessThanOrEqual(15);
  });
});

describe("mergeWalls (PREDATOR port)", () => {
  const binPx = 2.5;

  it("intensite sicramasi runu bolebilir (tek dev blok bolunur)", () => {
    const rows = 12;
    const bid = new Array(rows).fill(0);
    const ask = new Array(rows).fill(0);
    ask[2] = 1000;
    ask[3] = 100000; // intensite sicramasi > 0.28 -> yeni duvar
    const walls = mergeWalls(bid, ask, { threshold: 500, maxNotional: 100000, binPx });
    expect(walls.length).toBe(2);
    expect(walls[0].notional).toBe(1000);
    expect(walls[1].notional).toBe(100000);
  });

  it("dominance zayif satir duvar olmaz", () => {
    const bid = [100];
    const askSame = [90]; // dom = 0.526 < 0.58
    expect(mergeWalls(bid, askSame, { threshold: 50, maxNotional: 100, binPx })).toHaveLength(0);
    const askWeak = [10]; // dom = 0.909
    const walls = mergeWalls([100], askWeak, { threshold: 50, maxNotional: 100, binPx });
    expect(walls).toHaveLength(1);
    expect(walls[0].side).toBe("B");
  });

  it("notional-agirlikli centroid ve start/end", () => {
    const bid = [0, 100, 300, 0];
    const ask = [0, 0, 0, 0];
    const walls = mergeWalls(bid, ask, { threshold: 50, maxNotional: 300, binPx });
    expect(walls).toHaveLength(1);
    const w = walls[0];
    expect(w.start).toBe(1);
    expect(w.end).toBe(2);
    expect(w.notional).toBe(400);
    // centroid = (3.75*100 + 6.25*300) / 400
    expect(w.y).toBeCloseTo(5.625, 6);
  });
});

describe("nonzeroMax", () => {
  it("satir bazinda iki tarafi maksimize eder", () => {
    const { nz, max } = nonzeroMax([10, 0, 30], [0, 20, 25]);
    expect(nz).toEqual([10, 20, 30]);
    expect(max).toBe(30);
  });
});

describe("wallAgeKey + yas kayitlari", () => {
  it("tick yuvarlamasi kucuk fiyat oynamasini ayni duvar sayar", () => {
    const a = wallAgeKey("BTCUSDT", 100.001, "B", 0.01);
    const b = wallAgeKey("BTCUSDT", 100.049, "B", 0.01);
    expect(a).toBe(b);
    expect(wallAgeKey("BTCUSDT", 100.001, "A", 0.01)).not.toBe(a);
  });

  it("touchWallAge peak/decay takibi + pruneWallAges temizligi", () => {
    const map = new Map<string, WallAgeRecord>();
    const t0 = 1000000;
    const rec = touchWallAge(map, "k", "B", 1000, t0);
    expect(rec.first).toBe(t0);
    touchWallAge(map, "k", "B", 400, t0 + 1000);
    expect(map.get("k")?.peakNotional).toBe(1000);
    expect(map.get("k")?.decayRatio).toBeCloseTo(0.4, 6);
    pruneWallAges(map, new Set(), t0 + 7000); // 6sn hayirsa silinir (> 5sn esigi)
    expect(map.size).toBe(0);
  });
});
