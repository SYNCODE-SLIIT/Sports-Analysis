import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = await getSupabaseServerClient();
  try {
    // rely on supabase auth cookie/session being present in server context
    const { data: user } = await supabase.auth.getUser();
    const userId = user?.data?.user?.id;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // fetch preferences
    const { data: prefs } = await supabase
      .from('user_preferences')
      .select('favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos')
      .eq('user_id', userId)
      .single();

    const teams: string[] = (prefs?.favorite_teams ?? []) as string[];
    const leagues: string[] = (prefs?.favorite_leagues ?? []) as string[];
    const teamLogos: Record<string, string> = (prefs?.favorite_team_logos ?? {}) as Record<string, string>;
    const leagueLogos: Record<string, string> = (prefs?.favorite_league_logos ?? {}) as Record<string, string>;

    // fill from cached_ tables for any missing logos
    const missingTeamNames = teams.filter(t => !teamLogos[t] || teamLogos[t] === '');
    if (missingTeamNames.length) {
      const { data: rows } = await supabase.from('cached_teams').select('name, logo').in('name', missingTeamNames as any);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r?.name && r?.logo) teamLogos[String(r.name)] = String(r.logo);
        }
      }
    }

    const missingLeagueNames = leagues.filter(l => !leagueLogos[l] || leagueLogos[l] === '');
    if (missingLeagueNames.length) {
      const { data: rows } = await supabase.from('cached_leagues').select('name, logo').in('name', missingLeagueNames as any);
      if (Array.isArray(rows)) {
        for (const r of rows) {
          if (r?.name && r?.logo) leagueLogos[String(r.name)] = String(r.logo);
        }
      }
    }

    // return merged payload; callers can upsert the returned logo maps if they want to persist
    return NextResponse.json({ favorite_teams: teams, favorite_leagues: leagues, favorite_team_logos: teamLogos, favorite_league_logos: leagueLogos });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
