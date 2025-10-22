"use client";

import React, { useMemo, useState, useRef } from "react";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { MatchCard } from "@/components/MatchCard";
import { EmptyState } from "@/components/EmptyState";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { useLiveMatches } from "@/hooks/useData";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type LiveNowSectionProps = {
  onPageChangeAction?: () => void;
  showHeading?: boolean;
  enablePagination?: boolean;
  enableAutoScroll?: boolean;
};

export function LiveNowSection({
  onPageChangeAction,
  showHeading = true,
  enablePagination = true,
  enableAutoScroll = true,
}: LiveNowSectionProps) {
  const {
    data: liveMatches = [],
    isLoading,
    error,
    refetch,
  } = useLiveMatches();

  const LIVE_PER_PAGE = 6;
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(liveMatches.length / LIVE_PER_PAGE);
  const sectionRef = useRef<HTMLElement>(null);
  // Amount of space (px) to offset from the top when scrolling so the section
  // appears slightly higher than the top edge (adjust for a fixed header).
  const SCROLL_OFFSET = 72;

  const scrollToSectionWithOffset = (offset = SCROLL_OFFSET) => {
    if (typeof window === "undefined") return;
    if (sectionRef.current) {
      const rect = sectionRef.current.getBoundingClientRect();
      const top = rect.top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  // Scroll after page updates to ensure DOM has updated (matches FootballNews behavior)
  useEffect(() => {
    if (!enableAutoScroll) return;
    scrollToSectionWithOffset();
  }, [page, enableAutoScroll]);

  const matches = useMemo(() => {
    return liveMatches.slice(
      (page - 1) * LIVE_PER_PAGE,
      page * LIVE_PER_PAGE
    );
  }, [liveMatches, page]);

  const handlePageChange = (newPage: number) => {
    if (!enablePagination || newPage === page) return;
    setPage(newPage);
    // Scroll this section into view on page change so the user is taken to the top
    // of this section (falls back to window top if ref is not available).
    // Immediate attempt to scroll; the effect will run after render as well.
    if (enableAutoScroll) {
      scrollToSectionWithOffset();
    }
    if (onPageChangeAction) onPageChangeAction();
  };

  const shouldShowPagination = enablePagination && totalPages > 1;

  return (
    <section ref={sectionRef} className="space-y-4">
      {showHeading && (
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <h2 className="text-xl font-semibold">Live Now</h2>
        </div>
      )}

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
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: LIVE_PER_PAGE }).map((_, idx) => (
            <MatchCardSkeleton key={idx} />
          ))}
        </div>
      ) : liveMatches.length === 0 ? (
        <EmptyState
          type="no-matches"
          title="No matches are live right now"
          description="Check back again soon or explore the fixtures scheduled later today."
        />
      ) : (
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
                transition={{ delay: index * 0.08 }}
              >
                <MatchCard fixture={match} />
              </motion.div>
            ))}
          </motion.div>
          {shouldShowPagination && (
            <div className="flex flex-col items-center justify-center gap-2 mt-6">
              <div className="flex items-center gap-2">
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                >
                  Previous
                </button>
                {/* Page numbers with ellipsis logic */}
                {(() => {
                  const pages = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) {
                      pages.push(i);
                    }
                  } else {
                    if (page <= 4) {
                      pages.push(1, 2, 3, 4, 5, '...', totalPages);
                    } else if (page >= totalPages - 3) {
                      pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
                    } else {
                      pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
                    }
                  }
                  return pages.map((p, idx) =>
                    p === '...'
                      ? <span key={"ellipsis-" + idx} className="px-2">...</span>
                      : <button
                          key={p}
                          className={`px-3 py-1 border rounded font-semibold transition-colors ${page === p ? "bg-gray-400 text-black border-gray-400" : "bg-background text-foreground border-muted"}`}
                          onClick={() => handlePageChange(Number(p))}
                          disabled={page === p}
                        >{p}</button>
                  );
                })()}
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                >
                  Next
                </button>
              </div>
              <span>
                Page {page} of {totalPages}
              </span>
            </div>
          )}
          <div className="flex justify-center mt-6">
            <Button variant="default" asChild>
              <Link href="/live">Explore more</Link>
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
