"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

type LeaderEntry = { name: string; v: number | string };

type TeamLeaders = {
  goals: LeaderEntry[];
  assists: LeaderEntry[];
  cards: LeaderEntry[];
};

const CATEGORY_CONFIG: Array<{ key: keyof TeamLeaders; label: string }> = [
  { key: "goals", label: "Goals" },
  { key: "assists", label: "Assists" },
  { key: "cards", label: "Cards" },
];

interface LeadersCardProps {
  leaders: { home: TeamLeaders; away: TeamLeaders } | null;
  homeTeam: string;
  awayTeam: string;
  homeLogo?: string;
  awayLogo?: string;
}

const getInitials = (value?: string | null): string => {
  if (!value) return "NA";
  const parts = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return value.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("");
};

const renderNextUp = (entries: LeaderEntry[], usedName?: string) => {
  const next = entries.find((entry) => entry.name !== usedName);
  if (!next) return null;
  return `Next: ${next.name} ${next.v}`;
};

export default function LeadersCard({
  leaders,
  homeTeam,
  awayTeam,
  homeLogo,
  awayLogo,
}: LeadersCardProps) {
  if (!leaders) return null;

  const renderSide = (
    side: "home" | "away",
    category: keyof TeamLeaders,
  ) => {
    const entries = (leaders?.[side]?.[category] ?? []) as LeaderEntry[];
    const primary = entries[0];
    const teamName = side === "home" ? homeTeam : awayTeam;
    const teamLogo = side === "home" ? homeLogo : awayLogo;
    const initials = getInitials(primary?.name ?? teamName);
    const nextLine = renderNextUp(entries, primary?.name);
    const wrapperClasses =
      side === "home"
        ? "flex min-w-0 flex-1 items-center gap-3"
        : "flex min-w-0 flex-1 items-center gap-3 justify-end";

    if (side === "away") {
      return (
        <div className={wrapperClasses}>
          <div className="text-lg font-semibold tabular-nums">
            {primary ? primary.v : "—"}
          </div>
          <div className="min-w-0 text-right">
            <div className="truncate text-sm font-semibold">
              {primary ? primary.name : "—"}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {teamName}
            </div>
            {nextLine ? (
              <div className="truncate text-xs text-muted-foreground/80">
                {nextLine}
              </div>
            ) : null}
          </div>
          <Avatar className="h-9 w-9 border border-border/40 bg-background">
            {teamLogo ? (
              <AvatarImage src={teamLogo} alt={teamName} />
            ) : (
              <AvatarFallback className="text-xs font-semibold">
                {initials}
              </AvatarFallback>
            )}
          </Avatar>
        </div>
      );
    }

    return (
      <div className={wrapperClasses}>
        <Avatar className="h-9 w-9 border border-border/40 bg-background">
          {teamLogo ? (
            <AvatarImage src={teamLogo} alt={teamName} />
          ) : (
            <AvatarFallback className="text-xs font-semibold">
              {initials}
            </AvatarFallback>
          )}
        </Avatar>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {primary ? primary.name : "—"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {teamName}
          </div>
          {nextLine ? (
            <div className="truncate text-xs text-muted-foreground/80">
              {nextLine}
            </div>
          ) : null}
        </div>
        <div className="ml-auto text-lg font-semibold tabular-nums">
          {primary ? primary.v : "—"}
        </div>
      </div>
    );
  };

  const categoriesToRender = CATEGORY_CONFIG.filter(({ key }) => {
    const homeEntries = leaders.home?.[key]?.length ?? 0;
    const awayEntries = leaders.away?.[key]?.length ?? 0;
    return homeEntries > 0 || awayEntries > 0;
  });

  if (!categoriesToRender.length) return null;

  return (
    <Card className="border-border/60 bg-card/60">
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Game Leaders</CardTitle>
        <div className="mt-2 flex items-center justify-between gap-6 text-sm text-muted-foreground">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-9 w-9 border border-border/40 bg-background">
              {homeLogo ? (
                <AvatarImage src={homeLogo} alt={homeTeam} />
              ) : (
                <AvatarFallback className="text-xs font-semibold">
                  {getInitials(homeTeam)}
                </AvatarFallback>
              )}
            </Avatar>
            <span className="truncate font-medium">{homeTeam}</span>
          </div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
            vs
          </span>
          <div className="flex min-w-0 items-center gap-3 justify-end">
            <span className="truncate font-medium text-right">{awayTeam}</span>
            <Avatar className="h-9 w-9 border border-border/40 bg-background">
              {awayLogo ? (
                <AvatarImage src={awayLogo} alt={awayTeam} />
              ) : (
                <AvatarFallback className="text-xs font-semibold">
                  {getInitials(awayTeam)}
                </AvatarFallback>
              )}
            </Avatar>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {categoriesToRender.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-xl border border-border/40 bg-background/60 p-4 shadow-sm shadow-black/5"
          >
            <Badge
              variant="outline"
              className="mb-3 text-xs font-semibold uppercase tracking-wide"
            >
              {label}
            </Badge>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
              {renderSide("home", key)}
              <div
                className="hidden h-10 w-px bg-border/40 sm:block"
                aria-hidden
              />
              {renderSide("away", key)}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
