"use client";

import { useQuery } from "@tanstack/react-query";
import { postCollect, getLiveEvents, listEvents, getEventResults, getHighlights, DataObject } from "@/lib/collect";
import { parseInsights, parseEvent, parseHighlights, parseFixtures } from "@/lib/schemas";

/**
 * Hook to fetch match insights for a specific event
 */
export function useMatchInsights(eventId?: string) {
  return useQuery({
    queryKey: ["insights", eventId],
    queryFn: async () => {
      if (!eventId) throw new Error("Event ID is required");
  const res = await postCollect<{ insights?: DataObject } | DataObject>({ intent: "analysis.match_insights", args: { eventId } });
  const d = res.data;
  const payload = (typeof d === "object" && d !== null && "insights" in (d as Record<string, unknown>)) ? (d as { insights?: unknown }).insights : d;
      return parseInsights(payload);
    },
    enabled: !!eventId,
    staleTime: 60 * 1000, // 60 seconds
  });
}

/**
 * Hook to fetch event details
 */
export function useEvent(eventId?: string) {
  return useQuery({
    queryKey: ["event", eventId],
    queryFn: async () => {
      if (!eventId) throw new Error("Event ID is required");
  const res = await getEventResults(eventId);
  const d = res.data;
  const event = typeof d === "object" && d !== null && "event" in (d as Record<string, unknown>) ? (d as { event?: unknown }).event : undefined;
  return parseEvent(event ?? null);
    },
    enabled: !!eventId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook to fetch highlights for an event
 */
export function useHighlights(eventId?: string) {
  return useQuery({
    queryKey: ["highlights", eventId],
    queryFn: async () => {
  if (!eventId) return [];
  const res = await getHighlights(eventId);
  const d = res.data;
  const videos = typeof d === "object" && d !== null && "videos" in (d as Record<string, unknown>) ? (d as { videos?: unknown }).videos : [];
  return parseHighlights(Array.isArray(videos) ? videos : []);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to fetch league fixtures
 */
export function useLeagueFixtures(leagueId?: string, date?: string) {
  return useQuery({
    queryKey: ["fixtures", leagueId, date],
    queryFn: async () => {
      const today = date || new Date().toISOString().split("T")[0];
      const todayOnly = new Date().toISOString().split("T")[0];
      const kind: "past" | "upcoming" = (date ?? todayOnly) >= todayOnly ? "upcoming" : "past";
      const res = await listEvents({
        leagueName: leagueId,
        kind,
        fromDate: today,
        toDate: today,
      });
      const d = res.data;
      const events = typeof d === "object" && d !== null && "events" in (d as Record<string, unknown>) ? (d as { events?: unknown }).events : [];
      return parseFixtures(Array.isArray(events) ? events : []);
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

/**
 * Hook to fetch live matches with polling
 */
export function useLiveMatches(opts?: { leagueName?: string }) {
  return useQuery({
    queryKey: ["live-matches", opts?.leagueName ?? null],
    queryFn: async () => {
  const res = await getLiveEvents({ leagueName: opts?.leagueName });
  const d = res.data as Record<string, unknown> | undefined;
  let raw: unknown = [];
  if (d && typeof d === 'object') {
    const get = (key: string) => (d as Record<string, unknown>)[key];
    raw = (get('events') as unknown) ?? (get('result') as unknown) ?? (get('results') as unknown) ?? (get('items') as unknown) ?? [];
  }
  const arr = Array.isArray(raw) ? raw : [];
  const parsed = parseFixtures(arr);
  if (process.env.NODE_ENV !== 'production') {
    // Lightweight insight while wiring: see if parsing drops items
    if (arr.length && parsed.length === 0) {
      console.warn('[live] parsed 0 fixtures from', arr.length, 'items');
    }
  }
  return parsed;
    },
    staleTime: 0, // Always fresh
    refetchInterval: 15 * 1000, // Poll every 15 seconds
    refetchIntervalInBackground: true,
  });
}