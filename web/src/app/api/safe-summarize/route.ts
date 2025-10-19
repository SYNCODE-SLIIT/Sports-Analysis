import { toSummary, EMPTY_SUMMARY } from '@/lib/summarySchema';
import { moderateSummary } from '@/lib/moderation';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // Call backend summarizer directly (mirrors /api/summarizer logic)
  const basePrimary = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8030';
  const baseFallback = 'http://127.0.0.1:8000';
  const b = body as { events?: unknown[] };
  const isEvents = Array.isArray(b?.events) && b.events.length > 0;
  const path = isEvents ? '/summarizer/summarize/events' : '/summarizer/summarize';

  const tryFetch = async (base: string) => {
    const url = `${base.replace(/\/$/, '')}${path}`;
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'auto', ...body }) });
  };

  let raw: unknown = null;
  try {
    let r = await tryFetch(basePrimary);
    if (!r.ok && basePrimary !== baseFallback) {
      try { r = await tryFetch(baseFallback); } catch {}
    }
    try { raw = await r.json(); } catch { raw = null; }
  } catch {
    try {
      const rr = await tryFetch(baseFallback);
      try { raw = await rr.json(); } catch { raw = null; }
    } catch {
      raw = null;
    }
  }

  if (!raw) {
    return Response.json({ ok: false, ...EMPTY_SUMMARY }, { status: 200 });
  }

  // Normalize with schema (length caps, shape coercion)
  let safe = toSummary(raw);

  // Basic moderation
  const mod = moderateSummary(safe);
  if (!mod.ok) {
    // If unsafe, return minimal fallback without flagged text
    return Response.json({ ok: true, headline: 'Match Summary', paragraph: 'Summary unavailable for this fixture.', bullets: [] }, { status: 200 });
  }

  // Use cleaned values from moderation step
  safe = { ...safe, ...mod.cleaned };
  // If paragraph is empty but bullets exist, synthesize a short paragraph
  if ((!safe.paragraph || !safe.paragraph.trim()) && Array.isArray(safe.bullets) && safe.bullets.length > 0) {
    const parts = safe.bullets
      .slice(0, 5)
      .map((b) => (b.endsWith('.') ? b : `${b}.`));
    const joined = parts.join(' ');
    safe = { ...safe, paragraph: joined.slice(0, 800) };
  }
  return Response.json({ ok: true, ...safe }, { status: 200 });
}
