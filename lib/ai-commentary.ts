// AI Yorum Katmanı — Gemini (server-side) + yerel fallback entegrasyonu.
// Saf fonksiyonlar burada tutulur ki birim test edilebilsin (route dosyaları sadece handler export edebilir).
import { FlowSnapshot } from './types';

export const AI_COMMENTARY_MAX_LEN = 400;
export const AI_COMMENTARY_MIN_INTERVAL_MS = 45_000; // iki AI çağrısı arası min süre
export const AI_COMMENTARY_CACHE_TTL = 5 * 60_000; // aynı sinyal için önbellek süresi
export const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

export interface AICommentaryPatternInfo {
  id: string;
  name: string;
  n: number;
  winRate: number;
  wilsonLower: number;
  avgMfe20: number;
  avgMae20: number;
}

export interface AICommentaryContext {
  symbol: string;
  timeframe: string;
  dir: 'AL' | 'SAT';
  score: number | null;
  grade: string;
  reasons: string[];
  /** İnsan-okur orderflow özeti (buildFlowBrief ile üretilir) */
  brief: string;
  pattern?: AICommentaryPatternInfo | null;
}

export interface AICommentaryServerResponse {
  available: boolean;
  commentary?: string | null;
  model?: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Prompt üretimi
// ---------------------------------------------------------------------------

export function buildSystemPrompt(): string {
  return [
    'Sen "SPINS" adlı Binance USD-M Futures orderflow terminalinin piyasa yorumcususun.',
    'Görevin: sana verilen sinyal ve orderflow verisine göre kısa, yerinde ve karakterli bir Türkçe yorum üretmek.',
    '',
    'Stil kuralları:',
    '- İstanbul mahalle ağzı + trader argosu ("kanka", "reis", "mahalle" gibi) mevcut terminolojinin tınısını korur; abartmazsın.',
    '- En fazla 2 cümle ve toplam 40 kelime sınırı.',
    '- En az bir somut metriği (CVD, OBI, likidasyon, Wilson alt sınırı, funding, OI vb.) yoruma işlersin.',
    '- Kesinlik iddiası ("garanti", "kesin çıkar", "kayıp yok") yasak; risk ima edilir.',
    '- Emoji, başlık, madde işareti veya Markdown kullanmazsın; sadece düz yorum metnini döndürürsün.',
    '- Yasal uyarı veya "yatırım tavsiyesi değildir" ibaresi eklemezsin; arayüzde ayrıca mevcut.',
    '- Veride olmayan bilgiyi uydurmazsın; veri eksikse yorumunu genel tutarsın.'
  ].join('\n');
}

function fmtSignedPct(x: number, digits = 1): string {
  const v = (x * 100).toFixed(digits);
  return `${x >= 0 ? '+' : ''}${v}%`;
}

function fmtUsdK(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '$0';
  return `$${(x / 1000).toFixed(0)}k`;
}

export function buildFlowBrief(snap: FlowSnapshot): string {
  const parts: string[] = [];
  parts.push(`CVD bias (60s): ${fmtSignedPct(snap.cvdBias, 0)}, CVD eğim ivmesi: ${fmtSignedPct(snap.cvdSlope, 1)}`);
  parts.push(`OBI: ${snap.obi.toFixed(2)} (bid $${(snap.bidVol / 1000).toFixed(0)}k / ask $${(snap.askVol / 1000).toFixed(0)}k)`);
  parts.push(`Taker hacim 30s: ${fmtUsdK(snap.taker30)}, 60s toplam: ${fmtUsdK(snap.notional60)}`);
  parts.push(`Likidasyon 60s: long ${fmtUsdK(snap.longLiq60)} / short ${fmtUsdK(snap.shortLiq60)}`);
  if (snap.oi !== null) parts.push(`OI: ${snap.oi.toFixed(0)} (değişim ${snap.oiChangePct >= 0 ? '+' : ''}${snap.oiChangePct.toFixed(2)}%)`);
  if (snap.funding !== null) parts.push(`Funding: ${(snap.funding * 100).toFixed(4)}%`);
  parts.push(`Duvarlar: bid ${snap.wallCount.bid} / ask ${snap.wallCount.ask}`);
  if (snap.tightRange) parts.push('Bant dar (whipsaw riski)');
  if (snap.cascadeDown) parts.push('Aşağı yönlü cascade uyarısı');
  if (snap.cascadeUp) parts.push('Yukarı yönlü cascade/short squeeze uyarısı');
  if (snap.takerSpike) parts.push('Taker spike mevcut');
  return parts.join('; ');
}

export function buildUserPrompt(ctx: AICommentaryContext): string {
  const lines: string[] = [];
  lines.push(`Sembol: ${ctx.symbol} | Zaman dilimi: ${ctx.timeframe} | Sinyal yönü: ${ctx.dir}`);
  if (ctx.score !== null) lines.push(`Güven skoru: ${ctx.score}/100 (${ctx.grade})`);
  if (ctx.reasons?.length) {
    lines.push('Karar motoru gerekçeleri:');
    ctx.reasons.slice(0, 12).forEach((r) => lines.push(`- ${r}`));
  }
  lines.push(`Orderflow özeti: ${ctx.brief}`);
  if (ctx.pattern && ctx.pattern.n > 0) {
    lines.push(
      `Desen havuzu: ${ctx.pattern.name} (n=${ctx.pattern.n}, winRate %${ctx.pattern.winRate.toFixed(1)}, Wilson alt sınırı %${ctx.pattern.wilsonLower.toFixed(1)}, ort. MFE +%${ctx.pattern.avgMfe20.toFixed(2)} / MAE -%${ctx.pattern.avgMae20.toFixed(2)})`
    );
  }
  lines.push('Yukarıdaki veriye göre tek paragraf yorum üret.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Gemini yanıtı ayrıştırma & temizleme
// ---------------------------------------------------------------------------

export function sanitizeCommentaryText(raw: string): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  t = t.replace(/^["'`*#\s]+|["'`*\s]+$/g, '');
  if (t.length > AI_COMMENTARY_MAX_LEN) t = `${t.slice(0, AI_COMMENTARY_MAX_LEN - 3).trimEnd()}...`;
  return t;
}

export function parseGeminiText(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0] as { content?: { parts?: unknown } };
  const parts = first?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const p of parts) {
    if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
      texts.push((p as { text: string }).text);
    }
  }
  const joined = texts.join(' ').trim();
  if (!joined) return null;
  return sanitizeCommentaryText(joined);
}

// ---------------------------------------------------------------------------
// İstemci tarafı doğrulama (server route da aynı fonksiyonu kullanır)
// ---------------------------------------------------------------------------

export const AI_ALLOWED_TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d'];

export function validateCommentaryContext(raw: unknown): AICommentaryContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const symbol = typeof r.symbol === 'string' ? r.symbol.toUpperCase() : '';
  if (!/^[A-Z0-9._-]{2,20}$/.test(symbol)) return null;

  const timeframe = typeof r.timeframe === 'string' ? r.timeframe : '';
  if (!AI_ALLOWED_TIMEFRAMES.includes(timeframe)) return null;

  const dir = r.dir;
  if (dir !== 'AL' && dir !== 'SAT') return null;

  let score: number | null = null;
  if (r.score !== null && r.score !== undefined) {
    if (typeof r.score !== 'number' || !Number.isFinite(r.score) || r.score < 0 || r.score > 100) return null;
    score = r.score;
  }

  const grade = typeof r.grade === 'string' ? r.grade.slice(0, 12) : '';
  if (!grade) return null;

  if (!Array.isArray(r.reasons)) return null;
  const reasons = r.reasons
    .filter((x): x is string => typeof x === 'string')
    .slice(0, 16)
    .map((x) => x.slice(0, 240));
  if (reasons.length === 0) return null;

  const brief = typeof r.brief === 'string' ? r.brief.slice(0, 2000) : '';
  if (!brief) return null;

  let pattern: AICommentaryPatternInfo | null = null;
  if (r.pattern && typeof r.pattern === 'object') {
    const p = r.pattern as Record<string, unknown>;
    const id = typeof p.id === 'string' ? p.id.slice(0, 64) : '';
    const name = typeof p.name === 'string' ? p.name.slice(0, 120) : '';
    const nums = [p.n, p.winRate, p.wilsonLower, p.avgMfe20, p.avgMae20];
    if (id && name && nums.every((x) => typeof x === 'number' && Number.isFinite(x))) {
      pattern = {
        id,
        name,
        n: Math.max(0, Math.round(p.n as number)),
        winRate: p.winRate as number,
        wilsonLower: p.wilsonLower as number,
        avgMfe20: p.avgMfe20 as number,
        avgMae20: p.avgMae20 as number
      };
    }
  }

  return { symbol, timeframe, dir, score, grade, reasons, brief, pattern };
}

// ---------------------------------------------------------------------------
// İstemci çağrısı (cooldown + önbellek + sessiz fallback)
// ---------------------------------------------------------------------------

let lastCallTs = 0;
const responseCache = new Map<string, { text: string; ts: number }>();

function cacheKey(ctx: AICommentaryContext): string {
  return `${ctx.symbol}:${ctx.timeframe}:${ctx.dir}:${ctx.score ?? 'x'}:${ctx.pattern?.id ?? ''}`;
}

export async function fetchAICommentary(ctx: AICommentaryContext): Promise<string | null> {
  const key = cacheKey(ctx);
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.ts < AI_COMMENTARY_CACHE_TTL) return hit.text;
  if (Date.now() - lastCallTs < AI_COMMENTARY_MIN_INTERVAL_MS) return hit?.text ?? null;

  lastCallTs = Date.now();
  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 9000) : null;
    const res = await fetch('/api/ai/commentary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
      signal: controller?.signal
    });
    if (timer) clearTimeout(timer);
    if (!res.ok) return hit?.text ?? null;

    const data = (await res.json()) as AICommentaryServerResponse;
    if (!data || !data.available || typeof data.commentary !== 'string' || !data.commentary.trim()) {
      return hit?.text ?? null;
    }
    const text = data.commentary.trim();
    responseCache.set(key, { text, ts: Date.now() });
    return text;
  } catch {
    return hit?.text ?? null;
  }
}

export function resetAICommentaryRuntime(): void {
  // Sadece testler için
  lastCallTs = 0;
  responseCache.clear();
}
