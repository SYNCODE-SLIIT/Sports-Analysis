"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        // Use the app's collect helper which proxies to the backend collector.
        const resp = await getLeagueNews("football", limit || 20);
        const articlesRaw = resp?.data?.articles || resp?.data?.result || resp?.data || [];
        const asString = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
        const normalized = (Array.isArray(articlesRaw) ? articlesRaw : []).map((a: unknown, i: number) => {
          const obj = (a && typeof a === 'object') ? (a as Record<string, unknown>) : {};
          const media = Array.isArray(obj.media) ? obj.media : undefined;
          const imageCandidate = obj.image ?? obj.imageUrl ?? obj.urlToImage ?? obj.thumbnail ?? obj.image_url ?? (media && media[0] && ((media[0] as Record<string, unknown>).url ?? (media[0] as Record<string, unknown>).src));
          return {
            id: asString(obj.id) || asString(obj.articleId) || asString(obj.url) || `news-${i}`,
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
        const toMessage = (e: unknown) => {
          if (e instanceof Error) return e.message;
          if (typeof e === 'string') return e;
          try { return String(e); } catch { return 'Unknown error'; }
        };
        setError(toMessage(err));
        setArticles([]);
      } finally {
        if (!active) return;
        setLoading(false);
      }
    };

    fetchNews();
    return () => { active = false; };
  }, [initialArticles, limit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Football News</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading news…</div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : !articles || articles.length === 0 ? (
          <div className="text-sm text-muted-foreground">No football headlines available right now.</div>
        ) : (
          <div className="space-y-4">
            {articles.map((article) => (
              <a
                key={article.id}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-border p-4 transition hover:border-primary hover:shadow"
              >
                <div className="flex items-start gap-3">
                  {article.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={article.imageUrl}
                      alt={article.title || 'news image'}
                      className="h-20 w-28 flex-shrink-0 rounded-md object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : null}

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{article.title}</div>
                    {article.summary && (
                      <div className="text-sm text-muted-foreground line-clamp-3">{article.summary}</div>
                    )}
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-2">
                      {article.source && <span className="truncate">{article.source}</span>}
                      {article.publishedAt && (
                        <time dateTime={article.publishedAt} className="truncate">
                          {new Date(article.publishedAt).toLocaleString()}
                        </time>
                      )}
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
