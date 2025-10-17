export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const base = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8030";
  // If events array is provided, route to the per-event summarizer; else use generic match-level summarize
  const isEvents = Array.isArray(body?.events) && body.events.length > 0;
  const target = isEvents
    ? `${base.replace(/\/$/, '')}/summarizer/summarize/events`
    : `${base.replace(/\/$/, '')}/summarizer/summarize`;
  const r = await fetch(target, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
}
