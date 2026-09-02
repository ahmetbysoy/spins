import { afterEach, describe, expect, it, vi } from "vitest";
import { buzz, hapticsSupported, SIGNAL_BUZZ } from "./haptics";

describe("haptics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("destekleniyorsa navigator.vibrate cagrilir", () => {
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { vibrate });
    expect(hapticsSupported()).toBe(true);
    buzz(SIGNAL_BUZZ);
    expect(vibrate).toHaveBeenCalledWith(SIGNAL_BUZZ);
  });

  it("desteklenmiyorsa (iOS) sessiz no-op — hata firlamaz", () => {
    vi.stubGlobal("navigator", {});
    expect(hapticsSupported()).toBe(false);
    expect(() => buzz(20)).not.toThrow();
  });
});
