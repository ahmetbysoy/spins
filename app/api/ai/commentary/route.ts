import { NextRequest, NextResponse } from 'next/server';
import {
  AICommentaryServerResponse,
  DEFAULT_GEMINI_MODEL,
  buildSystemPrompt,
  buildUserPrompt,
  parseGeminiText,
  validateCommentaryContext
} from '@/lib/ai-commentary';

export const dynamic = 'force-dynamic';

// Basit bellek-içi hız limiti (tek instance için yeterli; Vercel serverless'ta best-effort)
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const GEMINI_TIMEOUT_MS = 8000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;

  // Anahtar yoksa: istemci yerel fallback havuzuna döner
  if (!apiKey) {
    const body: AICommentaryServerResponse = { available: false, reason: 'no-key' };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!rateLimit(ip)) {
    const body: AICommentaryServerResponse = { available: true, commentary: null, reason: 'rate-limited' };
    return NextResponse.json(body, { status: 429, headers: { 'Cache-Control': 'no-store' } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const ctx = validateCommentaryContext(raw);
  if (!ctx) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
        contents: [{ role: 'user', parts: [{ text: buildUserPrompt(ctx) }] }],
        generationConfig: {
          temperature: 0.85,
          topP: 0.95,
          maxOutputTokens: 120
        }
      })
    });

    if (!res.ok) {
      // Upstream hatası: istemci fallback'a dönsün, 500 patlatmaya gerek yok
      const body: AICommentaryServerResponse = { available: true, commentary: null, reason: `upstream-${res.status}` };
      return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
    }

    const data: unknown = await res.json();
    const text = parseGeminiText(data);
    const body: AICommentaryServerResponse = {
      available: true,
      commentary: text,
      model
    };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    const body: AICommentaryServerResponse = { available: true, commentary: null, reason: 'timeout-or-network' };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } finally {
    clearTimeout(timer);
  }
}
