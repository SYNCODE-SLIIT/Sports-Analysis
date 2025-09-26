// No request params needed

const POPULAR_LEAGUES = [
  { league_name: "Premier League", country_name: "England" },
  { league_name: "La Liga", country_name: "Spain" },
  { league_name: "Serie A", country_name: "Italy" },
  { league_name: "Bundesliga", country_name: "Germany" },
  { league_name: "Ligue 1", country_name: "France" },
  { league_name: "Champions League", country_name: "Europe" },
];

export async function GET() {
  // Try leagues.list via collect
  try {
    const r = await fetch(`${process.env.API_BASE_INTERNAL}/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "leagues.list", args: {} }),
    });
    const j = await r.json();
    if (j?.ok && Array.isArray(j?.data?.leagues)) {
      return Response.json({ ok: true, leagues: j.data.leagues });
    }
  } catch {}

  // Fallback: merge curated + infer from recent upcoming events
  try {
    const r2 = await fetch(`${process.env.API_BASE_INTERNAL}/collect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "events.list", args: { kind: "upcoming", days: 14 } }),
    });
    const j2 = await r2.json() as { data?: { events?: unknown } };
    const evsRaw = j2?.data?.events;
    const evs: unknown[] = Array.isArray(evsRaw) ? evsRaw : [];
    const inferred = new Map<string, { league_name: string; country_name?: string }>();
    for (const e of evs) {
      const rec = (e ?? {}) as Record<string, unknown>;
      const lname = typeof rec.league === "string" ? rec.league : undefined;
      if (lname && !inferred.has(lname)) inferred.set(lname, { league_name: lname });
    }
    const merged = [...POPULAR_LEAGUES, ...Array.from(inferred.values())];
    // unique by league_name
    const seen = new Set<string>();
    const uniq = merged.filter((l) => (l.league_name && !seen.has(l.league_name)) ? (seen.add(l.league_name), true) : false);
    return Response.json({ ok: true, leagues: uniq });
  } catch {}

  return Response.json({ ok: true, leagues: POPULAR_LEAGUES });
}
