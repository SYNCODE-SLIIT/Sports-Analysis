"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, Search, ThumbsUp, Bookmark, Share2, Eye, MousePointerClick, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MatchCard } from "@/components/MatchCard";
import { Input } from "@/components/ui/input";
import { listEvents, getLeagueTable, sanitizeInput, getLiveEvents, postCollect, getLeagueNews } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/components/AuthProvider";

type LeagueLite = {
  id: string;
  league_name: string;
  country_name?: string;
  logo?: string;
};

const POPULAR_LEAGUES = [
  "Premier League",
  "UEFA Champions League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Major League Soccer",
];

const isPopularLeague = (name: string) =>
  POPULAR_LEAGUES.some(popular => name.toLowerCase().includes(popular.toLowerCase()));

const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";

const getFirstString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

// Try many common keys and nested shapes to find a logo URL
const getLogoFromObject = (obj: Record<string, unknown>): string | undefined => {
  const keys = [
    "league_logo",
    "league_logo_url",
    "league_badge",
    "badge",
    "logo",
    "image",
    "strLogo",
    "strBadge",
    "strBadgeWide",
    "logo_path",
    "logo_url",
    "image_url",
    "thumb",
    "badge_url",
    "strLeagueLogo",
    "strLogoWide",
    "strThumb",
  ];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const nested = (v as Record<string, unknown>).url || (v as Record<string, unknown>).src || (v as Record<string, unknown>).image || (v as Record<string, unknown>).path;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }

  // try media arrays
  const mediaCandidates = ["media", "images", "logos", "thumbnails"];
  for (const mk of mediaCandidates) {
    const mv = obj[mk];
    if (Array.isArray(mv) && mv.length) {
      for (const item of mv) {
        if (typeof item === "string" && item.trim()) return item.trim();
        if (item && typeof item === "object") {
          const nested = (item as Record<string, unknown>).url || (item as Record<string, unknown>).src || (item as Record<string, unknown>).image;
          if (typeof nested === "string" && nested.trim()) return nested.trim();
        }
      }
    }
  }

  return undefined;
};

const extractLeagueInfo = (entry: unknown): LeagueLite | null => {
  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) return null;
    return {
      id: name.toLowerCase(),
      league_name: name,
    };
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const name = getFirstString(obj, ["league_name", "name", "league"]);
    if (!name) return null;
    const country = getFirstString(obj, ["country_name", "country", "nation"]);
    const idRaw = getFirstString(obj, ["league_id", "league_key", "id", "key", "idLeague"]);
    const logo = getLogoFromObject(obj) ?? getFirstString(obj, [
      "league_logo",
      "league_logo_url",
      "league_badge",
      "badge",
      "logo",
      "image",
      "strLogo",
      "strBadge",
      "strBadgeWide",
    ]);
    return {
      id: (idRaw || name).toLowerCase(),
      league_name: name,
      country_name: country || undefined,
      logo: logo || undefined,
    };
  }
  return null;
};

const mapLeagues = (raw: unknown): LeagueLite[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: LeagueLite[] = [];
  for (const entry of raw) {
    const info = extractLeagueInfo(entry);
    if (!info) continue;
    const uniqueKey = info.id || info.league_name.toLowerCase();
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    normalized.push(info);
  }
  return normalized;
};

export default function LeaguesPage() {
  const { user, supabase, bumpPreferences, bumpInteractions } = useAuth();
  const [allLeagues, setAllLeagues] = useState<LeagueLite[]>([]);
  const [initialLeagueParam, setInitialLeagueParam] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [standings, setStandings] = useState<Array<{ position?: number; team?: string; played?: number; points?: number }>>([]);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const [liveInLeague, setLiveInLeague] = useState<Fixture[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const [upcoming, setUpcoming] = useState<Fixture[]>([]);
  const [recent, setRecent] = useState<Fixture[]>([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const todayISO = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayISO);
  const [dateMatches, setDateMatches] = useState<Fixture[]>([]);
  const [dateLoading, setDateLoading] = useState(false);
  const [news, setNews] = useState<Array<{ id?: string; title?: string; url?: string; summary?: string; imageUrl?: string; source?: string; publishedAt?: string }>>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [favTeams, setFavTeams] = useState<string[]>([]);
  const [favLeagues, setFavLeagues] = useState<string[]>([]);


  const qSan = useMemo(() => sanitizeInput(search), [search]);

  const filteredLeagues = useMemo(() => {
    const query = qSan.toLowerCase();
    if (!query) return allLeagues;
    return allLeagues.filter(league => {
      const name = league.league_name.toLowerCase();
      const country = league.country_name?.toLowerCase() ?? "";
      return name.includes(query) || country.includes(query);
    });
  }, [allLeagues, qSan]);

  const visibleLeagues = useMemo(() => {
    const ordered = [...filteredLeagues];
    ordered.sort((a, b) => {
      const aPop = isPopularLeague(a.league_name) ? 0 : 1;
      const bPop = isPopularLeague(b.league_name) ? 0 : 1;
      if (aPop !== bPop) return aPop - bPop;
      return a.league_name.localeCompare(b.league_name);
    });
    return ordered;
  }, [filteredLeagues]);

  useEffect(() => {
    let active = true;

    const loadLeagues = async () => {
      try {
        const env = await postCollect("leagues.list", {});
        // env.data can be many shapes: array, { leagues: [...] }, { result: [...] }, or provider raw
        const rawPayload = env?.data as unknown;
        let arr: unknown[] = [];
        if (Array.isArray(rawPayload)) arr = rawPayload as unknown[];
        else if (rawPayload && typeof rawPayload === 'object') {
          const obj = rawPayload as Record<string, unknown>;
          if (Array.isArray(obj.leagues)) arr = obj.leagues as unknown[];
          else if (Array.isArray(obj.result)) arr = obj.result as unknown[];
          else if (Array.isArray(obj.results)) arr = obj.results as unknown[];
          else if (Array.isArray(obj.data)) arr = obj.data as unknown[];
        }
        const data = mapLeagues(arr);
        if (active && data.length) {
          setAllLeagues(data);
          return;
        }
      } catch (error) {
        console.debug("[leagues] collect fallback", error);
      }

      try {
        const response = await fetch("/api/leagues");
        if (!response.ok) throw new Error("Failed to load leagues");
        const json = (await response.json()) as { leagues?: unknown };
        if (!active) return;
        setAllLeagues(mapLeagues(json.leagues ?? []));
      } catch (error) {
        console.debug("[leagues] api fallback", error);
        if (active) setAllLeagues([]);
      }
    };

    loadLeagues();
    return () => {
      active = false;
    };
  }, []);

  // Read initial ?league=... param on first render so we can preselect a league when the
  // page is opened via a link. We store it separately and reconcile once `allLeagues` loads.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const l = params.get('league');
      if (l) setInitialLeagueParam(decodeURIComponent(l));
    } catch (e) {
      // ignore
    }
  }, []);

  // When the leagues list arrives, try to resolve an initial param into a canonical league name.
  useEffect(() => {
    if (!initialLeagueParam) return;
    if (!allLeagues || allLeagues.length === 0) return;
    if (selectedLeague) return; // already selected by user

    const param = initialLeagueParam.trim();
    if (!param) return;

    const paramL = param.toLowerCase();
    // Try exact match by league_name or id, then substring match
    let found = allLeagues.find(l => l.league_name.toLowerCase() === paramL || l.id.toLowerCase() === paramL);
    if (!found) {
      found = allLeagues.find(l => l.league_name.toLowerCase().includes(paramL) || l.id.toLowerCase().includes(paramL));
    }

    if (found) {
      setSelectedLeague(found.league_name);
      try { ensureLeagueItemAndSend(found.league_name, 'view'); } catch {}
      try { if (typeof window !== 'undefined') window.history.replaceState(null, '', `?league=${encodeURIComponent(found.league_name)}`); } catch {}
    } else {
      // No canonical match — still set the param value so panels will attempt to load by name
      setSelectedLeague(param);
      try { if (typeof window !== 'undefined') window.history.replaceState(null, '', `?league=${encodeURIComponent(param)}`); } catch {}
    }
  }, [allLeagues, initialLeagueParam]);

  // Load user preferences for boosting
  useEffect(() => {
    let active = true;
    (async () => {
      if (!user) { setFavTeams([]); setFavLeagues([]); return; }
      try {
        const { data } = await supabase.from('user_preferences').select('favorite_teams, favorite_leagues').eq('user_id', user.id).single();
        if (!active) return;
        setFavTeams((data?.favorite_teams ?? []) as string[]);
        setFavLeagues((data?.favorite_leagues ?? []) as string[]);
      } catch {
        if (!active) return;
        setFavTeams([]); setFavLeagues([]);
      }
    })();
    return () => { active = false; };
  }, [user, supabase]);

  // Ensure a league item exists and log interaction
  const ensureLeagueItemAndSend = useCallback(async (
    leagueName: string,
    evt: "view" | "click" | "like" | "save" | "share" | "dismiss"
  ) => {
    if (!user || !leagueName) return;
    try {
      const league = allLeagues.find(l => l.league_name === leagueName);
      const { data: item_id } = await supabase.rpc("ensure_league_item", {
        p_league_name: leagueName,
        p_logo: league?.logo ?? null,
        p_popularity: 0,
      });
      if (!item_id) return;
      await supabase.from("user_interactions").insert({ user_id: user.id, item_id, event: evt });
    } catch {}
  }, [user, supabase, allLeagues]);

  // Save league to user preferences (favorite_leagues) and log interaction
  const handleSaveLeague = useCallback(async () => {
    if (!user || !selectedLeague) return;
    try {
      // ensure league item & send save interaction
      await ensureLeagueItemAndSend(selectedLeague, 'save');

      // fetch existing preferences
      const { data: prefs } = await supabase.from('user_preferences').select('favorite_teams, favorite_leagues').eq('user_id', user.id).single();
      const existingLeagues: string[] = (prefs?.favorite_leagues ?? []) as string[];
      const existingTeams: string[] = (prefs?.favorite_teams ?? []) as string[];
      if (existingLeagues.includes(selectedLeague)) {
        toast.success('League already in your favorites');
        // still update local state to reflect db
        setFavLeagues(existingLeagues);
        return;
      }
      const newLeagues = [...existingLeagues, selectedLeague];
      // upsert preferences
  await supabase.from('user_preferences').upsert({ user_id: user.id, favorite_teams: existingTeams, favorite_leagues: newLeagues });
  // update local state so UI updates immediately
  setFavLeagues(newLeagues);
  // notify other components (Profile) to refresh preferences
  try { bumpPreferences(); } catch {}
  toast.success('League saved to your favorites');
    } catch (err) {
      console.error('save league', err);
      toast.error('Failed to save league');
    }
  }, [user, selectedLeague, supabase, ensureLeagueItemAndSend]);

  const handleLeagueShare = useCallback(async () => {
    if (!selectedLeague) return;
    const url = typeof window !== 'undefined'
      ? `${window.location.origin}/leagues?league=${encodeURIComponent(selectedLeague)}`
      : `/leagues?league=${encodeURIComponent(selectedLeague)}`;
    const title = `${selectedLeague}`;
    const text = `Check out ${selectedLeague} on Sports Analysis`;
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav?.share) {
        try {
          await nav.share({ title, text, url });
          toast.success('Shared');
          await ensureLeagueItemAndSend(selectedLeague, 'share');
          return;
        } catch (err: any) {
          if (err && err.name === 'AbortError') return;
        }
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied to clipboard');
        await ensureLeagueItemAndSend(selectedLeague, 'share');
      }
    } catch {
      // Ignore share failures
    }
  }, [selectedLeague, ensureLeagueItemAndSend]);

const fetchLeagueNews = useCallback(async (leagueName: string) => {
  if (!leagueName) return;
  setNewsLoading(true);
  setNewsError(null);
  try {
    const resp = await getLeagueNews(leagueName, 20);
    const articlesRaw = resp?.data?.articles || resp?.data?.result || resp?.data || [];
    const normalized = (Array.isArray(articlesRaw) ? articlesRaw : []).map((a: any, i: number) => ({
      id: a.id || a.articleId || a.url || `news-${i}`,
      title: a.title || a.headline || a.name || "",
      url: a.url || a.link || a.article_url || "",
      summary: a.summary || a.description || a.excerpt || "",
      // try many common keys providers use for an image
      imageUrl:
        a.image ||
        a.imageUrl ||
        a.urlToImage ||
        a.thumbnail ||
        a.image_url ||
        (a.media && a.media[0] && (a.media[0].url || a.media[0].src)) ||
        undefined,
      source: a.source || a.publisher || "",
      publishedAt: a.publishedAt || a.pubDate || a.published || "",
    }));
    setNews(normalized);
  } catch (err: any) {
    setNewsError(String(err?.message || err));
  } finally {
    setNewsLoading(false);
  }
}, []);

const fetchMatchesByDate = useCallback(async (leagueName: string, date: string) => {
    setDateLoading(true);
    try {
      const cleanLeague = sanitizeInput(leagueName);
      const cleanDate = date || todayISO;
      const response = await postCollect("events.list", {
        leagueName: cleanLeague,
        fromDate: cleanDate,
        toDate: cleanDate,
      });
      const data = response.data;
      const extract = (value: unknown): unknown[] => {
        if (!value || typeof value !== "object") return [];
        const candidate = value as Record<string, unknown>;
        if (Array.isArray(candidate.events)) return candidate.events;
        if (Array.isArray(candidate.result)) return candidate.result;
        if (Array.isArray(candidate.results)) return candidate.results;
        return Array.isArray(candidate) ? (candidate as unknown[]) : [];
      };
      const rawEvents: unknown[] = Array.isArray(data)
        ? data
        : extract(data) || [];
  setDateMatches(boostFixtures(parseFixtures(rawEvents)));
    } catch (error) {
      console.debug("[leagues] date fixtures", error);
      setDateMatches([]);
    } finally {
      setDateLoading(false);
    }
  }, [todayISO]);

  const applyDateFilter = useCallback(() => {
    if (!selectedLeague) return;
    fetchMatchesByDate(selectedLeague, selectedDate);
  }, [fetchMatchesByDate, selectedLeague, selectedDate]);

  // Load panels when selected league changes
  useEffect(() => {
    if (!selectedLeague) {
      setDateMatches([]);
      setDateLoading(false);
      return;
    }
    let active = true;
    setStandingsLoading(true);
    setLiveLoading(true);
    setLoadingUpcoming(true);
    setLoadingRecent(true);
    const initialDate = todayISO;
    setSelectedDate(initialDate);
    fetchMatchesByDate(selectedLeague, initialDate);
    setStandings([]);
    setLiveInLeague([]);
    setUpcoming([]);
    setRecent([]);
    setNews([]);
    fetchLeagueNews(selectedLeague);

    const extractEvents = (payload: unknown): unknown[] => {
      if (!payload || typeof payload !== "object") return [];
      const events = (payload as Record<string, unknown>).events;
      return Array.isArray(events) ? events : [];
    };

    const run = async () => {
      const [tableRes, liveRes, upcomingRes, recentRes] = await Promise.allSettled([
        getLeagueTable(selectedLeague),
        getLiveEvents({ leagueName: selectedLeague }),
        listEvents({ leagueName: selectedLeague, kind: "upcoming", days: 7 }),
        listEvents({ leagueName: selectedLeague, kind: "past", days: 3 }),
      ]);
      if (!active) return;

      if (tableRes.status === "fulfilled") {
        const d = tableRes.value.data as { table?: Array<Record<string, unknown>> } | undefined;
        const arr = (d && Array.isArray(d.table)) ? d.table : [];
        const mapped = arr.slice(0, 10).map((r, i) => {
          const rec = r as Record<string, unknown>;
          const rank = rec.rank;
          const teamName = typeof rec.team_name === "string" ? rec.team_name : undefined;
          return {
            position: typeof rec.position === "number" ? rec.position : (typeof rank === "string" && rank.trim() ? Number(rank) : i + 1),
            team: typeof rec.team === "string" ? rec.team : teamName,
            played: typeof rec.played === "number" ? rec.played : undefined,
            points: typeof rec.points === "number" ? rec.points : undefined,
          };
        });
        setStandings(mapped);
      } else {
        setStandings([]);
      }

      if (liveRes.status === "fulfilled") {
        const data = liveRes.value.data as Record<string, unknown> | undefined;
        let raw: unknown = [];
        if (data && typeof data === "object") {
          const getField = (key: string) => (data as Record<string, unknown>)[key];
          raw = getField("events") ?? getField("result") ?? getField("results") ?? getField("items") ?? [];
        }
        const fixtures = parseFixtures(Array.isArray(raw) ? raw : []);
  setLiveInLeague(boostFixtures(fixtures));
      } else {
        setLiveInLeague([]);
      }

      if (upcomingRes.status === "fulfilled") {
        const events = extractEvents(upcomingRes.value.data);
  setUpcoming(boostFixtures(parseFixtures(events)));
      } else {
        setUpcoming([]);
      }

      if (recentRes.status === "fulfilled") {
        const events = extractEvents(recentRes.value.data);
  setRecent(boostFixtures(parseFixtures(events)));
      } else {
        setRecent([]);
      }

      setStandingsLoading(false);
      setLiveLoading(false);
      setLoadingUpcoming(false);
      setLoadingRecent(false);
    };

    run().catch(() => {
      if (!active) return;
      setStandings([]);
      setLiveInLeague([]);
      setUpcoming([]);
      setRecent([]);
      setStandingsLoading(false);
      setLiveLoading(false);
      setLoadingUpcoming(false);
      setLoadingRecent(false);
    });

    return () => { active = false; };
  }, [selectedLeague, fetchMatchesByDate, todayISO]);

  const boostFixtures = useCallback((arr: Fixture[]) => {
    if (favTeams.length === 0 && favLeagues.length === 0) return arr;
    return [...arr]
      .map((m, idx) => {
        const teamBoost = (favTeams.includes(m.home_team) ? 3 : 0) + (favTeams.includes(m.away_team) ? 3 : 0);
        const leagueBoost = favLeagues.includes(m.league ?? '') ? 2 : 0;
        return { m, idx, score: teamBoost + leagueBoost };
      })
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .map(x => x.m);
  }, [favTeams, favLeagues]);
  return (
    <div className="container py-8 space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 text-center"
      >
        <h1 className="text-4xl font-bold">Football Leagues</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Explore fixtures, results, and live analysis from the world&apos;s top football leagues.
          Get detailed insights and win probabilities for every match.
        </p>
      </motion.div>

      {/* All Leagues + Search */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">All Leagues</h2>
          <p className="text-muted-foreground">Search all leagues and view details</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-full max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search by league or country" value={search} onChange={(e)=> setSearch(e.target.value)} />
          </div>
        </div>
        {visibleLeagues.length === 0 ? (
          <div className="text-sm text-muted-foreground">No leagues match your search.</div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleLeagues.map(league => {
              const isSelected = selectedLeague === league.league_name;
              return (
                <Card
                  key={`${league.id}-${league.league_name}`}
                  className={`cursor-pointer border hover:shadow-md focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 transition-transform active:scale-95 ${isSelected ? 'border-primary shadow-lg' : ''}`}
                  onClick={() => { setSelectedLeague(league.league_name); ensureLeagueItemAndSend(league.league_name, 'view'); }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(evt) => {
                    if (evt.key === 'Enter' || evt.key === ' ') {
                      evt.preventDefault();
                      setSelectedLeague(league.league_name);
                      ensureLeagueItemAndSend(league.league_name, 'view');
                    }
                  }}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div
                      className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border text-sm font-semibold ${league.logo ? 'border-transparent' : 'border-border bg-muted text-muted-foreground'}`}
                      style={league.logo ? { backgroundImage: `url(${league.logo})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      {!league.logo && getInitials(league.league_name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-foreground">{league.league_name}</div>
                      {league.country_name && (
                        <div className="truncate text-xs text-muted-foreground">{league.country_name}</div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {selectedLeague && (
          <Card className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="space-y-1">
                <h3 className="text-lg font-semibold">Filters</h3>
                <p className="text-sm text-muted-foreground">Pick a date to view fixtures for {selectedLeague}.</p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <label className="text-sm text-muted-foreground md:flex md:flex-col md:items-start md:gap-2">
                  <span className="text-xs uppercase tracking-wide">Date</span>
                  <input
                    type="date"
                    className="h-9 rounded-md border border-border bg-background px-3 text-sm"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-transform active:scale-95"
                  onClick={applyDateFilter}
                  disabled={dateLoading}
                >
                  {dateLoading ? 'Loading…' : 'Apply'}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" title="Like" className="transition-transform active:scale-95" onClick={() => { ensureLeagueItemAndSend(selectedLeague, 'like'); try { bumpInteractions(); } catch {} }}>
                <ThumbsUp className="w-4 h-4 mr-1"/> Like
              </Button>
              <Button variant="outline" size="sm" title="Save" className="transition-transform active:scale-95" onClick={handleSaveLeague}>
                <Bookmark className="w-4 h-4 mr-1"/> Save
              </Button>
              <Button variant="outline" size="sm" title="Share" className="transition-transform active:scale-95" onClick={() => { handleLeagueShare(); try { bumpInteractions(); } catch {} }}>
                <Share2 className="w-4 h-4 mr-1"/> Share
              </Button>
              {/* Dismiss removed as per request */}
            </div>
          </Card>
        )}

        {selectedLeague && (
          <div className="space-y-6">
            {selectedLeague && (
              <Card>
                <CardHeader>
                  <CardTitle>Matches on {selectedDate ? new Date(selectedDate + 'T00:00:00').toLocaleDateString() : 'selected date'}</CardTitle>
                </CardHeader>
                <CardContent>
                  {dateLoading ? (
                    <div className="text-sm text-muted-foreground">Loading fixtures…</div>
                  ) : dateMatches.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No fixtures scheduled for this date.</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {dateMatches.map((f) => (
                        <MatchCard key={f.id} fixture={f} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-1">
                <CardHeader><CardTitle>{selectedLeague} Standings</CardTitle></CardHeader>
                <CardContent>
                  {standingsLoading && standings.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Loading standings…</div>
                  ) : standings.length === 0 ? (
                    <div className="text-sm text-muted-foreground">Standings unavailable</div>
                  ) : (
                    <div className="text-sm">
                      <div className="grid grid-cols-4 gap-2 font-medium text-muted-foreground mb-2">
                        <div>#</div><div>Team</div><div>P</div><div>Pts</div>
                      </div>
                      <div className="space-y-1">
                        {standings.map((r, i)=> (
                          <div key={i} className="grid grid-cols-4 gap-2">
                            <div>{r.position ?? i+1}</div>
                            <div className="truncate">{r.team}</div>
                            <div>{r.played ?? '-'}</div>
                            <div>{r.points ?? '-'}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Live in {selectedLeague}</CardTitle></CardHeader>
                <CardContent>
                  {liveLoading ? (
                    <div className="text-sm text-muted-foreground">Loading live…</div>
                  ) : liveInLeague.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No live matches</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {liveInLeague.map((f)=> (
                        <MatchCard key={f.id} fixture={f} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader><CardTitle>Upcoming (next 7 days)</CardTitle></CardHeader>
                <CardContent>
                  {loadingUpcoming ? (
                    <div className="text-sm text-muted-foreground">Loading upcoming…</div>
                  ) : upcoming.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No upcoming fixtures</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {upcoming.map((f)=> (
                        <MatchCard key={f.id} fixture={f} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Recent Results (last 3 days)</CardTitle></CardHeader>
                <CardContent>
                  {loadingRecent ? (
                    <div className="text-sm text-muted-foreground">Loading recent…</div>
                  ) : recent.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No recent results</div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {recent.map((f)=> (
                        <MatchCard key={f.id} fixture={f} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Latest News</CardTitle>
                </CardHeader>
                <CardContent>
                  {newsLoading ? (
                    <div className="text-sm text-muted-foreground">Loading news…</div>
                  ) : newsError ? (
                    <div className="text-sm text-destructive">{newsError}</div>
                  ) : news.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No recent headlines available right now.</div>
                  ) : (
                    <div className="space-y-4">
                      {news.map((article) => (
                        <a
                          key={article.id}
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block rounded-lg border border-border p-4 transition hover:border-primary hover:shadow"
                        >
                          <div className="flex items-start gap-3">
                            {article.imageUrl ? (
                              <img
                                src={article.imageUrl}
                                alt={article.title || 'news image'}
                                className="h-20 w-28 flex-shrink-0 rounded-md object-cover"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : null}

                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-foreground truncate">{article.title}</div>
                              {article.summary && (
                                <div className="text-sm text-muted-foreground line-clamp-3">{article.summary}</div>
                              )}
                              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-2">
                                {article.source && <span className="truncate">{article.source}</span>}
                                {article.publishedAt && (
                                  <time dateTime={article.publishedAt} className="truncate">
                                    {new Date(article.publishedAt).toLocaleString()}
                                  </time>
                                )}
                              </div>
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
