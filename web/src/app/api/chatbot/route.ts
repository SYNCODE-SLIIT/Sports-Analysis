import { NextRequest } from "next/server";

const API_BASE =
  process.env.API_BASE_INTERNAL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { ok: false, error: { message: "Request body must be valid JSON." } },
      { status: 400 }
    );
  }

  try {
    const resp = await fetch(`${API_BASE}/chatbot/web-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const data = await resp
      .json()
      .catch(() => ({ ok: false, error: { message: "Invalid JSON from backend" } }));
    return Response.json(data, { status: resp.status });
  } catch (error) {
    return Response.json(
      { ok: false, error: { message: "Failed to reach chatbot backend.", detail: String(error) } },
      { status: 502 }
    );
  }
}
