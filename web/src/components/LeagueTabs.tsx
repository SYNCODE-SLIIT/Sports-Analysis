"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatchCard } from "./MatchCard";
import { MatchCardSkeleton } from "./Skeletons";
import { EmptyState } from "./EmptyState";
import { useLeagueFixtures } from "@/hooks/useData";
import type { Fixture } from "@/lib/schemas";

const leagues = [
  { id: "premier-league", name: "Premier League", code: "PL" },
  { id: "la-liga", name: "La Liga", code: "ES" },
  { id: "serie-a", name: "Serie A", code: "IT" },
  { id: "bundesliga", name: "Bundesliga", code: "DE" },
  { id: "ligue-1", name: "Ligue 1", code: "FR" },
  { id: "champions-league", name: "Champions League", code: "UCL" },
];

interface LeagueTabsProps {
  className?: string;
}

function FixtureGrid({ fixtures, isLoading }: { fixtures: Fixture[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <MatchCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (!fixtures.length) {
    return <EmptyState type="no-matches" />;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
    >
      {fixtures.map((fixture, index) => (
        <motion.div
          key={fixture.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1, duration: 0.5 }}
        >
          <MatchCard fixture={fixture} />
        </motion.div>
      ))}
    </motion.div>
  );
}

export function LeagueTabs({ className }: LeagueTabsProps) {
  const [selectedLeague, setSelectedLeague] = useState(leagues[0].id);
  
  const { data: fixtures = [], isLoading } = useLeagueFixtures(selectedLeague);

  return (
    <div className={className}>
      <Tabs value={selectedLeague} onValueChange={setSelectedLeague}>
        <TabsList className="grid w-full grid-cols-3 lg:grid-cols-6">
          {leagues.map((league) => (
            <TabsTrigger
              key={league.id}
              value={league.id}
              className="text-xs md:text-sm"
            >
              {league.code}
            </TabsTrigger>
          ))}
        </TabsList>
        
        {leagues.map((league) => (
          <TabsContent key={league.id} value={league.id} className="mt-6">
            <div className="space-y-4">
              <h3 className="text-xl font-semibold">{league.name}</h3>
              <FixtureGrid fixtures={fixtures} isLoading={isLoading} />
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}