import { describe, expect, it } from "vitest";
import {
  __setRestRouteForTests,
  buildRestCandidates,
  isRouteFresh,
  parseRetryAfterMs,
  type RestRoute
} from "./rest-race";

describe("rest-race (PREDATOR port)", () => {
  it("aday havuzu: sunucu proxy + direct fapi + 3 CORS proxy (toplam 5)", () => {
    __setRestRouteForTests(null);
    const c = buildRestCandidates("/fapi/v1/time");
    expect(c.map((x) => x.name)).toEqual([
      "proxy:server",
      "direct:fapi",
      "allorigins:fapi",
      "corsproxy:fapi",
      "codetabs:fapi"
    ]);
    expect(c[0].url).toBe("/api/binance/fapi/v1/time");
    expect(c[1].url).toBe("https://fapi.binance.com/fapi/v1/time");
    expect(c[2].url).toContain("allorigins.win/raw?url=");
    expect(c[4].url).toContain("codetabs.com/v1/proxy?quest=");
  });

  it("cache'lenmis rota aday listesinin basina tasinir", () => {
    __setRestRouteForTests({ name: "codetabs:fapi", ts: Date.now(), ms: 800 });
    const c = buildRestCandidates("/fapi/v1/time");
    expect(c[0].name).toBe("codetabs:fapi");
    __setRestRouteForTests(null);
  });

  it("Retry-After header parse: saniye -> ms, gecersiz -> 0", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(parseRetryAfterMs("0.5")).toBe(500);
    expect(parseRetryAfterMs(null)).toBe(0);
    expect(parseRetryAfterMs("")).toBe(0);
    expect(parseRetryAfterMs("abc")).toBe(0);
  });

  it("rota tazeligi: 5dk + 2500ms alti + hatasiz kosullari", () => {
    const now = Date.now();
    const route: RestRoute = { name: "direct:fapi", ts: now - 60000, ms: 300 };
    expect(isRouteFresh(route, now)).toBe(true);
    expect(isRouteFresh({ ...route, ts: now - 400000 }, now)).toBe(false); // 5dk+ eski
    expect(isRouteFresh({ ...route, ms: 3000 }, now)).toBe(false); // cok yavas
    expect(isRouteFresh(null, now)).toBe(false);
  });
});
