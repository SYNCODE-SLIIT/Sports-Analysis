"use client";

import { Hero } from "@/components/Hero";
import { LiveNowSection } from "@/components/LiveNowSection";
import { LeagueTabs } from "@/components/LeagueTabs";
import { HighlightsCarousel } from "@/components/HighlightsCarousel";
import { InfoSpotlight } from "@/components/InfoSpotlight";
import { useHighlights } from "@/hooks/useData";

export default function Home() {
  const { data: highlights = [], isLoading: highlightsLoading } = useHighlights();

  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <Hero />

      {/* Live Matches */}
      <section className="container">
        <LiveNowSection />
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
