import { describe, expect, it } from 'vitest';
import { computeHype, fmtCompact, metricsText, priceTickText, pushTickerItem, TICKER_MAX, type TickerItem } from './ticker';

function item(id: string, ts = 0): TickerItem {
  return { id, kind: 'info', text: id, ts };
}

describe('pushTickerItem', () => {
  it('sona ekler ve taşıran başını atar', () => {
    let buf: TickerItem[] = [];
    for (let i = 0; i < TICKER_MAX + 5; i++) buf = pushTickerItem(buf, item(`i${i}`), TICKER_MAX);
    expect(buf).toHaveLength(TICKER_MAX);
    expect(buf[0].id).toBe('i5'); // ilk 5 atıldı
    expect(buf[buf.length - 1].id).toBe(`i${TICKER_MAX + 4}`);
  });

  it('max altında liste dokunulmaz benzeri davranış: mevcut öğeler korunur', () => {
    const buf = [item('a'), item('b')];
    const out = pushTickerItem(buf, item('c'), 5);
    expect(out.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(buf).toHaveLength(2); // orijinal mutasyona uğramaz
  });
});

describe('priceTickText', () => {
  it('yükseliş: ▲ ve pozitif yüzde', () => {
    const { text, kind } = priceTickText(100.5, 100, 2);
    expect(kind).toBe('up');
    expect(text).toContain('▲');
    expect(text).toContain('0.50');
  });

  it('düşüş: ▼ ve negatif yüzde (mutlak değer yazılır)', () => {
    const { text, kind } = priceTickText(99, 100, 2);
    expect(kind).toBe('down');
    expect(text).toContain('▼');
    expect(text).toContain('1.00');
  });

  it('eşit/ilk tik: düz, yönsüz', () => {
    expect(priceTickText(100, 100).kind).toBe('flat');
    expect(priceTickText(100, null).kind).toBe('flat');
    expect(priceTickText(100, 0).kind).toBe('flat');
  });
});

describe('metricsText', () => {
  it('CVD/OBI/OI tam satır', () => {
    const t = metricsText(8_770_000, -0.214, 107_900_000, 0.42);
    expect(t).toContain('CVD +');
    expect(t).toContain('OBI -21.4%');
    expect(t).toContain('OI ');
    expect(t).toContain('(+0.4%)');
  });

  it('OI yoksa OI segmenti düşer', () => {
    const t = metricsText(-500, 0.1, null, 0);
    expect(t).not.toContain('OI');
    expect(t).toContain('CVD -');
    expect(t).toContain('OBI 10.0%');
  });
});

describe('computeHype', () => {
  it('sakin piyasa ~1x bandında, alt sınır 0,7', () => {
    expect(computeHype(0, 0, 1)).toBeCloseTo(0.85, 5);
    expect(computeHype(-5, -1, 0.2)).toBeGreaterThanOrEqual(0.7);
  });

  it('volatilite/hacim arttıkça hızlanır (üst sınır 2,6)', () => {
    const calm = computeHype(0.004, 0.0012, 1); // sikisik/sakin piyasa (oran birimi)
    const wild = computeHype(0.03, 0.01, 3.5); // %3 aralik + 3,5x hacim
    expect(wild).toBeGreaterThan(calm);
    expect(computeHype(50, 10, 20)).toBeLessThanOrEqual(2.6);
  });
});

describe('fmtCompact', () => {
  it('tr-TR kısa gösterim', () => {
    expect(fmtCompact(12_400)).toBe('12.4K');
    expect(fmtCompact(8_770_000)).toBe('8.77M');
  });
});
