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
  const { supabase, user, prefsVersion } = useAuth();
  return useQuery<{ items: RecItem[] }>( {
    queryKey: ["recommendations", user?.id, prefsVersion],
    enabled: !!user,
    queryFn: async () => {
      // Prefer server-side scoring via RPC
      try {
        // use the server-side wrapper which uses auth.uid() to ensure recs are computed for the logged in user
        const { data: rpcData, error: rpcError } = await supabase.rpc("get_my_personalized_recommendations", {
          limit_count: 20,
        });
        if (!rpcError && Array.isArray(rpcData) && rpcData.length) {
          const items: RecItem[] = rpcData.map((r: any) => ({
            item_id: r.item_id,
            score: Number(r.score ?? 0),
            reason: r.reason ?? null,
            item: r.item ?? null,
          }));
          return { items };
        }
      } catch {
        // fall through to simple fallback
      }

      // Fallback using preferences
      const { data: prefs } = await supabase
        .from("user_preferences")
        .select("favorite_teams, favorite_leagues")
        .eq("user_id", user!.id)
        .single();

      let query = supabase.from("items").select("*").order("popularity", { ascending: false }).limit(20);
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
