import { parseFixtures, parseHighlights, type Fixture, type Highlight } from "@/lib/schemas";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isObject(value) ? value : undefined;
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export interface NlSearchHit {
  intent: string;
  reason?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
  count?: number;
  items?: unknown[];
  data?: unknown;
  error?: unknown;
  source?: unknown;
  meta?: unknown;
}

export interface NlParsed {
  text?: string;
  entities?: Record<string, unknown>;
  candidates?: Array<Record<string, unknown>>;
}

export interface NlSearchResponse {
  ok: boolean;
  query: string;
  parsed?: NlParsed;
  hits: NlSearchHit[];
  results: NlSearchHit[];
  limit?: number;
  meta?: Record<string, unknown>;
}

export type NlHitKind = "matches" | "highlights" | "generic";

export interface NlHitInterpretation {
  kind: NlHitKind;
  fixtures?: Fixture[];
  highlights?: Highlight[];
  raw: NlSearchHit;
}

export interface NlSearchResultBundle extends NlSearchResponse {
  interpretedHits: NlHitInterpretation[];
}

function coerceHit(value: unknown): NlSearchHit | null {
  const record = toRecord(value);
  if (!record) return null;
  const intent = typeof record.intent === "string" ? record.intent : undefined;
  if (!intent) return null;
  return {
    intent,
    reason: typeof record.reason === "string" ? record.reason : undefined,
    args: toRecord(record.args),
    ok: typeof record.ok === "boolean" ? record.ok : undefined,
    count: typeof record.count === "number" ? record.count : undefined,
    items: toArray(record.items),
    data: record.data,
    error: record.error,
    source: record.source,
    meta: record.meta,
  };
}

function interpretHit(hit: NlSearchHit): NlHitInterpretation {
  const intent = hit.intent.toLowerCase();
  const items = hit.items ?? [];

  if (/(events|fixtures|h2h)/.test(intent)) {
    const fixtures = parseFixtures(items).filter(
      (fixture) => Boolean(fixture.home_team) && Boolean(fixture.away_team),
    );
    if (fixtures.length > 0) {
      return { kind: "matches", fixtures, raw: hit };
    }
  }

  if (intent === "video.highlights" || intent.includes("highlights")) {
    const highlights = parseHighlights(items);
    return { kind: "highlights", highlights, raw: hit };
  }

  return { kind: "generic", raw: hit };
}

export async function postNlSearch(query: string, options?: { limit?: number }) {
  const payload: Record<string, unknown> = { query };
  if (options?.limit !== undefined) payload.limit = options.limit;

  const response = await fetch("/api/search/nl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Search request failed with status ${response.status}`);
  }

  const json = await response.json();
  const record = toRecord(json) ?? {};

  const hits = toArray(record.hits).map(coerceHit).filter(Boolean) as NlSearchHit[];
  const results = toArray(record.results).map(coerceHit).filter(Boolean) as NlSearchHit[];
  const parsedRaw = toRecord(record.parsed);
  const parsed: NlParsed | undefined = parsedRaw
    ? {
        text: typeof parsedRaw.text === "string" ? parsedRaw.text : undefined,
        entities: toRecord(parsedRaw.entities),
        candidates: toArray(parsedRaw.candidates).map(toRecord).filter(Boolean) as Array<Record<string, unknown>>,
      }
    : undefined;

  const bundle: NlSearchResponse = {
    ok: Boolean(record.ok),
    query: typeof record.query === "string" ? record.query : query,
    parsed,
    hits,
    results,
    limit: typeof record.limit === "number" ? record.limit : undefined,
    meta: toRecord(record.meta),
  };

  const interpretedHits = hits.map(interpretHit);
  return { ...bundle, interpretedHits };
}
