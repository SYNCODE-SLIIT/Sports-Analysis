"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { LiveRail } from "@/components/LiveRail";
import { MatchCard } from "@/components/MatchCard";
import { EmptyState } from "@/components/EmptyState";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { useLiveMatches } from "@/hooks/useData";
import { Input } from "@/components/ui/input";
import { sanitizeInput } from "@/lib/collect";
import { useAuth } from "@/components/AuthProvider";

export default function LivePage() {
  const { user, supabase } = useAuth();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [leagueFilter, setLeagueFilter] = useState("");
  const { data: liveMatches = [], isLoading, error } = useLiveMatches({ leagueName: leagueFilter || undefined });
  const [favTeams, setFavTeams] = useState<string[]>([]);
  const [favLeagues, setFavLeagues] = useState<string[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(sanitizeInput(search)), 300);
    return () => clearTimeout(t);
  }, [search]);

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

  const leagueOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of liveMatches) if (m.league) set.add(m.league);
    return Array.from(set);
  }, [liveMatches]);

  const filtered = useMemo(() => {
    const base = (!debounced) ? liveMatches : liveMatches.filter(m => {
      const q = debounced.toLowerCase();
      return m.home_team.toLowerCase().includes(q) ||
        m.away_team.toLowerCase().includes(q) ||
        (m.league?.toLowerCase().includes(q) ?? false) ||
        (m.venue?.toLowerCase().includes(q) ?? false);
    });
    if (favTeams.length === 0 && favLeagues.length === 0) return base;
    // Boost: favorite teams > favorite leagues
    return [...base]
      .map((m, idx) => {
        const teamBoost = (favTeams.includes(m.home_team) ? 3 : 0) + (favTeams.includes(m.away_team) ? 3 : 0);
        const leagueBoost = favLeagues.includes(m.league ?? '') ? 2 : 0;
        const score = teamBoost + leagueBoost;
        return { m, idx, score };
      })
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .map(x => x.m);
  }, [debounced, liveMatches, favTeams, favLeagues]);

  if (error) {
    return (
      <div className="container py-8">
        <EmptyState 
          type="error" 
          onAction={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="flex items-center space-x-3">
          <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
          <h1 className="text-3xl font-bold">Live Matches</h1>
        </div>
        <p className="text-muted-foreground">
          Follow live football matches with real-time updates and win probabilities.
          Updates every 15 seconds automatically.
        </p>
      </motion.div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <Input placeholder="Search teams or league" value={search} onChange={(e)=>setSearch(e.target.value)} />
        </div>
        <div>
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={leagueFilter} onChange={(e)=>setLeagueFilter(e.target.value)}>
            <option value="">All leagues</option>
            {leagueOptions.map((l)=> (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Live Rail */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Currently Live</h2>
        <LiveRail matches={filtered} isLoading={isLoading} />
      </section>

      {/* All Live Matches Grid */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">All Live Matches</h2>
        
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <MatchCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState 
            type="no-matches" 
            title="No live matches"
            description="There are no matches being played at the moment. Check back later or browse upcoming fixtures."
          />
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          >
            {filtered.map((match, index) => (
              <motion.div
                key={match.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                <MatchCard fixture={match} />
              </motion.div>
            ))}
          </motion.div>
        )}
      </section>
    </div>
  );
}
