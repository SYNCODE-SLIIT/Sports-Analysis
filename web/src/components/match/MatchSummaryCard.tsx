"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { postCollect, sanitizeInput } from "@/lib/collect";
import { summarize } from "@/lib/api";
import type { DataObject, Json } from "@/lib/collect";

export type MatchSummaryCardProps = {
  event: {
    eventId: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    status: string;
    venue?: string;
    date: string;
  } | null;
  rawEvent: DataObject | null;
};

type SummaryResponse = {
  headline?: string;
  paragraph?: string;
  one_paragraph?: string;
  bullets?: Json[];
};

type SummaryContent = {
  headline: string;
  paragraph: string;
  bullets: string[];
};

type SummaryState = {
  data: SummaryContent | null;
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
};

const FALLBACK_SUMMARY: SummaryContent = {
  headline: "Match Summary",
  paragraph: "Summary unavailable for this fixture.",
  bullets: [],
};

export function MatchSummaryCard({ event, rawEvent }: MatchSummaryCardProps) {
  const [state, setState] = useState<SummaryState>({ data: null, status: "idle" });

  const fallback = useMemo(() => buildFallbackSummary(event, rawEvent), [event, rawEvent]);

  // Module-scoped in-flight promise map and cache to dedupe and cache results across
  // component remounts (helps in dev StrictMode and HMR). We store the request
  // Promise so subsequent mounts can await the same work and receive the result.
  const inflightMap = useMemo(() => globalThis.__sa_inflight_summaries ||= new Map<string, Promise<SummaryContent | null>>(), []);
  const resultCache = useMemo(() => globalThis.__sa_summary_cache ||= new Map<string, SummaryContent>(), []);

  // Stable key for this event — prefer eventId when available, otherwise fall
  // back to a composed key from teams+date. We only re-run when this key changes.
  const stableEventKey = useMemo(() => {
    if (!event) return null;
    if (event.eventId) return String(event.eventId);
    return `${event.homeTeam ?? ''}::${event.awayTeam ?? ''}::${event.date ?? ''}`;
  }, [event]);

  useEffect(() => {
    let active = true;
    if (!stableEventKey) {
      setState({ data: null, status: "idle" });
      return () => {
        active = false;
      };
    }

    // If we have a cached result, use it and don't re-fetch.
    if (resultCache.has(stableEventKey)) {
      const cached = resultCache.get(stableEventKey)!;
      setState({ data: cached, status: "ready" });
      return () => {
        active = false;
      };
    }

    const load = async () => {
      setState(prev => ({ ...prev, status: "loading", error: undefined }));

      // If another load for the same event is in-flight, await its promise and use its result
      if (inflightMap.has(stableEventKey)) {
        try {
          const shared = inflightMap.get(stableEventKey)!;
          const res = await shared;
          if (!active) return;
          if (res) {
            setState({ data: res, status: "ready" });
          } else {
            setState({ data: fallback, status: "error" });
          }
          return;
        } catch {
          if (!active) return;
          setState({ data: fallback, status: "error" });
          return;
        }
      }

      // Otherwise start a new request and store its promise
      const p = (async () => {
        try {
          const payload: Record<string, Json> = {};
          if (event?.eventId) payload.eventId = event.eventId;
          if (event?.homeTeam && event?.awayTeam) payload.eventName = `${event.homeTeam} vs ${event.awayTeam}`;
          if (event?.date) payload.date = event.date;
          if (event?.venue) payload.venue = event.venue;
          const homeSan = sanitizeInput(event?.homeTeam ?? "");
          if (homeSan) payload.homeTeam = homeSan;
          const awaySan = sanitizeInput(event?.awayTeam ?? "");
          if (awaySan) payload.awayTeam = awaySan;

          let raw: SummaryResponse | undefined | null = undefined;
          try {
            raw = await summarize(payload as { eventId?: string; eventName?: string; date?: string; venue?: string; homeTeam?: string; awayTeam?: string });
          } catch {
            // Keep raw undefined; we'll fall back to local summary below
            raw = undefined;
          }

          const normalized = normalizeSummary(raw) ?? fallback;
          // cache the successful result for this key
          try { if (normalized) resultCache.set(stableEventKey, normalized); } catch {}
          return normalized;
        } catch {
          return null;
        } finally {
          // ensure we clean the inflight entry (after promise settles)
          setTimeout(() => { try { inflightMap.delete(stableEventKey); } catch {} }, 0);
        }
      })();

      inflightMap.set(stableEventKey, p);

      try {
        const res = await p;
        if (!active) return;
        if (res) setState({ data: res, status: "ready" });
        else setState({ data: fallback, status: "error" });
      } catch {
        if (!active) return;
        setState({ data: fallback, status: "error" });
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [event, fallback, inflightMap, resultCache, stableEventKey]);

  const summary = state.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{state.status === 'loading' ? 'Generating summary…' : (summary?.headline ?? fallback.headline)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "loading" ? (
          <div className="text-sm text-muted-foreground">Generating summary…</div>
        ) : state.status === "error" ? (
          // show fallback when generation errored
          <>
            {fallback.paragraph && <p className="text-sm leading-relaxed text-muted-foreground">{fallback.paragraph}</p>}
            {fallback.bullets.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {fallback.bullets.map((item, idx) => (
                  <li key={`fallback-bullet-${idx}`}>{item}</li>
                ))}
              </ul>
            )}
            <div className="text-xs text-muted-foreground">Fallback summary shown.</div>
          </>
        ) : (
          // ready (or idle) — show generated summary if present, otherwise fallback
          <>
            {(summary?.paragraph ?? fallback.paragraph) && (
              <p className="text-sm leading-relaxed text-muted-foreground">{summary?.paragraph ?? fallback.paragraph}</p>
            )}
            {(summary?.bullets?.length ?? 0) > 0 ? (
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {summary!.bullets.map((item, idx) => (
                  <li key={`summary-bullet-${idx}`}>{item}</li>
                ))}
              </ul>
            ) : (
              fallback.bullets.length > 0 && (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {fallback.bullets.map((item, idx) => (
                    <li key={`fallback-bullet-${idx}`}>{item}</li>
                  ))}
                </ul>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function normalizeSummary(raw?: SummaryResponse | null): SummaryContent | null {
  if (!raw) return null;
  const headline = (raw.headline ?? "Match Summary").toString().trim() || "Match Summary";
  const paragraphSource = (raw.paragraph ?? raw.one_paragraph ?? "").toString();
  const paragraph = paragraphSource.trim();
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets
        .map(item => {
          if (item == null) return null;
          if (typeof item === "string") return item.trim();
          return item.toString();
        })
        .filter(Boolean) as string[]
    : [];
  if (!paragraph && bullets.length === 0) return null;
  return { headline, paragraph, bullets };
}

function buildFallbackSummary(event: MatchSummaryCardProps["event"], rawEvent: DataObject | null): SummaryContent {
  if (!event) return FALLBACK_SUMMARY;
  const { homeTeam, awayTeam, homeScore, awayScore, status, venue, date } = event;
  const details: string[] = [];
  if (status) details.push(status);
  if (venue) details.push(`Venue: ${venue}`);
  if (date) {
    const dt = new Date(date);
    if (!Number.isNaN(dt.getTime())) details.push(dt.toLocaleString());
  }

  const bullets = extractGoalBullets(rawEvent, homeTeam, awayTeam);

  return {
    headline: `${homeTeam} ${homeScore} – ${awayScore} ${awayTeam}`,
    paragraph: [
      `${homeTeam} and ${awayTeam} finished ${homeScore}-${awayScore}.`,
      details.join(" • "),
    ]
      .filter(Boolean)
      .join(" ")
      .trim(),
    bullets,
  };
}

function extractGoalBullets(rawEvent: DataObject | null, homeTeam: string, awayTeam: string): string[] {
  if (!rawEvent) return [];
  const record = rawEvent as Record<string, unknown>;
  const sources = [record.goalscorers, record.goals, record.scorers];
  const rawGoals = sources.find(Array.isArray) as Array<Record<string, unknown>> | undefined;
  if (!rawGoals || rawGoals.length === 0) return [];
  return rawGoals.slice(0, 6).map(goal => {
    const minute = goal.minute ?? goal.time ?? goal.elapsed ?? goal.time_elapsed;
    const minuteText = typeof minute === "number" || (typeof minute === "string" && minute.trim()) ? `${minute}'` : "";
    const scorer = (goal.scorer || goal.player || goal.home_scorer || goal.away_scorer || "Unknown scorer") as string;
    const note = (goal.info || goal.description || goal.note || "") as string;
    const teamSide = goal.home_scorer ? homeTeam : goal.away_scorer ? awayTeam : "";
    return [minuteText, scorer, teamSide, note].filter(Boolean).join(" • ");
  });
}

export default MatchSummaryCard;
