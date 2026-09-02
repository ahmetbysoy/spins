import { describe, expect, it } from "vitest";
import { isVolumeSpike, volumeBarColor, VOL_SPIKE_COLOR } from "./volume-spike";

describe("volume-spike (dopamin 3)", () => {
  it("ortalamanin 3x ustu altin renk alir", () => {
    const vols = [100, 100, 100, 100, 100, 100, 400];
    expect(isVolumeSpike(vols, 6)).toBe(true);
    expect(volumeBarColor(vols, 6, true)).toBe(VOL_SPIKE_COLOR);
    expect(volumeBarColor(vols, 6, false)).toBe(VOL_SPIKE_COLOR);
  });

  it("3x alti: normal yon rengi", () => {
    const vols = [100, 100, 100, 100, 100, 100, 299];
    expect(isVolumeSpike(vols, 6)).toBe(false);
    expect(volumeBarColor(vols, 6, true)).toBe("rgba(38, 166, 154, 0.4)");
    expect(volumeBarColor(vols, 6, false)).toBe("rgba(239, 83, 80, 0.4)");
  });

  it("5 ornekten az gecmis: spike sayilmaz (acilis barlari)", () => {
    expect(isVolumeSpike([100, 100, 9999], 2)).toBe(false);
  });
});
