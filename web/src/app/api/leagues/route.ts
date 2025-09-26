import { NextResponse } from "next/server";
import { POPULAR_LEAGUES } from "@/lib/leagues";

const API_BASE = process.env.API_BASE_INTERNAL;

async function callCollect(intent: string, args: Record<string, unknown>) {
  if (!API_BASE) throw new Error("API_BASE_INTERNAL not configured");
  const res = await fetch(`${API_BASE}/collect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, args }),
  });
  if (!res.ok) throw new Error(`collect ${intent} failed`);
  return res.json() as Promise<{ ok?: boolean; data?: unknown; meta?: unknown }>;
}

function normalizeLeagues(raw: unknown): Array<{ league_name: string; country_name?: string }> {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Array<{ league_name: string; country_name?: string }> = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ league_name: name });
      continue;
    }
    if (entry && typeof entry === "object") {
      const obj = entry as Record<string, unknown>;
      const leagueName = typeof obj.league_name === "string"
        ? obj.league_name
        : typeof obj.name === "string"
          ? obj.name
          : typeof obj.league === "string"
            ? obj.league
            : undefined;
      if (!leagueName) continue;
      const key = leagueName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const country = typeof obj.country_name === "string"
        ? obj.country_name
        : typeof obj.country === "string"
          ? obj.country
          : undefined;
      out.push({ league_name: leagueName, ...(country ? { country_name: country } : {}) });
    }
  }
  return out;
}

export async function GET() {
  try {
    const env = await callCollect("leagues.list", {});
    const leaguesRaw = (env?.data as Record<string, unknown> | undefined)?.leagues ?? env?.data ?? [];
    const leagues = normalizeLeagues(leaguesRaw);
    if (leagues.length) return NextResponse.json({ leagues });
  } catch {}

  try {
    const upcoming = await callCollect("events.list", { kind: "upcoming", days: 14 });
    const data = upcoming?.data as Record<string, unknown> | undefined;
    const events = Array.isArray(data?.events) ? data?.events : [];
    const inferred = new Map<string, { league_name: string; country_name?: string }>();
    for (const item of events) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const league = typeof rec.league === "string"
        ? rec.league
        : typeof rec.league_name === "string"
          ? rec.league_name
          : typeof rec.competition === "string"
            ? rec.competition
            : undefined;
      if (!league) continue;
      if (inferred.has(league)) continue;
      const country = typeof rec.country_name === "string"
        ? rec.country_name
        : typeof rec.country === "string"
          ? rec.country
          : undefined;
      inferred.set(league, country ? { league_name: league, country_name: country } : { league_name: league });
    }
    const merged = new Map<string, { league_name: string; country_name?: string }>();
    for (const name of POPULAR_LEAGUES) {
      const key = name.toLowerCase();
      if (!merged.has(key)) merged.set(key, { league_name: name });
    }
    inferred.forEach((value, name) => {
      const key = name.toLowerCase();
      if (!merged.has(key)) merged.set(key, value);
    });
    return NextResponse.json({ leagues: Array.from(merged.values()) });
  } catch {}

  const fallback = POPULAR_LEAGUES.map(name => ({ league_name: name }));
  return NextResponse.json({ leagues: fallback });
}
