"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { MatchCard } from "@/components/MatchCard";
import { EmptyState } from "@/components/EmptyState";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { useLiveMatches } from "@/hooks/useData";

const SKELETON_PLACEHOLDERS = 4;

export function LiveNowSection() {
  const {
    data: liveMatches = [],
    isLoading,
    error,
    refetch,
  } = useLiveMatches();

  const matches = useMemo(() => liveMatches, [liveMatches]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
        <h2 className="text-xl font-semibold">Live Now</h2>
      </div>

      {error ? (
        <EmptyState
          type="error"
          title="Unable to load live matches"
          description="We ran into an issue while fetching live matches. Try again in a moment."
          onAction={() => {
            void refetch();
          }}
        />
      ) : isLoading ? (
        <ScrollArea className="w-full">
          <div className="flex gap-4 pb-4">
            {Array.from({ length: SKELETON_PLACEHOLDERS }).map((_, idx) => (
              <div key={idx} className="w-[420px] flex-shrink-0">
                <MatchCardSkeleton />
              </div>
            ))}
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      ) : matches.length === 0 ? (
        <EmptyState
          type="no-matches"
          title="No matches are live right now"
          description="Check back again soon or explore the fixtures scheduled later today."
        />
      ) : (
        <ScrollArea className="w-full">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-4 pb-4"
          >
            {matches.map((match, index) => (
              <motion.div
                key={match.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.08 }}
                className="w-[420px] flex-shrink-0"
              >
                <MatchCard fixture={match} />
              </motion.div>
            ))}
          </motion.div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      )}
    </section>
  );
}
