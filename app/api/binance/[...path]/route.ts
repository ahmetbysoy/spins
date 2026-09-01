import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path } = await params;
    const fullPath = path.join('/');

    // REV-5: Endpoint allowlist
    const allowedRegex = /^fapi\/v[12]\/[a-zA-Z0-9/]+$/;
    if (!allowedRegex.test(fullPath)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 400 });
    }

    const searchParams = req.nextUrl.searchParams.toString();
    const targetUrl = `https://fapi.binance.com/${fullPath}${searchParams ? `?${searchParams}` : ''}`;

    const res = await fetch(targetUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      // Cache for 2s on high-frequency, or no-store
      cache: 'no-store'
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream error ${res.status}: ${res.statusText}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
