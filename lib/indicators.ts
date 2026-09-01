import { Candle } from './types';

export function sma(arr: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= period) sum -= arr[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(arr: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(arr.length).fill(null);
  const k = 2 / (period + 1);
  let sum = 0;
  let count = 0;
  let prev: number | null = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null || !Number.isFinite(v)) {
      out[i] = null;
      continue;
    }
    if (prev == null) {
      sum += v;
      count++;
      if (count === period) {
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function psar(
  cs: Candle[],
  step: number = 0.02,
  max: number = 0.2
): { sar: (number | null)[]; trend: (number | null)[] } {
  const n = cs.length;
  const sar: (number | null)[] = new Array(n).fill(null);
  const trend: (number | null)[] = new Array(n).fill(null);
  if (n < 3) return { sar, trend };

  let up = cs[1].close >= cs[0].close;
  let s = up ? Math.min(cs[0].low, cs[1].low) : Math.max(cs[0].high, cs[1].high);
  let ep = up ? cs[1].high : cs[1].low;
  let af = step;

  for (let i = 2; i < n; i++) {
    s = s + af * (ep - s);
    if (up) s = Math.min(s, cs[i - 1].low, cs[i - 2].low);
    else s = Math.max(s, cs[i - 1].high, cs[i - 2].high);

    if (up && cs[i].low < s) {
      up = false;
      s = ep;
      ep = cs[i].low;
      af = step;
    } else if (!up && cs[i].high > s) {
      up = true;
      s = ep;
      ep = cs[i].high;
      af = step;
    } else {
      if (up && cs[i].high > ep) {
        ep = cs[i].high;
        af = Math.min(af + step, max);
      }
      if (!up && cs[i].low < ep) {
        ep = cs[i].low;
        af = Math.min(af + step, max);
      }
    }
    sar[i] = s;
    trend[i] = up ? 1 : -1;
  }
  return { sar, trend };
}

export function bollingerBands(
  cs: Candle[],
  period: number = 20,
  stdDev: number = 2
): { upper: (number | null)[]; mid: (number | null)[]; lower: (number | null)[] } {
  const closes = cs.map((c) => c.close);
  const mid = sma(closes, period);
  const upper: (number | null)[] = new Array(cs.length).fill(null);
  const lower: (number | null)[] = new Array(cs.length).fill(null);

  for (let i = period - 1; i < cs.length; i++) {
    const m = mid[i];
    if (m === null) continue;
    let sumSquares = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSquares += Math.pow(closes[j] - m, 2);
    }
    const sd = Math.sqrt(sumSquares / period);
    upper[i] = m + stdDev * sd;
    lower[i] = m - stdDev * sd;
  }
  return { upper, mid, lower };
}

export function rsi(closes: number[], period: number = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export function macd(
  closes: number[],
  fast: number = 12,
  slow: number = 26,
  signalPeriod: number = 9
): {
  line: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  if (fast >= slow) slow = fast + 1;
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] == null || es[i] == null ? null : ef[i]! - es[i]!));
  const signal = ema(line, signalPeriod);
  const hist = line.map((v, i) => (v == null || signal[i] == null ? null : v - signal[i]!));
  return { line, signal, hist };
}

export function vwap(cs: Candle[]): (number | null)[] {
  const out: (number | null)[] = new Array(cs.length).fill(null);
  let day = '';
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < cs.length; i++) {
    const d = new Date(cs[i].time * 1000).toISOString().slice(0, 10);
    if (d !== day) {
      day = d;
      pv = 0;
      vol = 0;
    }
    const typ = (cs[i].high + cs[i].low + cs[i].close) / 3;
    pv += typ * cs[i].volume;
    vol += cs[i].volume;
    out[i] = vol > 0 ? pv / vol : null;
  }
  return out;
}

export function atrRatios(cs: Candle[], period: number = 14): (number | null)[] {
  const out: (number | null)[] = new Array(cs.length).fill(null);
  for (let i = 1; i < cs.length; i++) {
    const start = Math.max(1, i - period + 1);
    let sum = 0;
    let n = 0;
    for (let j = start; j <= i; j++) {
      const tr = Math.max(
        cs[j].high - cs[j].low,
        Math.abs(cs[j].high - cs[j - 1].close),
        Math.abs(cs[j].low - cs[j - 1].close)
      );
      sum += tr;
      n++;
    }
    out[i] = n && cs[i].close ? sum / n / cs[i].close : null;
  }
  return out;
}

export function wilsonLower(wins: number, n: number): number {
  if (!n || n <= 0) return 0;
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const adj = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return Math.max(0, ((centre - adj) / denom) * 100);
}

export function avg(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = avg(arr);
  return Math.sqrt(avg(arr.map((x) => (x - m) * (x - m))));
}

export function median(arr: number[]): number {
  const a = arr.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function percentile(arr: (number | null)[], p: number): number | null {
  const a = arr.filter((v): v is number => v !== null && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const pos = (a.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
