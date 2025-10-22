"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { StandingRow } from "@/components/league/LeagueStandingsCard";
import type { LeagueHeroInfo } from "@/components/league/LeagueInfoHero";

const formatNumber = (value: number | undefined): string | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value.toLocaleString();
};

const describeForm = (formRaw?: string | null): string | undefined => {
  if (!formRaw) return undefined;
  const cleaned = formRaw.replace(/[^WDL]/gi, "").slice(0, 5).toUpperCase();
  if (!cleaned) return undefined;
  return cleaned.split("").join(" · ");
};

const clampSummaryText = (text: string, limit = 1280): string => {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit).trimEnd();
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > 200) {
    return `${truncated.slice(0, lastSpace).trimEnd()}...`;
  }
  return `${truncated}...`;
};

export type LeagueSummaryCardProps = {
  leagueName?: string | null;
  info?: LeagueHeroInfo | null;
  rows: StandingRow[];
  seasonLabel?: string;
  stageLabel?: string;
  lastUpdated?: string;
};

export default function LeagueSummaryCard({
  leagueName,
  info,
  rows,
  seasonLabel,
  stageLabel,
  lastUpdated,
}: LeagueSummaryCardProps) {
  const summary = useMemo(() => {
    const name = leagueName || info?.name || undefined;
    const descriptionNormalized = info?.description
      ?.replace(/\r?\n+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const paragraphFromDescription = descriptionNormalized
      ? clampSummaryText(descriptionNormalized, 1280)
      : undefined;
    const safeRows = Array.isArray(rows) ? rows : [];
    const totalTeams = safeRows.length;
    const totalPlayed = safeRows.reduce((sum, row) => sum + (row.played ?? 0), 0);
    const totalMatches = totalPlayed > 0 ? Math.floor(totalPlayed / 2) : 0;
    const goalsFor = safeRows.reduce((sum, row) => sum + (row.goalsFor ?? 0), 0);
    const goalsAgainst = safeRows.reduce((sum, row) => sum + (row.goalsAgainst ?? 0), 0);
    const totalGoals = Math.max(goalsFor, goalsAgainst, 0);
    const avgGoals = totalMatches > 0 ? totalGoals / totalMatches : 0;
    const leader = safeRows[0];
    const challengers = safeRows.slice(1, 3).filter(row => row?.team) as StandingRow[];

    const bullets: string[] = [];

    if (leader) {
      const pointsText = formatNumber(leader.points) ?? (typeof leader.points === "number" ? String(leader.points) : null);
      const playedText =
        typeof leader.played === "number" && Number.isFinite(leader.played) ? `${leader.played} played` : null;
      const goalDiff =
        typeof leader.goalDifference === "number" && Number.isFinite(leader.goalDifference)
          ? leader.goalDifference
          : undefined;
      const goalDiffText = goalDiff !== undefined ? `GD ${goalDiff >= 0 ? "+" : ""}${goalDiff}` : null;
      const leaderPieces = [`Top spot: ${leader.team ?? "League leader"}`];
      if (pointsText) leaderPieces.push(`${pointsText} pts`);
      if (playedText) leaderPieces.push(playedText);
      if (goalDiffText) leaderPieces.push(goalDiffText);
      bullets.push(leaderPieces.join(" | "));

      const formText = describeForm(leader.form);
      if (formText) {
        bullets.push(`Recent form: ${leader.team ?? "Leader"} (${formText})`);
      }
    }

    if (challengers.length) {
      const chasingText = challengers
        .map(row => {
          const pts = formatNumber(row.points) ?? (typeof row.points === "number" ? String(row.points) : null);
          return `${row.team ?? "Team"}${pts ? ` (${pts} pts)` : ""}`;
        })
        .join(", ");
      if (chasingText.trim()) {
        bullets.push(`Chasing pack: ${chasingText}`);
      }
    }

    if (totalGoals > 0 && totalMatches > 0) {
      bullets.push(
        `Scoring pace: ${formatNumber(totalGoals) ?? String(totalGoals)} goals in ${
          formatNumber(totalMatches) ?? String(totalMatches)
        } matches (${avgGoals.toFixed(2)} per match)`
      );
    }

    const stageContext =
      stageLabel && stageLabel !== "Overall" && stageLabel !== "All stages" ? stageLabel : null;
    const contextParts = [seasonLabel, stageContext].filter(Boolean).map(part => String(part));
    const headingBase = name ? `${name} summary` : "League summary";
    const heading = contextParts.length ? `${headingBase} (${contextParts.join(" | ")})` : headingBase;

    const qualifierPieces: string[] = [];
    if (seasonLabel) qualifierPieces.push(seasonLabel);
    if (stageContext) qualifierPieces.push(stageContext);
    const qualifier = qualifierPieces.length ? ` (${qualifierPieces.join(" | ")})` : "";
    const leagueLabel = name ? `${name}${qualifier}` : `This league${qualifier}`;

    const statSegments: string[] = [];
    if (totalTeams > 0) {
      statSegments.push(
        `${leagueLabel} features ${formatNumber(totalTeams) ?? String(totalTeams)} teams competing this season`
      );
    } else if (name) {
      statSegments.push(`${leagueLabel} is underway with limited standings data so far`);
    }

    if (totalMatches > 0) {
      const scoringParts: string[] = [];
      if (totalGoals > 0) scoringParts.push(`${formatNumber(totalGoals) ?? String(totalGoals)} total goals`);
      if (avgGoals > 0) scoringParts.push(`${avgGoals.toFixed(2)} goals per match`);
      const scoringSummary = scoringParts.length ? ` with ${scoringParts.join(" and ")}` : "";
      statSegments.push(
        `Play has produced ${formatNumber(totalMatches) ?? String(totalMatches)} matches${scoringSummary}`
      );
    }

    if (leader) {
      const leaderDescriptor: string[] = [];
      if (leader.team) leaderDescriptor.push(`${leader.team} currently leads the standings`);
      const pointsText = formatNumber(leader.points) ?? (typeof leader.points === "number" ? String(leader.points) : null);
      if (pointsText) leaderDescriptor.push(`on ${pointsText} points`);
      if (typeof leader.wins === "number" && Number.isFinite(leader.wins)) {
        leaderDescriptor.push(`${leader.wins} win${leader.wins === 1 ? "" : "s"}`);
      }
      if (typeof leader.goalDifference === "number" && Number.isFinite(leader.goalDifference)) {
        const goalDiffVal = leader.goalDifference;
        leaderDescriptor.push(`goal difference ${goalDiffVal >= 0 ? "+" : ""}${goalDiffVal}`);
      }
      if (leaderDescriptor.length) statSegments.push(leaderDescriptor.join(", "));
    }

    if (challengers.length) {
      const chasingNames = challengers.map(row => row.team).filter(Boolean) as string[];
      if (chasingNames.length) {
        statSegments.push(`${chasingNames.join(", ")} are keeping the title race tight`);
      }
    }

    if (totalGoals > 0 && totalMatches > 0 && totalTeams > 0) {
      const goalsPerTeam = totalGoals / totalTeams;
      if (Number.isFinite(goalsPerTeam) && goalsPerTeam > 0) {
        statSegments.push(
          `Teams are averaging ${(Math.round(goalsPerTeam * 10) / 10).toFixed(1)} goals across the campaign`
        );
      }
    }

    if (lastUpdated) {
      statSegments.push(`Standings last updated ${lastUpdated}`);
    }

    const statParagraph = statSegments
      .map(sentence => {
        const trimmed = sentence.trim();
        if (!trimmed) return "";
        return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
      })
      .filter(Boolean)
      .join(" ");

    let paragraph = paragraphFromDescription ?? undefined;

    if (paragraphFromDescription && statParagraph) {
      const descTrimmed = paragraphFromDescription.trim();
      const joiner = /[.!?]$/.test(descTrimmed) ? " " : ". ";
      const combined = `${descTrimmed}${joiner}${statParagraph}`.replace(/\s+/g, " ").trim();
      paragraph = clampSummaryText(combined, 1280);
    }

    if (!paragraph && statParagraph) {
      paragraph = clampSummaryText(statParagraph.replace(/\s+/g, " ").trim(), 1280);
    }

    if (paragraph) {
      paragraph = paragraph.replace(/\s+/g, " ").trim();
      if (!/[.!?]$/.test(paragraph)) {
        paragraph = `${paragraph}.`;
      }
    }

    if (!paragraph && bullets.length === 0) return null;

    return {
      heading,
      paragraph,
      bullets,
    };
  }, [leagueName, info, rows, seasonLabel, stageLabel, lastUpdated]);

  if (!summary) return null;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg font-semibold text-foreground">{summary.heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {summary.paragraph ? (
          <p className="text-sm leading-relaxed text-muted-foreground">{summary.paragraph}</p>
        ) : null}
        {summary.bullets.length ? (
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
            {summary.bullets.map((bullet, idx) => (
              <li key={`league-summary-bullet-${idx}`}>{bullet}</li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
