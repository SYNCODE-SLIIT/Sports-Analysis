export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Invalid or empty JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
  // Default to local backend on :8030 for development if API_BASE_INTERNAL is not set
  const base = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8030";
  const r = await fetch(`${base.replace(/\/$/, '')}/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return new Response(await r.text(), {
    status: r.status,
    headers: { "Content-Type": "application/json" },
  });
}
