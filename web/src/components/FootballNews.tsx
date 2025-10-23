"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { ArticleSummaryCard } from "@/components/news/ArticleSummaryCard";
import { getLeagueNews } from "@/lib/collect";

type Article = {
  id?: string;
  title?: string;
  url?: string;
  summary?: string;
  imageUrl?: string;
  source?: string;
  author?: string;
  publishedAt?: string;
};

type Props = {
  articles?: Article[];
  limit?: number;
  moreHref?: string;
  moreLabel?: string;
  variant?: "full" | "preview";
  showSearch?: boolean;
};

export default function FootballNews({
  articles: initialArticles,
  limit = 0,
  moreHref,
  moreLabel = "Explore more",
  variant = "full",
  showSearch: showSearchProp,
}: Props) {
  const showSearch = showSearchProp ?? variant === "full";

  const [articles, setArticles] = useState<Article[] | null>(initialArticles ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const ARTICLES_PER_PAGE = 20;

  useEffect(() => {
    setPage(1); // Reset to first page on new data or search/filter
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
            author: asString(obj.author) || asString(obj.byline) || asString(obj.creator) || asString(obj.contributor) || undefined,
            publishedAt: asString(obj.publishedAt) || asString(obj.pubDate) || asString(obj.published) || "",
          } as Article;
        });

        const seen = new Set<string>();
        const unique = normalized.filter((article) => {
          const key = article.id || article.url;
          if (!key) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const finalPool =
          limit && limit > 0 && unique.length < limit ? normalized : unique;

        if (!active) return;
        setArticles(
          limit && limit > 0 ? finalPool.slice(0, limit) : finalPool
        );
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

  // Filtered and searched articles
  const filteredArticles = useMemo(() => {
    if (!articles) return [];
    let filtered = articles;
    const q = search.trim().toLowerCase();
    if (q) {
      filtered = filtered.filter((a) => {
        const title = a.title?.toLowerCase() || "";
        const author = a.author?.toLowerCase() || "";
        const source = a.source?.toLowerCase() || "";
        return (
          title.includes(q) ||
          author.includes(q) ||
          source.includes(q)
        );
      });
    }
    return filtered;
  }, [articles, search]);

  const totalPages = Math.ceil(filteredArticles.length / ARTICLES_PER_PAGE) || 1;
  // Scroll to top of news list on page change
  const newsListRef = useRef<HTMLDivElement>(null);
  const scrollNewsListToTop = useCallback(() => {
    if (variant === "full" && typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (newsListRef.current) {
      newsListRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [variant]);

  useEffect(() => {
    if (variant !== "full") return;
    scrollNewsListToTop();
  }, [page, variant, scrollNewsListToTop]);

  const pagedArticles = useMemo(() => {
    const start = (page - 1) * ARTICLES_PER_PAGE;
    return filteredArticles.slice(start, start + ARTICLES_PER_PAGE);
  }, [filteredArticles, page]);

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
      <CardHeader className="relative space-y-2 pb-4">
        <CardDescription className="text-sm text-muted-foreground">
          Hand-picked headlines from across the football world, refreshed throughout the day.
        </CardDescription>
        {showSearch ? (
          <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center md:gap-4 w-full">
            <div className="relative w-full max-w-xl">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                <svg
                  width="20"
                  height="20"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  className="text-muted-foreground"
                >
                  <circle cx="11" cy="11" r="7" strokeWidth="2" />
                  <path strokeWidth="2" strokeLinecap="round" d="M21 21l-4.35-4.35" />
                </svg>
              </span>
              <Input
                type="text"
                placeholder="Search by title, author, or source..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-md border border-border py-2 pl-10 pr-4 text-base transition-colors focus:border-primary/60 focus:ring-2 focus:ring-primary/30"
                style={{ minWidth: 320, width: "100%", maxWidth: 480 }}
              />
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div
            ref={newsListRef}
            className={
              variant === "preview"
                ? "grid gap-4 sm:grid-cols-2"
                : "grid gap-4 md:grid-cols-2"
            }
          >
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
        ) : !filteredArticles || filteredArticles.length === 0 ? (
          <div className="text-sm text-muted-foreground">No football headlines available right now.</div>
        ) : (
          <>
            <div
              ref={newsListRef}
              className={
                variant === "preview"
                  ? "grid gap-4 sm:grid-cols-2"
                  : "grid gap-4 md:grid-cols-2"
              }
            >
              {pagedArticles.map((article, index) => {
                const articleKey = article.id || article.url || `football-news-${index}`;
                return (
                  <ArticleSummaryCard
                    key={articleKey}
                    articleId={articleKey}
                    title={article.title}
                    url={article.url}
                    preview={article.summary}
                    imageUrl={article.imageUrl}
                    source={article.source}
                    publishedAt={article.publishedAt}
                    ctaLabel="Latest headline"
                  />
                );
              })}
            </div>
            {/* Pagination controls with ellipsis and scroll-to-top */}
            {variant === "full" && totalPages > 1 && (
              <div className="mt-8 flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setPage(p => Math.max(1, p - 1)); scrollNewsListToTop(); }} disabled={page === 1}>
                    Prev
                  </Button>
                  {/* Page numbers with ellipsis logic */}
                  {(() => {
                    const pages = [];
                    if (totalPages <= 7) {
                      for (let i = 1; i <= totalPages; i++) {
                        pages.push(i);
                      }
                    } else {
                      if (page <= 4) {
                        pages.push(1, 2, 3, 4, 5, '...', totalPages);
                      } else if (page >= totalPages - 3) {
                        pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
                      } else {
                        pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
                      }
                    }
                    return pages.map((p, idx) =>
                      p === '...'
                        ? <span key={"ellipsis-" + idx} className="px-2">...</span>
                        : <button
                            key={p}
                            className={`px-3 py-1 border rounded font-semibold transition-colors ${page === p ? "bg-gray-400 text-black border-gray-400" : "bg-background text-foreground border-muted"}`}
                            onClick={() => {
                                  setPage(Number(p));
                                  scrollNewsListToTop();
                                }}
                            disabled={page === p}
                          >{p}</button>
                    );
                  })()}
                  <Button size="sm" variant="ghost" onClick={() => { setPage(p => Math.min(totalPages, p + 1)); scrollNewsListToTop(); }} disabled={page === totalPages}>
                    Next
                  </Button>
                </div>
                <span>
                  Page {page} of {totalPages}
                </span>
              </div>
            )}
            {moreHref ? (
              <div className="mt-8 flex justify-center">
                <Button asChild variant="default" size="default">
                  <Link href={moreHref}>{moreLabel}</Link>
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
