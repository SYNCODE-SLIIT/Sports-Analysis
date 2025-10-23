"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import Image from "next/image";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Calendar, MapPin, Users, Trophy, ThumbsUp, Bookmark, Share2, Plus, Check, Heart } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { HighlightsCarousel } from "@/components/HighlightsCarousel";
import RichTimeline from "@/components/match/RichTimeline";
import BestPlayerCard from "@/components/match/BestPlayerCard";
import LeadersCard from "@/components/match/LeadersCard";
import MatchSummaryCard from "@/components/match/MatchSummaryCard";
import WinProbabilityCard from "@/components/match/WinProbabilityCard";

import { buildTimeline, computeLeaders, computeBestPlayer } from "@/lib/match-mappers";
import { LeagueStandingsCard } from "@/components/league/LeagueStandingsCard";
import type { TLItem } from "@/lib/match-mappers";
import {
  getEventResults,
  getEventAllSports,
  DataObject,
  getLeagueTable,
  postCollect,
  getTeam,
  listTeamPlayers,
  getForm,
  getH2HByTeams,
  getWinProb,
  getHighlights,
} from "@/lib/collect";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import { parseHighlights, type Highlight } from "@/lib/schemas";
import { usePlanContext } from "@/components/PlanProvider";

type TeamSideValue = { home?: number; away?: number };
type MatchStatEntry = {
  key: string;
  label: string;
  home: string;
  away: string;
  homeNumeric?: number;
  awayNumeric?: number;
};
type StandardStatField =
  | "possession"
  | "shots"
  | "shotsOnTarget"
  | "shotsOffTarget"
  | "shotsBlocked"
  | "shotsInsideBox"
  | "shotsOutsideBox"
  | "corners"
  | "fouls"
  | "offsides"
  | "yellowCards"
  | "redCards"
  | "saves"
  | "passesTotal"
  | "passesAccurate";
type MatchStats = Partial<Record<StandardStatField, TeamSideValue>> & {
  entries?: MatchStatEntry[];
};

type GoalEvent = {
  key: string;
  minute: number | null;
  minuteLabel: string;
  team: "home" | "away" | "neutral";
  player: string;
  assist?: string;
  score?: string;
  period?: string;
  note?: string;
};

type CardEvent = {
  key: string;
  minute: number | null;
  minuteLabel: string;
  team: "home" | "away" | "neutral";
  player: string;
  cardType: string;
  description?: string;
};

type SubstitutionEvent = {
  key: string;
  minute: number | null;
  minuteLabel: string;
  team: "home" | "away" | "neutral";
  playerIn?: string;
  playerOut?: string;
  reason?: string;
};

type FoulEvent = {
  key: string;
  minute: number | null;
  minuteLabel: string;
  team?: "home" | "away" | "neutral";
  description: string;
};

type RenderEvent = {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  league?: string;
  venue?: string;
  date: string;
  attendance?: number;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  winProbabilities?: { home?: number; draw?: number; away?: number };
  stats?: MatchStats;
  events?: Array<{ time?: number; type?: string; team?: string; player?: string }>;
};

// --------- Loose-shape safe helpers (module scope for stable refs) ---------
const getPathVal = (o: unknown, path: string): unknown => {
  if (!o || typeof o !== 'object') return undefined;
  const parts = path.split('.');
  let cur: unknown = o;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

const getString = (o: DataObject, keys: string[], fallback?: string) => {
  for (const k of keys) {
    const v = k.includes('.') ? getPathVal(o, k) : (o as Record<string, unknown>)[k];
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  }
  return fallback;
};
const getNumber = (o: DataObject, keys: string[], fallback?: number) => {
  for (const k of keys) {
    const raw = k.includes('.') ? getPathVal(o, k) : (o as Record<string, unknown>)[k];
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string' && raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  }
  return fallback;
};

const getLogo = (o: DataObject, homeOrAway: 'home' | 'away'): string | undefined => {
  const prefix = homeOrAway === 'home' ? 'home' : 'away';
  const keys = [
    `${prefix}_team_logo`,
    `team_${prefix}_badge`,
    `str${homeOrAway === 'home' ? 'Home' : 'Away'}TeamBadge`,
    `${prefix}Badge`,
    `${prefix}_logo`,
    `${prefix}_team_badge`,
  ];
  
  for (const k of keys) {
    const v = (o as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  
  // Check nested team objects
  const teamObj = (o as Record<string, unknown>)[`${prefix}_team`];
  if (teamObj && typeof teamObj === 'object') {
    const nested = teamObj as Record<string, unknown>;
    const nestedLogo = nested['logo'] || nested['badge'] || nested['image'];
    if (typeof nestedLogo === 'string' && nestedLogo.trim() !== '') return nestedLogo;
  }
  
  return undefined;
};

const STAT_LABELS: Record<StandardStatField, string> = {
  possession: "Ball Possession",
  shots: "Shots Total",
  shotsOnTarget: "Shots On Target",
  shotsOffTarget: "Shots Off Target",
  shotsBlocked: "Shots Blocked",
  shotsInsideBox: "Shots Inside Box",
  shotsOutsideBox: "Shots Outside Box",
  corners: "Corners",
  fouls: "Fouls",
  offsides: "Offsides",
  yellowCards: "Yellow Cards",
  redCards: "Red Cards",
  saves: "Saves",
  passesTotal: "Passes Total",
  passesAccurate: "Passes Accurate",
};

const STANDARD_STAT_FIELDS: StandardStatField[] = [
  "possession",
  "shots",
  "shotsOnTarget",
  "shotsOffTarget",
  "shotsBlocked",
  "shotsInsideBox",
  "shotsOutsideBox",
  "corners",
  "fouls",
  "offsides",
  "yellowCards",
  "redCards",
  "saves",
  "passesTotal",
  "passesAccurate",
];

const STAT_FIELD_ALIASES: Array<{ pattern: RegExp; field: StandardStatField }> = [
  { pattern: /ball\s*possession/i, field: "possession" },
  { pattern: /(shots?\s+total|total\s+shots?)/i, field: "shots" },
  { pattern: /shots?\s+on\s+(goal|target)/i, field: "shotsOnTarget" },
  { pattern: /shots?\s+off\s+(goal|target)/i, field: "shotsOffTarget" },
  { pattern: /shots?\s+blocked/i, field: "shotsBlocked" },
  { pattern: /shots?\s+inside(\s+the)?\s+box/i, field: "shotsInsideBox" },
  { pattern: /shots?\s+outside(\s+the)?\s+box/i, field: "shotsOutsideBox" },
  { pattern: /corners?/i, field: "corners" },
  { pattern: /fouls?/i, field: "fouls" },
  { pattern: /offsides?/i, field: "offsides" },
  { pattern: /yellow\s+cards?/i, field: "yellowCards" },
  { pattern: /red\s+cards?/i, field: "redCards" },
  { pattern: /saves?/i, field: "saves" },
  { pattern: /passes?\s+total/i, field: "passesTotal" },
  { pattern: /passes?\s+accurate/i, field: "passesAccurate" },
];

const toDisplayValue = (value: unknown): string => {
  if (value === null || value === undefined) return "0";
  if (typeof value === "number") {
    if (Number.isFinite(value)) return String(value);
    return "0";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? "0" : trimmed;
  }
  try {
    return String(value);
  } catch {
    return "0";
  }
};

const toNumericValue = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const cleaned = trimmed.replace(/[^0-9.+-]/g, "");
    if (!cleaned) return undefined;
    const num = Number(cleaned);
    return Number.isNaN(num) ? undefined : num;
  }
  return undefined;
};

const getStatValue = (obj: DataObject, keys: string[]): unknown => {
  for (const key of keys) {
    const val = key.includes(".") ? getPathVal(obj, key) : (obj as Record<string, unknown>)[key];
    if (val === undefined || val === null) continue;
    if (typeof val === "string" && val.trim() === "") continue;
    return val;
  }
  return undefined;
};

const buildSummaryEntries = (
  stats: MatchStats,
  push: (entry: MatchStatEntry) => void
) => {
  for (const field of STANDARD_STAT_FIELDS) {
    const stat = stats[field];
    if (!stat) continue;
    const { home, away } = stat;
    if (home === undefined && away === undefined) continue;
    push({
      key: field,
      label: STAT_LABELS[field],
      home: toDisplayValue(home),
      away: toDisplayValue(away),
      homeNumeric: typeof home === "number" ? home : toNumericValue(home),
      awayNumeric: typeof away === "number" ? away : toNumericValue(away),
    });
  }
};

const extractMatchStats = (source: DataObject): MatchStats | undefined => {
  const legacyRaw = (source as Record<string, unknown>)["stats"];
  const legacy = legacyRaw && typeof legacyRaw === "object" ? (legacyRaw as MatchStats) : undefined;

  const statsCandidate = getPathVal(source, "statistics");
  const statsArray: DataObject[] = Array.isArray(statsCandidate)
    ? (statsCandidate as DataObject[])
    : statsCandidate && typeof statsCandidate === "object" && Array.isArray((statsCandidate as Record<string, unknown>).statistics)
    ? ((statsCandidate as Record<string, unknown>).statistics as DataObject[])
    : [];

  const stats: MatchStats = legacy ? { ...legacy } : {};
  const entries: MatchStatEntry[] = Array.isArray(legacy?.entries) ? [...legacy.entries] : [];
  const seenKeys = new Map(entries.map((entry, idx) => [entry.key, idx]));

  const pushEntry = (entry: MatchStatEntry) => {
    if (seenKeys.has(entry.key)) {
      const existingIndex = seenKeys.get(entry.key)!;
      entries[existingIndex] = entry;
    } else {
      seenKeys.set(entry.key, entries.length);
      entries.push(entry);
    }
  };

  const applyField = (field: StandardStatField, homeNumeric?: number, awayNumeric?: number) => {
    if (homeNumeric === undefined && awayNumeric === undefined) return;
    const prev = stats[field] ?? {};
    stats[field] = {
      home: homeNumeric ?? prev.home,
      away: awayNumeric ?? prev.away,
    };
  };

  if (statsArray.length) {
    const homeValueKeys = ["home", "home_value", "homeTeam", "home_team", "team_home", "home_stat"];
    const awayValueKeys = ["away", "away_value", "awayTeam", "away_team", "team_away", "away_stat"];
    statsArray.forEach((statObj, index) => {
      const labelRaw = getString(statObj, ["type", "stat_type", "name", "label"], `Stat ${index + 1}`);
      const label = (labelRaw ?? `Stat ${index + 1}`).trim();
      const homeValueRaw = getStatValue(statObj, homeValueKeys);
      const awayValueRaw = getStatValue(statObj, awayValueKeys);
      const homeDisplay = toDisplayValue(homeValueRaw);
      const awayDisplay = toDisplayValue(awayValueRaw);
      const homeNumeric = toNumericValue(homeValueRaw);
      const awayNumeric = toNumericValue(awayValueRaw);

      let key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      key = key.replace(/^_+|_+$/g, "");
      if (!key) key = `stat_${index}`;

      pushEntry({
        key,
        label,
        home: homeDisplay,
        away: awayDisplay,
        homeNumeric,
        awayNumeric,
      });

      const alias = STAT_FIELD_ALIASES.find((candidate) => candidate.pattern.test(label));
      if (alias) {
        applyField(alias.field, homeNumeric, awayNumeric);
      }
    });
  }

  if (!entries.length) {
    buildSummaryEntries(stats, pushEntry);
  }

  const hasSummaryData = STANDARD_STAT_FIELDS.some((field) => {
    const value = stats[field];
    return value && (value.home !== undefined || value.away !== undefined);
  });

  if (!entries.length && !hasSummaryData) {
    return undefined;
  }

  stats.entries = entries;
  return stats;
};

const cleanString = (value?: string | null): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : undefined;
};

const getInitials = (value?: string | null): string => {
  const source = cleanString(value) ?? "";
  if (!source) return "NA";
  const parts = source.split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return initials.join("") || source.slice(0, 2).toUpperCase();
};

const parseMinuteInfo = (
  timeRaw: unknown,
  periodRaw: unknown,
  index: number,
  fallbackLabelPrefix: string
): { minute: number | null; label: string } => {
  let label = "";
  let minute: number | null = null;

  const timeStr =
    typeof timeRaw === "number"
      ? String(timeRaw)
      : typeof timeRaw === "string"
      ? timeRaw.trim()
      : "";

  if (timeStr) {
    const match = timeStr.match(/\d+/);
    if (match) {
      const candidate = Number(match[0]);
      if (Number.isFinite(candidate)) minute = candidate;
    }
    if (timeStr.includes("'") || timeStr.includes("’")) {
      label = timeStr;
    } else if (timeStr.includes("+")) {
      label = `${timeStr}′`;
    } else {
      label = `${timeStr}′`;
    }
  }

  const periodStr =
    typeof periodRaw === "string" && periodRaw.trim().length ? periodRaw.trim() : "";
  if (periodStr) {
    label = label ? `${label} · ${periodStr}` : periodStr;
  }

  if (!label) {
    label = `${fallbackLabelPrefix} ${index + 1}`;
  }

  return { minute, label };
};

const extractGoalEvents = (source: DataObject): GoalEvent[] => {
  const rawGoals = getPathVal(source, "goalscorers");
  const goalArray = Array.isArray(rawGoals) ? (rawGoals as DataObject[]) : [];
  const events: GoalEvent[] = [];

  goalArray.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const time = getString(raw, ["time", "minute", "min"]);
    const period = getString(raw, ["info_time", "info", "period"]);
    const { minute, label } = parseMinuteInfo(time, period, index, "Goal");
    const score = cleanString(getString(raw, ["score", "result"]));
    const homeScorer = cleanString(getString(raw, ["home_scorer", "homeScorer", "home_player"]));
    const awayScorer = cleanString(getString(raw, ["away_scorer", "awayScorer", "away_player"]));
    const player =
      homeScorer ??
      awayScorer ??
      cleanString(getString(raw, ["player", "scorer", "name"], "Goal")) ??
      "Goal";
    const assist = cleanString(
      getString(raw, ["home_assist", "away_assist", "assist", "assist_name", "second_assist"])
    );
    const note = cleanString(getString(raw, ["detail", "note"]));

    const team: "home" | "away" | "neutral" = homeScorer
      ? "home"
      : awayScorer
      ? "away"
      : "neutral";

    events.push({
      key: `goal-${team}-${minute ?? index}-${index}`,
      minute,
      minuteLabel: label,
      team,
      player,
      assist: assist,
      score: score,
      period: cleanString(period),
      note,
    });
  });

  return events.sort((a, b) => {
    const aMin = a.minute ?? Number.POSITIVE_INFINITY;
    const bMin = b.minute ?? Number.POSITIVE_INFINITY;
    if (aMin !== bMin) return aMin - bMin;
    return a.key.localeCompare(b.key);
  });
};

const extractCardEvents = (source: DataObject): CardEvent[] => {
  const rawCards = getPathVal(source, "cards");
  const cardsArray = Array.isArray(rawCards) ? (rawCards as DataObject[]) : [];
  const events: CardEvent[] = [];

  cardsArray.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const cardType =
      cleanString(getString(raw, ["card", "type", "detail"], "Card")) ?? "Card";
    const homeFault = cleanString(getString(raw, ["home_fault", "homeFault", "player_home"]));
    const awayFault = cleanString(getString(raw, ["away_fault", "awayFault", "player_away"]));
    const player =
      homeFault ??
      awayFault ??
      cleanString(getString(raw, ["player", "name"], cardType)) ??
      cardType;
    const description = cleanString(getString(raw, ["info", "note", "detail"]));
    const time = getString(raw, ["time", "minute", "min"]);
    const period = getString(raw, ["info_time", "period"]);
    const { minute, label } = parseMinuteInfo(time, period, index, "Card");

    const team: "home" | "away" | "neutral" = homeFault
      ? "home"
      : awayFault
      ? "away"
      : "neutral";

    events.push({
      key: `card-${team}-${minute ?? index}-${index}`,
      minute,
      minuteLabel: label,
      team,
      player,
      cardType,
      description,
    });
  });

  return events.sort((a, b) => {
    const aMin = a.minute ?? Number.POSITIVE_INFINITY;
    const bMin = b.minute ?? Number.POSITIVE_INFINITY;
    if (aMin !== bMin) return aMin - bMin;
    return a.key.localeCompare(b.key);
  });
};

const parseSubstitutionRecord = (value: unknown): { in?: string; out?: string } => {
  if (!value) return {};
  if (Array.isArray(value)) {
    if (value.length >= 2) {
      return {
        out: cleanString(value[0] as string),
        in: cleanString(value[1] as string),
      };
    }
    if (value.length === 1) {
      return { in: cleanString(value[0] as string) };
    }
    return {};
  }
  if (typeof value === "object") {
    const obj = value as DataObject;
    return {
      in: cleanString(getString(obj, ["in", "player_in", "playerIn"])),
      out: cleanString(getString(obj, ["out", "player_out", "playerOut"])),
    };
  }
  if (typeof value === "string") {
    if (value.includes("->") || value.includes("→")) {
      const segments = value.replace("→", "->").split("->");
      if (segments.length >= 2) {
        return {
          out: cleanString(segments[0]),
          in: cleanString(segments[1]),
        };
      }
    }
    return { in: cleanString(value) };
  }
  return {};
};

const extractSubstitutionEvents = (source: DataObject): SubstitutionEvent[] => {
  const rawSubs = getPathVal(source, "substitutes");
  const subsArray = Array.isArray(rawSubs) ? (rawSubs as DataObject[]) : [];
  const events: SubstitutionEvent[] = [];

  subsArray.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const homeSub = parseSubstitutionRecord(
      (raw as Record<string, unknown>)["home_scorer"] ??
        (raw as Record<string, unknown>)["home_player"]
    );
    const awaySub = parseSubstitutionRecord(
      (raw as Record<string, unknown>)["away_scorer"] ??
        (raw as Record<string, unknown>)["away_player"]
    );

    const team: "home" | "away" | "neutral" = homeSub.in || homeSub.out ? "home" : awaySub.in || awaySub.out ? "away" : "neutral";
    const sub = team === "home" ? homeSub : team === "away" ? awaySub : homeSub.in || homeSub.out ? homeSub : awaySub;

    if (!sub.in && !sub.out) return;

    const time = getString(raw, ["time", "minute", "min"]);
    const period = getString(raw, ["info_time", "period"]);
    const { minute, label } = parseMinuteInfo(time, period, index, "Substitution");
    const reason =
      cleanString(getString(raw, ["info", "note", "detail"])) ||
      (cleanString(getString(raw, ["score"])) === "substitution" ? undefined : cleanString(getString(raw, ["score"])));

    events.push({
      key: `sub-${team}-${minute ?? index}-${index}`,
      minute,
      minuteLabel: label,
      team,
      playerIn: sub.in,
      playerOut: sub.out,
      reason,
    });
  });

  return events.sort((a, b) => {
    const aMin = a.minute ?? Number.POSITIVE_INFINITY;
    const bMin = b.minute ?? Number.POSITIVE_INFINITY;
    if (aMin !== bMin) return aMin - bMin;
    return a.key.localeCompare(b.key);
  });
};

const extractFoulEvents = (source: DataObject): FoulEvent[] => {
  const timelineRaw = getPathVal(source, "timeline");
  const timelineArray = Array.isArray(timelineRaw) ? (timelineRaw as DataObject[]) : [];
  const events: FoulEvent[] = [];

  timelineArray.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const description = cleanString(getString(raw, ["description", "detail", "event"]));
    const tagsRaw = getPathVal(raw, "predicted_tags");
    const tags = Array.isArray(tagsRaw) ? (tagsRaw as unknown[]) : [];
    const hasFoulTag = tags.some(
      (tag) => typeof tag === "string" && /foul/i.test(tag)
    );

    if (!description && !hasFoulTag) return;
    const isFoul = description ? /foul/i.test(description) : hasFoulTag;
    if (!isFoul) return;

    const time = getString(raw, ["minute", "time"]);
    const period = getString(raw, ["period"]);
    const teamRaw = cleanString(getString(raw, ["team", "side", "club"]));
    const team =
      teamRaw && /home/i.test(teamRaw)
        ? "home"
        : teamRaw && /away/i.test(teamRaw)
        ? "away"
        : undefined;
    const { minute, label } = parseMinuteInfo(time, period, index, "Foul");

    events.push({
      key: `foul-${minute ?? index}-${index}`,
      minute,
      minuteLabel: label,
      team,
      description: description || "Foul",
    });
  });

  return events.sort((a, b) => {
    const aMin = a.minute ?? Number.POSITIVE_INFINITY;
    const bMin = b.minute ?? Number.POSITIVE_INFINITY;
    if (aMin !== bMin) return aMin - bMin;
    return a.key.localeCompare(b.key);
  });
};

export default function MatchPage() {
  const { user, supabase, bumpInteractions } = useAuth();
  const { plan } = usePlanContext();
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const sid = searchParams?.get("sid") ?? "card";

  const [event, setEvent] = useState<RenderEvent | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [highlightsLoading, setHighlightsLoading] = useState(false);
  const [table, setTable] = useState<Array<{
    position?: number;
    team?: string;
    played?: number;
    won?: number;
    drawn?: number;
    lost?: number;
    goalsFor?: number;
    goalsAgainst?: number;
    goalDifference?: number;
    points?: number;
    [key: string]: unknown;
  }>>([]);
  const [eventRaw, setEventRaw] = useState<DataObject | null>(null);
  const [timeline, setTimeline] = useState<TLItem[]>([]);
  const [leaders, setLeaders] = useState<ReturnType<typeof computeLeaders> | null>(null);
  const [best, setBest] = useState<{ name: string; score?: number } | null>(null);
  const [winProbDisplay, setWinProbDisplay] = useState<{ home: number; draw: number; away: number }>({ home: 0, draw: 0, away: 0 });
  const [winProbInsight, setWinProbInsight] = useState<Record<string, unknown> | null | undefined>(undefined);
  const [teamsExtra, setTeamsExtra] = useState<{ home: DataObject | null; away: DataObject | null }>({ home: null, away: null });
  const [playersExtra, setPlayersExtra] = useState<{ home: DataObject[]; away: DataObject[] }>({ home: [], away: [] });
  const [oddsExtra, setOddsExtra] = useState<{ listed: DataObject[]; live: DataObject[] }>({ listed: [], live: [] });
  // const [formExtra, setFormExtra] = useState<{ home: unknown[]; away: unknown[] }>({ home: [], away: [] });
  // const [formExtra, setFormExtra] = useState<{ home: unknown[]; away: unknown[] }>({ home: [], away: [] }); // Only for legacy fallback, not used in UI
  interface TeamForm {
    summary?: string;
    [key: string]: unknown;
  }
  interface TeamMetrics {
    last_results?: Record<string, unknown>[];
    [key: string]: unknown;
  }
  interface AnalysisForm {
    home_team?: TeamForm;
    away_team?: TeamForm;
    home_metrics?: TeamMetrics;
    away_metrics?: TeamMetrics;
    [key: string]: unknown;
  }
  const [analysisForm, setAnalysisForm] = useState<AnalysisForm | null>(null);
  const [h2hExtra, setH2hExtra] = useState<{ matches: DataObject[] } | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [favoriteTeams, setFavoriteTeams] = useState<string[]>([]);
  const [favoriteTeamPending, setFavoriteTeamPending] = useState<Set<string>>(new Set());
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

  const updateFavoriteTeamPending = useCallback((teamName: string, pending: boolean) => {
    setFavoriteTeamPending(prev => {
      const next = new Set(prev);
      if (pending) next.add(teamName);
      else next.delete(teamName);
      return next;
    });
  }, []);

  // Ensure an item exists for this match and log an interaction
  const ensureMatchItemAndSend = async (
    evt: "view" | "click" | "like" | "save" | "share" | "dismiss"
  ) => {
    if (!user) return;
    try {
      const title = event ? `${event.homeTeam} vs ${event.awayTeam}` : `Match ${eventId}`;
      const teams = event ? [event.homeTeam, event.awayTeam].filter(Boolean) : [];
      const league = event?.league ?? null;
      const { data: item_id, error: rpcErr } = await supabase.rpc("ensure_match_item", {
        p_event_id: String(eventId),
        p_title: title,
        p_teams: teams,
        p_league: league,
        p_popularity: 0,
      });
      if (rpcErr) throw rpcErr;
      if (!item_id) return;
      await supabase.from("user_interactions").insert({
        user_id: user.id,
        item_id,
        event: evt,
      });
      try { bumpInteractions(); } catch {}
    } catch {
      // best-effort; ignore errors to avoid breaking UX
    }
  };

  const toggleLike = async () => {
    if (!user) return;
    setLiked(prev => !prev);
    try {
      await ensureMatchItemAndSend(!liked ? 'like' : 'view');
      try { bumpInteractions(); } catch {}
    } catch {}
  };

  const toggleSave = async () => {
    if (!user || !event) return;
    try {
      // Ensure item exists and get the item id
      const { data: itemId, error: rpcErr } = await supabase.rpc('ensure_match_item', {
        p_event_id: String(event.eventId),
        p_title: `${event.homeTeam} vs ${event.awayTeam}`,
        p_teams: [event.homeTeam, event.awayTeam],
        p_league: event.league ?? null,
        p_popularity: 0,
      });
      if (rpcErr) throw rpcErr;
      if (!itemId) return;
      if (saved) {
        // Unsave: delete existing save interaction(s)
        try {
          await supabase.from('user_interactions').delete().match({ user_id: user.id, item_id: itemId, event: 'save' });
          setSaved(false);
          toast.success('Removed saved match');
        } catch {
          // ignore
        }
        return;
      }

      // Not saved yet: insert a save if none exists
      const { data: existing } = await supabase.from('user_interactions').select('id').eq('user_id', user.id).eq('item_id', itemId).eq('event', 'save').maybeSingle();
      if (existing) {
        setSaved(true);
        toast.info('Already saved');
        return;
      }
      await supabase.from('user_interactions').insert({ user_id: user.id, item_id: itemId, event: 'save' });
      setSaved(true);
      toast.success('Saved');
      try { bumpInteractions(); } catch {}
    } catch {
      // ignore failures silently
    }
  };

  // On load, mark saved=true if a prior 'save' exists for this match
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user || !event) return;
      try {
        const { data: itemId } = await supabase.rpc('ensure_match_item', {
          p_event_id: String(event.eventId),
          p_title: `${event.homeTeam} vs ${event.awayTeam}`,
          p_teams: [event.homeTeam, event.awayTeam],
          p_league: event.league ?? null,
          p_popularity: 0,
        });
        if (!itemId) return;
        const { data: existing } = await supabase.from('user_interactions').select('id').eq('user_id', user.id).eq('item_id', itemId).eq('event', 'save').maybeSingle();
        if (!active) return;
        if (existing) setSaved(true);
      } catch {
        // ignore
      }
    })();
    return () => { active = false; };
  }, [user, supabase, event]);

  // Load user's favorite teams for UI state (disable + and show heart)
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user) return;
      try {
        const { data } = await supabase
          .from('user_preferences')
          .select('favorite_teams')
          .eq('user_id', user.id)
          .single();
        if (!active) return;
        setFavoriteTeams((data?.favorite_teams ?? []) as string[]);
      } catch {
        if (!active) return;
        setFavoriteTeams([]);
      }
    })();
    return () => { active = false; };
  }, [user, supabase]);

  // Log a 'view' interaction automatically with a short debounce to avoid double logs
  const viewLogged = useRef(false);
  useEffect(() => {
    if (!user || !event || viewLogged.current) return;
    const t = setTimeout(() => {
      if (!viewLogged.current) {
        viewLogged.current = true;
        void ensureMatchItemAndSend("view");
      }
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, event?.eventId]);

  const removeFavoriteTeam = useCallback(async (teamName: string) => {
    if (!user || !teamName) return;
    if (favoriteTeamPending.has(teamName)) return;
    updateFavoriteTeamPending(teamName, true);
    setFavoriteTeams(prev => prev.filter(team => team !== teamName));
    try {
      const { data } = await supabase
        .from('user_preferences')
        .select('favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos')
        .eq('user_id', user.id)
        .single();
      const prevTeams = (data?.favorite_teams ?? []) as string[];
      const prevLeagues = (data?.favorite_leagues ?? []) as string[];
      const prevTeamLogos = (data?.favorite_team_logos ?? {}) as Record<string, string>;
      const prevLeagueLogos = (data?.favorite_league_logos ?? {}) as Record<string, string>;

      const nextTeams = prevTeams.filter(team => team !== teamName);
      const nextTeamLogos = { ...prevTeamLogos } as Record<string, string>;
      delete nextTeamLogos[teamName];

      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        favorite_teams: nextTeams,
        favorite_leagues: prevLeagues,
        favorite_team_logos: nextTeamLogos,
        favorite_league_logos: prevLeagueLogos,
      });
      setFavoriteTeams(nextTeams);
      toast.success(`Removed ${teamName} from favorites`);
    } catch {
      setFavoriteTeams(prev => (prev.includes(teamName) ? prev : [...prev, teamName]));
      toast.error(`Couldn't remove ${teamName}`);
    } finally {
      updateFavoriteTeamPending(teamName, false);
    }
  }, [user, supabase, favoriteTeamPending, updateFavoriteTeamPending]);

  const addFavoriteTeam = useCallback(async (teamName: string) => {
    if (!user || !teamName) return;
    if (favoriteTeamPending.has(teamName)) return;
    if (favoriteTeams.includes(teamName)) return;

    updateFavoriteTeamPending(teamName, true);
    setFavoriteTeams(prev => [...prev, teamName]);
    try {
      const { data } = await supabase
        .from('user_preferences')
        .select('favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos')
        .eq('user_id', user.id)
        .single();
      const prevTeams = (data?.favorite_teams ?? []) as string[];
      const prevLeagues = (data?.favorite_leagues ?? []) as string[];
      const prevTeamLogos = (data?.favorite_team_logos ?? {}) as Record<string, string>;
      const prevLeagueLogos = (data?.favorite_league_logos ?? {}) as Record<string, string>;

      const nextTeams = Array.from(new Set([...prevTeams, teamName]));

      const normalize = (s: string) => s.trim().toLowerCase();
      const nameKey = normalize(teamName);
      const getLogoFromObject = (obj: Record<string, unknown>): string | undefined => {
        const keys = [
          'team_logo', 'strTeamBadge', 'logo', 'badge', 'crest', 'emblem', 'shield', 'icon', 'image', 'thumb', 'logo_path', 'logo_url', 'image_url', 'strLogo', 'strBadge', 'strBadgeWide'
        ];
        for (const k of keys) {
          const v = obj[k];
          if (typeof v === 'string' && v.trim()) return v.trim();
          if (v && typeof v === 'object') {
            const rv = v as Record<string, unknown>;
            const r = rv.url || rv.src || rv.image || rv.path;
            if (typeof r === 'string' && r.trim()) return r.trim();
          }
        }
        const mediaKeys = ['media', 'images', 'logos', 'thumbnails'];
        for (const mk of mediaKeys) {
          const mv = obj[mk];
          if (Array.isArray(mv)) {
            for (const item of mv) {
              if (typeof item === 'string' && item.trim()) return item.trim();
              if (item && typeof item === 'object') {
                const it = item as Record<string, unknown>;
                const r = it.url || it.src || it.image || it.path;
                if (typeof r === 'string' && r.trim()) return r.trim();
              }
            }
          }
        }
        return undefined;
      };

      const getNameFromObject = (obj: Record<string, unknown>): string => {
        const name = pickString(obj, ['team', 'team_name', 'name', 'strTeam']);
        return name || '';
      };

      let logo: string | undefined = undefined;
      const candidates: Array<Record<string, unknown> | null> = [
        teamsExtra.home as Record<string, unknown> | null,
        teamsExtra.away as Record<string, unknown> | null,
      ];
      for (const c of candidates) {
        if (!c) continue;
        const nm = getNameFromObject(c);
        if (nm && normalize(nm) === nameKey) {
          logo = getLogoFromObject(c);
          if (logo) break;
        }
      }
      if (!logo) {
        try {
          const resp = await getTeam(teamName);
          const obj = parseTeamResponse(resp);
          if (obj && typeof obj === 'object') {
            logo = getLogoFromObject(obj as Record<string, unknown>);
          }
        } catch {
          // ignore fetch failures
        }
      }

      const nextTeamLogos: Record<string, string> = { ...prevTeamLogos };
      if (logo) nextTeamLogos[teamName] = logo;

      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        favorite_teams: nextTeams,
        favorite_leagues: prevLeagues,
        favorite_team_logos: nextTeamLogos,
        favorite_league_logos: prevLeagueLogos,
      });
      setFavoriteTeams(nextTeams);
      try {
        await supabase.rpc('upsert_cached_team', { p_provider_id: null, p_name: teamName, p_logo: logo ?? '', p_metadata: {} });
      } catch {
        // ignore cache population failures
      }
      toast.success(`${teamName} added to favorites`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void removeFavoriteTeam(teamName);
          },
        },
      });
    } catch {
      setFavoriteTeams(prev => prev.filter(team => team !== teamName));
      toast.error(`Couldn't save ${teamName}`);
    } finally {
      updateFavoriteTeamPending(teamName, false);
    }
  }, [user, supabase, favoriteTeams, favoriteTeamPending, teamsExtra.home, teamsExtra.away, updateFavoriteTeamPending, removeFavoriteTeam]);

  const toggleFavoriteTeam = useCallback((teamName: string) => {
    if (!teamName) return;
    if (!user) {
      toast.info('Sign in to save teams');
      return;
    }
    if (favoriteTeamPending.has(teamName)) return;
    if (favoriteTeams.includes(teamName)) {
      void removeFavoriteTeam(teamName);
    } else {
      void addFavoriteTeam(teamName);
    }
  }, [user, favoriteTeams, favoriteTeamPending, addFavoriteTeam, removeFavoriteTeam]);

  const handleShare = async () => {
    if (!match) return;
    try {
      const url = typeof window !== 'undefined'
        ? `${window.location.origin}/match/${encodeURIComponent(match.eventId)}?sid=share`
        : `/match/${encodeURIComponent(match.eventId)}?sid=share`;
      const title = `${match.homeTeam} vs ${match.awayTeam}`;
      const text = `Check out ${title} on Sports Analysis`;
  if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          await (navigator as Navigator & { share?: (data: { title: string; text: string; url: string }) => Promise<void> }).share?.({ title, text, url });
          toast.success('Shared');
          await ensureMatchItemAndSend('share');
          try { bumpInteractions(); } catch {}
          return;
  } catch (err) {
          // user cancelled share - do not show error
          if (typeof err === 'object' && err !== null && 'name' in err && (err as { name?: string }).name === 'AbortError') return;
        }
      }
      // Fallback to copy link
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
        await ensureMatchItemAndSend('share');
        try { bumpInteractions(); } catch {}
      }
    } catch {
      // ignore failures silently
    }
  };

  // Seed from sessionStorage for fast paint like legacy
  useEffect(() => {
    if (typeof window === "undefined") return;
    const seed = sessionStorage.getItem(`sa_selected_event_${sid}`);
    if (seed) {
      try {
        const rawUnknown = JSON.parse(seed);
        if (rawUnknown && typeof rawUnknown === 'object') {
          const raw = rawUnknown as DataObject;
          const e: RenderEvent = {
            eventId: getString(raw, ['eventId', 'id', 'event_id'], String(eventId))!,
            homeTeam: getString(raw, ['homeTeam', 'home_team', 'home'], 'Home')!,
            awayTeam: getString(raw, ['awayTeam', 'away_team', 'away'], 'Away')!,
            homeScore: getNumber(raw, ['homeScore', 'home_score'], 0)!,
            awayScore: getNumber(raw, ['awayScore', 'away_score'], 0)!,
            status: getString(raw, ['status'], '') || '',
            league: getString(raw, ['league']) || undefined,
            venue: getString(raw, ['venue']) || undefined,
            date: getString(raw, ['date'], new Date().toISOString())!,
            attendance: getNumber(raw, ['attendance']) || undefined,
            homeTeamLogo: getLogo(raw, 'home'),
            awayTeamLogo: getLogo(raw, 'away'),
            winProbabilities: (raw['winProbabilities'] || raw['winprob']) as RenderEvent['winProbabilities'],
            stats: extractMatchStats(raw) ?? ((raw['stats'] as MatchStats) || undefined),
            events: Array.isArray(raw['events']) ? (raw['events'] as Array<{ time?: number; type?: string; team?: string; player?: string }>) : [],
          };
          setEvent(e);
        }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid]);

  // Fetch live details and highlights
  useEffect(() => {
    let active = true;
    if (!eventId) return;
    // Prefer AllSports RAW event for richer timeline + tags
    getEventAllSports(String(eventId), { augmentTags: true, includeBest: true })
      .then(env => {
        if (!active) return;
        const d = env.data as Record<string, unknown> | undefined;
        let coreObj: DataObject | null = null;
        if (d && typeof d === 'object') {
          const result = (d as Record<string, unknown>).result;
          if (Array.isArray(result) && result.length && typeof result[0] === 'object') {
            coreObj = result[0] as DataObject;
          } else if ((d as Record<string, unknown>).event && typeof (d as Record<string, unknown>).event === 'object') {
            coreObj = (d as Record<string, unknown>).event as DataObject;
          } else {
            // last resort: assume it's the event object if it has typical keys
            const keys = Object.keys(d);
            if (keys.some(k => /event_|home_|away_|league|timeline|fixtures|result/i.test(k))) {
              coreObj = d as unknown as DataObject;
            }
          }
        }
        if (!coreObj) return;
        // Helper: parse score from common string fields like "1-2"
        const parseScore = (obj: DataObject) => {
          const s = getString(obj, ['event_final_result', 'final_result', 'ft_result']);
          if (s && s.includes('-')) {
            const [h, a] = s.split('-').map(x => Number(String(x).replace(/[^0-9.-]/g, '').trim()));
            return {
              home: Number.isFinite(h) ? h : undefined,
              away: Number.isFinite(a) ? a : undefined,
            };
          }
          return { home: undefined, away: undefined };
        };
        const scoreStr = parseScore(coreObj);
        const normalized: RenderEvent = {
          eventId: getString(coreObj, ['eventId', 'id', 'event_id', 'event_key', 'match_id', 'fixture_id'], String(eventId))!,
          homeTeam: getString(coreObj, ['homeTeam', 'home_team', 'event_home_team', 'strHomeTeam', 'home'], 'Home')!,
          awayTeam: getString(coreObj, ['awayTeam', 'away_team', 'event_away_team', 'strAwayTeam', 'away'], 'Away')!,
          homeScore: (scoreStr.home ?? getNumber(coreObj, ['homeScore', 'home_score', 'score.home', 'event_final_result_home', 'home_result'], 0)) || 0,
          awayScore: (scoreStr.away ?? getNumber(coreObj, ['awayScore', 'away_score', 'score.away', 'event_final_result_away', 'away_result'], 0)) || 0,
          status: getString(coreObj, ['status', 'event_status'], '') || '',
          league: getString(coreObj, ['league', 'league_name', 'competition']) || undefined,
          venue: getString(coreObj, ['venue', 'stadium']) || undefined,
          date: getString(coreObj, ['date', 'datetime', 'kickoff', 'event_date'], new Date().toISOString())!,
          attendance: getNumber(coreObj, ['attendance']) || undefined,
          homeTeamLogo: getLogo(coreObj, 'home'),
          awayTeamLogo: getLogo(coreObj, 'away'),
          winProbabilities: (coreObj['winProbabilities'] || coreObj['winprob']) as RenderEvent['winProbabilities'],
          stats: extractMatchStats(coreObj) ?? ((coreObj['stats'] as MatchStats) || undefined),
          events: Array.isArray(coreObj['events']) ? (coreObj['events'] as Array<{ time?: number; type?: string; team?: string; player?: string }>) : [],
        };
        setEventRaw(coreObj);
        setEvent(normalized);
      })
      .catch(() => {
        // Fallback to TSDB event.results
        getEventResults(String(eventId)).then(env => {
          if (!active) return;
          const d = env.data as { event?: DataObject } | DataObject;
          const core = (d && typeof d === 'object' && 'event' in d) ? (d as { event?: DataObject }).event : (d as DataObject);
          if (!core) return;
          const coreObj = core as DataObject;
          const scoreStr2 = (() => {
            const s = getString(coreObj, ['event_final_result', 'final_result', 'ft_result']);
            if (s && s.includes('-')) {
              const [h, a] = s.split('-').map(x => Number(String(x).replace(/[^0-9.-]/g, '').trim()));
              return { home: Number.isFinite(h) ? h : undefined, away: Number.isFinite(a) ? a : undefined };
            }
            return { home: undefined, away: undefined };
          })();
          const normalized: RenderEvent = {
            eventId: getString(coreObj, ['eventId', 'id', 'event_id'], String(eventId))!,
            homeTeam: getString(coreObj, ['homeTeam', 'home_team', 'home'], 'Home')!,
            awayTeam: getString(coreObj, ['awayTeam', 'away_team', 'away'], 'Away')!,
            homeScore: (scoreStr2.home ?? getNumber(coreObj, ['homeScore', 'home_score', 'score.home'], 0)) || 0,
            awayScore: (scoreStr2.away ?? getNumber(coreObj, ['awayScore', 'away_score', 'score.away'], 0)) || 0,
            status: getString(coreObj, ['status'], '') || '',
            league: getString(coreObj, ['league', 'competition']) || undefined,
            venue: getString(coreObj, ['venue', 'stadium']) || undefined,
            date: getString(coreObj, ['date', 'datetime', 'kickoff'], new Date().toISOString())!,
            attendance: getNumber(coreObj, ['attendance']) || undefined,
            homeTeamLogo: getLogo(coreObj, 'home'),
            awayTeamLogo: getLogo(coreObj, 'away'),
            winProbabilities: (coreObj['winProbabilities'] || coreObj['winprob']) as RenderEvent['winProbabilities'],
            stats: extractMatchStats(coreObj) ?? ((coreObj['stats'] as MatchStats) || undefined),
            events: Array.isArray(coreObj['events']) ? (coreObj['events'] as Array<{ time?: number; type?: string; team?: string; player?: string }>) : [],
          };
          setEventRaw(coreObj);
          setEvent(normalized);
        }).catch(() => {});
      });
    return () => { active = false; };
  }, [eventId]);

  // --- Parallelize win probability fetches and use SWR for caching ---
  const fetchWinProbabilities = async (eventId: string) => {
    // Fire both requests in parallel
    const [insightsRes, fallbackRes] = await Promise.allSettled([
      postCollect("analysis.match_insights", { eventId: String(eventId) }),
      getWinProb(String(eventId)),
    ]);
    // Prefer analysis agent (insights) if valid
    if (insightsRes.status === "fulfilled") {
      const data = (insightsRes.value?.data ?? {}) as Record<string, unknown>;
      const insightsRaw = data.insights;
      const insights = insightsRaw && typeof insightsRaw === "object" ? (insightsRaw as Record<string, unknown>) : undefined;
      const winprobContainer = insights ?? data;
      const winprobRaw = winprobContainer.winprob;
      const winprob = winprobRaw && typeof winprobRaw === "object"
        ? (winprobRaw as Record<string, unknown>)
        : undefined;
      const norm = (val?: unknown) => {
        if (typeof val !== "number") return 0;
        if (Number.isNaN(val)) return 0;
        return val <= 1.0001 ? Math.round(val * 100) : Math.round(val);
      };
      const homePct = norm(winprob?.home);
      const drawPct = norm(winprob?.draw);
      const awayPct = norm(winprob?.away);
      if (homePct + drawPct + awayPct > 0) {
        return {
          display: { home: homePct, draw: drawPct, away: awayPct },
          insight: winprobContainer,
        };
      }
    }
    // Fallback to getWinProb if insights are missing or zero
    if (fallbackRes.status === "fulfilled") {
      const data = (fallbackRes.value && fallbackRes.value.data) || {};
      const prob = (data && (data.winprob || data.win_prob || data.probabilities)) || {};
      const norm = (val?: unknown) => {
        if (typeof val !== "number") return 0;
        if (Number.isNaN(val)) return 0;
        return val <= 1.0001 ? Math.round(val * 100) : Math.round(val);
      };
      const h = norm(prob.home);
      const d = norm(prob.draw);
      const a = norm(prob.away);
      return {
        display: { home: h, draw: d, away: a },
        insight: fallbackRes.value as unknown as Record<string, unknown>,
      };
    }
    // If both fail, return zeros
    return {
      display: { home: 0, draw: 0, away: 0 },
      insight: null,
    };
  };

  const { data: winProbData } = useSWR(
    eventId ? ["winprob", eventId] : null,
    () => fetchWinProbabilities(String(eventId)),
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  useEffect(() => {
    if (!winProbData) return;
    setWinProbDisplay(winProbData.display);
    setWinProbInsight(winProbData.insight);
    setEvent(prev => prev ? {
      ...prev,
      winProbabilities: {
        home: winProbData.display.home / 100,
        draw: winProbData.display.draw / 100,
        away: winProbData.display.away / 100,
      },
    } : prev);
  }, [winProbData]);

  useEffect(() => {
    const win = event?.winProbabilities;
    if (!win) return;
    if (winProbInsight && typeof winProbInsight === "object") return;
    const toPct = (value?: number) => {
      if (typeof value !== "number" || Number.isNaN(value)) return 0;
      if (value <= 1.0001) return Math.round(value * 100);
      return Math.round(value);
    };
    setWinProbDisplay({
      home: toPct(win.home),
      draw: toPct(win.draw),
      away: toPct(win.away),
    });
  }, [event, winProbInsight]);

  useEffect(() => {
    if (!eventRaw) {
      setTimeline([]);
      setLeaders(null);
      setBest(null);
      return;
    }
    setTimeline(buildTimeline(eventRaw));
    setLeaders(computeLeaders(eventRaw));
    const rawBest = (eventRaw as Record<string, unknown>)?.best_player ?? (eventRaw as Record<string, unknown>)?.bestPlayer;
    if (rawBest && typeof rawBest === "object") {
      const candidate = rawBest as { name?: string; score?: number };
      if (candidate.name) {
        setBest({ name: candidate.name, score: typeof candidate.score === "number" ? candidate.score : undefined });
        return;
      }
    } else if (typeof rawBest === "string" && rawBest.trim()) {
      setBest({ name: rawBest });
      return;
    }
    setBest(computeBestPlayer(eventRaw));
  }, [eventRaw]);

  useEffect(() => {
    if (!eventRaw) {
      setTable([]);
      return;
    }

    // Prefer league_key if available, fallback to legacy keys
    let leagueId = getString(eventRaw, ['league_key']);
    if (!leagueId) {
      leagueId = getString(eventRaw, ['idLeague', 'league_id']);
    }
    const leagueName = getString(eventRaw, ['league_name', 'strLeague', 'league', 'competition']);

    if (!leagueId && !leagueName) {
      setTable([]);
      return;
    }

    let active = true;

    (async () => {
      try {
        // Extract season from event data
        const season = getString(eventRaw, ['season', 'league_season', 'event_season']);

        // Always prefer leagueId if available
        const response = await getLeagueTable({
          leagueId: leagueId || undefined,
          leagueName: !leagueId ? leagueName || undefined : undefined,
          season: season || undefined,
        });

        if (!active) return;

        // Process response data using the same logic as the old implementation
        const dataObj = response.data;
        let tableData: unknown[] = [];

        if (Array.isArray(dataObj)) {
          tableData = dataObj as unknown[];
        } else if (dataObj && typeof dataObj === 'object') {
          const rec = dataObj as Record<string, unknown>;
          if (Array.isArray(rec.table)) tableData = rec.table as unknown[];
          else if (Array.isArray(rec.result)) tableData = rec.result as unknown[];
          else if (Array.isArray(rec.total)) tableData = rec.total as unknown[];
          else if (Array.isArray(rec.standings)) tableData = rec.standings as unknown[];
          else if (Array.isArray(rec.rows)) tableData = rec.rows as unknown[];
          else if (Array.isArray(rec.league_table)) tableData = rec.league_table as unknown[];

          // Fix: handle case where result is an object with total/home/away arrays
          if (rec.result && typeof rec.result === 'object' && !Array.isArray(rec.result)) {
            const resultObj = rec.result as Record<string, unknown>;
            if (Array.isArray(resultObj.total)) tableData = resultObj.total as unknown[];
            else if (Array.isArray(resultObj.home)) tableData = resultObj.home as unknown[];
            else if (Array.isArray(resultObj.away)) tableData = resultObj.away as unknown[];
          }
        }

        if (tableData.length > 0) {
          const mapped = tableData.map((r, index) => {
            const rec = r as Record<string, unknown>;
            const position = typeof rec.position === "number" ? rec.position :
              typeof rec.rank === "number" ? rec.rank :
              parseNumber(rec.standing_place) ??
              parseNumber(rec.overall_league_position) ?? index + 1;

            // Use all possible team name fields, including 'standing_team'
            const teamName = pickString(rec, ["team", "team_name", "name", "standing_team"]);

            // Extract league table data using the correct fields for this API
            const played = parseNumber(rec.standing_P) ??
              parseNumber(rec.overall_league_payed) ??
              parseNumber(rec.overall_league_played) ??
              parseNumber(rec.played) ??
              parseNumber(rec.matches) ??
              parseNumber(rec.games) ?? 0;

            const wins = parseNumber(rec.standing_W) ??
              parseNumber(rec.overall_league_W) ??
              parseNumber(rec.wins) ??
              parseNumber(rec.W) ?? 0;

            const draws = parseNumber(rec.standing_D) ??
              parseNumber(rec.overall_league_D) ??
              parseNumber(rec.draws) ??
              parseNumber(rec.D) ?? 0;

            const losses = parseNumber(rec.standing_L) ??
              parseNumber(rec.overall_league_L) ??
              parseNumber(rec.losses) ??
              parseNumber(rec.L) ?? 0;

            // Updated mappings for GF, GA, GD
            const goalsFor = parseNumber(rec.standing_F) ??
              parseNumber(rec.goals_for) ??
              parseNumber(rec.overall_league_GF) ??
              parseNumber(rec.GF) ?? 0;

            const goalsAgainst = parseNumber(rec.standing_A) ??
              parseNumber(rec.goals_against) ??
              parseNumber(rec.overall_league_GA) ??
              parseNumber(rec.GA) ?? 0;

            const goalDifference = parseNumber(rec.standing_GD) ??
              parseNumber(rec.goal_difference) ??
              parseNumber(rec.overall_league_GD) ??
              parseNumber(rec.GD) ?? 0;

            const points = parseNumber(rec.standing_PTS) ??
              parseNumber(rec.points) ??
              parseNumber(rec.pts) ??
              parseNumber(rec.overall_league_PTS) ?? 0;

            return {
              position: position ?? index + 1,
              team: teamName,
              played,
              won: wins,
              drawn: draws,
              lost: losses,
              goalsFor,
              goalsAgainst,
              goalDifference,
              points,
              ...rec
            };
          });
          setTable(mapped);
        } else {
          setTable([]);
        }
      } catch (error) {
        console.error('Failed to fetch league table:', error);
        setTable([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [eventRaw]);

  useEffect(() => {
    if (!event) {
      setTeamsExtra({ home: null, away: null });
      setPlayersExtra({ home: [], away: [] });
      setOddsExtra({ listed: [], live: [] });
      // setFormExtra({ home: [], away: [] }); // legacy fallback removed
      setAnalysisForm(null);
      setH2hExtra(null);
      setExtrasLoading(false);
      return;
    }

    let active = true;
    setExtrasLoading(true);

    // Use teamId for form data, not eventId
    // Always fetch form data using eventId for analysis tab
    const requests: [
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
      Promise<unknown>,
    ] = [
      event.homeTeam ? getTeam(event.homeTeam) : Promise.resolve(null),
      event.awayTeam ? getTeam(event.awayTeam) : Promise.resolve(null),
      event.homeTeam ? listTeamPlayers(event.homeTeam) : Promise.resolve(null),
      event.awayTeam ? listTeamPlayers(event.awayTeam) : Promise.resolve(null),
      event.eventId ? postCollect("odds.list", { eventId: event.eventId }) : Promise.resolve(null),
      event.eventId ? postCollect("odds.live", { eventId: event.eventId }) : Promise.resolve(null),
      Promise.resolve(null),
      event.eventId ? getForm(event.eventId) : Promise.resolve({}),
      Promise.resolve({}),
      event.homeTeam && event.awayTeam ? getH2HByTeams(event.homeTeam, event.awayTeam) : Promise.resolve(null),
      event.eventId ? postCollect("analysis.match_insights", { eventId: event.eventId }) : Promise.resolve(null),
    ];

    Promise.allSettled(requests)
      .then(results => {
        if (!active) return;
        const [homeTeamRes, awayTeamRes, homePlayersRes, awayPlayersRes, oddsListRes, oddsLiveRes, , formRes, , h2hRes, analysisRes] = results;

        const homeTeamData = isFulfilled(homeTeamRes) ? parseTeamResponse(homeTeamRes.value as Awaited<ReturnType<typeof getTeam>> | null) : null;
        const awayTeamData = isFulfilled(awayTeamRes) ? parseTeamResponse(awayTeamRes.value as Awaited<ReturnType<typeof getTeam>> | null) : null;
        setTeamsExtra({ home: homeTeamData, away: awayTeamData });

        const homePlayers = isFulfilled(homePlayersRes) ? parsePlayersResponse(homePlayersRes.value as Awaited<ReturnType<typeof listTeamPlayers>> | null) : [];
        const awayPlayers = isFulfilled(awayPlayersRes) ? parsePlayersResponse(awayPlayersRes.value as Awaited<ReturnType<typeof listTeamPlayers>> | null) : [];
        setPlayersExtra({ home: homePlayers, away: awayPlayers });

        const listedOdds = isFulfilled(oddsListRes) ? parseOddsResponse(oddsListRes.value as { data?: unknown } | null) : [];
        const liveOdds = isFulfilled(oddsLiveRes) ? parseOddsResponse(oddsLiveRes.value as { data?: unknown } | null) : [];
        setOddsExtra({ listed: listedOdds, live: liveOdds });

        // Combine home and away form data
        // Set analysisForm directly from backend response for form
        let analysisFormObj = null;
        if (isFulfilled(formRes) && formRes.value && typeof formRes.value === 'object') {
          const data = (formRes.value as Record<string, unknown>).data;
          if (data && typeof data === 'object') {
            const d = data as Record<string, unknown>;
            analysisFormObj = {
              home_team: d.home_team as Record<string, unknown> ?? {},
              home_metrics: d.home_metrics as Record<string, unknown> ?? {},
              away_team: d.away_team as Record<string, unknown> ?? {},
              away_metrics: d.away_metrics as Record<string, unknown> ?? {},
            };
          }
        }
        const h2hData = isFulfilled(h2hRes) ? parseH2HResponse(h2hRes.value as unknown) : null;
        setH2hExtra(h2hData);

        // If analysis agent output exists, prefer it
        if (isFulfilled(analysisRes) && analysisRes.value && typeof analysisRes.value === 'object') {
          const data = (analysisRes.value as { data?: unknown }).data;
          if (data && typeof data === 'object') {
            const dataObj = data as Record<string, unknown>;
            if ('form' in dataObj) analysisFormObj = dataObj.form;
            else if ('insights' in dataObj && typeof dataObj.insights === 'object' && dataObj.insights !== null) {
              const insightsObj = dataObj.insights as Record<string, unknown>;
              if ('form' in insightsObj) analysisFormObj = insightsObj.form;
            }
          }
        }
        setAnalysisForm(analysisFormObj as AnalysisForm);
      })
      .catch(() => {
        // Silently handle errors
      })
      .finally(() => {
        if (!active) return;
        setExtrasLoading(false);
      });

    return () => {
      active = false;
    };
  }, [event, eventRaw, event?.homeTeam, event?.awayTeam]);
  useEffect(() => {
    if (!event || !event.eventId) {
      setHighlights([]);
      setHighlightsLoading(false);
      return;
    }

    let active = true;
    setHighlightsLoading(true);

    getHighlights(event.eventId, {
      eventRaw: eventRaw ?? undefined,
      homeTeam: event.homeTeam,
      awayTeam: event.awayTeam,
      date: event.date,
    })
      .then((resp) => {
        if (!active) return;
        const payload = resp?.data as Record<string, unknown> | undefined;
        const rawVideos = payload && typeof payload === "object" ? (payload.videos as unknown) : [];
        const parsed = parseHighlights(Array.isArray(rawVideos) ? rawVideos : []);
        setHighlights(parsed);
      })
      .catch((err: unknown) => {
        if (!active) return;
        const msg = err instanceof Error ? err.message : "Unable to load highlights";
        console.warn("highlight fetch failed", msg);
        setHighlights([]);
      })
      .finally(() => {
        if (!active) return;
        setHighlightsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [event, event?.eventId, event?.homeTeam, event?.awayTeam, event?.date, eventRaw]);

  const eventDetails = useMemo(() => {
    if (!eventRaw) {
      return {
        goals: [] as GoalEvent[],
        cards: [] as CardEvent[],
        substitutions: [] as SubstitutionEvent[],
        fouls: [] as FoulEvent[],
      };
    }
    return {
      goals: extractGoalEvents(eventRaw),
      cards: extractCardEvents(eventRaw),
      substitutions: extractSubstitutionEvents(eventRaw),
      fouls: extractFoulEvents(eventRaw),
    };
  }, [eventRaw]);

  const statEntries = useMemo(() => {
    const stats = event?.stats;
    if (!stats) return [] as MatchStatEntry[];
    if (Array.isArray(stats.entries) && stats.entries.length) {
      return stats.entries;
    }
    const fallback: MatchStatEntry[] = [];
    buildSummaryEntries(stats, (entry) => {
      fallback.push(entry);
    });
    return fallback;
  }, [event?.stats]);

  const match = event;

  if (!match) {
    return null;
  }

  const { goals, cards, substitutions, fouls } = eventDetails;

  const matchDate = new Date(match.date);
  const st = (match.status || '').toLowerCase();
  const isLive = /live|1st|2nd|ht/.test(st);
  const isFinished = /ft|finished/.test(st);

  const homeFavorite = favoriteTeams.includes(match.homeTeam);
  const homePending = favoriteTeamPending.has(match.homeTeam);
  const awayFavorite = favoriteTeams.includes(match.awayTeam);
  const awayPending = favoriteTeamPending.has(match.awayTeam);

  

  return (
    <div className="container py-8 space-y-8">
      {/* Match Header */}
      <div>
        <Card>
          <CardContent className="p-8">
            <div className="space-y-6">
              {/* League and Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Trophy className="w-5 h-5 text-primary" />
                  <span className="font-semibold">{match.league}</span>
                </div>
                <Badge variant={isLive ? "default" : isFinished ? "secondary" : "outline"}>
                  {match.status}
                </Badge>
              </div>

              {/* Teams and Score with Save (+) */}
              <div className="flex items-center justify-center space-x-8">
                <div className="text-center space-y-2">
                  <Avatar className="w-16 h-16 mx-auto border-2 border-border/40 shadow-md">
                    {match.homeTeamLogo ? (
                      <AvatarImage src={match.homeTeamLogo} alt={match.homeTeam} />
                    ) : (
                      <AvatarFallback className="bg-red-100 text-red-600 text-xl font-bold">
                        {match.homeTeam.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="font-semibold text-lg flex items-center gap-1">
                      {match.homeTeam}
                      {homeFavorite && (
                        <Heart className="w-4 h-4 text-red-500" fill="currentColor" />
                      )}
                    </h3>
                    <Button
                      variant="outline"
                      size="icon"
                      title={homeFavorite ? "Remove from favorites" : "Save team"}
                      className="transition-transform active:scale-95"
                      disabled={homePending}
                      onClick={() => toggleFavoriteTeam(match.homeTeam)}
                    >
                      {homePending ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/60 border-t-transparent" />
                      ) : homeFavorite ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="text-center space-y-2">
                  <div className="text-4xl font-bold">
                    {match.homeScore} - {match.awayScore}
                  </div>
                  {isLive && (
                    <Badge variant="default" className="animate-pulse">
                      LIVE
                    </Badge>
                  )}
                </div>

                <div className="text-center space-y-2">
                  <Avatar className="w-16 h-16 mx-auto border-2 border-border/40 shadow-md">
                    {match.awayTeamLogo ? (
                      <AvatarImage src={match.awayTeamLogo} alt={match.awayTeam} />
                    ) : (
                      <AvatarFallback className="bg-blue-100 text-blue-600 text-xl font-bold">
                        {match.awayTeam.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="font-semibold text-lg flex items-center gap-1">
                      {match.awayTeam}
                      {awayFavorite && (
                        <Heart className="w-4 h-4 text-red-500" fill="currentColor" />
                      )}
                    </h3>
                    <Button
                      variant="outline"
                      size="icon"
                      title={awayFavorite ? "Remove from favorites" : "Save team"}
                      className="transition-transform active:scale-95"
                      disabled={awayPending}
                      onClick={() => toggleFavoriteTeam(match.awayTeam)}
                    >
                      {awayPending ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/60 border-t-transparent" />
                      ) : awayFavorite ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Match Info */}
              <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
                <div className="flex items-center space-x-1">
                  <Calendar className="w-4 h-4" />
                  <span>{matchDate.toLocaleDateString()} at {matchDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <MapPin className="w-4 h-4" />
                  <span>{match.venue}</span>
                </div>
                <div className="flex items-center space-x-1">
                  <Users className="w-4 h-4" />
                  <span>{match.attendance?.toLocaleString()} attendance</span>
                </div>
              </div>

              {/* Personalization actions */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant={liked ? "default" : "outline"} size="sm" title="Like" className="transition-transform active:scale-95" onClick={toggleLike}>
                  <ThumbsUp className="w-4 h-4 mr-1"/>{liked ? 'Liked' : 'Like'}
                </Button>
                <Button variant={saved ? "default" : "outline"} size="sm" title="Save" className="transition-transform active:scale-95" onClick={toggleSave}>
                  <Bookmark className="w-4 h-4 mr-1"/>{saved ? 'Saved' : 'Save'}
                </Button>
                <Button variant="outline" size="sm" title="Share" className="transition-transform active:scale-95" onClick={handleShare}>
                  <Share2 className="w-4 h-4 mr-1"/> Share
                </Button>
                {/* Dismiss removed as per request */}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Match Summary */}
      <MatchSummaryCard
        event={{
          eventId: match.eventId,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          status: match.status,
          venue: match.venue,
          date: match.date,
        }}
        rawEvent={eventRaw}
      />

      {/* Match Timeline */}
      <Card>
        <CardContent className="p-4">
          <RichTimeline
            eventId={match.eventId}
            items={timeline}
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            matchRaw={eventRaw}
            players={playersExtra}
            teams={teamsExtra}
          />
        </CardContent>
      </Card>


      {highlights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Video Highlights</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <HighlightsCarousel
              highlights={highlights}
              isLoading={highlightsLoading}
              className="mt-2"
            />
          </CardContent>
        </Card>
      )}

      <WinProbabilityCard
        homeTeam={match.homeTeam}
        awayTeam={match.awayTeam}
        homeTeamLogo={match.homeTeamLogo}
        awayTeamLogo={match.awayTeamLogo}
        fallback={winProbDisplay}
        rawInsight={winProbInsight}
        rawEvent={eventRaw}
        teams={teamsExtra}
      />

      {/* Match Details Tabs */}
      <div>
        <Tabs defaultValue="stats" className="space-y-6">
          <TabsList className="grid grid-cols-5 w-full max-w-3xl mx-auto">
            <TabsTrigger value="stats">Statistics</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="league">League Table</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="space-y-6">
            {statEntries.length ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                {statEntries.map((entry) => {
                  const homeNumeric = entry.homeNumeric ?? toNumericValue(entry.home);
                  const awayNumeric = entry.awayNumeric ?? toNumericValue(entry.away);
                  const totalNumeric = (homeNumeric ?? 0) + (awayNumeric ?? 0);
                  const showBar =
                    homeNumeric !== undefined &&
                    awayNumeric !== undefined &&
                    totalNumeric > 0;
                  const homeShare = showBar
                    ? Math.max(0, Math.min(100, (homeNumeric! / totalNumeric) * 100))
                    : 0;
                  const awayShare = showBar
                    ? Math.max(0, Math.min(100, (awayNumeric! / totalNumeric) * 100))
                    : 0;

                  return (
                    <Card key={entry.key}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{entry.label}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-3 text-sm font-semibold">
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar className="h-9 w-9 border border-border/40 bg-background">
                                {match.homeTeamLogo ? (
                                  <AvatarImage src={match.homeTeamLogo} alt={match.homeTeam} />
                                ) : (
                                  <AvatarFallback className="text-xs font-semibold">
                                    {getInitials(match.homeTeam)}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium uppercase text-muted-foreground">
                                  {match.homeTeam}
                                </div>
                              </div>
                            </div>
                            <span className="text-lg font-semibold tabular-nums">{entry.home}</span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <Avatar className="h-9 w-9 border border-border/40 bg-background">
                                {match.awayTeamLogo ? (
                                  <AvatarImage src={match.awayTeamLogo} alt={match.awayTeam} />
                                ) : (
                                  <AvatarFallback className="text-xs font-semibold">
                                    {getInitials(match.awayTeam)}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium uppercase text-muted-foreground">
                                  {match.awayTeam}
                                </div>
                              </div>
                            </div>
                            <span className="text-lg font-semibold tabular-nums">{entry.away}</span>
                          </div>
                        </div>
                        {showBar ? (
                          <div className="space-y-1">
                            <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${homeShare}%` }}
                              />
                              <div
                                className="h-full bg-primary/20 transition-all"
                                style={{ width: `${awayShare}%` }}
                              />
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span className="truncate">{match.homeTeam}</span>
                              <span className="truncate text-right">{match.awayTeam}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span className="truncate">{match.homeTeam}</span>
                            <span className="truncate text-right">{match.awayTeam}</span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="p-6">
                  <div className="text-sm text-muted-foreground">
                    No statistics available for this match yet.
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-6">
            <div className="space-y-6">
              {best ? <BestPlayerCard best={best} /> : null}

              {goals.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Goals</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-3">
                      {goals.map((goal) => {
                        const teamLabel =
                          goal.team === "home"
                            ? match.homeTeam
                            : goal.team === "away"
                            ? match.awayTeam
                            : "Neutral";
                        const teamLogo =
                          goal.team === "home"
                            ? match.homeTeamLogo
                            : goal.team === "away"
                            ? match.awayTeamLogo
                            : undefined;
                        const badgeTone =
                          goal.team === "home"
                            ? "border-primary/60 text-primary"
                            : goal.team === "away"
                            ? "border-emerald-500/60 text-emerald-400"
                            : "border-border/60 text-muted-foreground";
                        const playerInitials = getInitials(goal.player);
                        return (
                          <li
                            key={goal.key}
                            className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/50 p-3"
                          >
                            <Badge variant="outline" className={`mt-0.5 ${badgeTone}`}>
                              {goal.minuteLabel}
                            </Badge>
                            <div className="flex flex-1 items-start gap-3">
                              <Avatar className="h-9 w-9 border border-border/40 bg-background">
                                {teamLogo ? (
                                  <AvatarImage src={teamLogo} alt={teamLabel} />
                                ) : (
                                  <AvatarFallback className="text-xs font-semibold">
                                    {playerInitials}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="flex-1 space-y-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold">{goal.player}</span>
                                  {goal.score ? (
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      {goal.score}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {teamLabel}
                                  {goal.assist ? ` · Assist: ${goal.assist}` : ""}
                                  {goal.note ? ` · ${goal.note}` : ""}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              {cards.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Discipline</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-3">
                      {cards.map((cardEvent) => {
                        const teamLabel =
                          cardEvent.team === "home"
                            ? match.homeTeam
                            : cardEvent.team === "away"
                            ? match.awayTeam
                            : "Neutral";
                        const teamLogo =
                          cardEvent.team === "home"
                            ? match.homeTeamLogo
                            : cardEvent.team === "away"
                            ? match.awayTeamLogo
                            : undefined;
                        const isRed = /red/i.test(cardEvent.cardType);
                        const isYellow = /yellow/i.test(cardEvent.cardType);
                        const badgeTone = isRed
                          ? "border-red-500/60 text-red-500 bg-red-500/10"
                          : isYellow
                          ? "border-yellow-500/60 text-yellow-700 bg-yellow-500/10"
                          : "border-border/60 text-muted-foreground bg-muted/20";
                        const playerInitials = getInitials(cardEvent.player);

                        return (
                          <li
                            key={cardEvent.key}
                            className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/50 p-3"
                          >
                            <Badge variant="outline" className={`mt-0.5 ${badgeTone}`}>
                              {cardEvent.minuteLabel}
                            </Badge>
                            <div className="flex flex-1 items-start gap-3">
                              <Avatar className="h-9 w-9 border border-border/40 bg-background">
                                {teamLogo ? (
                                  <AvatarImage src={teamLogo} alt={teamLabel} />
                                ) : (
                                  <AvatarFallback className="text-xs font-semibold">
                                    {playerInitials}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="flex-1 space-y-1">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold">{cardEvent.player}</span>
                                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                                    {cardEvent.cardType}
                                  </span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {teamLabel}
                                  {cardEvent.description ? ` · ${cardEvent.description}` : ""}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              {substitutions.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Substitutions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-3">
                      {substitutions.map((sub) => {
                        const teamLabel =
                          sub.team === "home"
                            ? match.homeTeam
                            : sub.team === "away"
                            ? match.awayTeam
                            : "Neutral";
                        const teamLogo =
                          sub.team === "home"
                            ? match.homeTeamLogo
                            : sub.team === "away"
                            ? match.awayTeamLogo
                            : undefined;
                        const badgeTone =
                          sub.team === "home"
                            ? "border-primary/60 text-primary"
                            : sub.team === "away"
                            ? "border-emerald-500/60 text-emerald-400"
                            : "border-border/60 text-muted-foreground";
                        const changeLine =
                          sub.playerOut && sub.playerIn
                            ? `${sub.playerOut} → ${sub.playerIn}`
                            : sub.playerIn ?? sub.playerOut ?? "Substitution";
                        const primaryName = sub.playerIn ?? sub.playerOut ?? teamLabel;
                        return (
                          <li
                            key={sub.key}
                            className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/50 p-3"
                          >
                            <Badge variant="outline" className={`mt-0.5 ${badgeTone}`}>
                              {sub.minuteLabel}
                            </Badge>
                            <div className="flex flex-1 items-start gap-3">
                              <Avatar className="h-9 w-9 border border-border/40 bg-background">
                                {teamLogo ? (
                                  <AvatarImage src={teamLogo} alt={teamLabel} />
                                ) : (
                                  <AvatarFallback className="text-xs font-semibold">
                                    {getInitials(primaryName)}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="flex-1 space-y-1">
                                <div className="font-semibold">{changeLine}</div>
                                <div className="text-xs text-muted-foreground">
                                  {teamLabel}
                                  {sub.reason ? ` · ${sub.reason}` : ""}
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              {fouls.length ? (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Fouls</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-3">
                      {fouls.map((foul) => {
                        const teamLabel =
                          foul.team === "home"
                            ? match.homeTeam
                            : foul.team === "away"
                            ? match.awayTeam
                            : foul.team === "neutral"
                            ? "Neutral"
                            : "Unspecified";
                        const teamLogo =
                          foul.team === "home"
                            ? match.homeTeamLogo
                            : foul.team === "away"
                            ? match.awayTeamLogo
                            : undefined;
                        return (
                          <li
                            key={foul.key}
                            className="flex items-start gap-3 rounded-lg border border-border/50 bg-card/50 p-3"
                          >
                            <Badge variant="outline" className="mt-0.5 border-border/60 text-muted-foreground">
                              {foul.minuteLabel}
                            </Badge>
                            <div className="flex flex-1 items-start gap-3">
                              <Avatar className="h-9 w-9 border border-border/40 bg-background">
                                {teamLogo ? (
                                  <AvatarImage src={teamLogo} alt={teamLabel} />
                                ) : (
                                  <AvatarFallback className="text-xs font-semibold">
                                    {getInitials(foul.description)}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <div className="flex-1 space-y-1">
                                <div className="font-semibold">{foul.description}</div>
                                <div className="text-xs text-muted-foreground">{teamLabel}</div>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </CardContent>
                </Card>
              ) : null}

              {leaders ? (
                <LeadersCard
                  leaders={leaders}
                  homeTeam={match.homeTeam}
                  awayTeam={match.awayTeam}
                  homeLogo={match.homeTeamLogo}
                  awayLogo={match.awayTeamLogo}
                />
              ) : null}
            </div>
          </TabsContent>

          <TabsContent value="league" className="space-y-4">
            {table.length > 0 ? (
              <LeagueStandingsCard
                rows={table.map((row, idx) => ({
                  ...row,
                  id: typeof row.id === "string" ? row.id : `${row.team ?? "row"}-${row.position ?? idx}`,
                }))}
                loading={false}
                error={null}
                seasonOptions={[]}
                selectedSeason={""}
                onSelectSeason={() => {}}
                stageOptions={[]}
                selectedStage={""}
                onSelectStage={() => {}}
                lastUpdated={undefined}
                highlightTeams={[match.homeTeam, match.awayTeam]}
              />
            ) : extrasLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="text-sm text-muted-foreground">Loading league table...</div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-6">
                  <div className="text-sm text-muted-foreground">No league table data available.</div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="teams" className="space-y-4">
            {extrasLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="text-sm text-muted-foreground">Loading teams...</div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Team Squads</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="home" className="space-y-4">
                    <TabsList className="grid grid-cols-2 w-full max-w-md">
                      <TabsTrigger value="home">{match.homeTeam}</TabsTrigger>
                      <TabsTrigger value="away">{match.awayTeam}</TabsTrigger>
                    </TabsList>

                    <TabsContent value="home" className="space-y-4">
                      {teamsExtra.home && (
                        <div className="rounded-lg border p-4 space-y-3">
                          <div className="flex items-center gap-3 mb-4">
                            <Avatar className="w-12 h-12 border-2 border-border/40 shadow-sm">
                              {match.homeTeamLogo ? (
                                <AvatarImage src={match.homeTeamLogo} alt={match.homeTeam} />
                              ) : (
                                <AvatarFallback className="text-lg font-semibold">
                                  {match.homeTeam.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <h4 className="font-semibold text-lg">{match.homeTeam}</h4>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            {(() => {
                              const teamRecord = teamsExtra.home as Record<string, unknown>;
                              const info = [
                                { label: "Founded", value: pickString(teamRecord, ["team_founded", "intFormedYear"]) },
                                { label: "Stadium", value: pickString(teamRecord, ["team_venue", "strStadium"]) },
                                { label: "Manager", value: pickString(teamRecord, ["team_manager", "strManager"]) },
                                { label: "Country", value: pickString(teamRecord, ["team_country", "strCountry"]) },
                              ].filter(item => item.value);
                              return info.map(item => (
                                <div key={item.label}>
                                  <div className="text-muted-foreground">{item.label}</div>
                                  <div className="font-medium">{item.value}</div>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                      
                      <div className="rounded-lg border p-4">
                        <h4 className="font-semibold mb-3">Players</h4>
                        {playersExtra.home.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {playersExtra.home.map((player, idx) => {
                              const playerRecord = player as Record<string, unknown>;
                              const name = pickString(playerRecord, ["player_name", "strPlayer", "name"]);
                              const position = pickString(playerRecord, ["player_type", "strPosition", "position"]);
                              const number = pickString(playerRecord, ["player_number", "strNumber", "number"]);
                              return (
                                <div key={idx} className="rounded border p-3 space-y-1">
                                  <div className="font-medium text-sm">{name || 'Unknown'}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {number && `#${number}`} {position && `• ${position}`}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No player data available.</div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="away" className="space-y-4">
                      {teamsExtra.away && (
                        <div className="rounded-lg border p-4 space-y-3">
                          <div className="flex items-center gap-3 mb-4">
                            <Avatar className="w-12 h-12 border-2 border-border/40 shadow-sm">
                              {match.awayTeamLogo ? (
                                <AvatarImage src={match.awayTeamLogo} alt={match.awayTeam} />
                              ) : (
                                <AvatarFallback className="text-lg font-semibold">
                                  {match.awayTeam.substring(0, 2).toUpperCase()}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <h4 className="font-semibold text-lg">{match.awayTeam}</h4>
                          </div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            {(() => {
                              const teamRecord = teamsExtra.away as Record<string, unknown>;
                              const info = [
                                { label: "Founded", value: pickString(teamRecord, ["team_founded", "intFormedYear"]) },
                                { label: "Stadium", value: pickString(teamRecord, ["team_venue", "strStadium"]) },
                                { label: "Manager", value: pickString(teamRecord, ["team_manager", "strManager"]) },
                                { label: "Country", value: pickString(teamRecord, ["team_country", "strCountry"]) },
                              ].filter(item => item.value);
                              return info.map(item => (
                                <div key={item.label}>
                                  <div className="text-muted-foreground">{item.label}</div>
                                  <div className="font-medium">{item.value}</div>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>
                      )}
                      
                      <div className="rounded-lg border p-4">
                        <h4 className="font-semibold mb-3">Players</h4>
                        {playersExtra.away.length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {playersExtra.away.map((player, idx) => {
                              const playerRecord = player as Record<string, unknown>;
                              const name = pickString(playerRecord, ["player_name", "strPlayer", "name"]);
                              const position = pickString(playerRecord, ["player_type", "strPosition", "position"]);
                              const number = pickString(playerRecord, ["player_number", "strNumber", "number"]);
                              return (
                                <div key={idx} className="rounded border p-3 space-y-1">
                                  <div className="font-medium text-sm">{name || 'Unknown'}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {number && `#${number}`} {position && `• ${position}`}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">No player data available.</div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            {plan !== "pro" ? (
              <Card>
                <CardContent className="py-16">
                  <div className="flex flex-col items-center text-center space-y-4 max-w-sm mx-auto">
                    <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <Image
                        src="/logo/chatbot.svg"
                        alt="Analytics Locked"
                        width={32}
                        height={32}
                        className="h-8 w-8"
                      />
                    </div>
                    <h3 className="text-xl font-bold">Upgrade to view analytics</h3>
                    <p className="text-sm text-muted-foreground">
                      Start a 7-day free trial of Sports Analysis Pro to unlock our AI assistant for game plans, stats, and predictions.
                    </p>
                    <Button asChild className="mt-2">
                      <Link href="/pro">Upgrade to Pro</Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : extrasLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="text-sm text-muted-foreground">Loading analysis data...</div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle>Match Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="odds" className="space-y-4">
                    <TabsList className="grid grid-cols-3 w-full max-w-md">
                      <TabsTrigger value="odds">Odds</TabsTrigger>
                      <TabsTrigger value="form">Form</TabsTrigger>
                      <TabsTrigger value="h2h">H2H</TabsTrigger>
                    </TabsList>

                    <TabsContent value="odds" className="space-y-4">
                      {oddsExtra.listed.length > 0 || oddsExtra.live.length > 0 ? (
                        <div className="space-y-4">
                          {oddsExtra.listed.length > 0 && (
                            <div className="rounded-lg border p-4">
                              <h4 className="font-semibold mb-3">Listed Odds</h4>
                              <div className="space-y-2">
                                {oddsExtra.listed.map((odd, idx) => {
                                  const oddRecord = odd as Record<string, unknown>;
                                  const bookmaker = pickString(oddRecord, ["bookmaker", "name"]);
                                  const home = pickString(oddRecord, ["home", "homeOdds"]);
                                  const draw = pickString(oddRecord, ["draw", "drawOdds"]);
                                  const away = pickString(oddRecord, ["away", "awayOdds"]);
                                  return (
                                    <div key={idx} className="flex items-center justify-between rounded border p-3 text-sm">
                                      <span className="font-medium">{bookmaker || `Bookmaker ${idx + 1}`}</span>
                                      <div className="flex gap-4">
                                        <span>H: {home || '-'}</span>
                                        <span>D: {draw || '-'}</span>
                                        <span>A: {away || '-'}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {oddsExtra.live.length > 0 && (
                            <div className="rounded-lg border p-4">
                              <h4 className="font-semibold mb-3">Live Odds</h4>
                              <div className="space-y-2">
                                {oddsExtra.live.map((odd, idx) => {
                                  const oddRecord = odd as Record<string, unknown>;
                                  const bookmaker = pickString(oddRecord, ["bookmaker", "name"]);
                                  const home = pickString(oddRecord, ["home", "homeOdds"]);
                                  const draw = pickString(oddRecord, ["draw", "drawOdds"]);
                                  const away = pickString(oddRecord, ["away", "awayOdds"]);
                                  return (
                                    <div key={idx} className="flex items-center justify-between rounded border p-3 text-sm">
                                      <span className="font-medium">{bookmaker || `Bookmaker ${idx + 1}`}</span>
                                      <div className="flex gap-4">
                                        <span>H: {home || '-'}</span>
                                        <span>D: {draw || '-'}</span>
                                        <span>A: {away || '-'}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No odds data available.</div>
                      )}
                    </TabsContent>

                    <TabsContent value="form" className="space-y-4">
                      {analysisForm ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Home Team Form */}
                          <div className="rounded-xl border bg-background/80 dark:bg-background/60 shadow p-6 flex flex-col gap-4">
                            <div className="flex items-center gap-3 mb-2">
                              <Avatar className="w-10 h-10 border object-contain bg-white dark:bg-zinc-900">
                                {match.homeTeamLogo ? (
                                  <AvatarImage src={match.homeTeamLogo} alt={String(analysisForm.home_team?.name || match.homeTeam)} />
                                ) : (
                                  <AvatarFallback className="bg-muted/40 border border-muted/50 font-bold text-lg text-primary dark:bg-zinc-800 dark:text-zinc-100">
                                    {String(analysisForm.home_team?.name || match.homeTeam).substring(0,2).toUpperCase()}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <h4 className="font-semibold text-lg dark:text-zinc-100">{String(analysisForm.home_team?.name || match.homeTeam)}</h4>
                            </div>
                            <div className="mb-2 text-base font-semibold text-primary/90 dark:text-primary">{analysisForm.home_team?.summary || ''}</div>
                            <div className="flex gap-1 mb-2">
                              {Array.isArray(analysisForm.home_metrics?.last_results) && analysisForm.home_metrics.last_results.length > 0 ? (
                                (analysisForm.home_metrics.last_results as unknown[])
                                  .filter((result): result is string => typeof result === 'string')
                                  .map((result, idx) => (
                                    <span key={idx} className={`px-2 py-1 rounded font-bold text-xs shadow border transition-colors ${
                                      result === 'W' ? 'bg-green-200 text-green-900 border-green-400 dark:bg-green-900 dark:text-green-100 dark:border-green-700' :
                                      result === 'L' ? 'bg-red-200 text-red-900 border-red-400 dark:bg-red-900 dark:text-red-100 dark:border-red-700' :
                                      result === 'D' ? 'bg-gray-300 text-gray-900 border-gray-400 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500' :
                                      'bg-gray-200 text-gray-900 border-gray-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700'
                                    }`}>{result}</span>
                                  ))
                              ) : (
                                <span className="text-sm text-muted-foreground">No recent results</span>
                              )}
                            </div>
                            <table className="w-full text-sm mb-2 border-separate border-spacing-y-1">
                              <tbody>
                                <tr className="border-b border-muted dark:border-zinc-700"><td className="text-muted-foreground">Games</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.home_metrics?.games ?? '—')}</td></tr>
                                <tr className="border-b border-muted dark:border-zinc-700"><td className="text-muted-foreground">Wins / Draws / Losses</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.home_metrics?.wins ?? '—')} / {String(analysisForm.home_metrics?.draws ?? '—')} / {String(analysisForm.home_metrics?.losses ?? '—')}</td></tr>
                                <tr className="border-b border-muted dark:border-zinc-700"><td className="text-muted-foreground">Goals For / Against</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.home_metrics?.gf ?? '—')} / {String(analysisForm.home_metrics?.ga ?? '—')}</td></tr>
                                <tr><td className="text-muted-foreground">Goal Difference</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.home_metrics?.gd ?? '—')}</td></tr>
                              </tbody>
                            </table>
                          </div>
                          {/* Away Team Form */}
                          <div className="rounded-xl border bg-background/80 dark:bg-background/60 shadow p-6 flex flex-col gap-4">
                            <div className="flex items-center gap-3 mb-2">
                              <Avatar className="w-10 h-10 border object-contain bg-white dark:bg-zinc-900">
                                {match.awayTeamLogo ? (
                                  <AvatarImage src={match.awayTeamLogo} alt={String(analysisForm.away_team?.name || match.awayTeam)} />
                                ) : (
                                  <AvatarFallback className="bg-muted/40 border border-muted/50 font-bold text-lg text-primary dark:bg-zinc-800 dark:text-zinc-100">
                                    {String(analysisForm.away_team?.name || match.awayTeam).substring(0,2).toUpperCase()}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                              <h4 className="font-semibold text-lg dark:text-zinc-100">{String(analysisForm.away_team?.name || match.awayTeam)}</h4>
                            </div>
                            <div className="mb-2 text-base font-semibold text-primary/90 dark:text-primary">{analysisForm.away_team?.summary || ''}</div>
                            <div className="flex gap-1 mb-2">
                              {Array.isArray(analysisForm.away_metrics?.last_results) && analysisForm.away_metrics.last_results.length > 0 ? (
                                (analysisForm.away_metrics.last_results as unknown[])
                                  .filter((result): result is string => typeof result === 'string')
                                  .map((result, idx) => (
                                    <span key={idx} className={`px-2 py-1 rounded font-bold text-xs shadow border transition-colors ${
                                      result === 'W' ? 'bg-green-200 text-green-900 border-green-400 dark:bg-green-900 dark:text-green-100 dark:border-green-700' :
                                      result === 'L' ? 'bg-red-200 text-red-900 border-red-400 dark:bg-red-900 dark:text-red-100 dark:border-red-700' :
                                      result === 'D' ? 'bg-gray-300 text-gray-900 border-gray-400 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500' :
                                      'bg-gray-200 text-gray-900 border-gray-300 dark:bg-gray-900 dark:text-gray-100 dark:border-gray-700'
                                    }`}>{result}</span>
                                  ))
                              ) : (
                                <span className="text-sm text-muted-foreground">No recent results</span>
                              )}
                            </div>
                            <table className="w-full text-sm mb-2 border-separate border-spacing-y-1">
                              <tbody>
                                <tr className="border-b border-muted dark:border-zinc-700"><td className="text-muted-foreground">Games</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.away_metrics?.games ?? '—')}</td></tr>
                                <tr className="border-b border-muted dark:border-zinc-700"><td className="text-muted-foreground">Wins / Draws / Losses</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.away_metrics?.wins ?? '—')} / {String(analysisForm.away_metrics?.draws ?? '—')} / {String(analysisForm.away_metrics?.losses ?? '—')}</td></tr>
                                <tr className="border-b border-muted dark:border-zinc-700"><td className="text-muted-foreground">Goals For / Against</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.away_metrics?.gf ?? '—')} / {String(analysisForm.away_metrics?.ga ?? '—')}</td></tr>
                                <tr><td className="text-muted-foreground">Goal Difference</td><td className="font-semibold text-right dark:text-zinc-100">{String(analysisForm.away_metrics?.gd ?? '—')}</td></tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No form data available.</div>
                      )}
                    </TabsContent>

                    <TabsContent value="h2h" className="space-y-4">
                      {h2hExtra && h2hExtra.matches.length > 0 ? (
                        <div className="rounded-lg border p-4">
                          <h4 className="font-semibold mb-3">Head to Head</h4>
                          <div className="space-y-2">
                            {h2hExtra.matches.map((match_item, idx) => {
                              const matchRecord = match_item as Record<string, unknown>;
                              const home = pickString(matchRecord, ["home_team", "homeTeam", "home"]);
                              const away = pickString(matchRecord, ["away_team", "awayTeam", "away"]);
                              const homeScore = pickString(matchRecord, ["home_score", "homeScore"]);
                              const awayScore = pickString(matchRecord, ["away_score", "awayScore"]);
                              const date = pickString(matchRecord, ["date", "match_date"]);
                              return (
                                <div key={idx} className="flex items-center justify-between rounded border p-3 text-sm">
                                  <span className="flex-1">{home || 'Home'}</span>
                                  <span className="font-bold px-3">{homeScore || '0'} - {awayScore || '0'}</span>
                                  <span className="flex-1 text-right">{away || 'Away'}</span>
                                  {date && <span className="text-xs text-muted-foreground ml-3">{date}</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">No head-to-head data available.</div>
                      )}
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function isFulfilled<T>(result: PromiseSettledResult<T>): result is PromiseFulfilledResult<T> {
  return result.status === "fulfilled";
}

function toDataObjectArray(value: unknown): DataObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === "object") as DataObject[];
}

function parseTeamResponse(res: Awaited<ReturnType<typeof getTeam>> | null): DataObject | null {
  if (!res) return null;
  const candidates = [res.data, (res as unknown as Record<string, unknown>).teams, res];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate) && candidate.length) return candidate[0] as DataObject;
    if (typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      if (Array.isArray(record.teams) && record.teams.length) return record.teams[0] as DataObject;
      if (Array.isArray(record.team) && record.team.length) return record.team[0] as DataObject;
      return candidate as DataObject;
    }
  }
  return null;
}

function parsePlayersResponse(res: Awaited<ReturnType<typeof listTeamPlayers>> | null): DataObject[] {
  if (!res) return [];
  const record = res as Record<string, unknown>;
  const sources = [
    record.data,
    record.result,
    record.results,
    record.players,
    res,
  ];
  for (const source of sources) {
    if (!source) continue;
    if (Array.isArray(source) && source.length) return toDataObjectArray(source);
    if (typeof source === "object") {
      const inner = source as Record<string, unknown>;
      if (Array.isArray(inner.players) && inner.players.length) return toDataObjectArray(inner.players);
      if (Array.isArray(inner.result) && inner.result.length) return toDataObjectArray(inner.result);
      if (Array.isArray(inner.results) && inner.results.length) return toDataObjectArray(inner.results);
    }
  }
  return [];
}

function parseOddsResponse(res: { data?: unknown } | null): DataObject[] {
  if (!res) return [];
  const data = res.data;
  if (!data) return [];
  if (Array.isArray(data)) return toDataObjectArray(data);
  if (typeof data === "object") {
    const record = data as Record<string, unknown>;
    if (Array.isArray(record.odds)) return toDataObjectArray(record.odds);
    if (Array.isArray(record.result)) return toDataObjectArray(record.result);
    if (Array.isArray(record.results)) return toDataObjectArray(record.results);
  }
  return [];
}

// parseFormResponse removed (unused)

function parseH2HResponse(res: unknown): { matches: DataObject[] } | null {
  if (!res || typeof res !== "object") return null;
  const record = res as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const matches = toDataObjectArray(data.matches ?? data.results ?? data.games ?? []);
  if (!matches.length) return null;
  return { matches };
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
