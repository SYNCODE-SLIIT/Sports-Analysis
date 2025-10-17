"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { MatchCard } from "@/components/MatchCard";
import { EmptyState } from "@/components/EmptyState";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { useTodayScheduledMatches } from "@/hooks/useData";

const SKELETON_ITEMS = 6;

export function ScheduledTodaySection() {
  const {
    data: scheduled = [],
    isLoading,
    error,
    refetch,
  } = useTodayScheduledMatches();

  const matches = useMemo(() => scheduled, [scheduled]);

  if (error) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Upcoming Fixtures</h2>
        <EmptyState
          type="error"
          title="Unable to load the upcoming schedule"
          description="We couldn&apos;t load the list of upcoming fixtures. Please retry."
          onAction={() => {
            void refetch();
          }}
        />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Upcoming Fixtures</h2>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: SKELETON_ITEMS }).map((_, idx) => (
            <MatchCardSkeleton key={idx} />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <EmptyState
          type="no-matches"
          title="No upcoming fixtures found"
          description="We couldn&apos;t find any upcoming fixtures in the current window. Try another league or check back soon."
        />
      ) : (
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
      )}
    </section>
  );
}
