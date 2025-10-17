import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams;
  const teamA = qs.get("teamA") || "";
  const teamB = qs.get("teamB") || "";
  const eventId = qs.get("eventId") || "";
  const lookback = qs.get("lookback") || "10";
  const base = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";

  // Prefer direct h2h when team names provided
  const directUrl = teamA && teamB
    ? `${base}/analysis/h2h?teamA=${encodeURIComponent(teamA)}&teamB=${encodeURIComponent(teamB)}&lookback=${encodeURIComponent(lookback)}`
    : `${base}/analysis/h2h${qs.toString() ? `?${qs.toString()}` : ""}`;

  try {
    const r = await fetch(directUrl, { method: "GET" });
    if (r.ok) {
      const j = await r.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
      return Response.json(j, { status: r.status });
    }
    // Fallback: use collector intent (by eventId if provided)
    const cr = await fetch(`${base}/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "analysis.h2h", args: { eventId: eventId || undefined, lookback: Number(lookback) || 10 } }),
    });
    const cj = await cr.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
    return Response.json(cj, { status: cr.status });
  } catch {
    try {
      const cr = await fetch(`${base}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "analysis.h2h", args: { eventId: eventId || undefined, lookback: Number(lookback) || 10 } }),
      });
      const cj = await cr.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
      return Response.json(cj, { status: cr.status });
    } catch (err) {
      return Response.json({ ok: false, error: { message: "Failed to reach analysis backend.", detail: String(err) } }, { status: 502 });
    }
  }
}
