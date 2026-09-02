import { describe, expect, it } from 'vitest';
import {
  AI_ALLOWED_TIMEFRAMES,
  buildFlowBrief,
  buildSystemPrompt,
  buildUserPrompt,
  parseGeminiText,
  sanitizeCommentaryText,
  validateCommentaryContext,
  type AICommentaryContext
} from './ai-commentary';
import { FlowSnapshot } from './types';

const snap = (over: Partial<FlowSnapshot> = {}): FlowSnapshot => ({
  cvd60: 120000,
  notional60: 500000,
  cvdBias: 0.24,
  cvdSlope: 0.06,
  obi: -0.15,
  bidVol: 300000,
  askVol: 400000,
  longLiq60: 120000,
  shortLiq60: 0,
  oi: 85000,
  oiChangePct: 0.42,
  funding: 0.00031,
  markPrice: 60000,
  nextFunding: 1700000000000,
  bestBid: 59990,
  bestAsk: 60010,
  spread: 20,
  taker30: 90000,
  takerSpike: true,
  rangePct: 0.009,
  atrPct: 0.002,
  tightRange: false,
  change5: 0.004,
  cascadeDown: false,
  cascadeUp: true,
  wallCount: { bid: 2, ask: 4 },
  ...over
});

const ctx = (over: Partial<AICommentaryContext> = {}): AICommentaryContext => ({
  symbol: 'BTCUSDT',
  timeframe: '5m',
  dir: 'SAT',
  score: 78,
  grade: 'YÜKSEK',
  reasons: ['CVD net satış baskısı altında.', 'OBI ask ağırlıklı.'],
  brief: 'CVD bias: +24%; OBI: -0.15',
  pattern: {
    id: '9x21_DOWN_SAR0_F1',
    name: 'Hızlı/Orta Death Cross + Anında SAR Onayı + Trend Uyumlu',
    n: 42,
    winRate: 61.9,
    wilsonLower: 47.2,
    avgMfe20: 0.55,
    avgMae20: 0.31
  },
  ...over
});

describe('buildSystemPrompt', () => {
  it('stil kurallarını içerir', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('40 kelime');
    expect(p).toContain('garanti');
    expect(p).toContain('Türkçe');
  });
});

describe('buildFlowBrief', () => {
  it('anahtar metrikleri biçimlendirir', () => {
    const b = buildFlowBrief(snap());
    expect(b).toContain('CVD bias');
    expect(b).toContain('OBI');
    expect(b).toContain('Funding');
    expect(b).toContain('short squeeze');
    expect(b).toContain('Duvarlar: bid 2 / ask 4');
  });

  it('null OI/funding alanlarını atlar', () => {
    const b = buildFlowBrief(snap({ oi: null, funding: null }));
    expect(b).not.toContain('OI:');
    expect(b).not.toContain('Funding:');
  });
});

describe('buildUserPrompt', () => {
  it('sembol, skor, gerekçe ve desen bilgisini işler', () => {
    const p = buildUserPrompt(ctx());
    expect(p).toContain('BTCUSDT');
    expect(p).toContain('78/100');
    expect(p).toContain('- CVD net satış baskısı altında.');
    expect(p).toContain('Wilson alt sınırı');
  });

  it('pattersiz bağlamda desen satırı üretmez', () => {
    const p = buildUserPrompt(ctx({ pattern: null }));
    expect(p).not.toContain('Desen havuzu');
  });
});

describe('sanitizeCommentaryText', () => {
  it('quote ve markdown artıklarını temizler', () => {
    expect(sanitizeCommentaryText('  "Kanka akış satıcıda."  ')).toBe('Kanka akış satıcıda.');
    expect(sanitizeCommentaryText('**Yukarı tırmanış**')).toBe('Yukarı tırmanış');
  });

  it('uzun metni 400 karaktere kırpar', () => {
    const t = sanitizeCommentaryText('a'.repeat(1000));
    expect(t.length).toBeLessThanOrEqual(400);
    expect(t.endsWith('...')).toBe(true);
  });
});

describe('parseGeminiText', () => {
  it('geçerli yanıtı okur', () => {
    const data = { candidates: [{ content: { parts: [{ text: 'Satıcılar sert, reis. ' }, { text: 'OBI ask ağırlıklı.' }] } }] };
    expect(parseGeminiText(data)).toBe('Satıcılar sert, reis. OBI ask ağırlıklı.');
  });

  it('bozuk/anlamsız yanıtlarda null döner', () => {
    expect(parseGeminiText(null)).toBeNull();
    expect(parseGeminiText({})).toBeNull();
    expect(parseGeminiText({ candidates: [] })).toBeNull();
    expect(parseGeminiText({ candidates: [{ content: { parts: [{ text: '' }] } }] })).toBeNull();
    expect(parseGeminiText({ candidates: [{ content: {} }] })).toBeNull();
  });
});

describe('validateCommentaryContext', () => {
  it('geçerli bağlamı kabul eder', () => {
    const v = validateCommentaryContext(ctx());
    expect(v).not.toBeNull();
    expect(v?.symbol).toBe('BTCUSDT');
    expect(v?.dir).toBe('SAT');
  });

  it('geçersiz yön/sembol/TF reddeder', () => {
    expect(validateCommentaryContext(ctx({ dir: 'X' as 'AL' }))).toBeNull();
    expect(validateCommentaryContext(ctx({ symbol: 'BTC USDT DROP TABLE' }))).toBeNull();
    expect(validateCommentaryContext(ctx({ timeframe: '7m' }))).toBeNull();
    expect(validateCommentaryContext(ctx({ timeframe: '1m' }).timeframe === '1m' ? ctx({ timeframe: '1m' }) : null)).not.toBeNull();
  });

  it('null skoru kabul eder, aralık dışı skoru reddeder', () => {
    expect(validateCommentaryContext(ctx({ score: null }))).not.toBeNull();
    expect(validateCommentaryContext(ctx({ score: 150 }))).toBeNull();
  });

  it('gerekçe listesi boşsa reddeder, uzun listeyi kırpar', () => {
    expect(validateCommentaryContext(ctx({ reasons: [] }))).toBeNull();
    const many = Array.from({ length: 50 }, () => 'x');
    const v = validateCommentaryContext(ctx({ reasons: many }));
    expect(v?.reasons.length).toBe(16);
  });

  it('brief olmadan reddeder', () => {
    expect(validateCommentaryContext(ctx({ brief: '' }))).toBeNull();
  });

  it('izinli TF listesi motor TF setiyle uyumlu', () => {
    expect(AI_ALLOWED_TIMEFRAMES).toContain('1m');
    expect(AI_ALLOWED_TIMEFRAMES).toContain('5m');
  });
});
