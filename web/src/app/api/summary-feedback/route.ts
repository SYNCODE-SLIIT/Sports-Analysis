export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  try {
    const { eventKey, headline, paragraph, bullets, reason } = body || {};
    // Minimal server-side logging without PII
    console.log('[summary-feedback]', {
      eventKey: String(eventKey || ''),
      reason: String(reason || ''),
      headline: String(headline || '').slice(0, 140),
      paragraphLen: String(paragraph || '').length,
      bulletsLen: Array.isArray(bullets) ? bullets.length : 0,
      ts: new Date().toISOString(),
    });
  } catch {}
  return new Response(null, { status: 204 });
}
