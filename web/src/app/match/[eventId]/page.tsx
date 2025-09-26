"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Calendar, MapPin, Users, Trophy, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HighlightsCarousel } from "@/components/HighlightsCarousel";
import Timeline from "@/components/match/Timeline";
import BestPlayerCard from "@/components/match/BestPlayerCard";
import LeadersCard from "@/components/match/LeadersCard";
import MatchSummaryCard from "@/components/match/MatchSummaryCard";
import MatchExtrasTabs, { type MatchExtrasTabsProps } from "@/components/match/MatchExtrasTabs";
import { buildTimeline, computeLeaders, computeBestPlayer } from "@/lib/match-mappers";
import type { TLItem } from "@/lib/match-mappers";
import {
  getEventResults,
  getHighlights,
  DataObject,
  searchEventHighlight,
  getComments,
  getLeagueTable,
  postCollect,
  getTeam,
  listTeamPlayers,
  listSeasons,
  getForm,
  getH2HByTeams,
} from "@/lib/collect";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type TeamSideValue = { home?: number; away?: number };
type MatchStats = {
  possession?: TeamSideValue;
  shots?: TeamSideValue;
  shotsOnTarget?: TeamSideValue;
  corners?: TeamSideValue;
  fouls?: TeamSideValue;
  yellowCards?: TeamSideValue;
  redCards?: TeamSideValue;
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

export default function MatchPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const sid = searchParams?.get("sid") ?? "card";

  const [event, setEvent] = useState<RenderEvent | null>(null);
  const [highlights, setHighlights] = useState<Array<{ id: string; title?: string; url?: string; thumbnail?: string; provider?: string; duration?: number }>>([]);
  const [ehsQuery, setEhsQuery] = useState({ minute: "", player: "", event_type: "" });
  const [ehsLoading, setEhsLoading] = useState(false);
  type ScrapedLink = { url?: string; title?: string; videoId?: string };
  const [ehsResults, setEhsResults] = useState<ScrapedLink[]>([]);
  const [comments, setComments] = useState<Array<{ time?: string; text?: string; author?: string }>>([]);
  const [table, setTable] = useState<Array<{ position?: number; team?: string; played?: number; points?: number }>>([]);
  const [eventRaw, setEventRaw] = useState<DataObject | null>(null);
  const [timeline, setTimeline] = useState<TLItem[]>([]);
  const [leaders, setLeaders] = useState<ReturnType<typeof computeLeaders> | null>(null);
  const [best, setBest] = useState<{ name: string; score?: number } | null>(null);
  const [winProbDisplay, setWinProbDisplay] = useState<{ home: number; draw: number; away: number }>({ home: 0, draw: 0, away: 0 });
  const [teamsExtra, setTeamsExtra] = useState<{ home: DataObject | null; away: DataObject | null }>({ home: null, away: null });
  const [playersExtra, setPlayersExtra] = useState<{ home: DataObject[]; away: DataObject[] }>({ home: [], away: [] });
  const [oddsExtra, setOddsExtra] = useState<{ listed: DataObject[]; live: DataObject[] }>({ listed: [], live: [] });
  const [formExtra, setFormExtra] = useState<{ home: unknown[]; away: unknown[] }>({ home: [], away: [] });
  const [seasonsExtra, setSeasonsExtra] = useState<DataObject[]>([]);
  const [h2hExtra, setH2hExtra] = useState<{ matches: DataObject[] } | null>(null);
  const [extrasErrors, setExtrasErrors] = useState<NonNullable<MatchExtrasTabsProps["errors"]>>({});
  const [extrasLoading, setExtrasLoading] = useState(false);

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
            winProbabilities: (raw['winProbabilities'] || raw['winprob']) as RenderEvent['winProbabilities'],
            stats: (raw['stats'] as MatchStats) || undefined,
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
    getEventResults(String(eventId)).then(env => {
      if (!active) return;
      const d = env.data as { event?: DataObject } | DataObject;
      const core = (d && typeof d === 'object' && 'event' in d) ? (d as { event?: DataObject }).event : (d as DataObject);
      if (!core) return;
      const coreObj = core as DataObject;
      const normalized: RenderEvent = {
        eventId: getString(coreObj, ['eventId', 'id', 'event_id'], String(eventId))!,
        homeTeam: getString(coreObj, ['homeTeam', 'home_team', 'home'], 'Home')!,
        awayTeam: getString(coreObj, ['awayTeam', 'away_team', 'away'], 'Away')!,
        homeScore: getNumber(coreObj, ['homeScore', 'home_score', 'score.home'], 0) || 0,
        awayScore: getNumber(coreObj, ['awayScore', 'away_score', 'score.away'], 0) || 0,
        status: getString(coreObj, ['status'], '') || '',
        league: getString(coreObj, ['league', 'competition']) || undefined,
        venue: getString(coreObj, ['venue', 'stadium']) || undefined,
        date: getString(coreObj, ['date', 'datetime', 'kickoff'], new Date().toISOString())!,
        attendance: getNumber(coreObj, ['attendance']) || undefined,
        winProbabilities: (coreObj['winProbabilities'] || coreObj['winprob']) as RenderEvent['winProbabilities'],
        stats: (coreObj['stats'] as MatchStats) || undefined,
        events: Array.isArray(coreObj['events']) ? (coreObj['events'] as Array<{ time?: number; type?: string; team?: string; player?: string }>) : [],
      };
      setEventRaw(coreObj);
      setEvent(normalized);
    }).catch(() => {});
    getHighlights(String(eventId)).then(env => {
      if (!active) return;
      const d = env.data as { videos?: Array<DataObject> } | undefined;
      const vids: Array<DataObject> = (d && typeof d === 'object' && d.videos && Array.isArray(d.videos)) ? d.videos : [];
      const normalized = vids.map((v) => ({
        id: String((v.id as string | number | undefined) ?? `${Math.random()}`),
        title: typeof v.title === 'string' ? v.title : undefined,
        url: typeof v.url === 'string' ? v.url : undefined,
        thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : undefined,
        provider: typeof v.provider === 'string' ? v.provider : undefined,
        duration: typeof v.duration === 'number' ? (v.duration as number) : undefined,
      }));
      setHighlights(normalized);
    }).catch(() => {});
    // Fetch comments (optional)
    getComments(String(eventId)).then(env => {
      if (!active) return;
      const d = env.data as { comments?: Array<DataObject> } | undefined;
      const arr = (d && Array.isArray(d.comments)) ? d.comments : [];
      const mapped = arr.map(c => ({
        time: typeof c.time === 'string' ? c.time : undefined,
        text: typeof c.text === 'string' ? c.text : (typeof c.comment === 'string' ? c.comment : undefined),
        author: typeof c.author === 'string' ? c.author : undefined,
      }));
      setComments(mapped);
    }).catch(() => setComments([]));

    return () => { active = false; };
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    postCollect("analysis.match_insights", { eventId: String(eventId) })
      .then(env => {
        if (!active) return;
        const data = (env?.data ?? {}) as Record<string, unknown>;
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

        setWinProbDisplay({ home: homePct, draw: drawPct, away: awayPct });
        setEvent(prev => prev ? {
          ...prev,
          winProbabilities: {
            home: homePct / 100,
            draw: drawPct / 100,
            away: awayPct / 100,
          },
        } : prev);
      })
      .catch(() => {
        if (!active) return;
        setWinProbDisplay({ home: 0, draw: 0, away: 0 });
      });
    return () => { active = false; };
  }, [eventId]);

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
    if (!event?.league) {
      setTable([]);
      return;
    }
    let active = true;
    getLeagueTable(event.league)
      .then(env => {
        if (!active) return;
        const d = env.data as { table?: Array<DataObject> } | undefined;
        const arr = (d && Array.isArray(d.table)) ? d.table : [];
        const mapped = arr.slice(0, 12).map((r, index) => {
          const rec = r as Record<string, unknown>;
          const pos = typeof rec.position === "number" ? rec.position : parseNumber(rec.rank) ?? index + 1;
          const teamName = pickString(rec, ["team", "team_name", "name"]);
          const played = parseNumber(rec.played);
          const points = parseNumber(rec.points);
          return { position: pos ?? index + 1, team: teamName, played, points };
        });
        setTable(mapped);
      })
      .catch(() => {
        if (!active) return;
        setTable([]);
      });
    return () => {
      active = false;
    };
  }, [event?.league]);

  useEffect(() => {
    if (!event) {
      setTeamsExtra({ home: null, away: null });
      setPlayersExtra({ home: [], away: [] });
      setOddsExtra({ listed: [], live: [] });
      setFormExtra({ home: [], away: [] });
      setSeasonsExtra([]);
      setH2hExtra(null);
      setExtrasErrors({});
      setExtrasLoading(false);
      return;
    }

    let active = true;
    setExtrasLoading(true);
    const nextErrors: NonNullable<MatchExtrasTabsProps["errors"]> = {};
    const seasonArgs = extractLeagueIdentifiers(event, eventRaw);

    const requests = [
      event.homeTeam ? getTeam(event.homeTeam) : Promise.resolve(null),
      event.awayTeam ? getTeam(event.awayTeam) : Promise.resolve(null),
      event.homeTeam ? listTeamPlayers(event.homeTeam) : Promise.resolve(null),
      event.awayTeam ? listTeamPlayers(event.awayTeam) : Promise.resolve(null),
      event.eventId ? postCollect("odds.list", { eventId: event.eventId }) : Promise.resolve(null),
      event.eventId ? postCollect("odds.live", { eventId: event.eventId }) : Promise.resolve(null),
      seasonArgs ? listSeasons(seasonArgs) : Promise.resolve(null),
      event.eventId ? getForm(event.eventId) : Promise.resolve(null),
      event.homeTeam && event.awayTeam ? getH2HByTeams(event.homeTeam, event.awayTeam) : Promise.resolve(null),
    ] as const;

    Promise.allSettled(requests)
      .then(results => {
        if (!active) return;
        const [homeTeamRes, awayTeamRes, homePlayersRes, awayPlayersRes, oddsListRes, oddsLiveRes, seasonsRes, formRes, h2hRes] = results;

        const homeTeamData = isFulfilled(homeTeamRes) ? parseTeamResponse(homeTeamRes.value) : null;
        const awayTeamData = isFulfilled(awayTeamRes) ? parseTeamResponse(awayTeamRes.value) : null;
        if (!homeTeamData && !awayTeamData && (homeTeamRes.status === "rejected" || awayTeamRes.status === "rejected")) {
          nextErrors.teams = "Unable to load team profiles.";
        }
        setTeamsExtra({ home: homeTeamData, away: awayTeamData });

        const homePlayers = isFulfilled(homePlayersRes) ? parsePlayersResponse(homePlayersRes.value) : [];
        const awayPlayers = isFulfilled(awayPlayersRes) ? parsePlayersResponse(awayPlayersRes.value) : [];
        if (!homePlayers.length && !awayPlayers.length && (homePlayersRes.status === "rejected" || awayPlayersRes.status === "rejected")) {
          nextErrors.players = "Unable to load squad information.";
        }
        setPlayersExtra({ home: homePlayers, away: awayPlayers });

        const listedOdds = isFulfilled(oddsListRes) ? parseOddsResponse(oddsListRes.value) : [];
        const liveOdds = isFulfilled(oddsLiveRes) ? parseOddsResponse(oddsLiveRes.value) : [];
        if (!listedOdds.length && !liveOdds.length && (oddsListRes.status === "rejected" || oddsLiveRes.status === "rejected")) {
          nextErrors.odds = "Odds data unavailable.";
        }
        setOddsExtra({ listed: listedOdds, live: liveOdds });

        const seasonsData = isFulfilled(seasonsRes) ? parseSeasonsResponse(seasonsRes.value) : [];
        if (!seasonsData.length && seasonsRes.status === "rejected") {
          nextErrors.seasons = "Unable to load seasons.";
        }
        setSeasonsExtra(seasonsData);

        const formData = isFulfilled(formRes) ? parseFormResponse(formRes.value) : { home: [], away: [] };
        if (!formData.home.length && !formData.away.length && formRes.status === "rejected") {
          nextErrors.form = "Recent form unavailable.";
        }
        setFormExtra(formData);

        const h2hData = isFulfilled(h2hRes) ? parseH2HResponse(h2hRes.value) : null;
        if (!h2hData && h2hRes.status === "rejected") {
          nextErrors.h2h = "Unable to load head-to-head results.";
        }
        setH2hExtra(h2hData);
      })
      .catch(error => {
        if (!active) return;
        nextErrors.general = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        if (!active) return;
        setExtrasErrors(nextErrors);
        setExtrasLoading(false);
      });

    return () => {
      active = false;
    };
  }, [event, eventRaw]);

  const match = event;

  if (!match) {
    return null;
  }

  const matchDate = new Date(match.date);
  const isLive = match.status === "LIVE";
  const isFinished = match.status === "FT";

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

              {/* Teams and Score */}
              <div className="flex items-center justify-center space-x-8">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
                    <span className="font-bold text-red-600 text-xl">
                      {match.homeTeam.substring(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <h3 className="font-semibold text-lg">{match.homeTeam}</h3>
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
                  <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="font-bold text-blue-600 text-xl">
                      {match.awayTeam.substring(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <h3 className="font-semibold text-lg">{match.awayTeam}</h3>
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
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Win Probabilities */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <TrendingUp className="w-5 h-5" />
              <span>Win Probabilities</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="space-y-2">
                <div className="text-2xl font-bold text-green-600">
                  {winProbDisplay.home.toFixed(0)}%
                </div>
                <div className="text-sm text-muted-foreground">{match.homeTeam} Win</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-yellow-600">
                  {winProbDisplay.draw.toFixed(0)}%
                </div>
                <div className="text-sm text-muted-foreground">Draw</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-blue-600">
                  {winProbDisplay.away.toFixed(0)}%
                </div>
                <div className="text-sm text-muted-foreground">{match.awayTeam} Win</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Match Details Tabs */}
      <div>
        <Tabs defaultValue="stats" className="space-y-6">
          <TabsList className="grid grid-cols-3 w-full max-w-md mx-auto">
            <TabsTrigger value="stats">Statistics</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="analysis">Analysis</TabsTrigger>
          </TabsList>

          <TabsContent value="stats" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Possession</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{match.stats?.possession?.home ?? 0}%</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="font-semibold">{match.stats?.possession?.away ?? 0}%</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Shots</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{match.stats?.shots?.home ?? 0}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="font-semibold">{match.stats?.shots?.away ?? 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Shots on Target</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{match.stats?.shotsOnTarget?.home ?? 0}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="font-semibold">{match.stats?.shotsOnTarget?.away ?? 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Corners</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{match.stats?.corners?.home ?? 0}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="font-semibold">{match.stats?.corners?.away ?? 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Fouls</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">{match.stats?.fouls?.home ?? 0}</span>
                    <span className="text-muted-foreground">-</span>
                    <span className="font-semibold">{match.stats?.fouls?.away ?? 0}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cards</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-yellow-600">
                      {(match.stats?.yellowCards?.home ?? 0)}Y {(match.stats?.redCards?.home ?? 0)}R
                    </span>
                    <span className="text-muted-foreground">-</span>
                    <span className="font-semibold text-yellow-600">
                      {(match.stats?.yellowCards?.away ?? 0)}Y {(match.stats?.redCards?.away ?? 0)}R
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="events" className="space-y-4">
            <Card>
              <CardContent className="p-4">
                <Timeline items={timeline} />
              </CardContent>
            </Card>
            <BestPlayerCard best={best} />
            <LeadersCard leaders={leaders} />
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
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

            <HighlightsCarousel highlights={highlights} isLoading={false} />

            <MatchExtrasTabs
              loading={extrasLoading}
              homeTeam={match.homeTeam}
              awayTeam={match.awayTeam}
              teams={teamsExtra}
              players={playersExtra}
              leagueTable={table}
              odds={oddsExtra}
              probabilities={winProbDisplay}
              form={formExtra}
              comments={comments}
              seasons={seasonsExtra}
              h2h={h2hExtra}
              errors={extrasErrors}
            />

            {/* Event Highlight Search (legacy-inspired) */}
            <Card>
              <CardHeader>
                <CardTitle>Search Specific Event Highlight</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Minute</label>
                    <Input type="number" min={1} max={130} placeholder="67" value={ehsQuery.minute} onChange={e=>setEhsQuery(q=>({...q, minute: e.target.value}))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Player</label>
                    <Input placeholder="Player name" value={ehsQuery.player} onChange={e=>setEhsQuery(q=>({...q, player: e.target.value}))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Event Type</label>
                    <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={ehsQuery.event_type} onChange={e=>setEhsQuery(q=>({...q, event_type: e.target.value}))}>
                      <option value="">(auto)</option>
                      <option value="goal">Goal</option>
                      <option value="penalty goal">Penalty Goal</option>
                      <option value="own goal">Own Goal</option>
                      <option value="red card">Red Card</option>
                      <option value="yellow card">Yellow Card</option>
                      <option value="substitution">Substitution</option>
                      <option value="VAR">VAR</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button disabled={ehsLoading} onClick={async ()=>{
                      if(!match) return;
                      setEhsLoading(true);
                      setEhsResults([]);
                      try{
                        const res = await searchEventHighlight({
                          home: match.homeTeam,
                          away: match.awayTeam,
                          date: match.date?.split('T')[0],
                          minute: ehsQuery.minute || undefined,
                          player: ehsQuery.player || undefined,
                          event_type: ehsQuery.event_type || undefined,
                        });
                        const scraped = (res?.results?.duckduckgo_scraped) || [];
                        setEhsResults(Array.isArray(scraped) ? scraped.slice(0,10) : []);
                      }catch{
                        // quietly ignore in UI; could show a toast later
                        setEhsResults([]);
                      }finally{
                        setEhsLoading(false);
                      }
                    }}>{ehsLoading ? 'Searching…' : 'Search'}</Button>
                  </div>
                </div>
                {ehsResults.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">Direct links</div>
                    <div className="space-y-2">
                      {ehsResults.map((r, i)=> (
                        <div key={i} className="text-sm">
                          <a className="text-primary hover:underline" href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
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

function parseSeasonsResponse(res: Awaited<ReturnType<typeof listSeasons>> | null): DataObject[] {
  if (!res) return [];
  const record = res as Record<string, unknown>;
  const candidates = [record.data, record.result, record.seasons, res];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return toDataObjectArray(candidate);
  }
  return [];
}

function parseFormResponse(res: unknown): { home: unknown[]; away: unknown[] } {
  if (!res || typeof res !== "object") return { home: [], away: [] };
  const record = res as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const homeMetrics = data.home_metrics as Record<string, unknown> | undefined;
  const awayMetrics = data.away_metrics as Record<string, unknown> | undefined;
  const homeTeam = data.home_team as Record<string, unknown> | undefined;
  const awayTeam = data.away_team as Record<string, unknown> | undefined;
  const home = Array.isArray(homeMetrics?.last_results)
    ? (homeMetrics!.last_results as unknown[])
    : Array.isArray(homeTeam?.recent)
      ? (homeTeam!.recent as unknown[])
      : [];
  const away = Array.isArray(awayMetrics?.last_results)
    ? (awayMetrics!.last_results as unknown[])
    : Array.isArray(awayTeam?.recent)
      ? (awayTeam!.recent as unknown[])
      : [];
  return { home, away };
}

function parseH2HResponse(res: unknown): { matches: DataObject[] } | null {
  if (!res || typeof res !== "object") return null;
  const record = res as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : record;
  const matches = toDataObjectArray(data.matches ?? data.results ?? data.games ?? []);
  if (!matches.length) return null;
  return { matches };
}

function extractLeagueIdentifiers(event: RenderEvent, rawEvent: DataObject | null): { leagueId?: string; leagueName?: string } | null {
  const record = rawEvent as Record<string, unknown> | null;
  const leagueId = record ? pickString(record, ["league_id", "league_key", "idLeague", "leagueid"]) : "";
  const leagueName = event.league || (record ? pickString(record, ["league", "league_name", "competition"]) : "");
  if (leagueId) return { leagueId };
  if (leagueName) return { leagueName };
  return null;
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
