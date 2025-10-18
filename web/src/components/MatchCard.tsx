"use client";

import { motion } from "framer-motion";
// Removed Link; navigation is handled programmatically
import { useRouter } from "next/navigation";
import { pickEventId } from "@/lib/collect";
import { useAuth } from "@/components/AuthProvider";
import { Calendar, Clock } from "lucide-react";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
  const { user, supabase, bumpInteractions } = useAuth();
  const winprob = insights?.winprob;
  const hasScore =
    typeof fixture.home_score === "number" &&
    typeof fixture.away_score === "number";
  
  const formatFixtureDateTime = (fixture: Fixture) => {
    const rawDate = fixture.date?.trim();
    const rawTime = fixture.time?.trim();

    const parseDateParts = (value: string) => {
      const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
      if (iso) {
        return {
          year: Number.parseInt(iso[1], 10),
          month: Number.parseInt(iso[2], 10),
          day: Number.parseInt(iso[3], 10),
        };
      }
      return null;
    };

    const parseTimeParts = (value: string) => {
      const cleaned = value.replace(/[^\d:apm ]+/gi, " ").trim();
      const match = cleaned.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
      if (!match) return null;
      let hours = Number.parseInt(match[1], 10);
      const minutes = Number.parseInt(match[2] ?? "0", 10);
      const seconds = Number.parseInt(match[3] ?? "0", 10);
      const suffix = match[4]?.toLowerCase();
      if (suffix === "pm" && hours < 12) hours += 12;
      if (suffix === "am" && hours === 12) hours = 0;
      return { hours, minutes, seconds };
    };

    if (!rawDate) {
      return {
        date: "",
        time: rawTime ?? "",
      };
    }

    const dateParts = parseDateParts(rawDate);
    const timeParts = rawTime ? parseTimeParts(rawTime) : null;

    if (dateParts) {
      const { year, month, day } = dateParts;
      const { hours, minutes, seconds } = timeParts ?? { hours: 0, minutes: 0, seconds: 0 };
      const localDate = new Date(year, month - 1, day, hours, minutes, seconds);
      const formattedDate = localDate.toLocaleDateString();
      const formattedTime = timeParts
        ? localDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
        : rawTime ?? "";
      return { date: formattedDate, time: formattedTime };
    }

    // Fallback: attempt to parse via Date constructor (handles ISO timestamps)
    const fallbackSource = rawTime ? `${rawDate} ${rawTime}` : rawDate;
    const includesTime = Boolean(rawTime) || /[T ]\d{1,2}:\d{2}/.test(rawDate);
    const parsed = new Date(fallbackSource);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        date: parsed.toLocaleDateString(),
        time: includesTime
          ? parsed.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
          : rawTime ?? "",
      };
    }

    return {
      date: rawDate,
      time: rawTime ?? "",
    };
  };

  const { date, time } = formatFixtureDateTime(fixture);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ duration: 0.2 }}
      className={className}
    >
  <Card className="group relative h-[360px] min-h-[320px] w-full cursor-pointer overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-background via-background to-muted/40 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/60 hover:shadow-xl">
        <div className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-100">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-primary/10" />
        </div>
  <CardContent className="relative flex h-full flex-col gap-5 p-6 justify-between">
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              {fixture.league && (
                <Badge variant="secondary" className="px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">
                  {fixture.league}
                </Badge>
              )}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-3 w-3" />
                  <span>{date}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  <span>{time}</span>
                </div>
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
          <div className="rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-sm transition-colors group-hover:border-primary/30">
            <div className="grid grid-cols-3 items-center gap-6">
              <div className="flex flex-col items-center gap-2 text-center">
                <Avatar className="size-8 border border-border/40 shadow-sm">
                  {fixture.home_team_logo ? (
                    <AvatarImage src={fixture.home_team_logo} alt={fixture.home_team} />
                  ) : (
                    <AvatarFallback>{fixture.home_team.slice(0,2).toUpperCase()}</AvatarFallback>
                  )}
                </Avatar>
                <div className="space-y-0.5">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Home</div>
                  <div className="text-sm font-semibold leading-tight">{fixture.home_team}</div>
                </div>
              </div>

              <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted/50 px-4 py-2 text-center shadow-inner">
                {hasScore ? (
                  <div className="text-xl font-bold leading-none tracking-tight">
                    <span>{fixture.home_score}</span>
                    <span className="mx-1 text-muted-foreground">-</span>
                    <span>{fixture.away_score}</span>
                  </div>
                ) : (
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">vs</div>
                )}
                {fixture.status && (
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground/80">
                    {fixture.status.toUpperCase()}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-2 text-center">
                <Avatar className="size-8 border border-border/40 shadow-sm">
                  {fixture.away_team_logo ? (
                    <AvatarImage src={fixture.away_team_logo} alt={fixture.away_team} />
                  ) : (
                    <AvatarFallback>{fixture.away_team.slice(0,2).toUpperCase()}</AvatarFallback>
                  )}
                </Avatar>
                <div className="space-y-0.5">
                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Away</div>
                  <div className="text-sm font-semibold leading-tight">{fixture.away_team}</div>
                </div>
              </div>
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
          <div className="pt-4">
            <Button
              variant="default"
              size="sm"
              className="w-full justify-center rounded-full shadow-md transition-all duration-200 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary"
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
                          try { bumpInteractions(); } catch {}
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
              View Details
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
