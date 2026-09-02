import { describe, expect, it } from 'vitest';
import {
  dataFreshnessRule,
  fadeObiRule,
  fundingCrowdedRule,
  liqClusterRule,
  reverseLiqRatioRule,
  whaleThreshold
} from './scoring-rules';

describe('fundingCrowdedRule', () => {
  it('yön aleyhine kalabalık fundingda -5p verir', () => {
    expect(fundingCrowdedRule('AL', 0.0004)).toMatchObject({ delta: -5 });
    expect(fundingCrowdedRule('SAT', -0.0004)).toMatchObject({ delta: -5 });
  });

  it('uyumlu fundingda ve null veride değmez', () => {
    expect(fundingCrowdedRule('SAT', 0.0004).reason).toBeNull();
    expect(fundingCrowdedRule('AL', -0.0004).reason).toBeNull();
    expect(fundingCrowdedRule('AL', null).reason).toBeNull();
    expect(fundingCrowdedRule('AL', 0.0001).reason).toBeNull();
  });
});

describe('fadeObiRule', () => {
  it('cascade-down + ask baskılı OBI → -8p', () => {
    expect(fadeObiRule(true, -0.12)).toMatchObject({ delta: -8 });
  });

  it('cascade yok, bant içinde veya bid tarafında değmez', () => {
    expect(fadeObiRule(false, -0.12).reason).toBeNull();
    expect(fadeObiRule(true, -0.05).reason).toBeNull();
    expect(fadeObiRule(true, 0.12).reason).toBeNull();
  });
});

describe('liqClusterRule', () => {
  const snap = (over: Partial<{ longLiq60: number; shortLiq60: number; takerSpike: boolean }> = {}) => ({
    longLiq60: 0,
    shortLiq60: 0,
    takerSpike: false,
    ...over
  });

  it('yönlü büyük likidasyon + taker spike → +12p', () => {
    expect(liqClusterRule('SAT', snap({ longLiq60: 120000, takerSpike: true }), 50000)).toMatchObject({ delta: 12 });
    expect(liqClusterRule('AL', snap({ shortLiq60: 80000, takerSpike: true }), 50000)).toMatchObject({ delta: 12 });
  });

  it('taker spike yoksa bonus verilmez (Stage-4 paritesi)', () => {
    const r = liqClusterRule('SAT', snap({ longLiq60: 120000, takerSpike: false }), 50000);
    expect(r.reason).toBeNull();
  });

  it('eşik altı likidasyonda değmez', () => {
    expect(liqClusterRule('SAT', snap({ longLiq60: 30000, takerSpike: true }), 50000).reason).toBeNull();
  });
});

describe('reverseLiqRatioRule', () => {
  it('karşı yön 1.5 kat baskın ve eşik üstündeyse -5p', () => {
    expect(
      reverseLiqRatioRule('SAT', { longLiq60: 10000, shortLiq60: 60000 }, 50000)
    ).toMatchObject({ delta: -5 });
    expect(
      reverseLiqRatioRule('AL', { longLiq60: 90000, shortLiq60: 20000 }, 50000)
    ).toMatchObject({ delta: -5 });
  });

  it('oran yetersiz veya eşik altındaysa değmez', () => {
    expect(reverseLiqRatioRule('SAT', { longLiq60: 40000, shortLiq60: 50000 }, 50000).reason).toBeNull();
    expect(reverseLiqRatioRule('SAT', { longLiq60: 1000, shortLiq60: 6000 }, 50000).reason).toBeNull();
  });
});

describe('dataFreshnessRule', () => {
  it('15sn üstü gecikmede -8p', () => {
    const now = 1_700_000_000_000;
    expect(dataFreshnessRule(now - 16000, now)).toMatchObject({ delta: -8 });
  });

  it('taze veride veya hiç veri yoksa (0) değmez', () => {
    const now = 1_700_000_000_000;
    expect(dataFreshnessRule(now - 5000, now).reason).toBeNull();
    expect(dataFreshnessRule(0, now).reason).toBeNull();
  });
});

describe('whaleThreshold', () => {
  it('50k tabanını uygular', () => {
    expect(whaleThreshold(10000)).toBe(50000);
    expect(whaleThreshold(undefined)).toBe(300000);
    expect(whaleThreshold(0)).toBe(300000);
    expect(whaleThreshold(500000)).toBe(500000);
  });
});
