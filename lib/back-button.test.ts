import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetBackHandlersForTests, __simulatePopForTests, registerBackHandler } from "./back-button";

afterEach(() => {
  __resetBackHandlersForTests();
});

describe("back-button LIFO yigini", () => {
  it("geri tusu en son acilan overlay'i once kapatir", () => {
    const closeFs = vi.fn();
    const closeSearch = vi.fn();
    registerBackHandler(closeFs);
    registerBackHandler(closeSearch);
    __simulatePopForTests();
    expect(closeSearch).toHaveBeenCalledTimes(1);
    expect(closeFs).not.toHaveBeenCalled();
    __simulatePopForTests();
    expect(closeFs).toHaveBeenCalledTimes(1);
  });

  it("unregister handler'i sessizce kaldirir (kapatma cagirmaz)", () => {
    const close = vi.fn();
    const off = registerBackHandler(close);
    off();
    __simulatePopForTests();
    expect(close).not.toHaveBeenCalled();
  });
});
