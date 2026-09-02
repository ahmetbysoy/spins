import { describe, expect, it } from 'vitest';
import { TradeEvent } from './types';
import {
  collectWalls,
  detectAbsorption,
  detectDeltaBurst,
  detectSpoofRemovals,
  detectSweep,
  type WallInfo
} from './flow-detectors';

const now = 1_700_000_000_000;
const WHALE = 100_000; // test eşiği

function trade(over: Partial<TradeEvent>): TradeEvent {
  const price = over.price ?? 100;
  const qty = over.qty ?? 1000; // notional = price * qty = 100k varsayılan
  const side = over.side ?? 'buy';
  const notional = over.notional ?? price * qty;
  return {
    ts: over.ts ?? now,
    price,
    qty,
    notional,
    delta: over.delta ?? (side === 'buy' ? notional : -notional),
    side
  };
}

describe('detectSweep', () => {
  it('aynı yönde 4+ hızlı işlem ve toplam eşiği aşınca yakalar', () => {
    const trades = Array.from({ length: 5 }, (_, i) =>
      trade({ ts: now - i * 100, side: 'buy', price: 100, qty: 800 })
    ); // 5 x 80k = 400k > 150k
    const r = detectSweep(trades, now, WHALE);
    expect(r).not.toBeNull();
    expect(r?.side).toBe('buy');
    expect(r?.count).toBe(5);
    expect(r?.total).toBeGreaterThan(WHALE * 1.5);
  });

  it('işlem sayısı yetersizse null', () => {
    const trades = [trade({ ts: now - 100, qty: 5000 }), trade({ ts: now - 200, qty: 5000 })];
    expect(detectSweep(trades, now, WHALE)).toBeNull();
  });

  it('pencere dışı (eski) işlemler sayılmaz', () => {
    const trades = Array.from({ length: 5 }, (_, i) =>
      trade({ ts: now - 5000 - i * 100, qty: 800 })
    );
    expect(detectSweep(trades, now, WHALE)).toBeNull();
  });
});

describe('detectDeltaBurst', () => {
  it('hizalı 5s CVD patlamasını yakalar', () => {
    const trades = [
      ...Array.from({ length: 6 }, (_, i) => trade({ ts: now - i * 200, side: 'buy', qty: 900 })), // 6x90k=540k > 180k, cvd/vol=1
      trade({ ts: now - 30000, side: 'buy', qty: 500 }) // 60s eğim pozitif kalsın
    ];
    const r = detectDeltaBurst(trades, now, WHALE);
    expect(r).not.toBeNull();
    expect(r?.side).toBe('buy');
  });

  it('60s eğim tersse null', () => {
    const trades = [
      ...Array.from({ length: 6 }, (_, i) => trade({ ts: now - i * 200, side: 'buy', qty: 900 })),
      trade({ ts: now - 30000, side: 'sell', qty: 10000 }) // 1M eski satış → cvd60 net negatif
    ];
    expect(detectDeltaBurst(trades, now, WHALE)).toBeNull();
  });

  it('hacim eşiği altında null', () => {
    const trades = Array.from({ length: 4 }, (_, i) => trade({ ts: now - i * 200, side: 'sell', qty: 200 }));
    expect(detectDeltaBurst(trades, now, WHALE)).toBeNull();
  });
});

describe('detectAbsorption', () => {
  it('yüksek hacim + dar bantta pasif tarafı döndürür (cvd+ → sell)', () => {
    const trades = Array.from({ length: 12 }, (_, i) =>
      trade({ ts: now - i * 100, side: 'buy', price: 100 + (i % 2) * 0.005, qty: 2000 })
    ); // 12 x ~200k = 2.4M > 220k; cvd ~+2.4M > 80k; spread ~%0.005 < %0.08
    const r = detectAbsorption(trades, now, WHALE);
    expect(r).not.toBeNull();
    expect(r?.side).toBe('sell');
  });

  it('bant genişse null', () => {
    const trades = Array.from({ length: 12 }, (_, i) =>
      trade({ ts: now - i * 100, side: 'buy', price: 100 + i * 0.05, qty: 2000 })
    ); // fiyat %5+ kayıyor
    expect(detectAbsorption(trades, now, WHALE)).toBeNull();
  });

  it('işlem sayısı <10 ise null', () => {
    const trades = Array.from({ length: 9 }, (_, i) => trade({ ts: now - i * 100, qty: 5000 }));
    expect(detectAbsorption(trades, now, WHALE)).toBeNull();
  });
});

describe('collectWalls & detectSpoofRemovals', () => {
  it('duvarları iki taraftan toplar', () => {
    const bids = new Map([[100, 1000]]); // 100k duvar
    const asks = new Map([[101, 5000]]); // 505k duvar
    const walls = collectWalls(bids, asks, WHALE, now);
    expect(walls.size).toBe(2);
    expect(walls.get(101)?.side).toBe('A');
    expect(walls.get(100)?.notional).toBe(100_000);
  });

  it('eşik altı seviyeler duvar sayılmaz', () => {
    const walls = collectWalls(new Map([[100, 10]]), new Map(), WHALE, now);
    expect(walls.size).toBe(0);
  });

  it('kısa ömürlü büyük duvar iptali spoof sayılır', () => {
    const prev = new Map<number, WallInfo>([
      [100, { notional: 500_000, ts: now - 1500, side: 'B' }]
    ]);
    const cur = new Map<number, WallInfo>();
    const spoofs = detectSpoofRemovals(prev, cur, now, WHALE);
    expect(spoofs).toHaveLength(1);
    expect(spoofs[0].price).toBe(100);
    expect(spoofs[0].side).toBe('B');
  });

  it('hâlâ ayakta olan veya yaşlı/ufak duvarlar spoof değil', () => {
    const prev = new Map<number, WallInfo>([
      [100, { notional: 500_000, ts: now - 1000, side: 'B' }],
      [102, { notional: 500_000, ts: now - 9000, side: 'A' }], // çok yaşlı
      [104, { notional: 50_000, ts: now - 1000, side: 'A' }] // ufak
    ]);
    const cur = new Map<number, WallInfo>([[100, { notional: 500_000, ts: now, side: 'B' }]]);
    expect(detectSpoofRemovals(prev, cur, now, WHALE)).toHaveLength(0);
  });
});
