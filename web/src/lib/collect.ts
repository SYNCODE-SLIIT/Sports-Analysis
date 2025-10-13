import { z } from "zod";

// Translate stray legacy intents to new ones
const LEGACY_INTENT_MAP: Record<string, string> = {
  "matches.live": "events.live",
  "matches.list": "events.list",
  "fixtures.list": "events.list",
  "match.get": "event.get",
  "match.results": "event.results",
  "highlights.byMatch": "video.highlights",
};
const mapIntent = (intent: string) => LEGACY_INTENT_MAP[intent] ?? intent;

const TraceZ = z.array(z.any());
const EnvelopeZ = z.object({
  ok: z.boolean(),
  data: z.any().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  meta: z.object({ trace: TraceZ }).optional(),
});

export type CollectEnvelope = z.infer<typeof EnvelopeZ>;
export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
export type DataObject = { [k: string]: Json };

/**
 * Post to the Next.js API proxy which forwards to backend /collect.
 * Throws if ok=false and logs meta.trace in dev for debugging.
 */
export async function postCollect<TData extends Json = DataObject>(
  intentOrPayload: string | Record<string, Json>,
  maybeArgs?: Record<string, Json>
): Promise<CollectEnvelope & { data: TData }> {
  const payload = typeof intentOrPayload === "string"
    ? { intent: mapIntent(intentOrPayload), args: maybeArgs ?? {} }
    : ("intent" in intentOrPayload
        ? { ...intentOrPayload, intent: mapIntent(String((intentOrPayload as Record<string, Json>).intent)) }
        : intentOrPayload);
  const r = await fetch("/api/collect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  const parsed = EnvelopeZ.parse(j);
  if (!parsed.ok) {
    if (parsed.meta?.trace) console.debug("TRACE", parsed.meta.trace);
    throw new Error(parsed.error?.message ?? "Backend returned ok=false");
  }
  return parsed as CollectEnvelope & { data: TData };
}

/** Input sanitizer: trims, collapses whitespace, length<=64, whitelist */
export function sanitizeInput(s: string) {
  const trimmed = s.trim().replace(/\s+/g, " ");
  const limited = trimmed.slice(0, 64);
  const safe = limited.replace(/[^a-zA-Z0-9\s.,'\-]/g, "");
  return safe;
}

/** Pick event id from various possible fields */
export function pickEventId(e: Record<string, unknown>): string {
  const obj = e as { eventId?: unknown; id?: unknown; event_id?: unknown; event_key?: unknown; fixture_id?: unknown };
  const id = obj.eventId ?? obj.id ?? obj.event_id ?? obj.event_key ?? obj.fixture_id;
  if (!id) throw new Error("Missing eventId");
  return String(id);
}

/** Live fixtures */
export async function getLiveEvents(args: { leagueName?: string } = {}) {
  const cleanArgs: Record<string, Json> = {};
  if (args.leagueName) cleanArgs.leagueName = sanitizeInput(args.leagueName);
  return postCollect<{ events?: DataObject[] }>("events.live", cleanArgs);
}

/** Past/upcoming fixtures */
export async function listEvents(args: { leagueName?: string; teamName?: string; kind: "past" | "upcoming"; days?: number; fromDate?: string; toDate?: string; }) {
  const cleanArgs: Record<string, Json> = { ...args };
  if (typeof cleanArgs.leagueName === "string" && cleanArgs.leagueName) cleanArgs.leagueName = sanitizeInput(cleanArgs.leagueName);
  if (typeof cleanArgs.teamName === "string" && cleanArgs.teamName) cleanArgs.teamName = sanitizeInput(cleanArgs.teamName);
  return postCollect<{ events?: DataObject[] }>("events.list", cleanArgs);
}

/** League table/details */
export async function getLeagueTable(leagueName: string) {
  return postCollect<{ table?: DataObject[]; league?: DataObject }>("league.table", { leagueName: sanitizeInput(leagueName) });
}

/** Single match details */
export async function getEventResults(eventId: string) {
  return postCollect<{ event?: DataObject; stats?: DataObject; score?: DataObject }>("event.results", { eventId: String(eventId) });
}

/** Highlights for a match */
export async function getHighlights(eventId: string) {
  return postCollect<{ videos?: DataObject[] }>("video.highlights", { eventId: String(eventId) });
}

export async function getTeam(teamName: string) {
  const clean = sanitizeInput(teamName);
  if (!clean) throw new Error("Team name is required");
  return postCollect<{ team?: DataObject; teams?: DataObject[] }>("team.get", { teamName: clean });
}

/** Search teams by name for autocomplete */
export async function searchTeams(teamName: string) {
  const clean = sanitizeInput(teamName);
  if (!clean) return { data: { teams: [] } } as CollectEnvelope & { data: { teams?: DataObject[] } };
  return postCollect<{ teams?: DataObject[] }>("teams.list", { teamName: clean });
}

/** Search leagues by name for autocomplete */
export async function searchLeagues(leagueName: string) {
  const clean = sanitizeInput(leagueName);
  if (!clean) return { data: { leagues: [] } } as CollectEnvelope & { data: { leagues?: DataObject[] } };
  return postCollect<{ leagues?: DataObject[] }>("leagues.list", { leagueName: clean });
}

export async function listTeamPlayers(teamName: string) {
  const clean = sanitizeInput(teamName);
  if (!clean) throw new Error("Team name is required");
  return postCollect<{ players?: DataObject[] }>("players.list", { teamName: clean });
}

export async function listSeasons(args: { leagueId?: string; leagueName?: string }) {
  const payload: Record<string, Json> = {};
  if (args.leagueId) payload.leagueId = sanitizeInput(String(args.leagueId));
  else if (args.leagueName) payload.leagueName = sanitizeInput(args.leagueName);
  if (!Object.keys(payload).length) throw new Error("leagueId or leagueName required");
  return postCollect<{ seasons?: DataObject[] }>("seasons.list", payload);
}

// ---- Extra helpers to mirror legacy match.js ----
export async function getH2HByTeams(teamA: string, teamB: string, lookback = 10) {
  const u = new URL("/api/analysis/h2h", window.location.origin);
  u.searchParams.set("teamA", teamA);
  u.searchParams.set("teamB", teamB);
  u.searchParams.set("lookback", String(lookback));
  const r = await fetch(u.toString());
  return r.json();
}

export async function getForm(teamId: string, lookback = 5) {
  const u = new URL("/api/analysis/form", window.location.origin);
  u.searchParams.set("eventId", teamId);
  u.searchParams.set("lookback", String(lookback));
  const r = await fetch(u.toString());
  return r.json();
}

export async function searchEventHighlight(params: { home: string; away: string; date?: string; minute?: string; player?: string; event_type?: string; }) {
  const u = new URL("/api/highlight/event", window.location.origin);
  Object.entries(params).forEach(([k, v]) => { if (v) u.searchParams.set(k, String(v)); });
  const r = await fetch(u.toString());
  return r.json();
}

/** Odds helpers and comments to improve match parity */
export async function getOdds(eventId: string) {
  try {
    return await postCollect<{ odds?: DataObject[] }>("odds.live", { eventId: String(eventId) });
  } catch {
    return await postCollect<{ odds?: DataObject[] }>("odds.list", { eventId: String(eventId) });
  }
}

export async function getComments(eventId: string) {
  return postCollect<{ comments?: DataObject[] }>("comments.list", { eventId: String(eventId) });
}

export async function getLeagueNews(leagueName: string, limit = 20) {
  const clean = sanitizeInput(leagueName);
  if (!clean) {
    return { data: { articles: [], count: 0 } } as CollectEnvelope & {
      data: { articles: Array<Record<string, Json>>; count: number };
    };
  }
  return postCollect<{ articles?: DataObject[]; count?: number }>("league.news", {
    leagueName: clean,
    limit,
  });
}
