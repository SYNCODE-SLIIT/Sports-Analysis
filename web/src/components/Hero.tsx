"use client";

import { useCallback, useMemo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Play, Calendar, Clock, Loader2, MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { useTheme } from "next-themes";
import { useAuth } from "@/components/AuthProvider";
import { useRecommendations } from "@/hooks/useRecommendations";
import { getEventAllSports, getEventResults, getTeam } from "@/lib/collect";

type AnyRecord = Record<string, unknown>;

type FeaturedMatch = {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
  homeScore?: number;
  awayScore?: number;
  league?: string;
  status?: string;
  venue?: string;
  kickoffIso?: string;
  dateLabel?: string;
  timeLabel?: string;
  winProb?: {
    home?: number;
    draw?: number;
    away?: number;
  };
};

type RecItem = {
  item_id: string;
  score?: number | null;
  reason?: string | null;
  item?: AnyRecord | null;
};

const sanitizeLogoUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lowered = trimmed.toLowerCase();
  if (["null", "undefined", "n/a", "none"].includes(lowered)) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return trimmed;
};

const getPathVal = (source: unknown, path: string): unknown => {
  if (!source || typeof source !== "object") return undefined;
  const segments = path.split(".");
  let cursor: unknown = source;
  for (const key of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as AnyRecord)[key];
  }
  return cursor;
};

const pickString = (source: AnyRecord | null | undefined, keys: string[], fallback?: string): string | undefined => {
  if (!source) return fallback;
  for (const key of keys) {
    const raw = key.includes(".") ? getPathVal(source, key) : (source as AnyRecord)[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return fallback;
};

const pickNumber = (source: AnyRecord | null | undefined, keys: string[]): number | undefined => {
  if (!source) return undefined;
  for (const key of keys) {
    const raw = key.includes(".") ? getPathVal(source, key) : (source as AnyRecord)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const cleaned = raw.replace(/[^0-9.+-]/g, "").trim();
      if (!cleaned) continue;
      const parsed = Number.parseFloat(cleaned);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return undefined;
};

const extractLogoFromObject = (source: AnyRecord | null | undefined): string | undefined => {
  if (!source) return undefined;
  const keys = [
    "team_logo",
    "team_logo_url",
    "team_badge",
    "logo",
    "badge",
    "crest",
    "image",
    "thumbnail",
    "thumb",
    "emblem",
    "shield",
    "strTeamBadge",
    "strTeamLogo",
    "logo_path",
    "logo_url",
    "badge_url",
  ];
  for (const key of keys) {
    const logo = sanitizeLogoUrl((source as AnyRecord)[key]);
    if (logo) return logo;
  }
  const mediaKeys = ["media", "images", "logos", "thumbnails"];
  for (const key of mediaKeys) {
    const collection = (source as AnyRecord)[key];
    if (!Array.isArray(collection)) continue;
    for (const entry of collection) {
      const direct = sanitizeLogoUrl(entry);
      if (direct) return direct;
      if (entry && typeof entry === "object") {
        const nested =
          sanitizeLogoUrl((entry as AnyRecord).url) ??
          sanitizeLogoUrl((entry as AnyRecord).src) ??
          sanitizeLogoUrl((entry as AnyRecord).image) ??
          sanitizeLogoUrl((entry as AnyRecord).path);
        if (nested) return nested;
      }
    }
  }
  return undefined;
};

const pickLogo = (source: AnyRecord | null | undefined, side: "home" | "away"): string | undefined => {
  if (!source) return undefined;
  const prefix = side === "home" ? "home" : "away";
  const keys = [
    `${prefix}_team_logo`,
    `${prefix}TeamLogo`,
    `${prefix}_logo`,
    `${prefix}_badge`,
    `${prefix}Badge`,
    `${prefix}_team_badge`,
    `${prefix}_crest`,
    `${prefix}_image`,
    `team_${prefix}_badge`,
    `str${side === "home" ? "Home" : "Away"}TeamBadge`,
    `str${side === "home" ? "Home" : "Away"}TeamLogo`,
    `${prefix}BadgeWide`,
  ];
  for (const key of keys) {
    const logo = sanitizeLogoUrl((source as AnyRecord)[key]);
    if (logo) return logo;
  }
  const teamObj = (source as AnyRecord)[`${prefix}_team`];
  if (teamObj && typeof teamObj === "object") {
    const nestedLogo = extractLogoFromObject(teamObj as AnyRecord);
    if (nestedLogo) return nestedLogo;
  }
  return undefined;
};

const findEventObject = (payload: unknown): AnyRecord | null => {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as AnyRecord;
  const direct = record.event;
  if (direct && typeof direct === "object") return direct as AnyRecord;
  const result = record.result;
  if (Array.isArray(result) && result.length && typeof result[0] === "object") return result[0] as AnyRecord;
  const events = record.events;
  if (Array.isArray(events) && events.length && typeof events[0] === "object") return events[0] as AnyRecord;
  const data = record.data;
  if (data && typeof data === "object") {
    const nested = findEventObject(data);
    if (nested) return nested;
  }
  const keys = Object.keys(record);
  if (keys.some(key => /event_|home_|away_|league|fixture|match/i.test(key))) {
    return record;
  }
  return null;
};

const parseDateTimeIso = (dateValue?: string, timeValue?: string): string | undefined => {
  const candidates: string[] = [];
  if (dateValue && dateValue.trim()) {
    const trimmed = dateValue.trim();
    if (trimmed.includes("T")) {
      candidates.push(trimmed);
    } else if (timeValue && timeValue.trim()) {
      const normalizedTime = timeValue.trim().length === 5 ? `${timeValue.trim()}:00` : timeValue.trim();
      candidates.push(`${trimmed}T${normalizedTime}`);
      candidates.push(`${trimmed} ${normalizedTime}`);
    } else {
      candidates.push(trimmed);
    }
  }
  if (timeValue && timeValue.trim()) {
    candidates.push(timeValue.trim());
  }
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return undefined;
};

const extractWinProbabilities = (source: AnyRecord | null | undefined): FeaturedMatch["winProb"] => {
  if (!source) return undefined;
  const container = (source.winProbabilities ?? source.winprob) as AnyRecord | undefined;
  if (!container || typeof container !== "object") return undefined;
  const toNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number.parseFloat(value.trim());
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  };
  const home = toNumber((container as AnyRecord).home);
  const draw = toNumber((container as AnyRecord).draw);
  const away = toNumber((container as AnyRecord).away);
  if (home === undefined && draw === undefined && away === undefined) return undefined;
  return { home, draw, away };
};

const initialsFromName = (value: string): string =>
  value
    .split(" ")
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";

const isMatchRecommendation = (rec: RecItem): boolean => {
  if (!rec) return false;
  const item = rec.item;
  if (item && typeof item === "object") {
    const kindCandidate = (item.kind ?? (typeof item.data === "object" ? (item.data as AnyRecord).kind : undefined)) as string | undefined;
    if (typeof kindCandidate === "string" && kindCandidate.toLowerCase() === "match") return true;
    const data = item.data as AnyRecord | undefined;
    if (data && typeof data === "object") {
      const dataKind = data.kind;
      if (typeof dataKind === "string" && dataKind.toLowerCase() === "match") return true;
      const eventId = (data.event_id ?? data.eventId ?? data.fixture_id ?? data.match_id) as string | undefined;
      if (eventId && eventId.trim()) return true;
    }
    const direct = (item.event_id ?? item.eventId) as string | undefined;
    if (direct && direct.trim()) return true;
  }
  return false;
};

const extractEventId = (rec: RecItem | null): string | undefined => {
  if (!rec) return undefined;
  const item = rec.item;
  const tryString = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value.trim() : undefined);
  if (item && typeof item === "object") {
    const data = item.data as AnyRecord | undefined;
    const fromData = data && (tryString(data.event_id) ?? tryString(data.eventId) ?? tryString(data.fixture_id) ?? tryString(data.match_id));
    if (fromData) return fromData;
    const direct = tryString((item as AnyRecord).event_id) ?? tryString((item as AnyRecord).eventId);
    if (direct) return direct;
  }
  return tryString(rec.item_id);
};

const fetchTeamLogo = async (teamName: string): Promise<string | undefined> => {
  if (!teamName) return undefined;
  try {
    const resp = await getTeam(teamName);
    const data = resp.data as AnyRecord | undefined;
    if (!data || typeof data !== "object") return undefined;
    const primary = (data.team ?? (Array.isArray(data.teams) ? data.teams[0] : undefined)) as AnyRecord | undefined;
    return extractLogoFromObject(primary);
  } catch {
    return undefined;
  }
};

const normalizeEvent = (record: AnyRecord, fallbackId: string): FeaturedMatch => {
  const eventId = pickString(record, ["eventId", "event_id", "event_key", "id", "match_id", "fixture_id"], fallbackId) ?? fallbackId;
  const homeTeam = pickString(record, ["homeTeam", "home_team", "event_home_team", "strHomeTeam", "home"], "Home") ?? "Home";
  const awayTeam = pickString(record, ["awayTeam", "away_team", "event_away_team", "strAwayTeam", "away"], "Away") ?? "Away";
  const homeScore = pickNumber(record, ["homeScore", "home_score", "score_home", "intHomeScore", "event_final_result_home"]);
  const awayScore = pickNumber(record, ["awayScore", "away_score", "score_away", "intAwayScore", "event_final_result_away"]);
  const league = pickString(record, ["league", "league_name", "competition", "tournament"]);
  const rawStatus = pickString(record, ["status", "event_status", "match_status"]);
  const status = rawStatus ? rawStatus.replace(/\s+/g, " ").trim() : undefined;
  const venue = pickString(record, ["venue", "stadium", "location", "strVenue"]);
  const dateLabel = pickString(record, ["datetime", "kickoff", "event_date", "date"]);
  const timeLabel = pickString(record, ["time", "event_time", "match_time", "strTime"]);
  const kickoffIso = parseDateTimeIso(dateLabel, timeLabel);
  const homeLogo = pickLogo(record, "home");
  const awayLogo = pickLogo(record, "away");
  const winProb = extractWinProbabilities(record);

  return {
    eventId,
    homeTeam,
    awayTeam,
    homeLogo,
    awayLogo,
    homeScore,
    awayScore,
    league,
    status,
    venue,
    kickoffIso,
    dateLabel,
    timeLabel,
    winProb,
  };
};

const resolveFeaturedMatch = async (eventId: string): Promise<FeaturedMatch> => {
  let match: FeaturedMatch | null = null;
  try {
    const env = await getEventAllSports(eventId, { augmentTags: true, includeBest: false });
    const payload = findEventObject(env.data);
    if (payload) {
      match = normalizeEvent(payload, eventId);
    }
  } catch {
    // ignore primary fetch failure
  }

  if (!match) {
    try {
      const env = await getEventResults(eventId);
      const payload = findEventObject(env.data);
      if (payload) {
        match = normalizeEvent(payload, eventId);
      }
    } catch {
      // ignore fallback failure
    }
  }

  if (!match) {
    throw new Error("Could not load featured match");
  }

  const [homeLogo, awayLogo] = await Promise.all([
    match.homeLogo ? Promise.resolve(match.homeLogo) : fetchTeamLogo(match.homeTeam),
    match.awayLogo ? Promise.resolve(match.awayLogo) : fetchTeamLogo(match.awayTeam),
  ]);

  return {
    ...match,
    homeLogo: homeLogo ?? match.homeLogo,
    awayLogo: awayLogo ?? match.awayLogo,
  };
};

function useFeaturedMatch(eventId?: string) {
  return useQuery<FeaturedMatch>({
    queryKey: ["hero-featured-match", eventId],
    enabled: !!eventId,
    staleTime: 60_000,
    queryFn: () => resolveFeaturedMatch(eventId!),
  });
}

const formatKickoff = (match: FeaturedMatch): { date: string; time: string } => {
  if (match.kickoffIso) {
    const dt = new Date(match.kickoffIso);
    if (!Number.isNaN(dt.getTime())) {
      return {
        date: dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
        time: dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
      };
    }
  }
  return {
    date: match.dateLabel ?? "Date TBC",
    time: match.timeLabel ?? "Time TBC",
  };
};

type TeamColumnProps = {
  side: "home" | "away";
  name: string;
  logo?: string;
};

function TeamColumn({ side, name, logo }: TeamColumnProps) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <Avatar className="h-14 w-14 border border-border/40 bg-background/80 shadow-sm">
        {logo ? <AvatarImage src={logo} alt={`${name} logo`} /> : <AvatarFallback>{initialsFromName(name)}</AvatarFallback>}
      </Avatar>
      <div className="space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {side === "home" ? "Home" : "Away"}
        </div>
        <div className="max-w-[8rem] truncate text-sm font-semibold text-foreground">{name}</div>
      </div>
    </div>
  );
}

const textVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0 },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.2,
      delayChildren: 0.3,
    },
  },
};

export function Hero() {
  const router = useRouter();
  const { supabase, user, bumpInteractions } = useAuth();
  const { data: recsData, isLoading: recsLoading } = useRecommendations();

  const matchRecommendation = useMemo(() => {
    const items = recsData?.items;
    if (!items || !items.length) return undefined;
    const ranked = [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return ranked.find(isMatchRecommendation) ?? ranked.find(rec => extractEventId(rec as RecItem) !== undefined);
  }, [recsData]);

  const eventId = extractEventId(matchRecommendation ?? null);

  const fallbackMatch = useMemo(() => {
    if (!matchRecommendation?.item) return undefined;
    const candidate = findEventObject(matchRecommendation.item) ?? (matchRecommendation.item as AnyRecord);
    if (!candidate) return undefined;
    return normalizeEvent(candidate, eventId ?? matchRecommendation.item_id);
  }, [matchRecommendation, eventId]);

  const { data: featuredMatch, isLoading: featuredLoading, isError: featuredError } = useFeaturedMatch(eventId);

  const match = featuredMatch ?? fallbackMatch;
  const kickoff = match ? formatKickoff(match) : { date: "Date TBC", time: "Time TBC" };
  const isLoading = recsLoading || (eventId ? featuredLoading : false);
  const hasError = Boolean(eventId && featuredError);
  const reason = matchRecommendation?.reason ?? undefined;
  const recScore = matchRecommendation?.score ?? undefined;

  const handleViewAnalysis = useCallback(() => {
    if (!match || !eventId) return;
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem("sa_selected_event_card", JSON.stringify(match));
      } catch {}
    }
    if (user && supabase) {
      void (async () => {
        try {
          const title = `${match.homeTeam} vs ${match.awayTeam}`;
          const teams = [match.homeTeam, match.awayTeam].filter(Boolean);
          const { data: itemId } = await supabase.rpc("ensure_match_item", {
            p_event_id: eventId,
            p_title: title,
            p_teams: teams,
            p_league: match.league ?? null,
            p_popularity: recScore ?? 0,
          });
          if (itemId) {
            await supabase.from("user_interactions").insert({ user_id: user.id, item_id: itemId, event: "click" });
            try {
              bumpInteractions();
            } catch {}
          }
        } catch {}
      })();
    }
    router.push(`/match/${encodeURIComponent(eventId)}?sid=hero`);
  }, [match, eventId, user, supabase, recScore, router, bumpInteractions]);

  const formatProbability = (value?: number) => {
    if (value === undefined) return undefined;
    const normalized = value > 1 ? value : value * 100;
    if (!Number.isFinite(normalized)) return undefined;
    return Math.round(normalized);
  };

  const hasScore = typeof match?.homeScore === "number" && typeof match?.awayScore === "number";

  const renderCardBody = () => {
    if (isLoading) {
      return (
        <div className="flex h-72 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm font-medium">Finding a match just for you...</p>
        </div>
      );
    }

    if (!match) {
      return (
        <div className="flex h-72 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <Sparkles className="h-6 w-6" />
          <p className="text-sm font-medium">Sign in to unlock personalized featured matches.</p>
        </div>
      );
    }

    return (
      <>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="secondary" className="w-fit px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
              Personalized pick
            </Badge>
            {match.league && <div className="text-sm font-semibold text-foreground">{match.league}</div>}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {kickoff.date}
              </span>
              <span className="text-muted-foreground/50">•</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {kickoff.time}
              </span>
            </div>
          </div>
          {match.status && (
            <Badge
              variant={match.status.toLowerCase().includes("live") ? "destructive" : "outline"}
              className="text-xs"
            >
              {match.status.toUpperCase()}
            </Badge>
          )}
        </div>

        {reason && (
          <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="line-clamp-2">{reason}</span>
          </div>
        )}

        <div className="grid grid-cols-3 items-center gap-4 rounded-2xl border border-border/50 bg-background/70 p-4 shadow-inner backdrop-blur">
          <TeamColumn side="home" name={match.homeTeam} logo={match.homeLogo} />
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted/60 px-4 py-3 text-center shadow">
            {hasScore ? (
              <div className="text-2xl font-bold tracking-tight">
                <span>{match.homeScore}</span>
                <span className="mx-1 text-muted-foreground">-</span>
                <span>{match.awayScore}</span>
              </div>
            ) : (
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">vs</div>
            )}
            {match.status && (
              <div className="text-[10px] font-semibold uppercase text-muted-foreground/80">
                {match.status.toUpperCase()}
              </div>
            )}
          </div>
          <TeamColumn side="away" name={match.awayTeam} logo={match.awayLogo} />
        </div>

        {match.venue && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span className="truncate">{match.venue}</span>
          </div>
        )}

        {match.winProb && (
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Win probability</div>
            <div className="space-y-1 text-xs">
              {formatProbability(match.winProb.home) !== undefined && (
                <div className="flex justify-between">
                  <span>Home</span>
                  <span className="font-semibold">{formatProbability(match.winProb.home)}%</span>
                </div>
              )}
              {formatProbability(match.winProb.draw) !== undefined && (
                <div className="flex justify-between">
                  <span>Draw</span>
                  <span className="font-semibold">{formatProbability(match.winProb.draw)}%</span>
                </div>
              )}
              {formatProbability(match.winProb.away) !== undefined && (
                <div className="flex justify-between">
                  <span>Away</span>
                  <span className="font-semibold">{formatProbability(match.winProb.away)}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Only render theme-dependent banner and overlays after mount
  let bannerSrc = "/banner.jpg";
  if (mounted) {
    bannerSrc = resolvedTheme === "light" ? "/banner_light.png" : "/banner.jpg";
  }
  return (
    <section className="relative flex min-h-[90vh] items-center overflow-hidden">
      <div className="absolute inset-0 z-0">
        <Image src={bannerSrc} alt="Football stadium background" fill className="object-cover" priority />
        {/* Overlay: Only show overlays after mount to avoid hydration mismatch */}
        {mounted && (
          resolvedTheme === "dark" ? (
            <>
              <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/60 to-background/20" />
              <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent" />
            </>
          ) : (
            <div className="absolute left-0 top-0 bottom-0 w-1/2 bg-white/70" style={{ pointerEvents: "none" }} />
          )
        )}
      </div>

      <div className="container relative z-10">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-8">
            <motion.div variants={textVariants} className="space-y-4">
              <h1 className="text-4xl font-bold leading-tight md:text-6xl">
                <span className="block">Live Football</span>
                <span className="block text-gradient">Analytics & Insights</span>
              </h1>
              <p
                className={
                  `max-w-lg text-lg ${resolvedTheme === 'light' ? 'text-zinc-700' : 'text-muted-foreground'}`
                }
              >
                Dive into tailored match analysis, real-time probabilities, and stories curated around the clubs and leagues you care about most.
              </p>
            </motion.div>

            <motion.div variants={textVariants} className="flex flex-col gap-4 sm:flex-row">
              <Button size="lg" asChild className="group">
                <Link href="/live">
                  <Play className="mr-2 h-4 w-4 transition-transform group-hover:scale-110" />
                  Explore Live
                  <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href="/leagues">Browse Leagues</Link>
              </Button>
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="hidden justify-center lg:flex"
          >
                <div className="w-full max-w-md">
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={match ? `${match.homeTeam} vs ${match.awayTeam} - View details` : "Featured match - view details"}
                    onClick={() => {
                      if (eventId && !isLoading && !hasError) {
                        handleViewAnalysis();
                      }
                    }}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && eventId && !isLoading && !hasError) {
                        e.preventDefault();
                        handleViewAnalysis();
                      }
                    }}
                    className="group relative cursor-pointer overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background/80 to-muted/40 shadow-xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
                  >
                    <Card className="pointer-events-none bg-transparent shadow-none">
                      <CardContent className="relative flex flex-col gap-6 p-6 pointer-events-none">
                        {renderCardBody()}
                        {hasError && (
                          <p className="text-xs text-destructive/80">
                            We could not load the latest details. Try again soon.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}