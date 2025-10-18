"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { MatchCard } from "@/components/MatchCard";
import { getLiveEvents, type DataObject } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";

type Props = {
  leagueName?: string;
  title?: string;
};

export default function LeagueLiveMatches({ leagueName, title = "Live Matches" }: Props) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leagueName) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getLiveEvents({ leagueName })
      .then(resp => {
        if (cancelled) return;
        const d = resp?.data as Record<string, unknown> | undefined;
        let raw: unknown = [];
        if (d && typeof d === "object") {
          const get = (key: string) => (d as Record<string, unknown>)[key];
          raw =
            (get("events") as unknown) ??
            (get("result") as unknown) ??
            (get("results") as unknown) ??
            (get("items") as unknown) ??
            [];
        }
        const parsed = parseFixtures(Array.isArray(raw) ? raw : []);
        setFixtures(parsed);
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : "Failed to load live matches.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [leagueName]);

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-4">
        <CardTitle className="text-xl font-semibold text-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[360px] w-full rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : fixtures.length === 0 ? (
          <div className="text-sm text-muted-foreground">No live matches right now for this league.</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fixtures.map(fx => (
              <MatchCard key={fx.id} fixture={fx} className="h-full" />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
