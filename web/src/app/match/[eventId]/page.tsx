"use client";
import Image from "next/image";

import { useEffect, useRef, useState } from "react";
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
import type { TLItem } from "@/lib/match-mappers";
import {
  getEventResults,
  getEventAllSports,
  getHighlights,
  DataObject,
  getLeagueTable,
  postCollect,
  getTeam,
  listTeamPlayers,
  getForm,
  getH2HByTeams,
  getWinProb,
} from "@/lib/collect";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";

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

export default function MatchPage() {
  const { user, supabase, bumpInteractions } = useAuth();
  const { eventId } = useParams<{ eventId: string }>();
  const searchParams = useSearchParams();
  const sid = searchParams?.get("sid") ?? "card";

  const [event, setEvent] = useState<RenderEvent | null>(null);
  const [highlights, setHighlights] = useState<Array<{ id: string; title?: string; url?: string; thumbnail?: string; provider?: string; duration?: number }>>([]);
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
  const [formExtra, setFormExtra] = useState<{ home: unknown[]; away: unknown[] }>({ home: [], away: [] });
  const [h2hExtra, setH2hExtra] = useState<{ matches: DataObject[] } | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [favoriteTeams, setFavoriteTeams] = useState<string[]>([]);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const addFavoriteTeam = async (teamName: string) => {
    if (!user || !teamName) return;
    if (favoriteTeams.includes(teamName)) return;
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

      // Try to resolve a logo from already-fetched team extras or by fetching
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
      // try from teamsExtra
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
      // update cached team for reuse
      try { await supabase.rpc('upsert_cached_team', { p_provider_id: null, p_name: teamName, p_logo: logo ?? '', p_metadata: {} }); } catch {}
    } catch {}
  };

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
          stats: (coreObj['stats'] as MatchStats) || undefined,
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
            stats: (coreObj['stats'] as MatchStats) || undefined,
            events: Array.isArray(coreObj['events']) ? (coreObj['events'] as Array<{ time?: number; type?: string; team?: string; player?: string }>) : [],
          };
          setEventRaw(coreObj);
          setEvent(normalized);
        }).catch(() => {});
      });
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

    return () => { active = false; };
  }, [eventId]);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    setWinProbInsight(undefined);
    postCollect("analysis.match_insights", { eventId: String(eventId) })
      .then(env => {
        if (!active) return;
        const data = (env?.data ?? {}) as Record<string, unknown>;
        const insightsRaw = data.insights;
        const insights = insightsRaw && typeof insightsRaw === "object" ? (insightsRaw as Record<string, unknown>) : undefined;
        const winprobContainer = insights ?? data;
        const winprobRaw = winprobContainer.winprob;
        setWinProbInsight(winprobContainer && typeof winprobContainer === "object" ? (winprobContainer as Record<string, unknown>) : null);
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
        // If zero or missing, try override endpoint used by legacy match.js
        const sum = homePct + drawPct + awayPct;
        if (sum === 0) {
          return getWinProb(String(eventId)).then(res => {
            if (!active) return;
            const data = (res && res.data) || {};
            const prob = (data && (data.winprob || data.win_prob || data.probabilities)) || {};
            const norm = (val?: unknown) => {
              if (typeof val !== "number") return 0;
              if (Number.isNaN(val)) return 0;
              return val <= 1.0001 ? Math.round(val * 100) : Math.round(val);
            };
            const h = norm(prob.home);
            const d = norm(prob.draw);
            const a = norm(prob.away);
            setWinProbDisplay({ home: h, draw: d, away: a });
            setWinProbInsight(res as unknown as Record<string, unknown>);
            setEvent(prev => prev ? {
              ...prev,
              winProbabilities: { home: h / 100, draw: d / 100, away: a / 100 },
            } : prev);
          }).catch(() => {});
        }
      })
      .catch(() => {
        if (!active) return;
        setWinProbInsight(null);
        // Try override endpoint as fallback when match_insights fails
        getWinProb(String(eventId)).then(res => {
          if (!active) return;
          const data = (res && res.data) || {};
          const prob = (data && (data.winprob || data.win_prob || data.probabilities)) || {};
          const norm = (val?: unknown) => {
            if (typeof val !== "number") return 0;
            if (Number.isNaN(val)) return 0;
            return val <= 1.0001 ? Math.round(val * 100) : Math.round(val);
          };
          const h = norm(prob.home);
          const d = norm(prob.draw);
          const a = norm(prob.away);
          setWinProbDisplay({ home: h, draw: d, away: a });
          setWinProbInsight(res as unknown as Record<string, unknown>);
          setEvent(prev => prev ? {
            ...prev,
            winProbabilities: { home: h / 100, draw: d / 100, away: a / 100 },
          } : prev);
        }).catch(() => {
          setWinProbDisplay({ home: 0, draw: 0, away: 0 });
        });
      });
    return () => { active = false; };
  }, [eventId]);

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
          const mapped = tableData.slice(0, 12).map((r, index) => {
            const rec = r as Record<string, unknown>;
            const position = typeof rec.position === "number" ? rec.position :
              typeof rec.rank === "number" ? rec.rank :
              parseNumber(rec.standing_place) ??
              parseNumber(rec.overall_league_position) ?? index + 1;

            // Use all possible team name fields, including 'standing_team'
            const teamName = pickString(rec, ["team", "team_name", "name", "standing_team"]);

            // Extract league table data using the same fields as the old implementation
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

            const goalsFor = parseNumber(rec.goals_for) ??
              parseNumber(rec.overall_league_GF) ??
              parseNumber(rec.GF) ?? 0;

            const goalsAgainst = parseNumber(rec.goals_against) ??
              parseNumber(rec.overall_league_GA) ??
              parseNumber(rec.GA) ?? 0;

            const goalDifference = parseNumber(rec.goal_difference) ??
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
      setFormExtra({ home: [], away: [] });
      setH2hExtra(null);
      setExtrasLoading(false);
      return;
    }

    let active = true;
    setExtrasLoading(true);

    const requests: [Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>, Promise<unknown>] = [
      event.homeTeam ? getTeam(event.homeTeam) : Promise.resolve(null),
      event.awayTeam ? getTeam(event.awayTeam) : Promise.resolve(null),
      event.homeTeam ? listTeamPlayers(event.homeTeam) : Promise.resolve(null),
      event.awayTeam ? listTeamPlayers(event.awayTeam) : Promise.resolve(null),
      event.eventId ? postCollect("odds.list", { eventId: event.eventId }) : Promise.resolve(null),
      event.eventId ? postCollect("odds.live", { eventId: event.eventId }) : Promise.resolve(null),
      Promise.resolve(null),
      event.eventId ? getForm(event.eventId) : Promise.resolve(null),
      event.homeTeam && event.awayTeam ? getH2HByTeams(event.homeTeam, event.awayTeam) : Promise.resolve(null),
    ];

    Promise.allSettled(requests)
      .then(results => {
        if (!active) return;
        const [homeTeamRes, awayTeamRes, homePlayersRes, awayPlayersRes, oddsListRes, oddsLiveRes, , formRes, h2hRes] = results;

  const homeTeamData = isFulfilled(homeTeamRes) ? parseTeamResponse(homeTeamRes.value as Awaited<ReturnType<typeof getTeam>> | null) : null;
  const awayTeamData = isFulfilled(awayTeamRes) ? parseTeamResponse(awayTeamRes.value as Awaited<ReturnType<typeof getTeam>> | null) : null;
  setTeamsExtra({ home: homeTeamData, away: awayTeamData });

  const homePlayers = isFulfilled(homePlayersRes) ? parsePlayersResponse(homePlayersRes.value as Awaited<ReturnType<typeof listTeamPlayers>> | null) : [];
  const awayPlayers = isFulfilled(awayPlayersRes) ? parsePlayersResponse(awayPlayersRes.value as Awaited<ReturnType<typeof listTeamPlayers>> | null) : [];
  setPlayersExtra({ home: homePlayers, away: awayPlayers });

  const listedOdds = isFulfilled(oddsListRes) ? parseOddsResponse(oddsListRes.value as { data?: unknown } | null) : [];
  const liveOdds = isFulfilled(oddsLiveRes) ? parseOddsResponse(oddsLiveRes.value as { data?: unknown } | null) : [];
  setOddsExtra({ listed: listedOdds, live: liveOdds });

  const formData = isFulfilled(formRes) ? parseFormResponse(formRes.value as unknown) : { home: [], away: [] };
  setFormExtra(formData);
  const h2hData = isFulfilled(h2hRes) ? parseH2HResponse(h2hRes.value as unknown) : null;
  setH2hExtra(h2hData);
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
  }, [event, eventRaw]);

  const match = event;

  if (!match) {
    return null;
  }

  const matchDate = new Date(match.date);
  const st = (match.status || '').toLowerCase();
  const isLive = /live|1st|2nd|ht/.test(st);
  const isFinished = /ft|finished/.test(st);

  

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
                      {favoriteTeams.includes(match.homeTeam) && (
                        <Heart className="w-4 h-4 text-red-500" fill="currentColor" />
                      )}
                    </h3>
                    <Button
                      variant="outline"
                      size="icon"
                      title={favoriteTeams.includes(match.homeTeam) ? "Saved" : "Save team"}
                      className="transition-transform active:scale-95"
                      disabled={favoriteTeams.includes(match.homeTeam)}
                      onClick={() => addFavoriteTeam(match.homeTeam)}
                    >
                      {favoriteTeams.includes(match.homeTeam) ? (
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
                      {favoriteTeams.includes(match.awayTeam) && (
                        <Heart className="w-4 h-4 text-red-500" fill="currentColor" />
                      )}
                    </h3>
                    <Button
                      variant="outline"
                      size="icon"
                      title={favoriteTeams.includes(match.awayTeam) ? "Saved" : "Save team"}
                      className="transition-transform active:scale-95"
                      disabled={favoriteTeams.includes(match.awayTeam)}
                      onClick={() => addFavoriteTeam(match.awayTeam)}
                    >
                      {favoriteTeams.includes(match.awayTeam) ? (
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
            items={timeline}
            homeTeam={match.homeTeam}
            awayTeam={match.awayTeam}
            matchRaw={eventRaw}
            players={playersExtra}
            teams={teamsExtra}
          />
        </CardContent>
      </Card>

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
            <BestPlayerCard best={best} />
            <LeadersCard leaders={leaders} />
          </TabsContent>

          <TabsContent value="league" className="space-y-4">
            {table.length > 0 ? (
              <Card className="shadow-xl border-2 border-primary/20 bg-gradient-to-br from-background to-primary/5">
                <CardHeader>
                  <CardTitle className="text-2xl font-bold text-primary">League Table</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="min-w-full rounded-xl bg-background text-base text-foreground">
                      <thead className="bg-primary/10">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold">#</th>
                          <th className="px-4 py-3 text-left font-semibold">Team</th>
                          <th className="px-4 py-3 text-left font-semibold">Played</th>
                          <th className="px-4 py-3 text-left font-semibold">W</th>
                          <th className="px-4 py-3 text-left font-semibold">D</th>
                          <th className="px-4 py-3 text-left font-semibold">L</th>
                          <th className="px-4 py-3 text-left font-semibold">GF</th>
                          <th className="px-4 py-3 text-left font-semibold">GA</th>
                          <th className="px-4 py-3 text-left font-semibold">GD</th>
                          <th className="px-4 py-3 text-left font-semibold">Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {table.map((row, idx) => {
                          // Try to get logo from teamsExtra first, fallback to row.logo or row.team_logo
                          let logo: string | undefined = undefined;
                          const teamName = typeof row.team === "string" ? row.team : String(row.team ?? "");
                          const norm = (s: unknown) => typeof s === "string" ? s.trim().toLowerCase() : typeof s === "number" ? String(s).toLowerCase() : "";
                          // Safely extract home team name
                          const homeName = typeof teamsExtra.home?.team_name === "string" ? teamsExtra.home.team_name : typeof teamsExtra.home?.name === "string" ? teamsExtra.home.name : "";
                          if (teamsExtra.home && norm(homeName) === norm(teamName)) {
                            logo = typeof teamsExtra.home.logo === "string" ? teamsExtra.home.logo :
                              typeof teamsExtra.home.team_logo === "string" ? teamsExtra.home.team_logo :
                              typeof teamsExtra.home.badge === "string" ? teamsExtra.home.badge : undefined;
                          } else {
                            const awayName = typeof teamsExtra.away?.team_name === "string" ? teamsExtra.away.team_name : typeof teamsExtra.away?.name === "string" ? teamsExtra.away.name : "";
                            if (teamsExtra.away && norm(awayName) === norm(teamName)) {
                              logo = typeof teamsExtra.away.logo === "string" ? teamsExtra.away.logo :
                                typeof teamsExtra.away.team_logo === "string" ? teamsExtra.away.team_logo :
                                typeof teamsExtra.away.badge === "string" ? teamsExtra.away.badge : undefined;
                            }
                          }
                          if (!logo) logo = typeof row.logo === "string" ? row.logo :
                            typeof row.team_logo === "string" ? row.team_logo :
                            typeof row.badge === "string" ? row.badge : undefined;

                          return (
                            <tr key={idx} className={idx < 3 ? "bg-primary/5" : idx % 2 === 0 ? "bg-background" : "bg-primary/2"}>
                              <td className="px-4 py-3 font-bold text-lg text-primary/80">{row.position}</td>
                              <td className="px-4 py-3 flex items-center gap-3">
                                {logo ? (
                                  <Image src={logo} alt={teamName} width={32} height={32} className="w-8 h-8 rounded-full border border-primary/30 bg-white object-contain" />
                                ) : (
                                  <span className="w-8 h-8 inline-block rounded-full bg-muted/30 border border-muted/40" />
                                )}
                                <span className="font-semibold text-base">{teamName}</span>
                              </td>
                              <td className="px-4 py-3 text-center">{row.played}</td>
                              <td className="px-4 py-3 text-center">{row.won}</td>
                              <td className="px-4 py-3 text-center">{row.drawn}</td>
                              <td className="px-4 py-3 text-center">{row.lost}</td>
                              <td className="px-4 py-3 text-center">{row.goalsFor}</td>
                              <td className="px-4 py-3 text-center">{row.goalsAgainst}</td>
                              <td className="px-4 py-3 text-center">{row.goalDifference}</td>
                              <td className="px-4 py-3 text-center font-bold text-primary">{row.points}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
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
            <HighlightsCarousel highlights={highlights} isLoading={false} />

            {extrasLoading ? (
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
                      {formExtra.home.length > 0 || formExtra.away.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="rounded-lg border p-4">
                            <h4 className="font-semibold mb-3">{match.homeTeam}</h4>
                            {formExtra.home.length > 0 ? (
                              <div className="space-y-2">
                                {formExtra.home.map((item, idx) => {
                                  const record = item as Record<string, unknown>;
                                  const result = pickString(record, ["result", "outcome"]);
                                  const opponent = pickString(record, ["opponent", "against"]);
                                  const score = pickString(record, ["score", "scoreline"]);
                                  return (
                                    <div key={idx} className="flex items-center justify-between rounded border p-2 text-sm">
                                      <span className={`font-bold px-2 py-0.5 rounded ${
                                        result === 'W' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
                                        result === 'L' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100' :
                                        'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100'
                                      }`}>{result || '?'}</span>
                                      <span className="flex-1 text-center">{opponent || 'vs Unknown'}</span>
                                      <span>{score || '-'}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground">No form data available.</div>
                            )}
                          </div>
                          <div className="rounded-lg border p-4">
                            <h4 className="font-semibold mb-3">{match.awayTeam}</h4>
                            {formExtra.away.length > 0 ? (
                              <div className="space-y-2">
                                {formExtra.away.map((item, idx) => {
                                  const record = item as Record<string, unknown>;
                                  const result = pickString(record, ["result", "outcome"]);
                                  const opponent = pickString(record, ["opponent", "against"]);
                                  const score = pickString(record, ["score", "scoreline"]);
                                  return (
                                    <div key={idx} className="flex items-center justify-between rounded border p-2 text-sm">
                                      <span className={`font-bold px-2 py-0.5 rounded ${
                                        result === 'W' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' :
                                        result === 'L' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100' :
                                        'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-100'
                                      }`}>{result || '?'}</span>
                                      <span className="flex-1 text-center">{opponent || 'vs Unknown'}</span>
                                      <span>{score || '-'}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="text-sm text-muted-foreground">No form data available.</div>
                            )}
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
