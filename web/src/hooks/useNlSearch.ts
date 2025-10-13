"use client";

import { useQuery } from "@tanstack/react-query";
import { postNlSearch, type NlSearchResultBundle } from "@/lib/search";

export function useNlSearch(query: string, options?: { limit?: number }) {
  const trimmed = query.trim();
  return useQuery<NlSearchResultBundle>({
    queryKey: ["nl-search", trimmed, options?.limit],
    queryFn: async () => {
      if (!trimmed) {
        throw new Error("Query is required");
      }
      return postNlSearch(trimmed, options);
    },
    enabled: trimmed.length > 0,
    staleTime: 30 * 1000,
    retry: (failureCount, error) => {
      // Avoid retrying on client validation errors
      return !/required/i.test(error?.message ?? "") && failureCount < 2;
    },
  });
}

