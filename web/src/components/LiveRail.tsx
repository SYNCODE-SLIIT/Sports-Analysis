"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { pickEventId } from "@/lib/collect";
import { Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import type { Fixture } from "@/lib/schemas";
import { LiveRailSkeleton } from "./Skeletons";

interface LiveRailProps {
  matches: Fixture[];
  isLoading?: boolean;
  className?: string;
}

export function LiveRail({ matches, isLoading, className }: LiveRailProps) {
  const router = useRouter();
  if (isLoading) {
    return <LiveRailSkeleton />;
  }

  if (!matches.length) {
    return (
      <div className="text-center py-8">
        <div className="text-muted-foreground">
          No live matches at the moment
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <ScrollArea className="w-full">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex space-x-4 pb-4"
        >
          {matches.map((match, index) => (
            <motion.div
              key={match.id}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
              className="flex-shrink-0 w-64"
            >
              <div
                role="button"
                onClick={() => {
                  try {
                    const id = pickEventId(match as unknown as Record<string, unknown>);
                    if (typeof window !== "undefined") {
                      sessionStorage.setItem("sa_selected_event_live", JSON.stringify(match));
                    }
                    router.push(`/match/${encodeURIComponent(id)}?sid=live`);
                  } catch {
                    router.push(`/match/${encodeURIComponent(String(match.id))}`);
                  }
                }}
              >
                <Card className="hover:shadow-md transition-all duration-200 group cursor-pointer h-full">
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      {/* Status */}
                      <div className="flex justify-between items-center">
                        {match.status?.toLowerCase() === 'live' && (
                          <Badge variant="destructive" className="text-xs">
                            <span className="w-2 h-2 bg-white rounded-full mr-1 animate-pulse" />
                            LIVE
                          </Badge>
                        )}
                        {match.time && (
                          <div className="flex items-center text-xs text-muted-foreground">
                            <Clock className="h-3 w-3 mr-1" />
                            <span>{match.time}&apos;</span>
                          </div>
                        )}
                      </div>

                      {/* Teams */}
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate">{match.home_team}</span>
                          <span className="font-mono text-sm">0</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-medium truncate">{match.away_team}</span>
                          <span className="font-mono text-sm">0</span>
                        </div>
                      </div>

                      {/* League */}
                      {match.league && (
                        <div className="pt-1 border-t border-border/50">
                          <span className="text-xs text-muted-foreground">
                            {match.league}
                          </span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </motion.div>
          ))}
        </motion.div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}