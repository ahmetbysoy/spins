// Sürekli akan çift haber bandı (marquee) yardımcıları — saf fonksiyonlar.
// ChartTerminal'deki üst/alt bant bunları kullanır; hız = Web Animations
// playbackRate (animation-duration'a dokunulmaz → hız değişiminde sıçrama olmaz).

export type TickerKind =
  | 'up'
  | 'down'
  | 'flat'
  | 'signal-al'
  | 'signal-sat'
  | 'liq-long'
  | 'liq-short'
  | 'wall'
  | 'metrics'
  | 'spike'
  | 'flow'
  | 'info';

export interface TickerItem {
  id: string;
  kind: TickerKind;
  text: string;
  ts: number;
}

/** Bant tamponu kapasitesi (üst/alt aynı). */
export const TICKER_MAX = 14;

/** Sonuna ekler, taşıyan başını atar (rolling buffer). Yeni dizi döner. */
export function pushTickerItem(buf: TickerItem[], item: TickerItem, max = TICKER_MAX): TickerItem[] {
  const next = [...buf, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Fiyat tik metni: "77.321,8 ▲0,28%" — önceki tike göre yön + %. */
export function priceTickText(
  price: number,
  prev: number | null,
  precision = 1
): { text: string; kind: TickerKind } {
  const p = fmtNum(price, precision);
  if (prev == null || prev === price || !prev) {
    return { text: `${p} •`, kind: 'flat' };
  }
  const pct = ((price - prev) / prev) * 100;
  const up = price > prev;
  return { text: `${p} ${up ? '▲' : '▼'}${Math.abs(pct).toFixed(2)}%`, kind: up ? 'up' : 'down' };
}

/** Ortamdan bağımsız sabit biçim (kullanıcı örneği: 77,321.80): binlik=, ondalık=. */
export function fmtNum(n: number, maxFrac = 2): string {
  const fixed = Math.abs(n).toFixed(maxFrac);
  const [i, f = ''] = fixed.split('.');
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const dec = f.replace(/0+$/, '');
  return (n < 0 ? '-' : '') + grouped + (dec ? '.' + dec : '');
}

/** 8_770_000 → "8.77M", 12_400 → "12.4K" (kullanıcı örneğiyle birebir). */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const one = (x: number) => x.toFixed(2).replace(/\.?0+$/, '');
  if (a >= 1e9) return `${sign}${one(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}${one(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}${one(a / 1e3)}K`;
  return `${sign}${Math.round(a)}`;
}

/** Alt bant metrik satırı: "CVD +8.77M · OBI -21.4% · OI 107.9M (+0.4%)" */
export function metricsText(cvd: number, obi: number, oi: number | null, oiChangePct: number): string {
  const oiTxt =
    oi != null
      ? ` · OI ${fmtCompact(oi)}${oiChangePct ? ` (${oiChangePct > 0 ? '+' : ''}${oiChangePct.toFixed(1)}%)` : ''}`
      : '';
  return `CVD ${cvd > 0 ? '+' : ''}${fmtCompact(cvd)} · OBI ${(obi * 100).toFixed(1)}%${oiTxt}`;
}

/**
 * Dopamin hız katsayısı: sakin piyasada ~1x, volatil/patlama anında 2,6x'a kadar.
 * Kaynaklar: görünür pencere %aralık (rangePct), ATR% (atrPct), son bar hacmi /
 * ortalama hacim oranı (volRatio, 1 = normal). Sonuç [0,7 .. 2,6] aralığına sıkıştırılır.
 */
export function computeHype(rangePct: number, atrPct: number, volRatio: number): number {
  // Dikkat: rangePct/atrPct ORAN (0.006 = %0.6), yüzde degil.
  const r = Math.max(0, rangePct);
  const a = Math.max(0, atrPct);
  const v = Math.max(1, volRatio);
  const hype = 0.85 + Math.min(1.2, r * 40) + Math.min(0.6, a * 60) + Math.min(1.0, (v - 1) * 0.45);
  return Math.min(2.6, Math.max(0.7, hype));
}
