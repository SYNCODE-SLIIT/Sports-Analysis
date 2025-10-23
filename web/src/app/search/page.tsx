"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { NlSearchBar } from "@/components/search/NlSearchBar";
import { NlSearchResults } from "@/components/search/NlSearchResults";
import { useNlSearch } from "@/hooks/useNlSearch";

function parseLimit(value: string | null): number | undefined {
  if (!value) return undefined;
  const num = Number(value);
  if (Number.isNaN(num)) return undefined;
  return num;
}

function SearchPageInner() {
  const params = useSearchParams();
  const queryParam = params?.get("q") ?? "";
  const limitParam = params?.get("limit") ?? null;
  const trimmedQuery = queryParam.trim();
  const limit = parseLimit(limitParam);
  const queryOptions = useMemo(() => ({ limit }), [limit]);

  const { data, isLoading, error } = useNlSearch(trimmedQuery, queryOptions);

  return (
    <div className="container space-y-8 py-10">
      <header className="space-y-3">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Search</h1>
          <p className="max-w-2xl text-muted-foreground">
            Search for matches using natural language queries. Try
            &nbsp;<span className="font-medium">“Premier League matches yesterday”</span>
          </p>
        </div>
        <NlSearchBar className="max-w-xl" />
      </header>

      <NlSearchResults query={trimmedQuery} data={data} isLoading={isLoading} error={error instanceof Error ? error : undefined} />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="container space-y-8 py-10">
          <header className="space-y-3">
            <h1 className="text-3xl font-bold tracking-tight">Search</h1>
          </header>
          <div className="text-sm text-muted-foreground">Loading search…</div>
        </div>
      }
    >
      <SearchPageInner />
    </Suspense>
  );
}
