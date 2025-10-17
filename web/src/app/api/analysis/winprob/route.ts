import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;
  const eventId = qs.get("eventId") || "";
  const source = qs.get("source") || "auto";
  const lookback = qs.get("lookback") || "10";

  const base = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
  const url = `${base}/analysis/winprob?eventId=${encodeURIComponent(eventId)}&source=${encodeURIComponent(source)}&lookback=${encodeURIComponent(lookback)}`;

  try {
    const r = await fetch(url, { method: "GET" });
    if (r.ok) {
      const j = await r.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
      return Response.json(j, { status: r.status });
    }
    // Fallback: use collector intent if direct endpoint not available
    const collectUrl = `${base}/collect`;
    const cr = await fetch(collectUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "analysis.winprob", args: { eventId, source, lookback: Number(lookback) || 10 } }),
    });
    const cj = await cr.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
    return Response.json(cj, { status: cr.status });
  } catch {
    // Last resort: try collector path; if that also fails, return 502
    try {
      const collectUrl = `${base}/collect`;
      const cr = await fetch(collectUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "analysis.winprob", args: { eventId, source, lookback: Number(lookback) || 10 } }),
      });
      const cj = await cr.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
      return Response.json(cj, { status: cr.status });
    } catch (err) {
      return Response.json({ ok: false, error: { message: "Failed to reach analysis backend.", detail: String(err) } }, { status: 502 });
    }
  }
}
