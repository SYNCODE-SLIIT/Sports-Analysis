import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type StandingRow = {
  id: string;
  position?: number;
  team?: string;
  played?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  goalDifference?: number;
  points?: number;
  logo?: string;
  stageKey?: string;
  stageLabel?: string;
  seasonKey?: string;
  seasonLabel?: string;
  form?: string;
  updatedAt?: string;
  country?: string;
};

export type SelectOption = {
  value: string;
  label: string;
};

type LeagueStandingsCardProps = {
  rows: StandingRow[];
  loading?: boolean;
  error?: string | null;
  seasonOptions: SelectOption[];
  selectedSeason: string;
  onSelectSeason: (value: string) => void;
  stageOptions: SelectOption[];
  selectedStage: string;
  onSelectStage: (value: string) => void;
  lastUpdated?: string;
};

const stageButtonClasses = (active: boolean) =>
  [
    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
    active ? "border-primary bg-primary/10 text-primary" : "border-border/60 bg-background text-muted-foreground hover:bg-muted/60",
  ].join(" ");

export function LeagueStandingsCard({
  rows,
  loading,
  error,
  seasonOptions,
  selectedSeason,
  onSelectSeason,
  stageOptions,
  selectedStage,
  onSelectStage,
  lastUpdated,
}: LeagueStandingsCardProps) {
  const INITIAL_VISIBLE = 10;
  const [expanded, setExpanded] = useState(false);
  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_VISIBLE);
  const hasMore = rows.length > INITIAL_VISIBLE;

  // Helper to generate a unique key for each row
  const getRowKey = (row: StandingRow) => {
    // Use team, season, stage, and position if available
    return [row.team, row.seasonKey, row.stageKey, row.position, row.id].filter(Boolean).join("-");
  };
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="gap-3 space-y-0 pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl font-semibold text-foreground">Standings</CardTitle>
            {lastUpdated ? (
              <CardDescription className="text-xs text-muted-foreground">
                Updated {new Date(lastUpdated).toLocaleString()}
              </CardDescription>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {seasonOptions.length > 0 ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Season</span>
                <select
                  value={selectedSeason}
                  onChange={evt => onSelectSeason(evt.target.value)}
                  className="rounded-md border border-border/60 bg-background px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  disabled={seasonOptions.length === 0}
                >
                  {seasonOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </div>
        {stageOptions.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
            {stageOptions.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelectStage(opt.value)}
                className={stageButtonClasses(opt.value === selectedStage)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-2 p-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full rounded-md" />
            ))}
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-destructive">{error}</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No standings data available for this selection.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border/60">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">#</th>
                  <th className="px-4 py-2 text-left font-medium">Team</th>
                  <th className="px-4 py-2 text-center font-medium">P</th>
                  <th className="px-4 py-2 text-center font-medium">W</th>
                  <th className="px-4 py-2 text-center font-medium">D</th>
                  <th className="px-4 py-2 text-center font-medium">L</th>
                  <th className="px-4 py-2 text-center font-medium">GF</th>
                  <th className="px-4 py-2 text-center font-medium">GA</th>
                  <th className="px-4 py-2 text-center font-medium">GD</th>
                  <th className="px-4 py-2 text-center font-medium">PTS</th>
                  <th className="px-4 py-2 text-center font-medium">Form</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40 text-sm">
                {visibleRows.map(row => (
                  <tr key={getRowKey(row)} className="hover:bg-muted/30">
                    <td className="px-4 py-3 text-left font-medium text-muted-foreground">{row.position ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-8 w-8 overflow-hidden rounded-full border border-border/60 bg-muted/30">
                          {row.logo ? (
                            <Image src={row.logo} alt={row.team ?? "team"} fill sizes="32px" className="object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-muted-foreground">
                              {row.team?.slice(0, 2).toUpperCase() ?? "NA"}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{row.team ?? "Unknown"}</div>
                          {row.stageKey && stageOptions.length > 1 ? (
                            <div className="text-xs text-muted-foreground">{row.stageLabel}</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">{row.played ?? "—"}</td>
                    <td className="px-4 py-3 text-center">{row.wins ?? "—"}</td>
                    <td className="px-4 py-3 text-center">{row.draws ?? "—"}</td>
                    <td className="px-4 py-3 text-center">{row.losses ?? "—"}</td>
                    <td className="px-4 py-3 text-center">{row.goalsFor ?? "—"}</td>
                    <td className="px-4 py-3 text-center">{row.goalsAgainst ?? "—"}</td>
                    <td className="px-4 py-3 text-center">{row.goalDifference ?? "—"}</td>
                    <td className="px-4 py-3 text-center font-semibold text-foreground">{row.points ?? "—"}</td>
                    <td className="px-4 py-3 text-center">
                      {row.form ? (
                        <div className="inline-flex items-center gap-1">
                          {row.form.split("").map((value, idx) => {
                            const trimmed = value.trim().toUpperCase();
                            const variant =
                              trimmed === "W" ? "bg-emerald-500/15 text-emerald-600" : trimmed === "L" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground";
                            // Use composite key for form badge
                            return (
                              <Badge key={`${getRowKey(row)}-form-${idx}`} className={`px-1 text-[10px] font-semibold ${variant}`}>
                                {trimmed || "—"}
                              </Badge>
                            );
                          })}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore ? (
              <div className="flex items-center justify-center border-t border-border/60 p-4">
                <Button variant="outline" size="sm" onClick={() => setExpanded(e => !e)}>
                  {expanded ? "Show less" : `Show all (${rows.length})`}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
