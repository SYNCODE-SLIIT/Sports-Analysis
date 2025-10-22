export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const basePrimary = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8030";
  const baseFallback = "http://127.0.0.1:8000";

  const tryFetch = async (base: string) => {
    const url = `${base.replace(/\/$/, "")}/summarizer/summarize/news`;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  try {
    let r = await tryFetch(basePrimary);
    if (!r.ok && basePrimary !== baseFallback) {
      try { r = await tryFetch(baseFallback); } catch {}
    }
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch {
    try {
      const r2 = await tryFetch(baseFallback);
      const text2 = await r2.text();
      return new Response(text2, { status: r2.status, headers: { "Content-Type": "application/json" } });
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "news summarizer backend unreachable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
}
