"use client";

import React, { Fragment, useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { MatchCard } from "@/components/MatchCard";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { buildLeagueHref, findLeagueMetadata } from "@/lib/leagues";
import type { Highlight, League, Fixture } from "@/lib/schemas";
import type { NlSearchResultBundle, NlHitInterpretation } from "@/lib/search";
import { ExternalLink } from "lucide-react";

function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

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

const getLeagueInitials = (name?: string) => {
  if (!name) return "LG";
  const tokens = name
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean);
  if (!tokens.length) return name.slice(0, 2).toUpperCase();
  const [first, second] = tokens;
  const initials = [first?.charAt(0), second?.charAt(0)].filter(Boolean).join("");
  return initials.slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
};

type FixtureCategory = "live" | "upcoming" | "recent";

const CATEGORY_PRIORITY: Record<FixtureCategory, number> = {
  live: 0,
  upcoming: 1,
  recent: 2,
};

function LeagueResultCard({ league }: { league: League }) {
  const href = buildLeagueHref({ id: league.id, name: league.name, country: league.country });
  const initials = getLeagueInitials(league.name);

  return (
    <Card className="flex h-full flex-col justify-between border border-border/60 bg-card/40 shadow-sm transition-colors hover:border-primary/40">
      <CardHeader className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-12 border border-border/40 bg-background/80">
            {league.logo ? (
              <AvatarImage src={league.logo} alt={league.name} />
            ) : (
              <AvatarFallback className="text-sm font-semibold uppercase">{initials}</AvatarFallback>
            )}
          </Avatar>
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold leading-tight">{league.name}</CardTitle>
            {league.country && <span className="text-sm text-muted-foreground">{league.country}</span>}
          </div>
        </div>
        {league.category && (
          <Badge variant="secondary" className="w-fit uppercase tracking-wider text-xs">
            {league.category}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="mt-auto pt-2">
        <Button
          asChild={Boolean(href)}
          variant="outline"
          size="sm"
          className="w-full rounded-full"
          disabled={!href}
        >
          {href ? <Link href={href}>View League</Link> : <span>View League</span>}
        </Button>
      </CardContent>
    </Card>
  );
}

function renderHit(hit: NlHitInterpretation, index: number) {
  const reason = hit.raw.reason;
  const intent = hit.raw.intent;

  if (hit.kind === "matches" && hit.fixtures && hit.fixtures.length > 0) {
    const args = (hit.raw.args ?? {}) as Record<string, unknown>;
    const normalize = (value: string | undefined | null) => value?.trim().toLowerCase() ?? "";
    const getArgString = (key: string) => {
      const val = args[key];
      return typeof val === "string" ? val : undefined;
    };
    const teamFilters = new Set<string>(
      ["teamName", "teamA", "teamB"]
        .map((key) => normalize(getArgString(key)))
        .filter((val) => Boolean(val)),
    );
    const leagueValue = getArgString("leagueName");
    const leagueFilter = leagueValue ? normalize(leagueValue) : undefined;

    const fixtures = hit.fixtures.filter((fixture) => {
      const home = normalize(fixture.home_team);
      const away = normalize(fixture.away_team);
      const league = normalize(fixture.league);

      if (teamFilters.size > 0) {
        const matchesTeam = Array.from(teamFilters).some(
          (target) => (target && home.includes(target)) || away.includes(target),
        );
        if (!matchesTeam) {
          return false;
        }
      }

      if (leagueFilter) {
        if (!league.includes(leagueFilter)) {
          return false;
        }
      }

      return true;
    });

    if (fixtures.length === 0) {
      return null;
    }

    return (
      <section key={`${intent}-${index}`} className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase tracking-wider text-xs">{intent}</Badge>
          {reason && <span className="text-sm text-muted-foreground">{reason}</span>}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {fixtures.map((fixture) => (
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

  if (hit.kind === "leagues" && hit.leagues && hit.leagues.length > 0) {
    return (
      <section key={`${intent}-${index}`} className="space-y-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="uppercase tracking-wider text-xs">{intent}</Badge>
          {reason && <span className="text-sm text-muted-foreground">{reason}</span>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hit.leagues.map((league) => (
            <LeagueResultCard key={`${league.id}-${league.name}`} league={league} />
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
  const parsedEntities = useMemo(
    () => (data?.parsed?.entities ?? {}) as Record<string, unknown>,
    [data?.parsed],
  );

  const matchAggregation = useMemo(() => {
    const sections: Record<FixtureCategory, Array<{ key: string; fixture: Fixture; isDirect: boolean; category: FixtureCategory }>> = {
      live: [],
      upcoming: [],
      recent: [],
    };
    const fixtureRecords = new Map<string, { key: string; fixture: Fixture; isDirect: boolean; category: FixtureCategory }>();
    const normalize = (value?: string | null) => value?.trim().toLowerCase() ?? "";

    const teamDisplayNames = new Set<string>();
    const combinedTeamFilters = new Set<string>();
    const directTeamFilters = new Set<string>();

    const registerTeam = (value: unknown, { direct = false }: { direct?: boolean } = {}) => {
      if (typeof value !== "string" || !value.trim()) return;
      teamDisplayNames.add(value);
      const normalizedValue = normalize(value);
      combinedTeamFilters.add(normalizedValue);
      if (direct) {
        directTeamFilters.add(normalizedValue);
      }
    };

    registerTeam(parsedEntities["teamName"]);
    registerTeam(parsedEntities["teamA"], { direct: true });
    registerTeam(parsedEntities["teamB"], { direct: true });

    let primaryLeagueName = typeof parsedEntities["leagueName"] === "string" ? (parsedEntities["leagueName"] as string) : undefined;
    let leagueFilterNormalized = primaryLeagueName ? normalize(primaryLeagueName) : undefined;

    const matchHits = (data?.interpretedHits ?? []).filter((hit) => hit.kind === "matches");

    matchHits.forEach((hit) => {
      const args = (hit.raw.args ?? {}) as Record<string, unknown>;
      registerTeam(args.teamName);
      registerTeam(args.teamA, { direct: true });
      registerTeam(args.teamB, { direct: true });
      if (!primaryLeagueName && typeof args.leagueName === "string" && args.leagueName.trim()) {
        primaryLeagueName = args.leagueName as string;
        leagueFilterNormalized = normalize(primaryLeagueName);
      }
    });

    const directTeamList = Array.from(directTeamFilters);
    const now = new Date();

    const getFixtureTimestamp = (fixture: Fixture): number | null => {
      const dateStr = fixture.date?.trim();
      if (!dateStr) return null;
      const timeStr = fixture.time?.trim();
      const candidate = timeStr ? `${dateStr} ${timeStr}` : dateStr;
      const parsedDate = new Date(candidate);
      if (Number.isNaN(parsedDate.getTime())) return null;
      return parsedDate.getTime();
    };

    const determineCategory = (fixture: Fixture, reasonLower: string): FixtureCategory => {
      const statusLower = fixture.status?.toLowerCase() ?? "";
      if (statusLower.includes("live") || statusLower.includes("inplay") || reasonLower.includes("live")) {
        return "live";
      }
      if (
        statusLower.includes("ft")
        || statusLower.includes("finished")
        || statusLower.includes("full")
        || reasonLower.includes("recent")
        || reasonLower.includes("result")
        || reasonLower.includes("past")
      ) {
        return "recent";
      }
      const ts = getFixtureTimestamp(fixture);
      if (ts !== null) {
        if (ts < now.getTime() - 15 * 60 * 1000) {
          return "recent";
        }
        if (ts >= now.getTime() - 15 * 60 * 1000 && ts <= now.getTime() + 2 * 60 * 60 * 1000) {
          return "live";
        }
        if (ts < now.getTime()) {
          return "recent";
        }
      }
      return "upcoming";
    };

    const shouldIncludeFixture = (fixture: Fixture) => {
      const home = normalize(fixture.home_team);
      const away = normalize(fixture.away_team);
      if (combinedTeamFilters.size > 0) {
        const matchesTeam = Array.from(combinedTeamFilters).some((team) => home.includes(team) || away.includes(team));
        if (!matchesTeam) {
          return false;
        }
      }
      if (leagueFilterNormalized) {
        const leagueNormalized = normalize(fixture.league);
        if (!leagueNormalized.includes(leagueFilterNormalized)) {
          return false;
        }
      }
      return true;
    };

    const addFixture = (category: FixtureCategory, fixture: Fixture, isDirect: boolean) => {
      const key = fixture.id ?? `${normalize(fixture.home_team)}-${normalize(fixture.away_team)}-${fixture.date ?? ""}-${fixture.time ?? ""}`;
      const existing = fixtureRecords.get(key);
      if (existing) {
        if (CATEGORY_PRIORITY[category] < CATEGORY_PRIORITY[existing.category]) {
          const list = sections[existing.category];
          const index = list.indexOf(existing);
          if (index >= 0) list.splice(index, 1);
          existing.category = category;
          sections[category].push(existing);
        }
        if (isDirect) existing.isDirect = true;
        return;
      }
      const record = { key, fixture, isDirect, category };
      fixtureRecords.set(key, record);
      sections[category].push(record);
    };

    matchHits.forEach((hit) => {
      const reasonLower = (hit.raw.reason ?? "").toLowerCase();
      (hit.fixtures ?? []).forEach((fixture) => {
        if (!shouldIncludeFixture(fixture)) return;
        const home = normalize(fixture.home_team);
        const away = normalize(fixture.away_team);
        const isDirect =
          directTeamList.length === 2
          && directTeamList.every((team) => home.includes(team) || away.includes(team));

        const category = determineCategory(fixture, reasonLower);
        addFixture(category, fixture, isDirect);
      });
    });

    const compareAsc = (a: { fixture: Fixture }, b: { fixture: Fixture }) => {
      const tsA = getFixtureTimestamp(a.fixture) ?? Number.POSITIVE_INFINITY;
      const tsB = getFixtureTimestamp(b.fixture) ?? Number.POSITIVE_INFINITY;
      return tsA - tsB;
    };
    const compareDesc = (a: { fixture: Fixture }, b: { fixture: Fixture }) => -compareAsc(a, b);

    sections.live.sort(compareAsc);
    sections.upcoming.sort(compareAsc);
    sections.recent.sort(compareDesc);

    const hasMatchContent = sections.live.length + sections.upcoming.length + sections.recent.length > 0;

    return {
      sections,
      hasMatchContent,
      teamDisplayNames: Array.from(teamDisplayNames),
      leagueName: primaryLeagueName,
    };
  }, [data?.interpretedHits, parsedEntities]);

  const leagueCards = useMemo(() => {
    const cards = new Map<string, League>();
    const addLeague = (league: Partial<League>) => {
      if (!league?.name) return;
      const key = (league.id ?? league.name).toString().toLowerCase();
      if (cards.has(key)) return;
      cards.set(key, {
        id: league.id ?? league.name,
        name: league.name,
        country: league.country,
        slug: league.slug,
        logo: league.logo,
        season: league.season,
        category: league.category,
      });
    };

    (data?.interpretedHits ?? []).forEach((hit) => {
      if (hit.kind === "leagues" && hit.leagues) {
        hit.leagues.forEach((league) => addLeague(league));
      }
    });

    if (matchAggregation.leagueName) {
      const metadata = findLeagueMetadata({ leagueName: matchAggregation.leagueName });
      if (metadata) {
        addLeague({
          id: String(metadata.league_key ?? metadata.id ?? metadata.name),
          name: metadata.name ?? matchAggregation.leagueName,
          country: metadata.country,
          slug: metadata.slug,
        });
      } else {
        addLeague({
          id: matchAggregation.leagueName,
          name: matchAggregation.leagueName,
        });
      }
    }

    return Array.from(cards.values());
  }, [data?.interpretedHits, matchAggregation.leagueName]);

  const interpretedHits = data?.interpretedHits ?? [];
  const hits = interpretedHits.filter((hit) => {
    if (hit.kind === "matches") return false;
    if (hit.kind === "leagues") return false;
    if (hit.kind === "highlights") return (hit.highlights?.length ?? 0) > 0;
    return true;
  });
  const tried = data?.results ?? [];

  const teamHeading = (() => {
    if (matchAggregation.teamDisplayNames.length === 0) return undefined;
    if (matchAggregation.teamDisplayNames.length === 1) return matchAggregation.teamDisplayNames[0];
    if (matchAggregation.teamDisplayNames.length === 2) {
      return `${matchAggregation.teamDisplayNames[0]} vs ${matchAggregation.teamDisplayNames[1]}`;
    }
    return matchAggregation.teamDisplayNames.join(", ");
  })();

  const hasAnyContent = matchAggregation.hasMatchContent || hits.length > 0 || leagueCards.length > 0;

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

  if (!hasAnyContent) {
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
              {tried.map((item, idx) => {
                const errorMessage = item.error ? formatError(item.error) : null;
                return (
                  <div key={`${item.intent}-${idx}`} className="flex flex-col gap-1 rounded-lg border border-border/60 p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge variant={item.ok ? "default" : "secondary"} className="uppercase tracking-wider text-xs">
                        {item.intent}
                      </Badge>
                      {item.reason && <span className="text-muted-foreground">{item.reason}</span>}
                    </div>
                    {errorMessage && (
                      <span className="text-xs text-destructive">Error: {errorMessage}</span>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const renderFixtureSection = (title: string, records: Array<{ key: string; fixture: Fixture; isDirect: boolean }>) => {
    if (!records.length) return null;
    const directRecords = records.filter((record) => record.isDirect);
    const otherRecords = records.filter((record) => !record.isDirect);
    const renderGroup = (group: typeof records) => (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {group.map((record) => (
          <MatchCard key={record.key} fixture={record.fixture} />
        ))}
      </div>
    );

    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-semibold">{title}</h3>
        </div>
        {directRecords.length > 0 && (
          <div className="space-y-2">
            {otherRecords.length > 0 && <h4 className="text-sm font-medium text-muted-foreground">Head-to-head</h4>}
            {renderGroup(directRecords)}
          </div>
        )}
        {otherRecords.length > 0 && (
          <div className="space-y-2">
            {directRecords.length > 0 && <h4 className="text-sm font-medium text-muted-foreground">Other fixtures</h4>}
            {renderGroup(otherRecords)}
          </div>
        )}
        {directRecords.length === 0 && otherRecords.length === 0 && renderGroup(records)}
      </section>
    );
  };

  return (
    <div className="space-y-8">
      {teamHeading && (
        <header className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{teamHeading}</h2>
          {matchAggregation.leagueName && (
            <p className="text-sm text-muted-foreground">
              Filtered by league: <span className="font-medium">{matchAggregation.leagueName}</span>
            </p>
          )}
        </header>
      )}

      {leagueCards.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xl font-semibold">Leagues</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {leagueCards.map((league) => (
              <LeagueResultCard key={league.id} league={league} />
            ))}
          </div>
        </section>
      )}

      {renderFixtureSection("Live matches", matchAggregation.sections.live)}
      {renderFixtureSection("Upcoming matches", matchAggregation.sections.upcoming)}
      {renderFixtureSection("Recent matches", matchAggregation.sections.recent)}

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
