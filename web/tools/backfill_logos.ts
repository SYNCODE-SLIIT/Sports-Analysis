/*
  Backfill script for favorite_team_logos and favorite_league_logos.
  Usage: set environment variables SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and run with ts-node or compile.
*/
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
const NEXT_PUBLIC_URL = process.env.NEXT_PUBLIC_URL || 'http://localhost:3000';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

type PrefRow = { user_id: string; favorite_teams?: string[]; favorite_leagues?: string[]; favorite_team_logos?: Record<string,string>; favorite_league_logos?: Record<string,string> };

async function getAllPreferences(): Promise<PrefRow[]> {
  const { data, error } = await supabase.from('user_preferences').select('*');
  if (error) throw error;
  return data as PrefRow[];
}

async function backfill() {
  const prefs = await getAllPreferences();
  console.log(`Found ${prefs.length} preference rows`);
  for (const p of prefs) {
    const userId = p.user_id;
    const teams = p.favorite_teams ?? [];
    const leagues = p.favorite_leagues ?? [];
    const teamLogos = { ...(p.favorite_team_logos ?? {}) } as Record<string,string>;
    const leagueLogos = { ...(p.favorite_league_logos ?? {}) } as Record<string,string>;

    const missingTeams = teams.filter(t => !teamLogos[t] || teamLogos[t] === '');
    if (missingTeams.length) {
      // try cached_teams
      const { data: rows } = await supabase.from('cached_teams').select('name, logo').in('name', missingTeams as any);
      if (Array.isArray(rows)) {
        for (const r of rows) if (r?.name && r?.logo) teamLogos[String(r.name)] = String(r.logo);
      }

      const stillMissing = missingTeams.filter(t => !teamLogos[t]);
      for (const t of stillMissing) {
        try {
          // call the collect proxy to search team
          const url = new URL('/api/collect', NEXT_PUBLIC_URL);
          const payload = { intent: 'teams.list', args: { teamName: t } };
          const res = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const json = await res.json();
          const teamsArr = json?.data?.teams ?? [];
          if (Array.isArray(teamsArr) && teamsArr.length) {
            const candidate = teamsArr[0];
            const logo = candidate?.team_logo ?? candidate?.strTeamBadge ?? candidate?.logo ?? '';
            if (logo) {
              teamLogos[t] = String(logo);
              try { await supabase.rpc('upsert_cached_team', { p_provider_id: null, p_name: t, p_logo: logo, p_metadata: {} }); } catch {}
            }
          }
        } catch {}
      }
    }

    const missingLeagues = leagues.filter(l => !leagueLogos[l] || leagueLogos[l] === '');
    if (missingLeagues.length) {
      const { data: rows } = await supabase.from('cached_leagues').select('name, logo').in('name', missingLeagues as any);
      if (Array.isArray(rows)) {
        for (const r of rows) if (r?.name && r?.logo) leagueLogos[String(r.name)] = String(r.logo);
      }

      const stillMissing = missingLeagues.filter(l => !leagueLogos[l]);
      for (const l of stillMissing) {
        try {
          const url = new URL('/api/collect', NEXT_PUBLIC_URL);
          const payload = { intent: 'leagues.list', args: { leagueName: l } };
          const res = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const json = await res.json();
          const leaguesArr = json?.data?.leagues ?? [];
          if (Array.isArray(leaguesArr) && leaguesArr.length) {
            const candidate = leaguesArr[0];
            const logo = candidate?.league_logo ?? candidate?.logo ?? candidate?.badge ?? candidate?.strLeagueBadge ?? '';
            if (logo) {
              leagueLogos[l] = String(logo);
              try {
                const { error: rpcErr } = await supabase.rpc('upsert_cached_league', { p_provider_id: null, p_name: l, p_logo: logo, p_metadata: {} });
                if (rpcErr) console.debug('backfill upsert_cached_league error', l, rpcErr);
              } catch (e) { console.debug('backfill upsert_cached_league threw', l, e); }
            }
          }
        } catch {}
      }
    }

    // if any logos were added, upsert the preference row
    const changed = Object.keys(teamLogos).length !== Object.keys(p.favorite_team_logos ?? {}).length || Object.keys(leagueLogos).length !== Object.keys(p.favorite_league_logos ?? {}).length;
    if (changed) {
      try {
        await supabase.from('user_preferences').upsert({ user_id: userId, favorite_teams: teams, favorite_leagues: leagues, favorite_team_logos: teamLogos, favorite_league_logos: leagueLogos });
        console.log(`Updated logos for ${userId}`);
      } catch (err) {
        console.error('upsert failed for', userId, err);
      }
    }
  }
}

backfill().then(() => { console.log('done'); process.exit(0); }).catch(e => { console.error(e); process.exit(2); });
