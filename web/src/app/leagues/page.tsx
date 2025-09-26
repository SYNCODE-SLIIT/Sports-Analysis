"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Users, Calendar, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LeagueTabs } from "@/components/LeagueTabs";
import { MatchCard } from "@/components/MatchCard";
import { Input } from "@/components/ui/input";
import { useLiveMatches } from "@/hooks/useData";
import { listEvents, getLeagueTable, sanitizeInput } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";

const featuredLeagues = [
  {
    id: "premier-league",
    name: "Premier League",
    country: "England",
    icon: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    teams: 20,
    description: "The top tier of English football, featuring the world's best clubs."
  },
  {
    id: "la-liga",
    name: "La Liga",
    country: "Spain", 
    icon: "🇪🇸",
    teams: 20,
    description: "Spain's premier football league, home to Real Madrid and Barcelona."
  },
  {
    id: "serie-a",
    name: "Serie A",
    country: "Italy",
    icon: "🇮🇹", 
    teams: 20,
    description: "Italy's top football league, known for tactical excellence."
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Germany",
    icon: "🇩🇪",
    teams: 18,
    description: "Germany's premier league, famous for its passionate fan culture."
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    country: "France",
    icon: "🇫🇷",
    teams: 20,
    description: "France's top division, featuring PSG and other elite clubs."
  },
  {
    id: "champions-league",
    name: "Champions League",
    country: "Europe",
    icon: "🏆",
    teams: 32,
    description: "Europe's premier club competition, the pinnacle of club football."
  }
];

type LeagueLite = { league_id?: string; league_name: string; country_name?: string };

export default function LeaguesPage() {
  const [allLeagues, setAllLeagues] = useState<LeagueLite[]>([]);
  const [search, setSearch] = useState("");
  const [selectedLeague, setSelectedLeague] = useState<string>("");
  const [standings, setStandings] = useState<Array<{ position?: number; team?: string; played?: number; points?: number }>>([]);
  const [standingsLoading, setStandingsLoading] = useState(false);
  const { data: liveInLeague = [], isLoading: liveLoading } = useLiveMatches({ leagueName: selectedLeague || undefined });
  const [upcoming, setUpcoming] = useState<Fixture[]>([]);
  const [recent, setRecent] = useState<Fixture[]>([]);
  const [loadingUpcoming, setLoadingUpcoming] = useState(false);
  const [loadingRecent, setLoadingRecent] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/leagues").then(r=>r.json()).then(j => {
      if (!active) return;
      const ls = Array.isArray(j?.leagues) ? j.leagues as LeagueLite[] : [];
      setAllLeagues(ls);
    }).catch(()=> setAllLeagues([]));
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = sanitizeInput(search).toLowerCase();
    if (!q) return allLeagues;
    return allLeagues.filter(l =>
      l.league_name.toLowerCase().includes(q) || (l.country_name?.toLowerCase().includes(q) ?? false)
    );
  }, [search, allLeagues]);

  // Load panels when selected league changes
  useEffect(() => {
    if (!selectedLeague) return;
    let active = true;
    setStandingsLoading(true);
    getLeagueTable(selectedLeague).then(env => {
      if (!active) return;
      const d = env.data as { table?: Array<Record<string, unknown>> } | undefined;
      const arr = (d && Array.isArray(d.table)) ? d.table : [];
      const mapped = arr.slice(0,10).map((r, i) => {
        const rec = r as Record<string, unknown>;
        const rank = rec.rank;
        const teamName = typeof rec.team_name === 'string' ? rec.team_name : undefined;
        return {
          position: typeof rec.position === 'number' ? rec.position : (typeof rank === 'string' ? Number(rank) : i+1),
          team: typeof rec.team === 'string' ? rec.team : teamName,
          played: typeof rec.played === 'number' ? rec.played : undefined,
          points: typeof rec.points === 'number' ? rec.points : undefined,
        };
      });
      setStandings(mapped);
    }).catch(()=> setStandings([])).finally(()=> setStandingsLoading(false));

    setLoadingUpcoming(true);
    listEvents({ leagueName: selectedLeague, kind: 'upcoming', days: 7 }).then(env => {
  const d = env.data as Record<string, unknown> | undefined;
  const ev = d && typeof d === 'object' ? (d as Record<string, unknown>).events : [];
  setUpcoming(Array.isArray(ev) ? parseFixtures(ev) : []);
    }).catch(()=> setUpcoming([])).finally(()=> setLoadingUpcoming(false));

    setLoadingRecent(true);
    listEvents({ leagueName: selectedLeague, kind: 'past', days: 3 }).then(env => {
  const d = env.data as Record<string, unknown> | undefined;
  const ev = d && typeof d === 'object' ? (d as Record<string, unknown>).events : [];
  setRecent(Array.isArray(ev) ? parseFixtures(ev) : []);
    }).catch(()=> setRecent([])).finally(()=> setLoadingRecent(false));

    return () => { active = false; };
  }, [selectedLeague]);
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

      {/* Featured Leagues Grid */}
      <section className="space-y-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Featured Leagues</h2>
          <p className="text-muted-foreground">
            The biggest competitions in world football
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {featuredLeagues.map((league, index) => (
            <motion.div
              key={league.id}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card className="h-full hover:shadow-lg transition-all duration-200 cursor-pointer group">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-3">
                    <span className="text-2xl">{league.icon}</span>
                    <div>
                      <div className="font-bold group-hover:text-primary transition-colors">
                        {league.name}
                      </div>
                      <div className="text-sm text-muted-foreground font-normal">
                        {league.country}
                      </div>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {league.description}
                  </p>
                  
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center space-x-1">
                      <Users className="h-3 w-3" />
                      <span>{league.teams} teams</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Calendar className="h-3 w-3" />
                      <span>Active</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Today's Fixtures */}
      <section className="space-y-8">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Today&apos;s Fixtures</h2>
          <p className="text-muted-foreground">
            Browse matches by league and get detailed analysis
          </p>
        </div>
        
        <LeagueTabs />
      </section>

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((l, idx) => (
            <motion.div key={`${l.league_name}-${idx}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <Card className={`cursor-pointer ${selectedLeague === l.league_name ? 'ring-1 ring-primary' : ''}`} onClick={()=> setSelectedLeague(l.league_name)}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-semibold">{l.league_name}</div>
                      {l.country_name && <div className="text-xs text-muted-foreground">{l.country_name}</div>}
                    </div>
                    <div className="text-xs text-muted-foreground">Select</div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {selectedLeague && (
          <div className="space-y-6">
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
          </div>
        )}
      </section>
    </div>
  );
}