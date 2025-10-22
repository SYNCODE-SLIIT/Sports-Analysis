"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatchCard } from "@/components/MatchCard";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { EmptyState } from "@/components/EmptyState";
import { useLiveMatches, useTodayScheduledMatches } from "@/hooks/useData";
import leagueMetadataJson from "@/app/leagues/league-metadata.json";
import type { Fixture } from "@/lib/schemas";

type LeagueMetadata = {
  slug: string;
  name: string;
  country?: string;
};

interface LeagueTabsProps {
  className?: string;
}

type MajorLeagueConfig = {
  slug: string;
  code: string;
  fallbackCountry?: string;
};

type MajorLeague = {
  id: string;
  code: string;
  name: string;
  country?: string;
  queryName: string;
};

const MAJOR_LEAGUE_CONFIG: MajorLeagueConfig[] = [
  { slug: "english_premier_league", code: "PL" },
  { slug: "la_liga", code: "LL" },
  { slug: "serie_a", code: "SA" },
  { slug: "bundesliga", code: "BUN" },
  { slug: "ligue_1", code: "L1" },
  { slug: "uefa_champions_league", code: "UCL", fallbackCountry: "Europe" },
];

const LEAGUE_METADATA = leagueMetadataJson as LeagueMetadata[];

const metadataBySlug = new Map(
  LEAGUE_METADATA.map((entry) => [entry.slug, entry])
);

const MAJOR_LEAGUES: MajorLeague[] = MAJOR_LEAGUE_CONFIG
  .map(({ slug, code, fallbackCountry }) => {
    const metadata = metadataBySlug.get(slug);
    if (!metadata) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[LeagueTabs] Missing metadata for slug '${slug}'`);
      }
      return null;
    }

    const name = metadata.name?.trim() || slug.replace(/_/g, " ");
    const countryRaw = metadata.country?.trim();

    const formatCountry = (value?: string) => {
      if (!value) return undefined;
      const normalized = value
        .replace(/[_-]+/g, " ")
        .split(" ")
        .filter(Boolean)
        .map((segment) => {
          if (segment.length <= 3) return segment.toUpperCase();
          return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
        })
        .join(" ");
      return normalized;
    };

    const country =
      formatCountry(countryRaw) ??
      formatCountry(fallbackCountry) ??
      fallbackCountry;

    return {
      id: slug,
      code,
      name,
      country,
      queryName: metadata.name?.trim() || name,
    };
  })
  .filter((league): league is MajorLeague => league !== null);

const GRID_CLASSES =
  "grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3";
const MAX_FIXTURES_PER_SECTION = 6;

function FixtureGrid({
  fixtures,
  animationDelayStep = 0.08,
}: {
  fixtures: Fixture[];
  animationDelayStep?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className={GRID_CLASSES}
    >
      {fixtures.map((fixture, index) => (
        <motion.div
          key={fixture.id ?? `${fixture.home_team}-${fixture.away_team}-${index}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * animationDelayStep, duration: 0.35 }}
        >
          <MatchCard fixture={fixture} />
        </motion.div>
      ))}
    </motion.div>
  );
}

function LoadingGrid() {
  return (
    <div className={GRID_CLASSES}>
      {Array.from({ length: MAX_FIXTURES_PER_SECTION }).map((_, index) => (
        <MatchCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function LeagueTabs({ className }: LeagueTabsProps) {
  const defaultLeagueId = MAJOR_LEAGUES[0]?.id ?? "";
  const [selectedLeague, setSelectedLeague] = useState(defaultLeagueId);
  const [sectionTab, setSectionTab] = useState<"live" | "upcoming">("live");

  const activeLeague =
    useMemo(
      () =>
        MAJOR_LEAGUES.find((league) => league.id === selectedLeague) ??
        MAJOR_LEAGUES[0],
      [selectedLeague]
    ) ?? null;

  const leagueName = activeLeague?.queryName;

  useEffect(() => {
    setSectionTab("live");
  }, [selectedLeague]);

  const {
    data: liveMatches = [],
    isLoading: liveLoading,
    error: liveError,
    refetch: refetchLive,
  } = useLiveMatches(
    leagueName ? { leagueName } : undefined
  );

  const {
    data: upcomingMatches = [],
    isLoading: upcomingLoading,
    error: upcomingError,
    refetch: refetchUpcoming,
  } = useTodayScheduledMatches(
    leagueName ? { leagueName } : undefined
  );

  const liveFixtures = liveMatches.slice(0, MAX_FIXTURES_PER_SECTION);
  const upcomingFixtures = upcomingMatches.slice(0, MAX_FIXTURES_PER_SECTION);
  const hasLiveMatches =
    !liveLoading && !liveError && liveFixtures.length > 0;

  if (!MAJOR_LEAGUES.length) {
    return (
      <EmptyState
        type="no-matches"
        title="Unable to load featured leagues"
        description="We could not locate the featured leagues in the metadata set."
      />
    );
  }

  return (
    <div className={className}>
      <Tabs
        value={selectedLeague || defaultLeagueId}
        onValueChange={setSelectedLeague}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {MAJOR_LEAGUES.map((league) => (
            <TabsTrigger
              key={league.id}
              value={league.id}
              className="text-xs font-semibold uppercase md:text-sm"
            >
              {league.code}
            </TabsTrigger>
          ))}
        </TabsList>

        {activeLeague ? (
          <TabsContent
            key={activeLeague.id}
            value={activeLeague.id}
            className="space-y-10"
          >
            <header className="flex flex-col gap-1">
              <h3 className="text-xl font-semibold text-foreground">
                {activeLeague.name}
              </h3>
              {activeLeague.country ? (
                <p className="text-sm text-muted-foreground">
                  {activeLeague.country}
                </p>
              ) : null}
            </header>

            <Tabs
              value={sectionTab}
              onValueChange={(value) =>
                setSectionTab(value as "live" | "upcoming")
              }
              className="space-y-4"
            >
              <TabsList className="grid w-full grid-cols-2 rounded-xl bg-muted p-1">
                <TabsTrigger value="live" className="text-sm font-semibold">
                  <span className="flex items-center justify-center gap-2">
                    {hasLiveMatches ? (
                      <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    ) : null}
                    Live Now
                  </span>
                </TabsTrigger>
                <TabsTrigger value="upcoming" className="text-sm font-semibold">
                  Upcoming
                </TabsTrigger>
              </TabsList>

              <TabsContent value="live" className="space-y-4">
                {liveError ? (
                  <EmptyState
                    type="error"
                    title="Unable to load live fixtures"
                    description="We ran into an issue while fetching live fixtures. Try again in a moment."
                    onAction={() => {
                      void refetchLive();
                    }}
                  />
                ) : liveLoading ? (
                  <LoadingGrid />
                ) : liveFixtures.length ? (
                  <FixtureGrid fixtures={liveFixtures} />
                ) : (
                  <EmptyState
                    type="no-matches"
                    title="No live matches right now"
                    description="Check back later or explore the upcoming fixtures below."
                  />
                )}
              </TabsContent>

              <TabsContent value="upcoming" className="space-y-4">
                {upcomingError ? (
                  <EmptyState
                    type="error"
                    title="Unable to load upcoming fixtures"
                    description="We could not fetch the upcoming schedule for this league."
                    onAction={() => {
                      void refetchUpcoming();
                    }}
                  />
                ) : upcomingLoading ? (
                  <LoadingGrid />
                ) : upcomingFixtures.length ? (
                  <FixtureGrid
                    fixtures={upcomingFixtures}
                    animationDelayStep={0.05}
                  />
                ) : (
                  <EmptyState
                    type="no-matches"
                    title="No fixtures scheduled in the next few days"
                    description="We could not find any upcoming fixtures for this league in the short-term window."
                  />
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
