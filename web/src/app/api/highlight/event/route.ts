import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  // Use internal API base when available. Default to 8030 which is the local
  // backend used by run_server.py during development.
  const base = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8030";
  const url = `${base}/highlight/event${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, { method: "GET" });
  const j = await r.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
  return Response.json(j, { status: r.status });
}
