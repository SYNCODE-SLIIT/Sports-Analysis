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

  if (!items.some(i => i.type === "ht")) items.push({ minute: 45, team: "home", type: "ht" });
  if (!items.some(i => i.type === "ft")) items.push({ minute: 90, team: "home", type: "ft" });

  items.sort((a, b) => (a.minute - b.minute) || scoreRank(a.type) - scoreRank(b.type));
  return items;
}

const toMinute = (value: unknown): number => {
  if (value === null || value === undefined) return 0;
  const n = Number(String(value).replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? n : 0;
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
