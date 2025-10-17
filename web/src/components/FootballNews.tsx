"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getLeagueNews } from "@/lib/collect";

type Article = {
  id?: string;
  title?: string;
  url?: string;
  summary?: string;
  imageUrl?: string;
  source?: string;
  publishedAt?: string;
};

type Props = {
  articles?: Article[];
  limit?: number;
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

export default function FootballNews({ articles: initialArticles, limit = 0 }: Props) {
  const [articles, setArticles] = useState<Article[] | null>(initialArticles ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (initialArticles && initialArticles.length) {
      setArticles(initialArticles.slice(0, limit || initialArticles.length));
      return;
    }

    const fetchNews = async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await getLeagueNews("football", limit || 20);
        const articlesRaw = resp?.data?.articles || resp?.data?.result || resp?.data || [];
        const asString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
        const normalized = (Array.isArray(articlesRaw) ? articlesRaw : []).map((item: unknown, index: number) => {
          const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
          const media = Array.isArray(obj.media) ? obj.media : undefined;
          const imageCandidate =
            obj.image ??
            obj.imageUrl ??
            obj.urlToImage ??
            obj.thumbnail ??
            obj.image_url ??
            (media && media[0] && ((media[0] as Record<string, unknown>).url ?? (media[0] as Record<string, unknown>).src));

          return {
            id: asString(obj.id) || asString(obj.articleId) || asString(obj.url) || `news-${index}`,
            title: asString(obj.title) || asString(obj.headline) || asString(obj.name) || "",
            url: asString(obj.url) || asString(obj.link) || asString(obj.article_url) || "",
            summary: asString(obj.summary) || asString(obj.description) || asString(obj.excerpt) || "",
            imageUrl: asString(imageCandidate) || undefined,
            source: asString(obj.source) || asString(obj.publisher) || "",
            publishedAt: asString(obj.publishedAt) || asString(obj.pubDate) || asString(obj.published) || "",
          } as Article;
        });

        if (!active) return;
        setArticles(limit && limit > 0 ? normalized.slice(0, limit) : normalized);
      } catch (err: unknown) {
        if (!active) return;
        const toMessage = (value: unknown) => {
          if (value instanceof Error) return value.message;
          if (typeof value === "string") return value;
          try {
            return String(value);
          } catch {
            return "Unknown error";
          }
        };
        setError(toMessage(err));
        setArticles([]);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    };

    fetchNews();
    return () => {
      active = false;
    };
  }, [initialArticles, limit]);

  const skeletonCount = useMemo(() => {
    if (limit && limit > 0) {
      return Math.min(Math.max(limit, 3), 6);
    }

    return 4;
  }, [limit]);

  return (
    <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background via-background/80 to-primary/5 shadow-md">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-6 -right-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl"
      />
      <CardHeader className="relative space-y-2 pb-6">
        <CardTitle className="text-2xl font-bold tracking-tight">Football News</CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          Hand-picked headlines from across the football world, refreshed throughout the day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: skeletonCount }).map((_, index) => (
              <div
                key={`news-skeleton-${index}`}
                className="relative overflow-hidden rounded-xl border border-border/50 bg-card/60 p-4 shadow-sm"
              >
                <div className="flex animate-pulse flex-col gap-4 sm:flex-row">
                  <div className="h-24 w-full rounded-lg bg-muted sm:h-24 sm:w-32" />
                  <div className="flex-1 space-y-3">
                    <div className="h-4 w-3/4 rounded bg-muted/80" />
                    <div className="h-3 w-full rounded bg-muted/60" />
                    <div className="h-3 w-4/5 rounded bg-muted/60" />
                    <div className="flex gap-2 pt-2">
                      <div className="h-3 w-16 rounded-full bg-muted/50" />
                      <div className="h-3 w-24 rounded-full bg-muted/50" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !articles || articles.length === 0 ? (
          <div className="text-sm text-muted-foreground">No football headlines available right now.</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {articles.map((article) => {
              const displayTitle = article.title || "Untitled headline";
              const relativeTime = formatRelativeTime(article.publishedAt);

              return (
                <a
                  key={article.id}
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative block overflow-hidden rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-background hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/0 via-primary/5 to-primary/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  />
                  <div className="flex flex-col gap-4 sm:flex-row">
                    {article.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={article.imageUrl}
                        alt={displayTitle}
                        className="h-24 w-full flex-shrink-0 rounded-lg object-cover shadow-sm sm:h-24 sm:w-32"
                        onError={(event) => {
                          (event.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-primary/70">Latest headline</div>
                      <div className="mt-1 text-base font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
                        {displayTitle}
                      </div>
                      {article.summary ? (
                        <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{article.summary}</p>
                      ) : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {article.source ? (
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary/80">
                            {article.source}
                          </span>
                        ) : null}
                        {article.source && article.publishedAt ? (
                          <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
                        ) : null}
                        {article.publishedAt ? (
                          <time
                            dateTime={article.publishedAt}
                            className="truncate"
                            title={new Date(article.publishedAt).toLocaleString()}
                          >
                            {relativeTime ?? new Date(article.publishedAt).toLocaleDateString()}
                          </time>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary/80 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    Read full story
                    <svg
                      aria-hidden
                      className="h-3.5 w-3.5 translate-x-0 transition-transform duration-300 group-hover:translate-x-1"
                      viewBox="0 0 16 16"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M4 12L12 4M12 4H6M12 4V10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </a>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
