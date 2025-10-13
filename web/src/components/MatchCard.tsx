"use client";

import { motion } from "framer-motion";
// Removed Link; navigation is handled programmatically
import { useRouter } from "next/navigation";
import { pickEventId } from "@/lib/collect";
import { useAuth } from "@/components/AuthProvider";
import { Calendar, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Fixture, MatchInsights } from "@/lib/schemas";

interface MatchCardProps {
  fixture: Fixture;
  insights?: MatchInsights | null;
  className?: string;
}

export function MatchCard({ fixture, insights, className }: MatchCardProps) {
  const router = useRouter();
  const { user, supabase } = useAuth();
  const winprob = insights?.winprob;
  
  const formatTime = (dateTime: string) => {
    try {
      const date = new Date(dateTime);
      return {
        date: date.toLocaleDateString(),
        time: date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false 
        })
      };
    } catch {
      return { date: '', time: fixture.time || '' };
    }
  };

  const { date, time } = formatTime(fixture.date);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
      <Card className="h-full hover:shadow-lg transition-all duration-200 cursor-pointer group">
        <CardContent className="p-6 space-y-4">
          {/* Header */}
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              {fixture.league && (
                <Badge variant="secondary" className="text-xs">
                  {fixture.league}
                </Badge>
              )}
              <div className="flex items-center text-xs text-muted-foreground space-x-1">
                <Calendar className="h-3 w-3" />
                <span>{date}</span>
                <Clock className="h-3 w-3 ml-2" />
                <span>{time}</span>
              </div>
            </div>
            
            {fixture.status && (
              <Badge 
                variant={fixture.status === 'live' ? 'destructive' : 'outline'}
                className="text-xs"
              >
                {fixture.status === 'live' && <span className="w-2 h-2 bg-red-500 rounded-full mr-1 animate-pulse" />}
                {fixture.status.toUpperCase()}
              </Badge>
            )}
          </div>

          {/* Teams */}
          <div className="space-y-3">
            <div className="text-center space-y-2">
              <div className="font-semibold">{fixture.home_team}</div>
              <div className="text-sm text-muted-foreground">vs</div>
              <div className="font-semibold">{fixture.away_team}</div>
            </div>
          </div>

          {/* Win Probabilities */}
          {winprob && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">Win Probability</div>
              <div className="space-y-1">
                {winprob.home && (
                  <div className="flex justify-between text-xs">
                    <span>Home</span>
                    <span className="font-medium">{Math.round(winprob.home * 100)}%</span>
                  </div>
                )}
                {winprob.draw && (
                  <div className="flex justify-between text-xs">
                    <span>Draw</span>
                    <span className="font-medium">{Math.round(winprob.draw * 100)}%</span>
                  </div>
                )}
                {winprob.away && (
                  <div className="flex justify-between text-xs">
                    <span>Away</span>
                    <span className="font-medium">{Math.round(winprob.away * 100)}%</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Action */}
          <div className="pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors"
              onClick={() => {
                try {
                  const id = pickEventId(fixture as unknown as Record<string, unknown>);
                  if (typeof window !== "undefined") {
                    sessionStorage.setItem("sa_selected_event_card", JSON.stringify(fixture));
                  }
                  // best-effort: log a click interaction by ensuring the match item and inserting interaction
                  if (user && supabase) {
                    void (async () => {
                      try {
                        const title = `${fixture.home_team} vs ${fixture.away_team}`;
                        const teams = [fixture.home_team, fixture.away_team].filter(Boolean);
                        const league = fixture.league ?? null;
                        const { data: item_id } = await supabase.rpc("ensure_match_item", {
                          p_event_id: String(id),
                          p_title: title,
                          p_teams: teams,
                          p_league: league,
                          p_popularity: 0,
                        });
                        if (item_id) {
                          await supabase.from("user_interactions").insert({ user_id: user.id, item_id, event: "click" });
                        }
                      } catch {}
                    })();
                  }
                  router.push(`/match/${encodeURIComponent(id)}?sid=card`);
                } catch {
                  router.push(`/match/${encodeURIComponent(String(fixture.id))}`);
                }
              }}
            >
              View Analysis
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}