/**
 * Backfill logos script (plain JS) — run with Node 18+
 * Usage (PowerShell):
 *  $env:SUPABASE_URL='https://...'; $env:SUPABASE_SERVICE_ROLE_KEY='...'; node web\tools\backfill_logos.js
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

async function getAllPreferences() {
  const { data, error } = await supabase.from('user_preferences').select('*');
  if (error) throw error;
  return data;
}

async function backfill() {
  const prefs = await getAllPreferences();
  console.log(`Found ${prefs.length} preference rows`);
  for (const p of prefs) {
    const userId = p.user_id;
    const teams = p.favorite_teams || [];
    const leagues = p.favorite_leagues || [];
    const teamLogos = Object.assign({}, p.favorite_team_logos || {});
    const leagueLogos = Object.assign({}, p.favorite_league_logos || {});

    const missingTeams = teams.filter(t => !teamLogos[t] || teamLogos[t] === '');
    if (missingTeams.length) {
      const { data: rows } = await supabase.from('cached_teams').select('name, logo').in('name', missingTeams);
      if (Array.isArray(rows)) {
        for (const r of rows) if (r && r.name && r.logo) teamLogos[String(r.name)] = String(r.logo);
      }
      const stillMissing = missingTeams.filter(t => !teamLogos[t]);
      for (const t of stillMissing) {
        try {
          const url = new URL('/api/collect', NEXT_PUBLIC_URL);
          const payload = { intent: 'teams.list', args: { teamName: t } };
          const res = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const json = await res.json();
          const teamsArr = (json && json.data && json.data.teams) || [];
          if (Array.isArray(teamsArr) && teamsArr.length) {
            const c = teamsArr[0];
            const logo = c && (c.team_logo || c.strTeamBadge || c.logo || '');
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
      const { data: rows } = await supabase.from('cached_leagues').select('name, logo').in('name', missingLeagues);
      if (Array.isArray(rows)) {
        for (const r of rows) if (r && r.name && r.logo) leagueLogos[String(r.name)] = String(r.logo);
      }
      const stillMissing = missingLeagues.filter(l => !leagueLogos[l]);
      for (const l of stillMissing) {
        try {
          const url = new URL('/api/collect', NEXT_PUBLIC_URL);
          const payload = { intent: 'leagues.list', args: { leagueName: l } };
          const res = await fetch(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          const json = await res.json();
          const arr = (json && json.data && json.data.leagues) || [];
          if (Array.isArray(arr) && arr.length) {
            const c = arr[0];
            const logo = c && (c.league_logo || c.logo || c.badge || c.strLeagueBadge || '');
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

    const changed = Object.keys(teamLogos).length !== Object.keys(p.favorite_team_logos || {}).length || Object.keys(leagueLogos).length !== Object.keys(p.favorite_league_logos || {}).length;
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
