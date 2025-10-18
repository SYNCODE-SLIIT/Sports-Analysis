"use client";

import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StandingRow } from "@/components/league/LeagueStandingsCard";

type Metric = {
  label: string;
  value: string | number;
  sub?: string;
};

type TeamMetricRow = {
  team: string;
  logo?: string;
  value: number;
  extra?: string;
};

export interface LeagueStatisticsProps {
  rows: StandingRow[];
  leagueName?: string | null;
  seasonLabel?: string | null;
  stageLabel?: string | null;
}

const fmt = (n: number | undefined, digits = 0) =>
  typeof n === "number" && Number.isFinite(n) ? n.toFixed(digits) : "-";

export default function LeagueStatistics({ rows, leagueName, seasonLabel, stageLabel }: LeagueStatisticsProps) {
  const {
    metrics,
    topAttack,
    topDefense,
    topPoints,
    topGoalDiff,
  } = useMemo(() => {
    const safeRows = Array.isArray(rows) ? rows : [];

    const totalTeams = safeRows.length;
    const totalPlayed = safeRows.reduce((sum, r) => sum + (r.played ?? 0), 0);
    // Each match appears twice across teams, so divide by 2 to estimate matches in the league
    const totalMatches = Math.floor(totalPlayed / 2);
    const goalsFor = safeRows.reduce((sum, r) => sum + (r.goalsFor ?? 0), 0);
    const goalsAgainst = safeRows.reduce((sum, r) => sum + (r.goalsAgainst ?? 0), 0);
    const totalGoals = Math.max(goalsFor, goalsAgainst); // minor guard against missing data
    const avgGoalsPerMatch = totalMatches > 0 ? totalGoals / totalMatches : 0;
    const avgPointsPerGame = totalTeams > 0 ? safeRows.reduce((s, r) => s + (r.points ?? 0), 0) / (totalPlayed || 1) : 0;

    const metrics: Metric[] = [
      { label: "Teams", value: totalTeams },
      { label: "Matches Played", value: totalMatches },
      { label: "Total Goals", value: totalGoals },
      { label: "Avg Goals / Match", value: fmt(avgGoalsPerMatch, 2) },
      { label: "Avg Points / Game", value: fmt(avgPointsPerGame, 2) },
    ];

    const topBy = (
      pick: (r: StandingRow) => number | undefined,
      desc = true
    ): TeamMetricRow[] => {
      return safeRows
        .map(r => ({
          team: r.team ?? "Unknown",
          logo: r.logo,
          value: ((): number => {
            const v = pick(r);
            return typeof v === "number" && Number.isFinite(v) ? v : -Infinity;
          })(),
          extra: undefined,
        }))
        .filter(r => Number.isFinite(r.value))
        .sort((a, b) => (desc ? b.value - a.value : a.value - b.value))
        .slice(0, 5);
    };

    const topAttack = topBy(r => r.goalsFor);
    const topDefense = topBy(r => {
      // For defense, we prefer lowest goalsAgainst
      const ga = r.goalsAgainst ?? Infinity;
      return -ga; // invert for sorting desc
    });
    // Fix display for defense: restore positive GA values
    topDefense.forEach(t => (t.value = Math.abs(t.value)));

    const topPoints = topBy(r => r.points);
    const topGoalDiff = topBy(r => r.goalDifference);

    return { metrics, topAttack, topDefense, topPoints, topGoalDiff };
  }, [rows]);

  const heading = useMemo(() => {
    const parts = ["League statistics"] as string[];
    if (leagueName) parts.unshift(leagueName);
    const suffix: string[] = [];
    if (stageLabel) suffix.push(stageLabel);
    if (seasonLabel) suffix.push(seasonLabel);
    if (suffix.length) parts.push(`(${suffix.join(" · ")})`);
    return parts.join(" ");
  }, [leagueName, seasonLabel, stageLabel]);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">{heading}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((m, i) => (
              <div key={i} className="flex flex-col rounded-md border border-border/60 p-3">
                <div className="text-xs text-muted-foreground">{m.label}</div>
                <div className="text-lg font-semibold">{m.value}</div>
                {m.sub ? <div className="text-xs text-muted-foreground">{m.sub}</div> : null}
              </div>
            ))}
          </div>

          <div className="my-2 h-px w-full bg-border/60" />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-2">
            <TopList title="Top Attack (GF)" items={topAttack} valueSuffix=" GF" />
            <TopList title="Best Defense (GA)" items={topDefense} valueSuffix=" GA" invertBadge />
            <TopList title="Top Points" items={topPoints} valueSuffix=" pts" />
            <TopList title="Best Goal Difference" items={topGoalDiff} valueSuffix=" GD" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function TopList({
  title,
  items,
  valueSuffix,
  invertBadge,
}: {
  title: string;
  items: TeamMetricRow[];
  valueSuffix?: string;
  invertBadge?: boolean;
}) {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 ? (
          <div className="text-sm text-muted-foreground">No data</div>
        ) : (
          <ul className="space-y-2">
            {items.map((t, idx) => (
              <li key={`${t.team}-${idx}`} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-5">{idx + 1}.</span>
                  {t.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={t.logo}
                      alt={t.team}
                      className="h-5 w-5 rounded bg-card object-contain"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-5 w-5 rounded bg-muted" />
                  )}
                  <span className="text-sm">{t.team}</span>
                </div>
                <Badge variant={invertBadge ? "secondary" : "default"} className="min-w-12 justify-center">
                  {t.value}
                  {valueSuffix}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
