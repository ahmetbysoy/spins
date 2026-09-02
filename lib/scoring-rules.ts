// Karar motoru (Katman 2) parite kuralları — saf fonksiyonlar, birim test edilebilir.
// Kaynak: futures-scanner.html (Stage 4) ile davranış paritesi; uygulama noktası
// app/page.tsx → evaluateRawFlow.
import { FlowSnapshot } from './types';

export interface RuleResult {
  delta: number;
  reason: string | null;
}

const NO_HIT: RuleResult = { delta: 0, reason: null };

/**
 * Funding "kalabalık" penaltısı: sinyal yönündeki kalabalık funding aleyhineyse -5p.
 * (Mevcut +8p aşırı-funding bonusunun tamamlayıcısı; çift yön kapsamı.)
 */
export function fundingCrowdedRule(dir: 'AL' | 'SAT', funding: number | null): RuleResult {
  if (funding === null || !Number.isFinite(funding)) return NO_HIT;
  if (funding > 0.00025 && dir === 'AL') {
    return {
      delta: -5,
      reason: `Funding pozitif kalabalık (%${(funding * 100).toFixed(4)}); AL tarafı yığılmış, long unwind riski.`
    };
  }
  if (funding < -0.00025 && dir === 'SAT') {
    return {
      delta: -5,
      reason: `Funding negatif kalabalık (%${(funding * 100).toFixed(4)}); SAT tarafı yığılmış, short squeeze riski.`
    };
  }
  return NO_HIT;
}

/**
 * Fade-AL erken çıkış penaltısı: dump sonrası AL kurgusunda OBI hâlâ ask baskılıysa -8p.
 */
export function fadeObiRule(cascadeDown: boolean, obi: number): RuleResult {
  if (cascadeDown && obi < -0.08) {
    return { delta: -8, reason: 'OBI hâlâ ask baskılı; fade AL erken olabilir.' };
  }
  return NO_HIT;
}

/**
 * Likidasyon cluster bonusu: yönlü büyük likidasyon + taker spike birlikte ise +12p.
 * (Stage-4 paritesi: bonus yalnızca takerSpike ile verilir.)
 */
export function liqClusterRule(
  dir: 'AL' | 'SAT',
  snap: Pick<FlowSnapshot, 'longLiq60' | 'shortLiq60' | 'takerSpike'>,
  liqMin: number
): RuleResult {
  if (!snap.takerSpike) return NO_HIT;
  if (dir === 'SAT' && snap.longLiq60 >= liqMin) {
    return {
      delta: 12,
      reason: `Likidasyon cascade: $${(snap.longLiq60 / 1000).toFixed(0)}k long liq + taker spike.`
    };
  }
  if (dir === 'AL' && snap.shortLiq60 >= liqMin) {
    return {
      delta: 12,
      reason: `Short squeeze cascade: $${(snap.shortLiq60 / 1000).toFixed(0)}k short liq + taker spike.`
    };
  }
  return NO_HIT;
}

/**
 * Ters likidasyon akışı penaltısı (oran bazlı): karşı yönlü likidasyonlar 1.5 kat
 * baskın VE eşik üstündeyse -5p. (Mutlak 0.75×liqMin eşiği yerine Stage-4 oranı.)
 */
export function reverseLiqRatioRule(
  dir: 'AL' | 'SAT',
  snap: Pick<FlowSnapshot, 'longLiq60' | 'shortLiq60'>,
  liqMin: number
): RuleResult {
  if (dir === 'SAT' && snap.shortLiq60 > snap.longLiq60 * 1.5 && snap.shortLiq60 >= liqMin) {
    return { delta: -5, reason: 'Ters liq akışı: short likidasyonları baskın; SAT için squeeze riski.' };
  }
  if (dir === 'AL' && snap.longLiq60 > snap.shortLiq60 * 1.5 && snap.longLiq60 >= liqMin) {
    return { delta: -5, reason: 'Ters liq akışı: long likidasyonları baskın; AL için bıçak tutma riski.' };
  }
  return NO_HIT;
}

/**
 * Veri tazeliği: trade/depth/mark'dan en yenisı bile 15sn eskiyse -8p.
 */
export function dataFreshnessRule(freshTs: number, now: number = Date.now()): RuleResult {
  if (freshTs > 0 && now - freshTs > 15000) {
    return { delta: -8, reason: 'Veri tazeliği uyarısı (-8p): Son 15 saniyede akış gecikmesi var.' };
  }
  return NO_HIT;
}

/** Whale eşiği tabanı: kullanıcı ne girerse girsin 50k altına düşmez. */
export const WHALE_MIN_FLOOR = 50000;

export function whaleThreshold(v: number | null | undefined): number {
  const val = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 300000;
  return Math.max(WHALE_MIN_FLOOR, val);
}
