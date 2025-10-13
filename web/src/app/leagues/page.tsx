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
    const logo = getFirstString(obj, [
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
  const { user, supabase } = useAuth();
  const [allLeagues, setAllLeagues] = useState<LeagueLite[]>([]);
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
        const data = mapLeagues((env?.data as unknown) ?? []);
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
      setDateMatches(parseFixtures(rawEvents));
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
        setLiveInLeague(fixtures);
      } else {
        setLiveInLeague([]);
      }

      if (upcomingRes.status === "fulfilled") {
        const events = extractEvents(upcomingRes.value.data);
        setUpcoming(parseFixtures(events));
      } else {
        setUpcoming([]);
      }

      if (recentRes.status === "fulfilled") {
        const events = extractEvents(recentRes.value.data);
        setRecent(parseFixtures(events));
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
                  className={`cursor-pointer border transition hover:shadow-md focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 ${isSelected ? 'border-primary shadow-lg' : ''}`}
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
                  className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                  onClick={applyDateFilter}
                  disabled={dateLoading}
                >
                  {dateLoading ? 'Loading…' : 'Apply'}
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" title="Like" className="transition-transform active:scale-95" onClick={() => ensureLeagueItemAndSend(selectedLeague, 'like')}>
                <ThumbsUp className="w-4 h-4 mr-1"/> Like
              </Button>
              <Button variant="outline" size="sm" title="Save" className="transition-transform active:scale-95" onClick={() => ensureLeagueItemAndSend(selectedLeague, 'save')}>
                <Bookmark className="w-4 h-4 mr-1"/> Save
              </Button>
              <Button variant="outline" size="sm" title="Share" className="transition-transform active:scale-95" onClick={() => ensureLeagueItemAndSend(selectedLeague, 'share')}>
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
