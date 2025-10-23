import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE =
  process.env.API_BASE_INTERNAL ||
  process.env.NEXT_PUBLIC_API_BASE ||
  "http://127.0.0.1:8000";

type RecommendationItem = Record<string, unknown>;

type RecommendationRow = {
  reason?: string | null;
  item?: RecommendationItem | RecommendationItem[] | null;
};

type PromptRecommendation = {
  title?: string;
  summary?: string;
  reason?: string;
  league?: string;
  teams?: string[];
  metadata?: Record<string, string>;
};

function normalizeRecommendationItem(value: RecommendationRow["item"]): RecommendationItem {
  if (!value) return {};

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return entry as RecommendationItem;
      }
    }
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value as RecommendationItem;
  }

  return {};
}

function pickFirstString(value: unknown, fallback?: string): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed) return trimmed;
      }
    }
  }
  return fallback;
}

function buildPromptSeed(row: RecommendationRow): PromptRecommendation | null {
  const item = normalizeRecommendationItem(row.item);

  const title =
    pickFirstString(item.title) ||
    pickFirstString(item.matchup) ||
    pickFirstString(item.name) ||
    pickFirstString(item.headline);

  const summary =
    pickFirstString(item.summary) ||
    pickFirstString(item.description) ||
    pickFirstString(item.subtitle) ||
    pickFirstString(item.notes);

  const league =
    pickFirstString(item.league) ||
    pickFirstString(item.competition) ||
    pickFirstString(item.tournament);

  const teamsSet = new Set<string>();
  const pushTeam = (value: unknown) => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) teamsSet.add(trimmed);
    } else if (Array.isArray(value)) {
      value.forEach((entry) => pushTeam(entry));
    }
  };

  pushTeam(item.teams);
  pushTeam(item.team_names);
  pushTeam(item.clubs);
  pushTeam(item.home_team);
  pushTeam(item.away_team);

  const metadata: Record<string, string> = {};
  const kickoff =
    pickFirstString(item.kickoff_at) ||
    pickFirstString(item.kickoff) ||
    pickFirstString(item.fixture_date) ||
    pickFirstString(item.start_time) ||
    pickFirstString(item.date);
  if (kickoff) metadata.kickoff = kickoff;

  const stage = pickFirstString(item.stage) || pickFirstString(item.round);
  if (stage) metadata.stage = stage;

  const location = pickFirstString(item.venue) || pickFirstString(item.location);
  if (location) metadata.location = location;

  const reason = typeof row.reason === "string" ? row.reason.trim() : undefined;

  if (!title && !summary && !reason && !league && teamsSet.size === 0) {
    return null;
  }

  const result: PromptRecommendation = {};
  if (title) result.title = title;
  if (summary) result.summary = summary;
  if (reason) result.reason = reason;
  if (league) result.league = league;
  if (teamsSet.size > 0) result.teams = Array.from(teamsSet);
  if (Object.keys(metadata).length > 0) result.metadata = metadata;
  return result;
}

async function loadRecommendationSeeds(): Promise<PromptRecommendation[]> {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return [];

    const { data: recs, error } = await supabase
      .from("recommendations")
      .select("reason, item:items(*)")
      .eq("user_id", user.id)
      .order("score", { ascending: false })
      .limit(8);

    if (!error && Array.isArray(recs) && recs.length > 0) {
      return recs
        .map(buildPromptSeed)
        .filter((seed): seed is PromptRecommendation => seed !== null);
    }

    const { data: prefs } = await supabase
      .from("user_preferences")
      .select("favorite_teams, favorite_leagues")
      .eq("user_id", user.id)
      .single();

    let query = supabase.from("items").select("*").order("popularity", { ascending: false }).limit(8);
    if (Array.isArray(prefs?.favorite_teams) && prefs.favorite_teams.length > 0) {
      query = query.contains("teams", prefs.favorite_teams);
    }
    if (Array.isArray(prefs?.favorite_leagues) && prefs.favorite_leagues.length > 0) {
      query = query.contains("leagues", prefs.favorite_leagues);
    }

    const { data: items } = await query;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map((item) => buildPromptSeed({ item }))
      .filter((seed): seed is PromptRecommendation => seed !== null);
  } catch {
    return [];
  }
}

export async function GET() {
  const seeds = await loadRecommendationSeeds();

  try {
    const resp = await fetch(`${API_BASE}/chatbot/suggested-prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recommendations: seeds, limit: 4 }),
      cache: "no-store",
    });

    const data = await resp.json().catch(() => ({ prompts: [] }));
    if (!resp.ok) {
      return NextResponse.json({ prompts: [] });
    }

    const prompts = Array.isArray((data as { prompts?: unknown }).prompts)
      ? ((data as { prompts?: unknown }).prompts as unknown[]).filter(
          (item): item is string => typeof item === "string" && item.trim().length > 0
        )
      : [];

    return NextResponse.json({ prompts });
  } catch {
    return NextResponse.json({ prompts: [] });
  }
}
