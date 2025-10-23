"use client";

import React, { useMemo, useState, useRef } from "react";
import { motion } from "framer-motion";
import { MatchCard } from "@/components/MatchCard";
import { EmptyState } from "@/components/EmptyState";
import { MatchCardSkeleton } from "@/components/Skeletons";
import { useTodayScheduledMatches } from "@/hooks/useData";

const SKELETON_ITEMS = 6;

type ScheduledTodaySectionProps = {
  onPageChangeAction?: () => void;
  showHeading?: boolean;
  headingLabel?: string;
  enablePagination?: boolean;
  enableAutoScroll?: boolean;
};

export function ScheduledTodaySection({
  onPageChangeAction,
  showHeading = true,
  headingLabel = "Upcoming Fixtures",
  enablePagination = true,
  enableAutoScroll = true,
}: ScheduledTodaySectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const {
    data: scheduled = [],
    isLoading,
    error,
    refetch,
  } = useTodayScheduledMatches();

  const FIXTURES_PER_PAGE = 6;
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(scheduled.length / FIXTURES_PER_PAGE);

  // Offset (px) to leave above the section when scrolling so it sits slightly
  // below the top edge (adjust for fixed header height).
  const SCROLL_OFFSET = 72;

  const scrollToSectionWithOffset = (offset = SCROLL_OFFSET) => {
    if (typeof window === "undefined") return;
    if (sectionRef.current) {
      const rect = sectionRef.current.getBoundingClientRect();
      const top = rect.top + window.scrollY - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  // Scroll after page updates to ensure DOM has updated (consistent with LiveNow and News)
  React.useEffect(() => {
    if (!enableAutoScroll) return;
    scrollToSectionWithOffset();
  }, [page, enableAutoScroll]);

  const matches = useMemo(() => {
    return scheduled.slice(
      (page - 1) * FIXTURES_PER_PAGE,
      page * FIXTURES_PER_PAGE
    );
  }, [scheduled, page]);

  if (error) {
    return (
      <section ref={sectionRef} className="space-y-4">
        {showHeading && <h2 className="text-xl font-semibold">{headingLabel}</h2>}
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

  const handlePageChange = (newPage: number) => {
    if (!enablePagination || newPage === page) return;
    setPage(newPage);
    // Scroll the section into view on page change so the user is taken to the top
    // of this section (falls back to window top if ref is not available).
    if (sectionRef.current && typeof sectionRef.current.scrollIntoView === "function") {
      if (enableAutoScroll) {
        sectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (typeof window !== "undefined" && enableAutoScroll) {
      const top = sectionRef.current?.offsetTop ?? 0;
      window.scrollTo({ top, behavior: "smooth" });
    }
    if (onPageChangeAction) onPageChangeAction();
  };

  const shouldShowPagination = enablePagination && totalPages > 1;

  return (
    <section ref={sectionRef} className="space-y-4">
      {showHeading && <h2 className="text-xl font-semibold">{headingLabel}</h2>}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: SKELETON_ITEMS }).map((_, idx) => (
            <MatchCardSkeleton key={idx} />
          ))}
        </div>
      ) : scheduled.length === 0 ? (
        <EmptyState
          type="no-matches"
          title="No upcoming fixtures found"
          description="We couldn&apos;t find any upcoming fixtures in the current window. Try another league or check back soon."
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
                transition={{ delay: index * 0.05 }}
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
        </>
      )}
    </section>
  );
}
