import { NextRequest, NextResponse } from "next/server";

const MIN_LIMIT = 1;
const MAX_LIMIT = 5;

function normalizeLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const num = Number(value);
  if (Number.isNaN(num)) return undefined;
  const clamped = Math.min(Math.max(Math.trunc(num), MIN_LIMIT), MAX_LIMIT);
  return clamped;
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "invalid_json", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  const rawQuery =
    typeof body.query === "string"
      ? body.query
      : typeof body.q === "string"
        ? body.q
        : "";
  const query = rawQuery.trim();
  if (!query) {
    return NextResponse.json(
      { ok: false, error: { code: "query_required", message: "Provide a search query." } },
      { status: 400 },
    );
  }

  const limit = normalizeLimit(body.limit);
  const payload = {
    ...body,
    query,
    ...(limit !== undefined ? { limit } : {}),
  };

  const base = process.env.API_BASE_INTERNAL;
  if (!base) {
    return NextResponse.json(
      { ok: false, error: { code: "missing_api_base", message: "API_BASE_INTERNAL is not configured." } },
      { status: 500 },
    );
  }

  const upstream = await fetch(`${base}/search/nl`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

