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

export default function LivePage() {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [leagueFilter, setLeagueFilter] = useState("");
  const { data: liveMatches = [], isLoading, error } = useLiveMatches({ leagueName: leagueFilter || undefined });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(sanitizeInput(search)), 300);
    return () => clearTimeout(t);
  }, [search]);

  const leagueOptions = useMemo(() => {
    const set = new Set<string>();
    for (const m of liveMatches) if (m.league) set.add(m.league);
    return Array.from(set);
  }, [liveMatches]);

  const filtered = useMemo(() => {
    if (!debounced) return liveMatches;
    const q = debounced.toLowerCase();
    return liveMatches.filter(m =>
      m.home_team.toLowerCase().includes(q) ||
      m.away_team.toLowerCase().includes(q) ||
      (m.league?.toLowerCase().includes(q) ?? false)
    );
  }, [debounced, liveMatches]);

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