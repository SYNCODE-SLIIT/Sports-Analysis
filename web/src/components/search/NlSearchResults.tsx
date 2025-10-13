"use client";

import { Fragment } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { MatchCard } from "@/components/MatchCard";
import type { Highlight } from "@/lib/schemas";
import type { NlSearchResultBundle, NlHitInterpretation } from "@/lib/search";
import { ExternalLink } from "lucide-react";

interface NlSearchResultsProps {
  query: string;
  data?: NlSearchResultBundle;
  isLoading?: boolean;
  error?: Error | null;
}

function HighlightCard({ highlight }: { highlight: Highlight }) {
  const hasUrl = Boolean(highlight.url);
  return (
    <Card className="hover:shadow-md transition-all">
      <CardHeader className="space-y-2">
        <CardTitle className="text-sm font-semibold line-clamp-2">{highlight.title ?? "Highlight"}</CardTitle>
        {highlight.provider && <Badge variant="secondary" className="w-fit text-xs">{highlight.provider}</Badge>}
      </CardHeader>
      <CardContent className="space-y-3">
        {highlight.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={highlight.thumbnail}
            alt={highlight.title ?? "Highlight thumbnail"}
            className="w-full rounded-lg object-cover"
          />
        )}
        {hasUrl ? (
          <Button asChild variant="outline" size="sm" className="w-full">
            <a href={highlight.url ?? "#"} target="_blank" rel="noopener noreferrer">
              Watch highlight
              <ExternalLink className="ml-2 h-3.5 w-3.5" />
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" className="w-full" disabled>
            Link unavailable
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function renderHit(hit: NlHitInterpretation, index: number) {
  const reason = hit.raw.reason;
  const intent = hit.raw.intent;

  if (hit.kind === "matches" && hit.fixtures && hit.fixtures.length > 0) {
    return (
      <section key={`${intent}-${index}`} className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase tracking-wider text-xs">{intent}</Badge>
          {reason && <span className="text-sm text-muted-foreground">{reason}</span>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {hit.fixtures.map((fixture) => (
            <MatchCard key={`${fixture.id}-${fixture.date}-${fixture.home_team}`} fixture={fixture} />
          ))}
        </div>
      </section>
    );
  }

  if (hit.kind === "highlights" && hit.highlights && hit.highlights.length > 0) {
    return (
      <section key={`${intent}-${index}`} className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase tracking-wider text-xs">{intent}</Badge>
          {reason && <span className="text-sm text-muted-foreground">{reason}</span>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {hit.highlights.map((highlight) => (
            <HighlightCard key={highlight.id} highlight={highlight} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section key={`${intent}-${index}`} className="space-y-3">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="uppercase tracking-wider text-xs">{intent}</Badge>
        {reason && <span className="text-sm text-muted-foreground">{reason}</span>}
      </div>
      <Card className="bg-muted/40">
        <CardContent className="p-4">
          <pre className="max-h-80 overflow-auto text-xs">
            {JSON.stringify(hit.raw.items ?? hit.raw.data ?? {}, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </section>
  );
}

export function NlSearchResults({ query, data, isLoading, error }: NlSearchResultsProps) {
  if (!query) {
    return (
      <EmptyState
        type="no-data"
        title="Natural language search"
        description="Ask for fixtures, highlights, odds, or team information. Try queries like “Team A vs Team B tomorrow”, “highlights for Liverpool”, or “matches in EPL yesterday”."
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        {[0, 1, 2].map((idx) => (
          <Card key={idx} className="border-muted/40">
            <CardHeader>
              <Skeleton className="h-4 w-48" />
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((child) => (
                <Skeleton key={child} className="h-48 rounded-xl" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        type="error"
        title="Search error"
        description={error.message || "We couldn't complete that search just now."}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        type="no-data"
        title="No results yet"
        description="Submit a natural-language query to explore matches, highlights, or analysis."
      />
    );
  }

  const hits = data.interpretedHits.filter((hit) => {
    if (hit.kind === "matches") return (hit.fixtures?.length ?? 0) > 0;
    if (hit.kind === "highlights") return (hit.highlights?.length ?? 0) > 0;
    return true;
  });

  const tried = data.results ?? [];

  const parsedEntities = data.parsed?.entities ?? {};

  if (hits.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          type="no-data"
          title="No direct matches"
          description="We parsed your request but couldn't locate matching fixtures or highlights."
        />
        {tried.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">What we tried</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {tried.map((item, idx) => (
                <div key={`${item.intent}-${idx}`} className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.ok ? "default" : "secondary"} className="uppercase tracking-wider text-xs">
                      {item.intent}
                    </Badge>
                    {item.reason && <span className="text-muted-foreground">{item.reason}</span>}
                  </div>
                  {item.error && (
                    <span className="text-xs text-destructive">Error: {JSON.stringify(item.error)}</span>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {Object.keys(parsedEntities).length > 0 && (
        <Card className="border-muted/50 bg-muted/40">
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Parsed intent</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2">
            {Object.entries(parsedEntities).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-background/60 p-3 text-sm shadow-sm">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{key}</div>
                <div className="font-medium">{String(value)}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {hits.map((hit, idx) => (
        <Fragment key={`${hit.raw.intent}-${idx}`}>{renderHit(hit, idx)}</Fragment>
      ))}

      {tried.length > hits.length && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Additional attempts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {tried
              .filter((item) => !(item.ok && hits.some((hit) => hit.raw.intent === item.intent)))
              .map((item, idx) => (
                <div key={`${item.intent}-${idx}`} className="rounded-lg border border-border/60 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant={item.ok ? "default" : "secondary"} className="uppercase tracking-wider text-xs">
                      {item.intent}
                    </Badge>
                    {item.reason && <span className="text-muted-foreground">{item.reason}</span>}
                  </div>
                  {item.count !== undefined && (
                    <div className="text-xs text-muted-foreground mt-1">Items: {item.count}</div>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
