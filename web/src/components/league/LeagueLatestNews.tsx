"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  leagueName?: string | null;
  limit?: number;
};

export default function LeagueLatestNews({ leagueName, limit = 20 }: Props) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!leagueName) {
        setArticles([]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const resp = await getLeagueNews(leagueName, limit || 20);
        const articlesRaw = (resp as any)?.data?.articles || (resp as any)?.data?.result || (resp as any)?.data || [];

        const asString = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);

        const normalized = (Array.isArray(articlesRaw) ? articlesRaw : []).map((item: unknown, index: number) => {
          if (!item || typeof item !== "object") return { id: `news-${index}` } as Article;
          const obj = item as Record<string, unknown>;

          const pick = (keys: string[]): string | undefined => {
            for (const k of keys) {
              const v = obj[k];
              if (typeof v === "string" && v.trim()) return v.trim();
            }
            return undefined;
          };

          // image/media detection
          let imageUrl = pick(["image", "imageUrl", "urlToImage", "thumbnail", "image_url", "thumb"]);
          if (!imageUrl) {
            const media = Array.isArray((obj as any).media) ? ((obj as any).media as any[]) : undefined;
            if (media && media.length) {
              for (const m of media) {
                if (typeof m === "string" && m.trim()) { imageUrl = m.trim(); break; }
                if (m && typeof m === "object") {
                  const url = asString((m as any).url) || asString((m as any).src) || asString((m as any).image);
                  if (url) { imageUrl = url; break; }
                }
              }
            }
          }

          return {
            id: asString(obj.id) || asString((obj as any).articleId) || asString((obj as any).url) || `news-${index}`,
            title: asString((obj as any).title) || asString((obj as any).headline) || asString((obj as any).name) || "",
            url: asString((obj as any).url) || asString((obj as any).link) || asString((obj as any).article_url) || "",
            summary: asString((obj as any).summary) || asString((obj as any).description) || asString((obj as any).excerpt) || "",
            imageUrl: imageUrl || undefined,
            source: asString((obj as any).source) || asString((obj as any).publisher) || "",
            author: asString((obj as any).author) || asString((obj as any).byline) || asString((obj as any).creator) || asString((obj as any).contributor) || undefined,
            publishedAt: asString((obj as any).publishedAt) || asString((obj as any).pubDate) || asString((obj as any).published) || "",
          } as Article;
        });

        if (!cancelled) setArticles(normalized);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [leagueName, limit]);

  const skeletonCount = useMemo(() => Math.min(Math.max(limit || 6, 3), 6), [limit]);

  const newsListRef = useRef<HTMLDivElement>(null);

  return (
    <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background via-background/80 to-primary/5 shadow-md">
      <div aria-hidden className="pointer-events-none absolute inset-y-6 -right-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl" />
      <CardHeader className="relative space-y-2 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Latest from {leagueName || "this league"}</h2>
        </div>
        <CardDescription className="text-sm text-muted-foreground">
          Curated headlines and updates around {leagueName || "this league"}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div ref={newsListRef} className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: skeletonCount }).map((_, index) => (
              <div key={`news-skeleton-${index}`} className="relative overflow-hidden rounded-xl border border-border/50 bg-card/60 p-4 shadow-sm">
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
          <div className="text-sm text-muted-foreground">No recent headlines available right now.</div>
        ) : (
          <div ref={newsListRef} className="grid gap-4 md:grid-cols-2">
            {articles.map((article, index) => {
              const articleKey = article.id || article.url || `league-news-${index}`;
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
                  ctaLabel="League news"
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
