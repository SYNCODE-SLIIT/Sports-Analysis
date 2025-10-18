"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MatchCard } from "@/components/MatchCard";
import { postCollect, sanitizeInput, type DataObject, type Json } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";

type Props = {
  leagueName?: string;
  seasonLabel?: string; // e.g., "Current Season", "2023/2024", or "2023"
  title?: string;
};

const CURRENT_SEASON_KEY = "__current__";

const toISODate = (d: Date) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const seasonRangeFor = (labelRaw?: string): { from: string; to: string } | null => {
  if (!labelRaw) return null;
  const label = labelRaw.trim();
  const now = new Date();
  const asDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

  if (/current/i.test(label) || label === CURRENT_SEASON_KEY) {
    const y = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = month >= 6 ? asDate(y, 6, 1) : asDate(y - 1, 6, 1); // July = 6
    const end = asDate(start.getUTCFullYear() + 1, 5, 30);
    return { from: toISODate(start), to: toISODate(end) };
  }

  const mSeason = label.match(/^(\d{4})[\/\-](\d{2}|\d{4})$/);
  if (mSeason) {
    const startYear = Number(mSeason[1]);
    const endRaw = mSeason[2];
    const endYear = endRaw.length === 2 ? Number(`${String(startYear).slice(0, 2)}${endRaw}`) : Number(endRaw);
    const start = asDate(startYear, 6, 1);
    const end = asDate(endYear, 5, 30);
    return { from: toISODate(start), to: toISODate(end) };
  }

  const mYear = label.match(/^(\d{4})$/);
  if (mYear) {
    const y = Number(mYear[1]);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  return null;
};

export function LeagueSeasonMatches({ leagueName, seasonLabel, title = "Season Matches" }: Props) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<number>(24);

  useEffect(() => {
    if (!leagueName || !seasonLabel) return;
    const range = seasonRangeFor(seasonLabel);
    if (!range) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisible(24);

    const args: Record<string, Json> = {
      leagueName: sanitizeInput(leagueName),
      from: range.from,
      to: range.to,
    };

    postCollect<{ events?: DataObject[]; result?: DataObject[]; results?: DataObject[] }>("events.list", args)
      .then(resp => {
        if (cancelled) return;
        const d = resp?.data as Record<string, unknown> | undefined;
        let raw: unknown = [];
        if (d && typeof d === "object") {
          const get = (key: string) => (d as Record<string, unknown>)[key];
          raw = (get("events") as unknown) ?? (get("result") as unknown) ?? (get("results") as unknown) ?? (get("items") as unknown) ?? [];
        }
        const parsed = parseFixtures(Array.isArray(raw) ? raw : []);

        const seen = new Set<string>();
        const unique = parsed.filter(match => {
          const keyBase = match.id || `${match.home_team}-${match.away_team}-${match.date}-${match.time ?? ""}`;
          if (!keyBase) return true;
          if (seen.has(keyBase)) return false;
          seen.add(keyBase);
          return true;
        });

        const ts = (f: Fixture) => {
          const rawDate = f.date ?? "";
          if (rawDate.includes("T")) {
            const parsed = Date.parse(rawDate);
            if (!Number.isNaN(parsed)) return parsed;
          }
          const baseDate = rawDate.split("T")[0];
          const t = f.time ?? "00:00";
          const hhmmss = t.length === 5 ? `${t}:00` : t;
          const parsed = Date.parse(`${baseDate}T${hhmmss}Z`);
          return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
        };
        const sorted = unique.sort((a, b) => ts(a) - ts(b));
        setFixtures(sorted);
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : "Failed to load season matches.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueName, seasonLabel]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[360px] w-full rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : fixtures.length === 0 ? (
          <div className="text-sm text-muted-foreground">No matches found for this season window.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fixtures.slice(0, visible).map(fx => (
                <MatchCard key={`${fx.id}-${fx.date}`} fixture={fx} className="h-full" />
              ))}
            </div>
            {visible < fixtures.length ? (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={() => setVisible(v => v + 24)}>
                  Show more ({fixtures.length - visible} more)
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default LeagueSeasonMatches;
