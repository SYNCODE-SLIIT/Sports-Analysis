"use client";

import React from "react";
import Link from "next/link";
// ...existing code...

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveNowSection } from "@/components/LiveNowSection";
import { useTodayScheduledMatches } from "@/hooks/useData";
import { MatchCard } from "@/components/MatchCard";
import { EmptyState } from "@/components/EmptyState";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

// ...existing code...
export function LiveUpcomingTabs() {
  // ...existing code...

  return (
    <section className="space-y-6">
      <Tabs defaultValue="live" className="space-y-6">
        <TabsList className="w-full flex justify-between rounded-xl bg-muted p-1">
          <TabsTrigger value="live" className="flex-1 text-base py-2">
            <span className="flex items-center justify-center gap-2">
              <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
              Live Now
            </span>
          </TabsTrigger>
          <TabsTrigger value="upcoming" className="flex-1 text-base py-2">
            Upcoming
          </TabsTrigger>
        </TabsList>
        <TabsContent value="live" className="mt-2">
          <LiveNowSection showHeading={false} enablePagination={false} enableAutoScroll={false} />
        </TabsContent>
        <TabsContent value="upcoming" className="mt-2">
          <UpcomingGridSection />
        </TabsContent>
      </Tabs>
      {/* Removed duplicate Explore more button to avoid two on the page */}
    </section>
  );
}

// New: UpcomingGridSection for consistent upcoming matches display
function UpcomingGridSection() {
  const {
    data: upcoming = [],
    isLoading,
    error,
    refetch,
  } = useTodayScheduledMatches();
  const MAX_MATCHES = 6;
  const matches = upcoming.slice(0, MAX_MATCHES);

  if (error) {
    return (
      <EmptyState
        type="error"
        title="Unable to load the upcoming schedule"
        description="We couldn't load the list of upcoming fixtures. Please retry."
        onAction={() => { void refetch(); }}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: MAX_MATCHES }).map((_, idx) => (
          <MatchCardSkeleton key={idx} />
        ))}
      </div>
    );
  }

  if (upcoming.length === 0) {
    return (
      <EmptyState
        type="no-matches"
        title="No upcoming fixtures found"
        description="We couldn't find any upcoming fixtures in the current window. Try another league or check back soon."
      />
    );
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3"
      >
        {matches.map((match, index) => (
          <motion.div
            key={match.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <MatchCard fixture={match} />
          </motion.div>
        ))}
      </motion.div>
      <div className="flex justify-center mt-6">
        <Button variant="default" asChild>
          <Link href="/live">Explore more</Link>
        </Button>
      </div>
    </>
  );
}

// ...existing code...
