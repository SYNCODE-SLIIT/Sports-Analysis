"use client";

import { useCallback, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { summarizeNewsArticle } from "@/lib/collect";

export type ArticleSummaryCardProps = {
  articleId: string;
  title?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
  preview?: string;
  imageUrl?: string;
  ctaLabel?: string;
  alignButtons?: "row" | "stack";
};

type SummaryState = {
  status: "idle" | "loading" | "ready" | "error";
  summary?: string;
  bullets?: string[];
  error?: string;
};

const formatRelativeTime = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const divisions: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
    { amount: 60, name: "second" },
    { amount: 60, name: "minute" },
    { amount: 24, name: "hour" },
    { amount: 7, name: "day" },
    { amount: 4.34524, name: "week" },
    { amount: 12, name: "month" },
    { amount: Number.POSITIVE_INFINITY, name: "year" },
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let duration = seconds;

  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.name);
    }
    duration /= division.amount;
  }
  return null;
};

export function ArticleSummaryCard({
  articleId,
  title,
  url,
  source,
  publishedAt,
  preview,
  imageUrl,
  ctaLabel = "Latest headline",
  alignButtons = "row",
}: ArticleSummaryCardProps) {
  const [state, setState] = useState<SummaryState>({ status: "idle" });
  const [open, setOpen] = useState(false);

  const displayTitle = title || "Untitled headline";
  const relativeTime = useMemo(() => formatRelativeTime(publishedAt), [publishedAt]);
  const bullets = Array.isArray(state.bullets) ? state.bullets : [];

  const fetchSummary = useCallback(async () => {
    if (!url) {
      setState({ status: "error", error: "No article URL available to summarize." });
      return;
    }
    setState({ status: "loading" });
    try {
      const result = await summarizeNewsArticle({ url, title });
      setState({
        status: "ready",
        summary: result.summary,
        bullets: Array.isArray(result.bullets) ? result.bullets : [],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: "error", error: message });
    }
  }, [url, title]);

  const handleSummarizeClick = useCallback(() => {
    setOpen(true);
    if (!url) {
      setState({ status: "error", error: "No article URL available to summarize." });
      return;
    }
    if (state.status === "ready" || state.status === "loading") return;
    void fetchSummary();
  }, [fetchSummary, state.status, url]);

  const handleRetry = useCallback(() => {
    void fetchSummary();
  }, [fetchSummary]);

  return (
    <>
      <div className="group relative block overflow-hidden rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-background hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/0 via-primary/5 to-primary/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="flex flex-col gap-4 sm:flex-row">
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={displayTitle}
              className="h-24 w-full flex-shrink-0 rounded-lg object-cover shadow-sm sm:h-24 sm:w-32"
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-primary/70">{ctaLabel}</div>
            <div className="mt-1 text-base font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
              {displayTitle}
            </div>
            {preview ? <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{preview}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {source ? <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary/80">{source}</span> : null}
              {source && publishedAt ? <span aria-hidden className="h-1 w-1 rounded-full bg-border" /> : null}
              {publishedAt ? (
                <time dateTime={publishedAt} className="truncate" title={new Date(publishedAt).toLocaleString()}>
                  {relativeTime ?? new Date(publishedAt).toLocaleDateString()}
                </time>
              ) : null}
            </div>
            <div
              className={
                alignButtons === "stack"
                  ? "mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
                  : "mt-4 flex flex-wrap items-center gap-3"
              }
            >
              <Button size="sm" variant="secondary" onClick={handleSummarizeClick} disabled={state.status === "loading"}>
                {state.status === "loading"
                  ? "Summarizing..."
                  : state.status === "ready"
                  ? "View Summary"
                  : state.status === "error"
                  ? "Retry summary"
                  : "Get Summary"}
              </Button>
              {url ? (
                <Button size="sm" variant="outline" asChild>
                  <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                    Go to article
                    <svg aria-hidden className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled>
                  Go to article
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      <Dialog open={open} onOpenChange={(next) => setOpen(next)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title || "Article Summary"}</DialogTitle>
            {(source || relativeTime) ? (
              <DialogDescription>
                <div className="flex flex-wrap items-center gap-2 text-xs uppercase text-muted-foreground">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary/80">AI-generated</span>
                  {source ? <span>{source}</span> : null}
                  {source && relativeTime ? <span aria-hidden>•</span> : null}
                  {relativeTime ? <span>{relativeTime}</span> : null}
                </div>
              </DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="space-y-4">
            {state.status === "loading" ? (
              <p className="text-sm text-muted-foreground">Generating summary...</p>
            ) : null}
            {state.status === "error" ? (
              <div className="space-y-3">
                <p className="text-sm text-destructive">{state.error ?? "Unable to generate summary right now."}</p>
                <Button size="sm" onClick={handleRetry}>
                  Try again
                </Button>
              </div>
            ) : null}
            {state.status === "ready" ? (
              <>
                <p className="text-sm leading-relaxed text-muted-foreground">{state.summary}</p>
                {bullets.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {bullets.map((bullet, idx) => (
                      <li key={`${articleId}-bullet-${idx}`}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-xs text-muted-foreground">This summary is generated by AI and may contain mistakes.</p>
              </>
            ) : null}
          </div>
          {url ? (
            <DialogFooter>
              <Button variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2">
                  Read full article
                  <svg aria-hidden className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 12L12 4M12 4H6M12 4V10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
