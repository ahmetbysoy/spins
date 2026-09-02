// REST coğrafi-engel direnç katmani — PREDATOR TERMINAL'den port (birebir mekanik).
// Tarayicidan Binance futures API'sine giden her REST cagrisi aday havuzundan gecer:
// sunucu proxy'si -> dogrudan fapi -> 3 CORS proxy x fapi. Adaylar 2'li batch'lerle
// Promise.any ile yaristirilir; kazanan localStorage'da 5dk cache'lenir, 429/18'de
// Retry-After backoff uygulanir. WS olunce use-flow-stream'deki REST dusus modu
// (degraded polling) bu katman uzerinden calisir.
const FAPI_BASE = 'https://fapi.binance.com';
const SERVER_PROXY_BASE = '/api/binance';

export interface RouteCandidate {
  name: string;
  url: string;
}

export interface RestRoute {
  name: string;
  ts: number;
  ms: number;
}

// PREDATOR birebir: allorigins / corsproxy / codetabs
const CORS_PROXIES: { name: string; wrap: (u: string) => string }[] = [
  { name: 'allorigins', wrap: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: 'corsproxy', wrap: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
  { name: 'codetabs', wrap: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` }
];

const ROUTE_CACHE_KEY = 'fs_rest_route';
const ROUTE_TTL_MS = 300000; // PREDATOR: 5dk
const ROUTE_MAX_MS = 2500; // cache gecerli olmak icin yeterince hizli olmali
const BATCH_SIZE = 2;
const CALL_TIMEOUT_MS = 4000;

let restRoute: RestRoute | null = null;
let restErrorCount = 0;
let routeLoaded = false;

function loadRoute(): RestRoute | null {
  if (!routeLoaded && typeof window !== 'undefined') {
    routeLoaded = true;
    try {
      restRoute = JSON.parse(window.localStorage.getItem(ROUTE_CACHE_KEY) || 'null');
    } catch {
      restRoute = null;
    }
  }
  return restRoute;
}

function cacheRoute(r: RestRoute) {
  restRoute = r;
  routeLoaded = true;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(r));
    } catch {}
  }
}

/** UI durum rozeti / debug icin aktif rota */
export function getRestRoute(): RestRoute | null {
  return loadRoute();
}

/** Test enjeksiyonu */
export function __setRestRouteForTests(r: RestRoute | null) {
  restRoute = r;
  routeLoaded = true;
}

/** PREDATOR refreshRestRoute kosulu: rota 5dk icinde secilmis VE hizli VE hatasizsa taze */
export function isRouteFresh(route: RestRoute | null, now = Date.now()): boolean {
  return !!route && now - route.ts < ROUTE_TTL_MS && route.ms < ROUTE_MAX_MS && restErrorCount === 0;
}

/** Gömülü APK WebView'i (capacitor https://localhost): yerel sunucu yok —
 *  '/api/binance' adayı anlamsız (404), doğrudan fapi + CORS proxy'lerle başlanır. */
export function isEmbeddedWebview(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    window.location.hostname === 'localhost'
  );
}

export function buildRestCandidates(path: string, embedded: boolean = isEmbeddedWebview()): RouteCandidate[] {
  const raw: RouteCandidate[] = [];
  if (!embedded) raw.push({ name: 'proxy:server', url: `${SERVER_PROXY_BASE}${path}` });
  raw.push({ name: 'direct:fapi', url: `${FAPI_BASE}${path}` });
  const prox = CORS_PROXIES.map((pr) => ({ name: `${pr.name}:fapi`, url: pr.wrap(`${FAPI_BASE}${path}`) }));
  const all = [...raw, ...prox];
  const cached = loadRoute();
  if (cached) {
    const i = all.findIndex((c) => c.name === cached.name);
    if (i > 0) {
      const [c] = all.splice(i, 1);
      all.unshift(c);
    }
  }
  return all;
}

export function parseRetryAfterMs(headerValue: string | null): number {
  const v = parseFloat(headerValue || '');
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
}

interface RaceFetchError extends Error {
  status?: number;
  retryAfterMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchTextWithTimeout(url: string, ms: number): Promise<string> {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try {
    const r = await fetch(url, { cache: 'no-store', signal: ctl?.signal });
    const txt = await r.text();
    if (!r.ok) {
      const err = new Error(`HTTP ${r.status}`) as RaceFetchError;
      err.status = r.status;
      err.retryAfterMs = parseRetryAfterMs(r.headers?.get('Retry-After') ?? null);
      throw err;
    }
    return txt;
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * REST cagrisini aday havuzunda yaristirir (PREDATOR fetchJSONPath birebir):
 * 2'li batch -> Promise.any -> kazanan rota cache. 429/418'de Retry-After
 * (yoksa 10s, tavan 60s) beklenip sonraki batch denenir.
 * SSR/test ortaminda (window yok) yaristirma anlamsiz: dogrudan fapi'ye gider.
 */
export async function fetchJsonRaced<T = unknown>(
  path: string,
  opts: { batchSize?: number; timeout?: number } = {}
): Promise<T> {
  if (typeof window === 'undefined') {
    const r = await fetch(`${FAPI_BASE}${path}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  }

  if (loadRoute() && !isRouteFresh(restRoute)) restRoute = null; // PREDATOR: 5dk+ eski rota gecersiz

  const candidates = buildRestCandidates(path);
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const timeout = Math.min(opts.timeout ?? CALL_TIMEOUT_MS, CALL_TIMEOUT_MS);
  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    try {
      const winner = await Promise.any(
        batch.map(async (c) => {
          const started = performance.now();
          const txt = await fetchTextWithTimeout(c.url, timeout);
          return { c, data: JSON.parse(txt) as T, ms: Math.round(performance.now() - started) };
        })
      );
      cacheRoute({ name: winner.c.name, ts: Date.now(), ms: winner.ms });
      restErrorCount = 0;
      return winner.data;
    } catch (e) {
      lastErr = e;
      restErrorCount++;
      const errs = (e as AggregateError)?.errors || [e];
      const rl = errs.find(
        (x) => (x as RaceFetchError)?.status === 429 || (x as RaceFetchError)?.status === 418
      ) as RaceFetchError | undefined;
      if (rl) {
        const wait = Math.min(60000, rl.retryAfterMs || 10000);
        console.warn(`[rest-race] rate limit — ${Math.ceil(wait / 1000)}s bekleniyor`);
        await sleep(wait);
      }
    }
  }
  throw lastErr || new Error(`REST failed ${path}`);
}
