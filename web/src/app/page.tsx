"use client";

import { Hero } from "@/components/Hero";
import { LiveRail } from "@/components/LiveRail";
import { LeagueTabs } from "@/components/LeagueTabs";
import { HighlightsCarousel } from "@/components/HighlightsCarousel";
import { InfoSpotlight } from "@/components/InfoSpotlight";
import { useLiveMatches, useHighlights } from "@/hooks/useData";
import { useEffect, useMemo, useState } from "react";
import { listEvents } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";
import { useAuth } from "@/components/AuthProvider";

export default function Home() {
  const { user, supabase } = useAuth();
  const { data: liveMatches = [], isLoading: liveLoading } = useLiveMatches();
  const { data: highlights = [], isLoading: highlightsLoading } = useHighlights();
  const [recentFallback, setRecentFallback] = useState<Fixture[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [favTeams, setFavTeams] = useState<string[]>([]);
  const [favLeagues, setFavLeagues] = useState<string[]>([]);

  // If no live matches, immediately fetch recent past 1 day to avoid blank UI
  useEffect(() => {
    let active = true;
    if (liveLoading) return;
    if (liveMatches.length === 0) {
      setRecentLoading(true);
      listEvents({ kind: "past", days: 1 }).then((env) => {
        if (!active) return;
        const d = env.data as Record<string, unknown> | undefined;
        let events: Fixture[] = [];
        if (d && typeof d === 'object') {
          const ev = (d as Record<string, unknown>).events;
          if (Array.isArray(ev)) events = parseFixtures(ev);
        }
        setRecentFallback(events);
      }).catch(() => setRecentFallback([])).finally(() => setRecentLoading(false));
    } else {
      setRecentFallback([]);
    }
    return () => { active = false; };
  }, [liveLoading, liveMatches]);

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

  const boostedLive = useMemo(() => {
    const base = liveMatches.length > 0 ? liveMatches : recentFallback;
    if (favTeams.length === 0 && favLeagues.length === 0) return base;
    return [...base]
      .map((m, idx) => {
        const teamBoost = (favTeams.includes(m.home_team) ? 3 : 0) + (favTeams.includes(m.away_team) ? 3 : 0);
        const leagueBoost = favLeagues.includes(m.league ?? '') ? 2 : 0;
        return { m, idx, score: teamBoost + leagueBoost };
      })
      .sort((a, b) => (b.score - a.score) || (a.idx - b.idx))
      .map(x => x.m);
  }, [liveMatches, recentFallback, favTeams, favLeagues]);

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <Hero />

      {/* Live Matches Rail */}
      <section className="container space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">{liveMatches.length > 0 ? 'Live Now' : 'Recent Results'}</h2>
          <p className="text-muted-foreground">
            {liveMatches.length > 0 ? 'Follow live matches with real-time updates and probabilities' : 'No live games right now — here are recent results'}
          </p>
        </div>
        <LiveRail 
          matches={boostedLive}
          isLoading={liveLoading || recentLoading}
        />
      </section>

      {/* League Fixtures */}
      <section className="container space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Today&apos;s Fixtures</h2>
          <p className="text-muted-foreground">
            Browse matches across major football leagues
          </p>
        </div>
        <LeagueTabs />
      </section>

      {/* Highlights */}
      <section className="container space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Match Highlights</h2>
          <p className="text-muted-foreground">
            Watch the best moments from recent matches
          </p>
        </div>
        <HighlightsCarousel 
          highlights={highlights} 
          isLoading={highlightsLoading}
        />
      </section>

      {/* Analysis Spotlight */}
      <section className="bg-muted/30 py-16">
        <div className="container">
          <InfoSpotlight />
        </div>
      </section>
    </div>
  );
}
