import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString();
  const base = process.env.API_BASE_INTERNAL || process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8000";
  const url = `${base}/analysis/form${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, { method: "GET" });
  const j = await r.json().catch(() => ({ ok: false, error: { message: "Invalid JSON" } }));
  return Response.json(j, { status: r.status });
}
