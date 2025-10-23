"use client";

import { Hero } from "@/components/Hero";
import { LiveUpcomingTabs } from "@/components/LiveUpcomingTabs";
import { LeagueTabs } from "@/components/LeagueTabs";
import FootballNews from "@/components/FootballNews";
import { InfoSpotlight } from "@/components/InfoSpotlight";

export default function Home() {
  return (
    <div className="space-y-16">
      {/* Hero Section */}
      <Hero />

      {/* Live Matches */}
      <section className="container">
        <LiveUpcomingTabs />
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

      {/* Football News */}
      <section className="container space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Football News</h2>
          <p className="text-muted-foreground">
            Stay in the loop with breaking stories and match-day insights.
          </p>
        </div>
        <FootballNews
          limit={4}
          moreHref="/news"
          moreLabel="Explore more"
          variant="preview"
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
