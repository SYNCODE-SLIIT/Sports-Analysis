"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/AuthProvider";

type RecItem = {
  item_id: string;
  score: number;
  reason?: string | null;
  item?: Record<string, unknown> | null;
};

type ItemRow = {
  id: string;
  popularity?: number | null;
  [key: string]: unknown;
};

export function useRecommendations() {
  const { supabase, user, prefsVersion, interactionsVersion } = useAuth();
  return useQuery<{ items: RecItem[] }>( {
    queryKey: ["recommendations", user?.id, prefsVersion, interactionsVersion],
    enabled: !!user,
    queryFn: async () => {
      // Prefer server-side scoring via RPC
      try {
        // use the server-side wrapper which uses auth.uid() to ensure recs are computed for the logged in user
        const { data: rpcData, error: rpcError } = await supabase.rpc("get_my_personalized_recommendations", {
          limit_count: 20,
        });
        if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
          type RpcRow = { item_id: string; score?: number | string | null; reason?: string | null; item?: Record<string, unknown> | null };
          const items: RecItem[] = (rpcData as unknown[]).map((rec: unknown) => {
            const r = rec as Partial<RpcRow>;
            return {
              item_id: String(r.item_id ?? ''),
              score: Number(r.score ?? 0),
              reason: typeof r.reason === 'string' ? r.reason : null,
              item: (r.item && typeof r.item === 'object') ? (r.item as Record<string, unknown>) : null,
            };
          });
          return { items };
        }
      } catch {
        // fall through to simple fallback
      }

      // Fallback using preferences (and popularity for cold start)
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("favorite_teams, favorite_leagues")
        .eq("user_id", user!.id)
        .single();

      // Start from popular items, break ties by most recent
      let query = supabase
        .from("items")
        .select("*")
        .order("popularity", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(20);
      if (prefs?.favorite_teams?.length) {
        query = query.contains("teams", prefs.favorite_teams);
      }
      if (prefs?.favorite_leagues?.length) {
        query = query.contains("leagues", prefs.favorite_leagues);
      }
      const { data: items } = await query;
      return { items: (items ?? []).map((it: ItemRow) => ({ item_id: it.id, score: Number(it.popularity ?? 0), item: it })) };
    },
    staleTime: 60_000,
  });
}
