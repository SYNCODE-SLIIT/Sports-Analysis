"use client";

import { Hero } from "@/components/Hero";
import { LiveRail } from "@/components/LiveRail";
import { LeagueTabs } from "@/components/LeagueTabs";
import { HighlightsCarousel } from "@/components/HighlightsCarousel";
import { InfoSpotlight } from "@/components/InfoSpotlight";
import { useLiveMatches, useHighlights } from "@/hooks/useData";
import { useEffect, useState } from "react";
import { listEvents } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";

export default function Home() {
  const { data: liveMatches = [], isLoading: liveLoading } = useLiveMatches();
  const { data: highlights = [], isLoading: highlightsLoading } = useHighlights();
  const [recentFallback, setRecentFallback] = useState<Fixture[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);

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
          matches={liveMatches.length > 0 ? liveMatches : recentFallback}
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
