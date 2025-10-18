"use client";

import { useMemo, useState, type ReactElement } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { sanitizeInput } from "@/lib/collect";

type LeagueSearchItem = {
  rawName: string;
  displayName: string;
  displayLabel: string;
  displayCountry?: string;
  logo?: string;
  metadata?: {
    primary?: {
      name?: string;
      slug?: string;
      aliases?: string[];
      country?: string;
      confederation?: string;
    };
    categories?: string[];
    fameRank?: number;
  };
};

type LeagueSearchProps<T extends LeagueSearchItem> = {
  leagues: readonly T[];
  renderResultCard: (league: T, index: number) => ReactElement;
  placeholder?: string;
  maxResults?: number;
};

const normalize = (value: string | undefined | null) => {
  if (!value) return "";
  return sanitizeInput(value).toLowerCase();
};

const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  const previous = new Array<number>(bLen + 1);
  const current = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j += 1) {
    previous[j] = j;
  }

  for (let i = 0; i < aLen; i += 1) {
    current[0] = i + 1;
    const aCode = a.charCodeAt(i);
    for (let j = 0; j < bLen; j += 1) {
      const cost = aCode === b.charCodeAt(j) ? 0 : 1;
      const insertion = current[j] + 1;
      const deletion = previous[j + 1] + 1;
      const substitution = previous[j] + cost;
      current[j + 1] = Math.min(insertion, deletion, substitution);
    }
    for (let j = 0; j <= bLen; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[bLen];
};

const normalizedDistance = (a: string, b: string) => {
  const maxLength = Math.max(a.length, b.length, 1);
  return levenshtein(a, b) / maxLength;
};

const collectCandidateStrings = <T extends LeagueSearchItem>(league: T): string[] => {
  const bucket = new Set<string>();
  bucket.add(league.displayName);
  bucket.add(league.rawName);
  bucket.add(league.displayLabel);
  if (league.displayCountry) {
    bucket.add(league.displayCountry);
    bucket.add(`${league.displayCountry} ${league.displayName}`);
  }

  const metadata = league.metadata;
  if (metadata) {
    const primary = metadata.primary;
    if (primary) {
      if (primary.name) bucket.add(primary.name);
      if (primary.slug) bucket.add(primary.slug.replace(/-/g, " "));
      if (primary.country) bucket.add(primary.country);
      if (primary.confederation) bucket.add(primary.confederation);
      (primary.aliases ?? []).forEach(alias => bucket.add(alias));
    }
    (metadata.categories ?? []).forEach(category => bucket.add(category.replace(/_/g, " ")));
  }

  return Array.from(bucket);
};

const rankLeagues = <T extends LeagueSearchItem>(query: string, leagues: readonly T[], maxResults: number) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!queryTokens.length) return [];

  const scored: Array<{ league: T; score: number; strongHit: boolean }> = [];

  leagues.forEach(league => {
    const candidates = collectCandidateStrings(league);
    if (!candidates.length) return;

    let bestScore = Number.POSITIVE_INFINITY;
    let strongHit = false;

    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      if (!normalizedCandidate) continue;

      if (queryTokens.every(token => normalizedCandidate.includes(token))) {
        strongHit = true;
        bestScore = Math.min(bestScore, 0);
      }

      bestScore = Math.min(bestScore, normalizedDistance(normalizedQuery, normalizedCandidate));

      const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
      for (const candidateToken of candidateTokens) {
        bestScore = Math.min(bestScore, normalizedDistance(normalizedQuery, candidateToken));
        for (const queryToken of queryTokens) {
          const tokenDistance = normalizedDistance(queryToken, candidateToken);
          if (tokenDistance <= 0.18) strongHit = true;
          bestScore = Math.min(bestScore, tokenDistance + 0.02);
        }
      }
    }

    if (!Number.isFinite(bestScore)) return;

    const fameRank = league.metadata?.fameRank ?? Number.MAX_SAFE_INTEGER;
    const fameBias = fameRank === Number.MAX_SAFE_INTEGER ? 0.08 : Math.min(fameRank / 1_000_000, 0.08);
    const score = bestScore + fameBias;

    scored.push({ league, score, strongHit });
  });

  const fallbackThreshold = 0.75;

  scored.sort((a, b) => {
    if (a.strongHit !== b.strongHit) return a.strongHit ? -1 : 1;
    if (a.score !== b.score) return a.score - b.score;
    return a.league.displayLabel.localeCompare(b.league.displayLabel);
  });

  const filtered = scored.filter(item => item.strongHit || item.score <= fallbackThreshold);

  const pool = filtered.length > 0 ? filtered : scored;

  return pool.slice(0, maxResults).map(item => item.league);
};

export function LeagueSearch<T extends LeagueSearchItem>({
  leagues,
  renderResultCard,
  placeholder = "Search by league or country",
  maxResults = 16,
}: LeagueSearchProps<T>) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => rankLeagues(query, leagues, maxResults), [query, leagues, maxResults]);
  const hasQuery = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="relative w-full max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="pl-9"
          placeholder={placeholder}
          aria-label="Search leagues by name or country"
        />
      </div>

      {hasQuery && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold">Search Results</h3>
            <span className="text-sm text-muted-foreground">{results.length} match{results.length === 1 ? "" : "es"}</span>
          </div>

          {results.length ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {results.map((league, index) => renderResultCard(league, index))}
            </div>
          ) : (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/40 p-6 text-sm text-muted-foreground">
              No close matches. Try refining your spelling or search terms.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export type { LeagueSearchItem };
