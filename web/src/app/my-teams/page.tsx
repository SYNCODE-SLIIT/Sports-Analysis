"use client";

import { motion } from "framer-motion";
import { Heart, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/components/AuthProvider";
import { useEffect, useMemo, useState } from "react";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { searchLeagues, getTeam, getLeagueTable } from "@/lib/collect";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { searchTeams } from "@/lib/collect";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useRef } from "react";

type SearchResult = {
  name: string;
  logo?: string;
  type: "team" | "league";
};

const TEAM_LOGO_KEYS = [
  "team_logo",
  "team_logo_url",
  "team_badge",
  "teamBadge",
  "strTeamBadge",
  "logo",
  "badge",
  "crest",
  "image",
  "thumbnail",
  "teamLogo",
  "teamBadgeUrl",
  "team_badge_url",
  "logo_path",
  "logo_url",
  "badge_url",
  "strTeamLogo",
  "strTeamBadge",
  "emblem",
  "shield",
  "media",
  "images",
  "logos",
  "thumbnails",
  "badges",
];

const LEAGUE_LOGO_KEYS = [
  "league_logo",
  "league_logo_url",
  "league_badge",
  "leagueBadge",
  "strLeagueLogo",
  "strLeagueBadge",
  "badge",
  "logo",
  "image",
  "thumb",
  "badge_url",
  "logo_path",
  "logo_url",
  "crest",
  "emblem",
  "media",
  "images",
  "logos",
  "thumbnails",
  "badges",
];

const sanitizeLogoUrl = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const lowered = trimmed.toLowerCase();
    if (lowered === "null" || lowered === "undefined" || lowered === "none" || lowered === "n/a") {
      return "";
    }
    return trimmed;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = sanitizeLogoUrl(item);
      if (candidate) return candidate;
    }
    return "";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedKeys = [
      "url",
      "src",
      "image",
      "path",
      "logo",
      "badge",
      "thumbnail",
      "thumb",
      "href",
      "link",
      "default",
      "light",
      "dark",
    ];
    for (const key of nestedKeys) {
      if (record[key]) {
        const candidate = sanitizeLogoUrl(record[key]);
        if (candidate) return candidate;
      }
    }
  }
  return "";
};

const extractLogoFromEntry = (
  entry: Record<string, unknown> | null | undefined,
  candidateKeys: string[],
): string => {
  if (!entry || typeof entry !== "object") return "";
  for (const key of candidateKeys) {
    if (key in entry) {
      const candidate = sanitizeLogoUrl((entry as Record<string, unknown>)[key]);
      if (candidate) return candidate;
    }
  }
  return "";
};

const getTeamLogoFromEntry = (entry: Record<string, unknown> | null | undefined) =>
  extractLogoFromEntry(entry, TEAM_LOGO_KEYS);

const getLeagueLogoFromEntry = (entry: Record<string, unknown> | null | undefined) =>
  extractLogoFromEntry(entry, LEAGUE_LOGO_KEYS);

const pickFirstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
};

export default function MyTeamsPage() {
  const { user, supabase, loading } = useAuth();
  const [teams, setTeams] = useState<string[]>([]);
  const [teamLogos, setTeamLogos] = useState<Record<string, string>>({});
  const [newTeam, setNewTeam] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [leagueLogosMap, setLeagueLogosMap] = useState<Record<string, string>>({});
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const normalizeKey = (s?: string) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const resolveLogoForDisplay = (displayName: string, userMap: Record<string,string>, cachedMap: Record<string,string>) => {
    const exact = userMap?.[displayName];
    if (exact) return exact;
    const key = normalizeKey(displayName);
    // try direct cached map
    if (cachedMap && cachedMap[key]) return cachedMap[key];
    // try userMap via normalized keys
    for (const k of Object.keys(userMap || {})) {
      if (!k) continue;
      if (normalizeKey(k) === key) return userMap[k];
    }
    // try fuzzy contains match both ways
    for (const k of Object.keys(userMap || {})) {
      const nk = normalizeKey(k);
      if (nk.includes(key) || key.includes(nk)) return userMap[k];
    }
    // try fuzzy on cached
    for (const k of Object.keys(cachedMap || {})) {
      const nk = normalizeKey(k);
      if (nk.includes(key) || key.includes(nk)) return cachedMap[k];
    }
    return '';
  };

  useEffect(() => {
    if (!user) return;
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos")
        .eq("user_id", user.id)
        .single();
      if (!mounted) return;
      setTeams(data?.favorite_teams ?? []);
      setLeagues(data?.favorite_leagues ?? []);
      // Prefer stored maps for instant logos if available
      if (data?.favorite_team_logos && typeof data.favorite_team_logos === 'object') {
        setTeamLogos(data.favorite_team_logos as Record<string,string>);
      }
      if (data?.favorite_league_logos && typeof data.favorite_league_logos === 'object') {
        setLeagueLogosMap(data.favorite_league_logos as Record<string,string>);
      }

      // Load suggestions from RPC if available (ignore errors)
      try {
        const { data: rpc } = await supabase.rpc("list_popular_teams", { limit_count: 25 });
        const names = Array.isArray(rpc) ? rpc.map((r: any) => r.team).filter(Boolean) : [];
        setSuggestions(names);
        // Try to prefetch cached logos for suggestions so buttons can show icons
        try {
          const { data: cached } = await supabase.from('cached_teams').select('name, logo').in('name', names as any);
          if (Array.isArray(cached) && cached.length) {
            const add: Record<string,string> = {};
            cached.forEach((c: any) => {
              if (!c?.name) return;
              const logo = sanitizeLogoUrl(c?.logo);
              if (logo) add[String(c.name)] = logo;
            });
            // merge into teamLogos (display-keyed)
            setTeamLogos(prev => ({ ...add, ...prev }));
          }
        } catch {}
      } catch {
        setSuggestions([]);
      }
      // leagues already loaded above
    })();
    return () => { mounted = false; };
  }, [user, supabase]);

  // Development debug helper: fetch and log a sample of cached tables when ?debug_cache=1 is present
  useEffect(() => {
    try {
      const shouldDebug = (typeof window !== 'undefined' && (window.location.search.includes('debug_cache=1') || process.env.NODE_ENV === 'development'));
      if (!shouldDebug) return;
      (async () => {
        try {
          const { data: teamsRows, error: teamsErr } = await supabase.from('cached_teams').select('name,logo').limit(50);
          console.debug('DEBUG cached_teams sample', { teamsErr, teamsRows });
        } catch (e) { console.debug('DEBUG cached_teams fetch threw', e); }
        try {
          const { data: leaguesRows, error: leaguesErr } = await supabase.from('cached_leagues').select('name,logo').limit(50);
          console.debug('DEBUG cached_leagues sample', { leaguesErr, leaguesRows });
        } catch (e) { console.debug('DEBUG cached_leagues fetch threw', e); }
      })();
    } catch (e) {
      // no-op
    }
  }, [user, supabase]);

  // Fetch cached team logos for display (if present in cached_teams)
  useEffect(() => {
    if (!user || teams.length === 0) {
      setTeamLogos({});
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const { data: rows } = await supabase.from('cached_teams').select('name, logo').in('name', teams as any);
        if (!mounted) return;

        const map: Record<string, string> = {};
        if (Array.isArray(rows)) {
          rows.forEach((r: any) => {
            if (!r?.name) return;
            const key = normalizeKey(String(r.name));
            map[key] = sanitizeLogoUrl(r?.logo);
          });
        }

        const missing = teams.filter(teamName => {
          const normalizedKey = normalizeKey(teamName);
          const existing = sanitizeLogoUrl(teamLogos[teamName]);
          const cached = sanitizeLogoUrl(map[normalizedKey]);
          return !existing && !cached;
        });

        if (missing.length > 0) {
          await Promise.all(missing.map(async (name) => {
            try {
              const res = await searchTeams(name);
              const teamsArr = Array.isArray(res?.data?.teams) ? res.data.teams : [];
              const normalizedTarget = normalizeKey(name);
              const candidateEntry = (teamsArr.find((t: any) => {
                const candidateName = pickFirstString(
                  t?.team_name,
                  t?.strTeam,
                  t?.name,
                  t?.team,
                );
                if (!candidateName) return false;
                return normalizeKey(candidateName) === normalizedTarget;
              }) ?? teamsArr[0]) as Record<string, unknown> | undefined;

              let logo = candidateEntry ? getTeamLogoFromEntry(candidateEntry) : '';

              if (!logo) {
                try {
                  const detail = await getTeam(name);
                  const maybeArr = detail?.data?.teams ?? detail?.data?.team ?? detail?.data?.result ?? detail?.data ?? null;
                  const detailObj = Array.isArray(maybeArr) && maybeArr.length
                    ? maybeArr[0]
                    : (maybeArr && typeof maybeArr === 'object' ? maybeArr : null);
                  if (detailObj) {
                    const fromDetail = getTeamLogoFromEntry(detailObj as Record<string, unknown>);
                    if (fromDetail) logo = fromDetail;
                  }
                } catch {
                  // ignore team detail errors
                }
              }

              if (logo) {
                map[normalizeKey(name)] = logo;
                try {
                  const { error: rpcErr } = await supabase.rpc('upsert_cached_team', {
                    p_provider_id: null,
                    p_name: name,
                    p_logo: logo,
                    p_metadata: {},
                  });
                  if (rpcErr) console.debug('upsert_cached_team error', name, rpcErr);
                } catch (e) {
                  console.debug('upsert_cached_team threw', name, e);
                }
              }
            } catch {
              // ignore per-name errors
            }
          }));
        }

        const displayMap: Record<string, string> = {};
        teams.forEach(teamName => {
          displayMap[String(teamName)] = resolveLogoForDisplay(String(teamName), teamLogos, map) || '';
        });
        setTeamLogos(displayMap);
      } catch {
        if (mounted) setTeamLogos({});
      }
    })();
    return () => { mounted = false; };
  }, [teams, user, supabase]);

  // Fetch cached league logos for display (if present in cached_leagues)
  useEffect(() => {
    if (!user || leagues.length === 0) {
      setLeagueLogosMap({});
      return;
    }
    let mounted = true;
    (async () => {
      try {
        const { data: rows } = await supabase.from('cached_leagues').select('name, logo').in('name', leagues as any);
        if (!mounted) return;

        const map: Record<string, string> = {};
        if (Array.isArray(rows)) {
          rows.forEach((r: any) => {
            if (!r?.name) return;
            map[normalizeKey(String(r.name))] = sanitizeLogoUrl(r?.logo);
          });
        }

        let missing = leagues.filter(leagueName => {
          const normalizedKey = normalizeKey(leagueName);
          const existing = sanitizeLogoUrl(leagueLogosMap[leagueName]);
          const cached = sanitizeLogoUrl(map[normalizedKey]);
          return !existing && !cached;
        });

        if (missing.length > 0) {
          await Promise.all(missing.map(async (name) => {
            try {
              const res = await searchLeagues(name);
              const leaguesArr = Array.isArray(res?.data?.leagues) ? res.data.leagues : [];
              const normalizedTarget = normalizeKey(name);
              const candidateEntry = (leaguesArr.find((l: any) => {
                const candidateName = pickFirstString(
                  l?.league_name,
                  l?.name,
                  l?.strLeague,
                  l?.league,
                );
                if (!candidateName) return false;
                return normalizeKey(candidateName) === normalizedTarget;
              }) ?? leaguesArr[0]) as Record<string, unknown> | undefined;

              let logo = candidateEntry ? getLeagueLogoFromEntry(candidateEntry) : '';

              if (!logo) {
                try {
                  const detail = await getLeagueTable(name);
                  const maybeLeague = detail?.data?.league ?? detail?.data ?? null;
                  const leagueObj = Array.isArray(maybeLeague) && maybeLeague.length
                    ? maybeLeague[0]
                    : (maybeLeague && typeof maybeLeague === 'object' ? maybeLeague : null);
                  if (leagueObj) {
                    const fromDetail = getLeagueLogoFromEntry(leagueObj as Record<string, unknown>);
                    if (fromDetail) logo = fromDetail;
                  }
                } catch {
                  // ignore league detail errors
                }
              }

              if (logo) {
                map[normalizeKey(name)] = logo;
                try {
                  const { error: rpcErr } = await supabase.rpc('upsert_cached_league', {
                    p_provider_id: null,
                    p_name: name,
                    p_logo: logo,
                    p_metadata: {},
                  });
                  if (rpcErr) {
                    console.debug('upsert_cached_league error', name, rpcErr);
                  } else {
                    try {
                      const { data: checkRow } = await supabase
                        .from('cached_leagues')
                        .select('name,logo')
                        .eq('name', name)
                        .maybeSingle();
                      if (!checkRow) console.debug('cached_leagues upsert did not persist for', name);
                    } catch (verifyErr) {
                      console.debug('cached_leagues verify failed', name, verifyErr);
                    }
                  }
                } catch (e) {
                  console.debug('upsert_cached_league threw', name, e);
                }
              }
            } catch {
              // ignore per-name errors
            }
          }));
        }

        missing = leagues.filter(leagueName => !sanitizeLogoUrl(map[normalizeKey(leagueName)]));
        if (missing.length > 0) {
          try {
            const resp = await fetch('/api/leagues');
            if (resp.ok) {
              const json = await resp.json();
              const arr = Array.isArray(json.leagues)
                ? json.leagues
                : (Array.isArray(json) ? json : (json.leagues ?? []));
              if (Array.isArray(arr) && arr.length) {
                const lookup: Record<string, string> = {};
                for (const entry of arr) {
                  if (!entry || typeof entry !== 'object') continue;
                  const entryName = pickFirstString(
                    (entry as Record<string, unknown>)?.league_name,
                    (entry as Record<string, unknown>)?.name,
                    (entry as Record<string, unknown>)?.strLeague,
                    (entry as Record<string, unknown>)?.league,
                  );
                  if (!entryName) continue;
                  const key = normalizeKey(entryName);
                  if (lookup[key]) continue;
                  const logo = getLeagueLogoFromEntry(entry as Record<string, unknown>);
                  if (logo) lookup[key] = logo;
                }

                await Promise.all(missing.map(async (name) => {
                  const normalizedName = normalizeKey(name);
                  const matchKey = lookup[normalizedName]
                    ? normalizedName
                    : Object.keys(lookup).find(k => k.includes(normalizedName) || normalizedName.includes(k));
                  const logo = matchKey ? lookup[matchKey] : '';
                  if (logo) {
                    map[normalizedName] = logo;
                    try {
                      const { error: rpcErr } = await supabase.rpc('upsert_cached_league', {
                        p_provider_id: null,
                        p_name: name,
                        p_logo: logo,
                        p_metadata: {},
                      });
                      if (rpcErr) console.debug('upsert_cached_league error', name, rpcErr);
                    } catch (e) {
                      console.debug('upsert_cached_league threw', name, e);
                    }
                  }
                }));
              }
            }
          } catch {
            // ignore catalog fetch errors
          }
        }

        const stillMissing = leagues.filter(leagueName => !sanitizeLogoUrl(map[normalizeKey(leagueName)]));
        if (stillMissing.length > 0) {
          await Promise.all(stillMissing.map(async (name) => {
            try {
              const pattern = `%${normalizeKey(name).replace(/%/g, '\\%')}%`;
              const { data: hits, error } = await supabase
                .from('cached_leagues')
                .select('name,logo')
                .ilike('name', pattern);
              if (error) {
                console.debug('cached_leagues ilike query error', name, error);
                return;
              }
              if (Array.isArray(hits) && hits.length) {
                const hit = hits.find((h: any) => sanitizeLogoUrl(h?.logo)) || hits[0];
                const hitLogo = sanitizeLogoUrl(hit?.logo);
                if (hitLogo) {
                  map[normalizeKey(name)] = hitLogo;
                  console.debug('cached_leagues fuzzy matched', name, hit?.name, hitLogo);
                } else {
                  console.debug('cached_leagues fuzzy matched but no logo', name, hits.map((h: any) => ({ name: h?.name, logo: !!sanitizeLogoUrl(h?.logo) })));
                }
              }
            } catch (e) {
              console.debug('cached_leagues fuzzy lookup threw', name, e);
            }
          }));
        }

        const displayLeagueMap: Record<string, string> = {};
        leagues.forEach(leagueName => {
          displayLeagueMap[String(leagueName)] = resolveLogoForDisplay(String(leagueName), leagueLogosMap, map) || '';
        });
        setLeagueLogosMap(displayLeagueMap);
      } catch {
        if (mounted) setLeagueLogosMap({});
      }
    })();
    return () => { mounted = false; };
  }, [leagues, user, supabase]);

  const filteredSuggestions = useMemo(() => {
    const q = newTeam.trim().toLowerCase();
    const base = suggestions.filter(s => !teams.includes(s));
    if (!q) return base.slice(0, 10);
    return base.filter(s => s.toLowerCase().includes(q)).slice(0, 10);
  }, [newTeam, suggestions, teams]);

  const addTeam = (t: string) => {
    const name = t.trim();
    if (!name) return;
    if (teams.includes(name)) {
      toast.info("Already added");
      return;
    }
    setTeams(prev => [...prev, name]);
    // If suggestion had a logo in results, attach it optimistically
    const found = results.find(r => r.name === name && r.type === "team");
    const optimisticLogo = found?.logo ? sanitizeLogoUrl(found.logo) : "";
    if (optimisticLogo) {
      setTeamLogos(prev => ({ ...prev, [name]: optimisticLogo }));
    }
    setNewTeam("");
  };

  const followLeague = async (ln: string) => {
    const name = ln.trim();
    if (!name) return;
    if (leagues.includes(name)) {
      toast.info('Already following');
      return;
    }
    setLeagues(prev => [...prev, name]);
    const found = results.find(r => r.name === name && r.type === "league");
    let resolvedLogo = found?.logo ? sanitizeLogoUrl(found.logo) : "";

    if (!resolvedLogo) {
      resolvedLogo = resolveLogoForDisplay(name, leagueLogosMap, {});
    }

    if (!resolvedLogo) {
      try {
        const { data: cached } = await supabase
          .from('cached_leagues')
          .select('logo')
          .eq('name', name)
          .maybeSingle();
        const cachedLogo = sanitizeLogoUrl(cached?.logo);
        if (cachedLogo) resolvedLogo = cachedLogo;
      } catch {
        // ignore cached lookup failures
      }
    }

    if (!resolvedLogo) {
      try {
        const res = await searchLeagues(name);
        const leaguesArr = Array.isArray(res?.data?.leagues) ? res.data.leagues : [];
        const normalizedTarget = normalizeKey(name);
        const candidateEntry = (leaguesArr.find((l: any) => {
          const candidateName = pickFirstString(
            l?.league_name,
            l?.name,
            l?.strLeague,
            l?.league,
          );
          if (!candidateName) return false;
          return normalizeKey(candidateName) === normalizedTarget;
        }) ?? leaguesArr[0]) as Record<string, unknown> | undefined;
        const fetchedLogo = candidateEntry ? getLeagueLogoFromEntry(candidateEntry) : '';
        if (fetchedLogo) {
          resolvedLogo = fetchedLogo;
        }
      } catch {
        // ignore search errors
      }
    }

    if (resolvedLogo) {
      setLeagueLogosMap(prev => ({ ...prev, [name]: resolvedLogo }));
    }
  };

  const unfollowLeague = (ln: string) => {
    setLeagues(prev => prev.filter(x => x !== ln));
  };

  const removeTeam = (t: string) => {
    setTeams(prev => prev.filter(x => x !== t));
    setTeamLogos(prev => {
      const { [t]: _, ...rest } = prev;
      return rest;
    });
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const sanitizedTeamsMap: Record<string, string> = {};
      Object.entries(teamLogos).forEach(([key, value]) => {
        const logo = sanitizeLogoUrl(value);
        if (logo) sanitizedTeamsMap[key] = logo;
      });
      const sanitizedLeaguesMap: Record<string, string> = {};
      Object.entries(leagueLogosMap).forEach(([key, value]) => {
        const logo = sanitizeLogoUrl(value);
        if (logo) sanitizedLeaguesMap[key] = logo;
      });

      await supabase.from("user_preferences").upsert({
        user_id: user.id,
        favorite_teams: teams,
        favorite_leagues: leagues,
        favorite_team_logos: sanitizedTeamsMap,
        favorite_league_logos: sanitizedLeaguesMap,
      });
      // Upsert any known team logos into cached_teams
      try {
        await Promise.all(teams.map(async (t) => {
          const logo = sanitizeLogoUrl(teamLogos[t]);
          if (logo) {
            try { await supabase.rpc('upsert_cached_team', { p_provider_id: null, p_name: t, p_logo: logo, p_metadata: {} }); } catch {}
          }
        }));
      } catch {}
      // Upsert any known league logos into cached_leagues
      try {
        await Promise.all(leagues.map(async (l) => {
          const logo = sanitizeLogoUrl(leagueLogosMap[l]);
          if (logo) {
            try {
              const { error: rpcErr } = await supabase.rpc('upsert_cached_league', { p_provider_id: null, p_name: l, p_logo: logo, p_metadata: {} });
              if (rpcErr) console.debug('upsert_cached_league error', l, rpcErr);
            } catch (e) { console.debug('upsert_cached_league threw', l, e); }
          }
        }));
      } catch {}
      toast.success("Saved your favorite teams");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Live search teams via backend API, debounce via input onChange
  const debouncedQuery = useDebouncedValue(newTeam, 250);

  useEffect(() => {
    let alive = true;
    const q = debouncedQuery.trim();
    if (!q) { setResults([]); return; }
    (async () => {
      try {
        setSearching(true);
        const [teamsResp, leaguesResp] = await Promise.allSettled([searchTeams(q), searchLeagues(q)]);
        const teamsArr = (teamsResp.status === 'fulfilled' ? teamsResp.value.data?.teams ?? [] : []) as Array<Record<string, unknown>>;
        const leaguesArr = (leaguesResp.status === 'fulfilled' ? leaguesResp.value.data?.leagues ?? [] : []) as Array<Record<string, unknown>>;

        const mappedTeams: SearchResult[] = teamsArr
          .map((t) => {
            const record = (t ?? {}) as Record<string, unknown>;
            const name = pickFirstString(
              record?.team_name,
              record?.strTeam,
              record?.name,
              record?.team,
            );
            if (!name) return null;
            const logo = getTeamLogoFromEntry(record) || undefined;
            return { name, logo, type: 'team' as const };
          })
          .filter(Boolean) as SearchResult[];

        const mappedLeagues: SearchResult[] = leaguesArr
          .map((l) => {
            const record = (l ?? {}) as Record<string, unknown>;
            const name = pickFirstString(
              record?.league_name,
              record?.name,
              record?.strLeague,
              record?.league,
            );
            if (!name) return null;
            const logo = getLeagueLogoFromEntry(record) || undefined;
            return { name, logo, type: 'league' as const };
          })
          .filter(Boolean) as SearchResult[];

        if (!alive) return;
        const combined = [...mappedLeagues.slice(0, 6), ...mappedTeams].slice(0, 12);
        setResults(combined);
      } catch {
        if (alive) setResults([]);
      } finally {
        if (alive) setSearching(false);
      }
    })();
    return () => { alive = false; };
  }, [debouncedQuery]);

  if (loading) {
    return <div className="container py-8 min-h-[60vh] flex items-center justify-center">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="container py-8 min-h-[60vh] flex items-center justify-center">
        <EmptyState
          type="no-teams"
          title="Sign in to manage your teams"
          description="Create an account or sign in to save your favorite teams and get personalized match recommendations."
          actionLabel="Sign In"
          onAction={() => window.location.href = '/auth/login'}
        />
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-between items-start"
      >
        <div className="space-y-4">
          <div className="flex items-center space-x-3">
            <Heart className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">My Teams</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your favorite teams and get personalized match updates and analysis.
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              placeholder="Add a team (e.g. Barcelona)"
              value={newTeam}
              onChange={(e) => setNewTeam(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTeam(newTeam); }}
              className="w-80"
            />
            {newTeam && results.length > 0 && (
              <div role="listbox" aria-label="Search results" className="absolute z-10 mt-1 w-full bg-background border rounded shadow">
                {results.map((r, idx) => (
                  <button
                    key={r.name}
                    role="option"
                    aria-selected={activeIndex === idx}
                    className={`w-full flex items-center gap-3 p-2 text-left ${activeIndex === idx ? 'bg-muted' : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseLeave={() => setActiveIndex(-1)}
                    onClick={async () => {
                      // add as team by default
                      addTeam(r.name);
                      // upsert into cache
                      try { await supabase.rpc('upsert_cached_team', { p_provider_id: null, p_name: r.name, p_logo: r.logo ?? '', p_metadata: {} }); } catch {}
                    }}
                  >
                    <Avatar className="size-6">
                      {r.logo ? (
                        <AvatarImage src={r.logo} alt={r.name} />
                      ) : (
                        <AvatarFallback>{r.name.slice(0,2).toUpperCase()}</AvatarFallback>
                      )}
                    </Avatar>
                    <div className="flex-1">
                      <div className="font-medium">{r.name}</div>
                    </div>
                    <div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await followLeague(r.name);
                          const logoForCache = sanitizeLogoUrl(r.logo);
                          try {
                            const res: any = await supabase.rpc('upsert_cached_league', {
                              p_provider_id: null,
                              p_name: r.name,
                              p_logo: logoForCache,
                              p_metadata: {},
                            });
                            if (res?.error) console.debug('upsert_cached_league error', r.name, res.error);
                          } catch (err: any) {
                            console.debug('upsert_cached_league threw', r.name, err);
                          }
                        }}
                      >
                        Follow
                      </Button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button onClick={() => addTeam(newTeam)} className="flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Add</span>
          </Button>
          <Button variant="secondary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </motion.div>

      {/* Content would go here when authenticated */}
      <Card>
        <CardHeader>
          <CardTitle>Your Favorite Teams</CardTitle>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <EmptyState
              type="no-teams"
              description="You haven&apos;t added any favorite teams yet. Try adding one above to personalize recommendations."
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {teams.map(t => (
                <Badge key={t} variant="secondary" className="px-3 py-1 flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    {teamLogos[t] ? (
                      <AvatarImage src={teamLogos[t]} alt={t} />
                    ) : (
                      <AvatarFallback>{t.slice(0,2).toUpperCase()}</AvatarFallback>
                    )}
                  </Avatar>
                  <span className="font-medium">{t}</span>
                  <button className="ml-1" aria-label={`Remove ${t}`} onClick={() => removeTeam(t)}>
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          {filteredSuggestions.length > 0 && (
            <div className="mt-6">
              <div className="text-sm text-muted-foreground mb-2">Suggestions</div>
              <div className="flex flex-wrap gap-2">
                {filteredSuggestions.map(s => (
                  <Button key={s} variant="outline" size="sm" onClick={() => addTeam(s)}>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-4 w-4">
                        {teamLogos[s] ? (
                          <AvatarImage src={teamLogos[s]} alt={s} />
                        ) : (
                          <AvatarFallback>{s.slice(0,2).toUpperCase()}</AvatarFallback>
                        )}
                      </Avatar>
                      <span>{s}</span>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}
          {leagues.length > 0 && (
            <div className="mt-6">
              <div className="text-sm text-muted-foreground mb-2">Followed Leagues</div>
              <div className="flex flex-wrap gap-2">
                {leagues.map(l => (
                  <Badge key={l} variant="secondary" className="px-3 py-1 flex items-center gap-2">
                    <Avatar className="h-5 w-5">
                      {leagueLogosMap[l] ? (
                        <AvatarImage src={leagueLogosMap[l]} alt={l} />
                      ) : (
                        <AvatarFallback>{l.slice(0,2).toUpperCase()}</AvatarFallback>
                      )}
                    </Avatar>
                    <span className="font-medium">{l}</span>
                    <button className="ml-1" aria-label={`Unfollow ${l}`} onClick={() => unfollowLeague(l)}>
                      <X className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}