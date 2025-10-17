type LooseRecord = Record<string, unknown>;
type LeaderStat = { name: string; v: number | string };

/** Common timeline event shape used by Timeline.tsx */
export type TLItem = {
  minute: number;
  period?: "1H" | "2H" | "ET" | "PEN";
  team: "home" | "away";
  type: "goal" | "own_goal" | "pen_miss" | "pen_score" | "yellow" | "red" | "sub" | "ht" | "ft";
  player?: string;
  assist?: string;
  note?: string;
};

const asRecords = (value: unknown): LooseRecord[] => (Array.isArray(value) ? value.filter((item): item is LooseRecord => Boolean(item) && typeof item === "object") : []);

/** Build a unified minute-sorted timeline from event.results variants */
export function buildTimeline(ev: unknown): TLItem[] {
  if (!ev || typeof ev !== "object") return [];
  const source = ev as LooseRecord;
  const items: TLItem[] = [];

  const goalEntries = asRecords(source.goalscorers ?? source.goals ?? source.scorers ?? []);
  for (const g of goalEntries) {
    const minute = toMinute(g.time ?? g.minute ?? g.elapsed ?? g.time_elapsed);
    const isHome = toBool(g.home_scorer)
      || toBool(g.team === "home")
      || toBool(g.side === "home")
      || toBool(g.homeGoal ?? g.home);
    const type: TLItem["type"] = toBool(g.own_goal ?? g.ownGoal)
      ? "own_goal"
      : toBool(g.penalty_missed)
        ? "pen_miss"
        : toBool(g.penalty)
          ? "pen_score"
          : "goal";
    items.push({
      minute,
      team: isHome ? "home" : "away",
      type,
      player: toString(g.scorer ?? g.home_scorer ?? g.away_scorer ?? g.player),
      assist: toString(g.assist ?? g.assist_name),
      note: toString(g.info ?? g.reason),
    });
  }

  const cardEntries = asRecords(source.cards ?? source.bookings ?? []);
  for (const c of cardEntries) {
    const minute = toMinute(c.time ?? c.minute ?? c.elapsed);
    const isHome = toBool(c.home_fault)
      || toBool(c.team === "home")
      || toBool(c.side === "home")
      || toBool(c.home ?? c.homeTeam);
    const type: TLItem["type"] = String(c.card ?? c.type ?? "").toLowerCase().includes("red") ? "red" : "yellow";
    items.push({
      minute,
      team: isHome ? "home" : "away",
      type,
      player: toString(c.player ?? c.home_fault ?? c.away_fault),
      note: toString(c.reason ?? c.info),
    });
  }

  const subEntries = asRecords(source.substitutions ?? source.subs ?? []);
  for (const s of subEntries) {
    const minute = toMinute(s.time ?? s.minute ?? s.elapsed);
    const isHome = toBool(s.home)
      || toBool(s.team === "home")
      || toBool(s.side === "home")
      || toBool(s.in_team === "home");
    items.push({
      minute,
      team: isHome ? "home" : "away",
      type: "sub",
      player: toString(s.in_player ?? s.player_in ?? s.player),
      assist: toString(s.out_player ?? s.player_out),
    });
  }

  const merged = buildFallbackTimeline(source);
  if (merged.length) {
    const seen = new Set(items.map(item => timelineKey(item)));
    for (const extra of merged) {
      const key = timelineKey(extra);
      if (seen.has(key)) continue;
      items.push(extra);
      seen.add(key);
    }
  }

  if (!items.some(i => i.type === "ht")) items.push({ minute: 45, team: "home", type: "ht" });
  if (!items.some(i => i.type === "ft")) items.push({ minute: 90, team: "home", type: "ft" });

  items.sort((a, b) => (a.minute - b.minute) || scoreRank(a.type) - scoreRank(b.type));
  return items;
}

const timelineKey = (item: TLItem) => `${item.minute}-${item.type}-${item.team}-${item.player ?? ""}-${item.assist ?? ""}`;

const toMinute = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value).trim();
  if (!raw) return 0;
  if (/^ht$/i.test(raw)) return 45;
  if (/^ft$/i.test(raw)) return 90;

  const plusIndex = raw.indexOf("+");
  if (plusIndex !== -1) {
    const basePart = raw.slice(0, plusIndex);
    const extraPart = raw.slice(plusIndex + 1);
    const baseNum = Number(basePart.replace(/[^\d]/g, ""));
    const extraMatch = extraPart.match(/\d+/);
    const extraNum = extraMatch ? Number(extraMatch[0]) : 0;
    if (Number.isFinite(baseNum)) {
      const total = baseNum + (Number.isFinite(extraNum) ? extraNum : 0);
      if (Number.isFinite(total)) return total;
    }
  }

  const firstMatch = raw.match(/\d+/);
  if (firstMatch) {
    const base = Number(firstMatch[0]);
    if (Number.isFinite(base)) return base;
  }

  return 0;
};

const toString = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length ? value : undefined);

const toBool = (value: unknown): boolean => {
  if (typeof value === "string") return value.toLowerCase() !== "false" && value !== "0" && value.trim().length > 0;
  return Boolean(value);
};

const scoreRank = (type: string): number => {
  if (type === "ht") return -1;
  if (type === "ft") return 999;
  return 0;
};

const fallbackTimelineSources = [
  "timeline",
  "timeline_items",
  "events",
  "event_timeline",
  "eventTimeline",
  "event_entries",
  "comments",
  "comments_list",
  "match_comments",
  "play_by_play",
];

const pickTeamName = (source: LooseRecord, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
};

function buildFallbackTimeline(source: LooseRecord): TLItem[] {
  const entries = gatherCandidateTimelineEntries(source);
  if (!entries.length) return [];

  const homeName = pickTeamName(source, ["event_home_team", "home_team", "homeTeam", "strHomeTeam", "HomeTeam"]);
  const awayName = pickTeamName(source, ["event_away_team", "away_team", "awayTeam", "strAwayTeam", "AwayTeam"]);

  const out: TLItem[] = [];
  for (const entry of entries) {
    const minuteRaw = entry.minute ?? entry.time ?? entry.elapsed ?? entry.min ?? entry.m ?? entry.match_minute;
    const minute = toMinute(minuteRaw);
    if (!Number.isFinite(minute)) continue;

    const description = toString(entry.description ?? entry.text ?? entry.event ?? entry.detail);
    const tags = normalizeTagList(entry, description);
    const type = deriveTimelineType(tags, description, entry);
    if (!type) continue;

  const team = deduceTeamSide(entry, { homeName, awayName });
    if (!team) continue;

    let player = toString(entry.player ?? entry.player_name ?? entry.playerName ?? entry.player_fullname ?? entry.scorer ?? entry.goal_scorer ?? entry.home_scorer ?? entry.away_scorer);
    if (!player && type === "sub") {
      player = toString(entry.player_in ?? entry.in_player ?? entry.sub_on ?? entry.sub_in);
    }

    let assist: string | undefined;
    if (type === "goal" || type === "own_goal" || type === "pen_score") {
      assist = toString(entry.assist ?? entry.assist_name ?? entry.home_assist ?? entry.away_assist);
    }
    if (type === "sub") {
      assist = toString(entry.player_out ?? entry.out_player ?? entry.sub_out ?? entry.out);
    }

    const note = toString(entry.note ?? entry.info ?? entry.reason ?? entry.detail ?? entry.description ?? entry.text);

    out.push({ minute, team, type, player, assist, note });
  }

  return out;
}

function gatherCandidateTimelineEntries(source: LooseRecord): LooseRecord[] {
  const collected: LooseRecord[] = [];
  for (const key of fallbackTimelineSources) {
    const value = (source as LooseRecord)[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      collected.push(...asRecords(value));
      continue;
    }
    if (typeof value === "object") {
      for (const nested of Object.values(value as LooseRecord)) {
        if (Array.isArray(nested)) {
          collected.push(...asRecords(nested));
        } else if (nested && typeof nested === "object") {
          collected.push(nested as LooseRecord);
        }
      }
    }
  }
  return collected;
}

function normalizeTagList(entry: LooseRecord, description?: string | undefined): string[] {
  const sources = [
    entry.tags,
    entry.labels,
    entry.labels_list,
    entry.predicted_tags,
    entry.predictedTags,
    entry.card,
    entry.type,
    entry.event_type,
  ];
  const tags: string[] = [];
  for (const src of sources) {
    if (src === undefined || src === null) continue;
    if (Array.isArray(src)) {
      for (const v of src) {
        const s = toString(v);
        if (s) tags.push(s.toLowerCase());
      }
      continue;
    }
    if (typeof src === "string") {
      const parts = src.split(/[|,/]/g).map(part => part.trim().toLowerCase()).filter(Boolean);
      if (parts.length) tags.push(...parts);
      continue;
    }
    if (typeof src === "object") {
      const maybeLabel = toString((src as LooseRecord).label ?? (src as LooseRecord).name ?? (src as LooseRecord).text);
      if (maybeLabel) tags.push(maybeLabel.toLowerCase());
    }
  }

  if (!tags.length && description) {
    tags.push(...detectTagsFromText(description));
  }

  return Array.from(new Set(tags));
}

function deriveTimelineType(tags: string[], description: string | undefined, entry: LooseRecord): TLItem["type"] | null {
  const tagText = tags.join(" ");
  const desc = (description ?? "").toLowerCase();
  const typeField = String(entry.type ?? entry.event_type ?? "").toLowerCase();

  const has = (needle: string) => tagText.includes(needle) || desc.includes(needle) || typeField.includes(needle);

  if (has("own goal")) return "own_goal";
  if (has("penalty miss") || has("pen miss") || has("penalty saved")) return "pen_miss";
  if (has("penalty") && has("goal")) return "pen_score";
  if (has("goal") || toBool(entry.goal) || toBool(entry.is_goal)) return "goal";
  if (has("red card") || has("sent off") || has("redcard") || toBool(entry.red_card)) return "red";
  if (has("yellow card") || has("yellowcard") || toBool(entry.yellow_card)) return "yellow";
  if (has("substitution") || has("subbed") || has("replaced") || toBool(entry.substitution)) return "sub";
  return null;
}

function detectTagsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const tags = new Set<string>();
  if (lower.includes("own goal")) tags.add("own goal");
  if (lower.includes("penalty") && lower.includes("miss")) tags.add("penalty miss");
  if (lower.includes("penalty")) tags.add("penalty");
  if (/(\bgoal\b|scored|scores|header)/.test(lower)) tags.add("goal");
  if (lower.includes("red card") || lower.includes("sent off")) tags.add("red card");
  if (lower.includes("yellow card")) tags.add("yellow card");
  if (lower.includes("substitution") || lower.includes("subbed") || lower.includes("replaces")) tags.add("substitution");
  return Array.from(tags);
}

function deduceTeamSide(entry: LooseRecord, names: { homeName?: string; awayName?: string }): "home" | "away" | null {
  const normalize = (value?: string) => value ? value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim() : "";
  const homeNorm = normalize(names.homeName);
  const awayNorm = normalize(names.awayName);

  const teamField = toString(entry.team ?? entry.team_name ?? entry.teamName ?? entry.club ?? entry.squad ?? entry.competitor);
  const sideField = toString(entry.side ?? entry.team_side ?? entry.teamSide);
  const combined = normalize(teamField ?? sideField ?? undefined);

  if (combined) {
    if (combined === "home" || combined.includes("home")) return "home";
    if (combined === "away" || combined.includes("away")) return "away";
    if (homeNorm && combined === homeNorm) return "home";
    if (awayNorm && combined === awayNorm) return "away";
    if (homeNorm && combined.includes(homeNorm)) return "home";
    if (awayNorm && combined.includes(awayNorm)) return "away";
  }

  if (toBool(entry.home) || toBool(entry.is_home) || toBool(entry.homeTeam) || toBool(entry.home_side)) return "home";
  if (toBool(entry.away) || toBool(entry.is_away) || toBool(entry.awayTeam) || toBool(entry.away_side)) return "away";

  if (entry.home_scorer !== undefined || entry.home_fault !== undefined || entry.home_player !== undefined || entry.in_team === "home" || entry.team === "home") return "home";
  if (entry.away_scorer !== undefined || entry.away_fault !== undefined || entry.away_player !== undefined || entry.in_team === "away" || entry.team === "away") return "away";

  const playerTeam = toString(entry.player_team ?? entry.team_name ?? entry.teamName);
  const playerTeamNorm = normalize(playerTeam ?? undefined);
  if (playerTeamNorm) {
    if (homeNorm && playerTeamNorm.includes(homeNorm)) return "home";
    if (awayNorm && playerTeamNorm.includes(awayNorm)) return "away";
  }

  // As a last resort, try to match score context (e.g., "Home 1-0 Away")
  const rawNote = toString(entry.note ?? entry.description ?? entry.text);
  if (rawNote) {
    const noteNorm = rawNote.toLowerCase();
    if (homeNorm && noteNorm.includes(homeNorm)) return "home";
    if (awayNorm && noteNorm.includes(awayNorm)) return "away";
  }

  return null;
}

type LeaderBuckets = {
  home: { goals: LeaderStat[]; assists: LeaderStat[]; cards: LeaderStat[] };
  away: { goals: LeaderStat[]; assists: LeaderStat[]; cards: LeaderStat[] };
};

/** Compute per-team leaders from the event */
export function computeLeaders(ev: unknown): LeaderBuckets | null {
  if (!ev || typeof ev !== "object") return null;
  const source = ev as LooseRecord;
  const leaders: LeaderBuckets = {
    home: { goals: [], assists: [], cards: [] },
    away: { goals: [], assists: [], cards: [] },
  };

  const push = (bucket: LeaderStat[], name: string | undefined, value: number | string) => {
    if (!name) return;
    const existing = bucket.find(stat => stat.name === name);
    if (existing) {
      if (typeof existing.v === "number" && typeof value === "number") existing.v += value;
      else if (typeof value === "string") existing.v = `${existing.v ?? ""} ${value}`.trim();
      else existing.v = (Number(existing.v) || 0) + Number(value);
      return;
    }
    bucket.push({ name, v: value });
  };

  const goalEntries = asRecords(source.goalscorers ?? source.goals ?? source.scorers ?? []);
  for (const g of goalEntries) {
    const side = (toBool(g.home_scorer) || toBool(g.team === "home")) ? "home" : "away";
    const scorer = toString(g.scorer ?? g.home_scorer ?? g.away_scorer ?? g.player);
    push(leaders[side].goals, scorer, 1);
    if (g.assist) push(leaders[side].assists, toString(g.assist), 1);
  }

  const cardEntries = asRecords(source.cards ?? source.bookings ?? []);
  for (const c of cardEntries) {
    const side = (toBool(c.home_fault) || toBool(c.team === "home")) ? "home" : "away";
    const who = toString(c.player ?? c.home_fault ?? c.away_fault);
    if (!who) continue;
    const card = String(c.card ?? "").toLowerCase().includes("red") ? "\uD83D\uDD34" : "\uD83D\uDFE8";
    push(leaders[side].cards, who, card);
  }

  const top3 = (stats: LeaderStat[]) => stats
    .slice()
    .sort((a, b) => {
      if (typeof a.v === "number" && typeof b.v === "number") return b.v - a.v;
      if (typeof a.v === "string" && typeof b.v === "string") return b.v.localeCompare(a.v);
      return 0;
    })
    .slice(0, 3);

  leaders.home.goals = top3(leaders.home.goals);
  leaders.home.assists = top3(leaders.home.assists);
  leaders.home.cards = top3(leaders.home.cards);
  leaders.away.goals = top3(leaders.away.goals);
  leaders.away.assists = top3(leaders.away.assists);
  leaders.away.cards = top3(leaders.away.cards);

  return leaders;
}

/** Compute a single best player if backend didn't return ev.best_player */
export function computeBestPlayer(ev: unknown): { name: string; score?: number } | null {
  if (!ev || typeof ev !== "object") return null;
  const source = ev as LooseRecord;
  const scores = new Map<string, number>();

  const add = (name: string | undefined, pts: number) => {
    if (!name) return;
    scores.set(name, (scores.get(name) ?? 0) + pts);
  };

  const goals = asRecords(source.goalscorers ?? source.goals ?? source.scorers ?? []);
  for (const g of goals) {
    const scorer = toString(g.scorer ?? g.home_scorer ?? g.away_scorer ?? g.player);
    add(scorer, 3);
    if (g.assist) add(toString(g.assist), 2);
    const note = String(g.info ?? "").toLowerCase();
    if (note.includes("winning")) add(scorer, 1);
  }

  const cards = asRecords(source.cards ?? source.bookings ?? []);
  for (const c of cards) {
    const who = toString(c.player ?? c.home_fault ?? c.away_fault);
    if (!who) continue;
    const cardTxt = String(c.card ?? "").toLowerCase();
    if (cardTxt.includes("second yellow")) add(who, 1);
  }

  let bestName: string | null = null;
  let bestScore = -1;
  scores.forEach((score, name) => {
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
    }
  });

  if (!bestName) {
    const fallback = goals[0];
    bestName = toString(fallback?.scorer ?? fallback?.player) ?? null;
    if (!bestName) return null;
    bestScore = scores.get(bestName) ?? bestScore;
  }

  return { name: bestName, score: bestScore >= 0 ? bestScore : undefined };
}
