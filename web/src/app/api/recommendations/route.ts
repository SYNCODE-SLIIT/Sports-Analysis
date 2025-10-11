import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ items: [] });

  // Try personalized table first
  const { data: recs, error } = await supabase
    .from("recommendations")
    .select("item_id, score, reason, item:items(*)")
    .eq("user_id", user.id)
    .order("score", { ascending: false })
    .limit(20);

  if (!error && recs && recs.length > 0) {
    return NextResponse.json({ items: recs });
  }

  // Cold-start fallback: recommend by favorites/leagues
  const { data: prefs } = await supabase
    .from("user_preferences")
    .select("favorite_teams, favorite_leagues")
    .eq("user_id", user.id)
    .single();

  let query = supabase.from("items").select("*").order("popularity", { ascending: false }).limit(20);
  if (prefs?.favorite_teams?.length) {
    query = query.contains("teams", prefs.favorite_teams);
  }
  if (prefs?.favorite_leagues?.length) {
    query = query.contains("leagues", prefs.favorite_leagues);
  }
  const { data: items } = await query;
  return NextResponse.json({ items: items ?? [] });
}
