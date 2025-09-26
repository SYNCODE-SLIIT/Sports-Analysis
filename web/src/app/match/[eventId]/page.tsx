"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Calendar, MapPin, Users, Trophy, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HighlightsCarousel } from "@/components/HighlightsCarousel";
import { getEventResults, getHighlights, DataObject, searchEventHighlight, getOdds, getComments, getLeagueTable } from "@/lib/collect";
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
      const core: DataObject | undefined = (d && typeof d === 'object' && 'event' in d) ? (d as { event?: DataObject }).event : (d as DataObject);
      if (!core) return;
      const normalized: RenderEvent = {
        eventId: getString(core, ['eventId', 'id', 'event_id'], String(eventId))!,
        homeTeam: getString(core, ['homeTeam', 'home_team', 'home'], 'Home')!,
        awayTeam: getString(core, ['awayTeam', 'away_team', 'away'], 'Away')!,
        homeScore: getNumber(core, ['homeScore', 'home_score', 'score.home'], 0) || 0,
        awayScore: getNumber(core, ['awayScore', 'away_score', 'score.away'], 0) || 0,
        status: getString(core, ['status'], '') || '',
        league: getString(core, ['league', 'competition']) || undefined,
        venue: getString(core, ['venue', 'stadium']) || undefined,
        date: getString(core, ['date', 'datetime', 'kickoff'], new Date().toISOString())!,
        attendance: getNumber(core, ['attendance']) || undefined,
        winProbabilities: (core['winProbabilities'] || core['winprob']) as RenderEvent['winProbabilities'],
        stats: (core['stats'] as MatchStats) || undefined,
        events: Array.isArray(core['events']) ? (core['events'] as Array<{ time?: number; type?: string; team?: string; player?: string }>) : [],
      };
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

    // Compute win probabilities from odds if missing
    getOdds(String(eventId)).then(env => {
      if (!active) return;
      const d = env.data as { odds?: Array<DataObject> } | undefined;
      const odds = (d && Array.isArray(d.odds)) ? d.odds : [];
      if (!odds.length) return;
      const pickNum = (o: DataObject, keys: string[]) => {
        for (const k of keys) {
          const v = (o as Record<string, unknown>)[k];
          if (typeof v === 'number') return v;
          if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
        }
        return undefined;
      };
      // Try to find a 1X2 market
      const o = odds[0] as Record<string, unknown>;
      const h = pickNum(o as DataObject, ['home','home_odds','H','one','1']);
      const dDraw = pickNum(o as DataObject, ['draw','draw_odds','X']);
      const a = pickNum(o as DataObject, ['away','away_odds','A','two','2']);
      if (h && dDraw && a) {
        const pH = 1 / h; const pD = 1 / dDraw; const pA = 1 / a;
        const sum = pH + pD + pA;
        const wp = { home: pH / sum, draw: pD / sum, away: pA / sum } as RenderEvent['winProbabilities'];
        setEvent(prev => prev ? { ...prev, winProbabilities: prev.winProbabilities ?? wp } : prev);
      }
    }).catch(() => {});

    return () => { active = false; };
  }, [eventId]);

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
                  {(((match.winProbabilities?.home ?? 0) * 100).toFixed(0))}%
                </div>
                <div className="text-sm text-muted-foreground">{match.homeTeam} Win</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-yellow-600">
                  {(((match.winProbabilities?.draw ?? 0) * 100).toFixed(0))}%
                </div>
                <div className="text-sm text-muted-foreground">Draw</div>
              </div>
              <div className="space-y-2">
                <div className="text-2xl font-bold text-blue-600">
                  {(((match.winProbabilities?.away ?? 0) * 100).toFixed(0))}%
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
            {match.events?.map((event: { time?: number; type?: string; team?: string; player?: string }, index: number) => (
              <Card key={index}>
                <CardContent className="p-4">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <span className="font-semibold text-primary">{event.time}&apos;</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2">
                        {event.type === "goal" && <div className="w-2 h-2 rounded-full bg-green-500"></div>}
                        {event.type === "yellow" && <div className="w-2 h-2 rounded-full bg-yellow-500"></div>}
                        {event.type === "red" && <div className="w-2 h-2 rounded-full bg-red-500"></div>}
                        <span className="font-medium capitalize">{event.type}</span>
                        <span className="text-muted-foreground">•</span>
                        <span>{event.player}</span>
                        <span className="text-muted-foreground">
                          ({event.team === "home" ? match.homeTeam : match.awayTeam})
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="analysis" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Match Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground leading-relaxed">
                  This was an exciting London derby with Arsenal taking control early through goals from Gabriel Jesus and Martin Ødegaard. 
                  Chelsea fought back with a goal from Raheem Sterling but couldn&apos;t find the equalizer despite late pressure.
                </p>
              </CardContent>
            </Card>
            <HighlightsCarousel highlights={highlights} isLoading={false} />

            {/* Standings */}
            {match.league && (
              <Card>
                <CardHeader>
                  <CardTitle>{match.league} Standings</CardTitle>
                </CardHeader>
                <CardContent>
                  <LeagueTable leagueName={match.league} onLoaded={setTable} rows={table} />
                </CardContent>
              </Card>
            )}

            {/* Comments */}
            {comments.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Match Comments</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {comments.map((c, i)=> (
                    <div key={i} className="text-sm text-muted-foreground">
                      {c.time && <span className="font-mono mr-2">{c.time}</span>}
                      <span>{c.text}</span>
                      {c.author && <span className="ml-2">— {c.author}</span>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

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

// Inline component to fetch and show league table while keeping page layout minimal
function LeagueTable({ leagueName, onLoaded, rows }: { leagueName: string; onLoaded: (r: Array<{ position?: number; team?: string; played?: number; points?: number }>) => void; rows: Array<{ position?: number; team?: string; played?: number; points?: number }>; }) {
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    getLeagueTable(leagueName).then(env => {
      if (!active) return;
      const d = env.data as { table?: Array<DataObject> } | undefined;
      const arr = (d && Array.isArray(d.table)) ? d.table : [];
      const mapped = arr.slice(0,10).map((r) => {
        const rec = r as unknown as Record<string, unknown>;
        const rankVal = rec.rank;
        const teamName = typeof rec.team_name === 'string' ? rec.team_name : undefined;
        return {
          position: typeof rec.position === 'number' ? rec.position : (typeof rankVal === 'string' && rankVal.trim() ? Number(rankVal) : undefined),
          team: typeof rec.team === 'string' ? rec.team : teamName,
          played: typeof rec.played === 'number' ? rec.played : undefined,
          points: typeof rec.points === 'number' ? rec.points : undefined,
        };
      });
      onLoaded(mapped);
    }).catch(()=> onLoaded([])).finally(()=> setLoading(false));
    return () => { active = false; };
  }, [leagueName, onLoaded]);
  if (loading && rows.length === 0) return <div className="text-sm text-muted-foreground">Loading standings…</div>;
  if (rows.length === 0) return <div className="text-sm text-muted-foreground">Standings unavailable</div>;
  return (
    <div className="text-sm">
      <div className="grid grid-cols-4 gap-2 font-medium text-muted-foreground mb-2">
        <div>#</div><div>Team</div><div>P</div><div>Pts</div>
      </div>
      <div className="space-y-1">
        {rows.map((r, i)=> (
          <div key={i} className="grid grid-cols-4 gap-2">
            <div>{r.position ?? i+1}</div>
            <div className="truncate">{r.team}</div>
            <div>{r.played ?? '-'}</div>
            <div>{r.points ?? '-'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}