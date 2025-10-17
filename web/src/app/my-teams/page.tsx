"use client";

import { motion } from "framer-motion";
import { Heart, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/components/AuthProvider";
import { useEffect, useMemo, useRef, useState } from "react";
import useDebouncedValue from "@/hooks/useDebouncedValue";
import { searchLeagues, getTeam, getLeagueTable, postCollect, searchTeams } from "@/lib/collect";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  "strBadgeWide",
  "strLogoWide",
  "strThumb",
  "strLogo",
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

const normalizeKey = (s?: string | null) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const gatherAliases = (value: unknown): string[] => {
  const out: string[] = [];
  if (!value) return out;
  if (typeof value === "string") {
    value
      .split(/[;,|]/)
      .map(part => part.trim())
      .filter(Boolean)
      .forEach(part => out.push(part));
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach(item => {
      if (typeof item === "string") {
        out.push(...gatherAliases(item));
      }
    });
  }
  return out;
};

const toLeagueEntriesArray = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const candidateKeys = ["leagues", "league", "result", "results", "data", "countries"];
    for (const key of candidateKeys) {
      const val = obj[key];
      if (Array.isArray(val)) return val;
    }
  }
  return [];
};

const mapLeagueEntriesToLogoLookup = (raw: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  const arr = toLeagueEntriesArray(raw);
  for (const entry of arr) {
    if (!entry) continue;
    if (typeof entry === "string") {
      const name = entry.trim();
      if (!name) continue;
      const key = normalizeKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      continue;
    }
    if (typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = pickFirstString(
      record.league_name,
      record.name,
      record.strLeague,
      record.league,
      record.leagueName,
      record.league_title,
    );
    if (!name) continue;
    const logo = getLeagueLogoFromEntry(record);
    const normalizedName = normalizeKey(name);
    if (normalizedName && seen.has(normalizedName)) continue;
    if (logo && normalizedName) {
      result[normalizedName] = logo;
    }
    gatherAliases(record.strLeagueAlternate).forEach(alias => {
      if (!logo) return;
      const aliasKey = normalizeKey(alias);
      if (aliasKey) result[aliasKey] = logo;
    });
    const aliasesField = record.aliases ?? record.alias ?? record.alternate;
    if (Array.isArray(aliasesField)) {
      aliasesField
        .map(item => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
        .forEach(alias => {
          if (!logo) return;
          const aliasKey = normalizeKey(alias);
          if (aliasKey) result[aliasKey] = logo;
        });
    } else if (typeof aliasesField === "string") {
      gatherAliases(aliasesField).forEach(alias => {
        if (!logo) return;
        const aliasKey = normalizeKey(alias);
        if (aliasKey) result[aliasKey] = logo;
      });
    }
    if (normalizedName) seen.add(normalizedName);
  }
  return result;
};

export default function MyTeamsPage() {
  const { user, supabase, loading } = useAuth();
  const [teams, setTeams] = useState<string[]>([]);
  const [teamLogos, setTeamLogos] = useState<Record<string, string>>({});
  const [teamLogoCache, setTeamLogoCache] = useState<Record<string, string>>({});
  const [leagueLogoCache, setLeagueLogoCache] = useState<Record<string, string>>({});
  const [addQuery, setAddQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [leagues, setLeagues] = useState<string[]>([]);
  const [leagueLogosMap, setLeagueLogosMap] = useState<Record<string, string>>({});
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [activeSearchTab, setActiveSearchTab] = useState<"team" | "league">("team");
  const dialogInputRef = useRef<HTMLInputElement | null>(null);

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
            const normalized: Record<string, string> = {};
            cached.forEach((c: any) => {
              if (!c?.name) return;
              const logo = sanitizeLogoUrl(c?.logo);
              if (!logo) return;
              normalized[normalizeKey(String(c.name))] = logo;
            });
            if (Object.keys(normalized).length) {
              setTeamLogoCache(prev => ({ ...normalized, ...prev }));
            }
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
            const logo = sanitizeLogoUrl(r?.logo);
            if (logo) map[key] = logo;
          });
        }

        if (Object.keys(map).length) {
          setTeamLogoCache(prev => ({ ...prev, ...map }));
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
                setTeamLogoCache(prev => ({ ...prev, [normalizeKey(name)]: logo }));
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

        const combinedCache = { ...teamLogoCache, ...map };
        const displayMap: Record<string, string> = {};
        teams.forEach(teamName => {
          displayMap[String(teamName)] = resolveLogoForDisplay(String(teamName), teamLogos, combinedCache) || '';
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
            const logo = sanitizeLogoUrl(r?.logo);
            if (!logo) return;
            map[normalizeKey(String(r.name))] = logo;
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
            const env = await postCollect("leagues.list", {});
            const lookup = mapLeagueEntriesToLogoLookup(env?.data);
            if (lookup && Object.keys(lookup).length) {
              Object.entries(lookup).forEach(([key, logo]) => {
                if (logo) map[key] = logo;
              });
            }
          } catch (e) {
            console.debug('leagues.list fallback error', e);
          }
        }

        missing = leagues.filter(leagueName => !sanitizeLogoUrl(map[normalizeKey(leagueName)]));
        if (missing.length > 0) {
          try {
            const resp = await fetch('/api/leagues');
            if (resp.ok) {
              const json = await resp.json();
              const lookup = mapLeagueEntriesToLogoLookup(json?.leagues ?? json ?? []);
              if (lookup && Object.keys(lookup).length) {
                await Promise.all(missing.map(async (name) => {
                  const normalizedName = normalizeKey(name);
                  const direct = lookup[normalizedName];
                  const fuzzyKey = direct
                    ? normalizedName
                    : Object.keys(lookup).find(k => k.includes(normalizedName) || normalizedName.includes(k));
                  const logo = fuzzyKey ? lookup[fuzzyKey] : '';
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

        if (Object.keys(map).length) {
          setLeagueLogoCache(prev => ({ ...prev, ...map }));
        }

        const combinedLeagueCache = { ...leagueLogoCache, ...map };
        const displayLeagueMap: Record<string, string> = {};
        leagues.forEach(leagueName => {
          displayLeagueMap[String(leagueName)] = resolveLogoForDisplay(String(leagueName), leagueLogosMap, combinedLeagueCache) || '';
        });
        setLeagueLogosMap(displayLeagueMap);
      } catch {
        if (mounted) setLeagueLogosMap({});
      }
    })();
    return () => { mounted = false; };
  }, [leagues, user, supabase]);

  const topSuggestions = useMemo(() => {
    return suggestions.filter(s => !teams.includes(s)).slice(0, 12);
  }, [suggestions, teams]);

  const filteredResults = useMemo(() => {
    const scope = activeSearchTab;
    return results.filter(r => (scope === "team" ? r.type === 'team' : r.type === 'league'));
  }, [results, activeSearchTab]);

  const addTeam = (t: string): boolean => {
    const name = t.trim();
    if (!name) return false;
    if (teams.includes(name)) {
      toast.info("Already added");
      return false;
    }
    setTeams(prev => [...prev, name]);
    // If suggestion had a logo in results, attach it optimistically
    const found = results.find(r => r.name === name && r.type === "team");
    const optimisticLogo = found?.logo ? sanitizeLogoUrl(found.logo) : "";
    if (optimisticLogo) {
      setTeamLogos(prev => ({ ...prev, [name]: optimisticLogo }));
      setTeamLogoCache(prev => ({ ...prev, [normalizeKey(name)]: optimisticLogo }));
    }
    setAddQuery("");
    return true;
  };

  const resolveTeamLogo = (name: string) => {
    const direct = sanitizeLogoUrl(teamLogos[name]);
    if (direct) return direct;
    const cached = sanitizeLogoUrl(teamLogoCache[normalizeKey(name)]);
    return cached;
  };

  const resolveLeagueLogo = (name: string) => {
    const direct = sanitizeLogoUrl(leagueLogosMap[name]);
    if (direct) return direct;
    const cached = sanitizeLogoUrl(leagueLogoCache[normalizeKey(name)]);
    return cached;
  };

  const handleResultSelect = async (item: SearchResult) => {
    const cleanedLogo = sanitizeLogoUrl(item.logo);
    if (item.type === 'team') {
      const added = addTeam(item.name);
      if (!added) return;
      if (cleanedLogo) {
        setTeamLogoCache(prev => ({ ...prev, [normalizeKey(item.name)]: cleanedLogo }));
        try {
          await supabase.rpc('upsert_cached_team', {
            p_provider_id: null,
            p_name: item.name,
            p_logo: cleanedLogo,
            p_metadata: {},
          });
        } catch {}
      }
    } else {
      await followLeague(item.name);
      if (cleanedLogo) {
        setLeagueLogoCache(prev => ({ ...prev, [normalizeKey(item.name)]: cleanedLogo }));
        try {
          await supabase.rpc('upsert_cached_league', {
            p_provider_id: null,
            p_name: item.name,
            p_logo: cleanedLogo,
            p_metadata: {},
          });
        } catch {}
      }
    }
    setIsAddDialogOpen(false);
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
        const lookup = mapLeagueEntriesToLogoLookup(leaguesArr);
        if (normalizedTarget) {
          resolvedLogo = lookup[normalizedTarget] ?? resolvedLogo;
          if (!resolvedLogo) {
            const fuzzyKey = Object.keys(lookup).find(k => k.includes(normalizedTarget) || normalizedTarget.includes(k));
            if (fuzzyKey) resolvedLogo = lookup[fuzzyKey];
          }
        }
        if (!resolvedLogo) {
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
        }
      } catch {
        // ignore search errors
      }
    }

    if (resolvedLogo) {
      setLeagueLogosMap(prev => ({ ...prev, [name]: resolvedLogo }));
      setLeagueLogoCache(prev => ({ ...prev, [normalizeKey(name)]: resolvedLogo }));
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
  const debouncedQuery = useDebouncedValue(addQuery, 250);

  useEffect(() => {
    let alive = true;
    const q = debouncedQuery.trim();
    if (!isAddDialogOpen) {
      setResults([]);
      return () => { alive = false; };
    }
    if (!q) { setResults([]); return () => { alive = false; }; }
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
  }, [debouncedQuery, isAddDialogOpen]);

  useEffect(() => {
    if (isAddDialogOpen) {
      requestAnimationFrame(() => {
        dialogInputRef.current?.focus();
      });
    } else {
      setAddQuery("");
      setResults([]);
    }
  }, [isAddDialogOpen]);

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
        className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between"
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Heart className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-3xl font-bold">My Teams</h1>
              <p className="text-muted-foreground">Curate the clubs and competitions you care about most.</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Header Add favourites button removed per user request; dialog remains accessible where needed */}
          <Button variant="secondary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save preferences'}
          </Button>
        </div>
      </motion.div>

      <Card>
        <CardHeader className="space-y-1">
          <CardTitle>Favorites overview</CardTitle>
          <p className="text-sm text-muted-foreground">
            Track the teams and competitions you follow most closely.
          </p>
        </CardHeader>
        <CardContent className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Teams</h2>
              {teams.length > 0 && (
                <span className="text-xs text-muted-foreground">{teams.length} saved</span>
              )}
            </div>
            {teams.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  You haven&apos;t added any teams yet. Use suggestions below or search to get started.
                </p>
                <Button size="sm" className="mt-4" onClick={() => { setActiveSearchTab("team"); setAddQuery(""); setIsAddDialogOpen(true); }}>
                  <Plus className="h-4 w-4" />
                  <span>Add a team</span>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {teams.map(t => {
                  const logo = resolveTeamLogo(t);
                  return (
                    <Badge key={t} variant="secondary" className="flex items-center gap-3 rounded-full px-3 py-2 text-sm">
                      <Avatar className="h-6 w-6">
                        {logo ? (
                          <AvatarImage src={logo} alt={t} />
                        ) : (
                          <AvatarFallback>{t.slice(0, 2).toUpperCase()}</AvatarFallback>
                        )}
                      </Avatar>
                      <span className="font-medium">{t}</span>
                      <button className="ml-2 rounded-full bg-black/5 p-1 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20" aria-label={`Remove ${t}`} onClick={() => removeTeam(t)}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Leagues</h2>
              {leagues.length > 0 && (
                <span className="text-xs text-muted-foreground">{leagues.length} following</span>
              )}
            </div>
            {leagues.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/10 p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Add leagues to follow standings, live fixtures, and news in one place.
                </p>
                <Button size="sm" variant="outline" className="mt-4" onClick={() => { setActiveSearchTab("league"); setAddQuery(""); setIsAddDialogOpen(true); }}>
                  <Plus className="h-4 w-4" />
                  <span>Discover leagues</span>
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {leagues.map(l => {
                  const logo = resolveLeagueLogo(l);
                  return (
                    <Badge key={l} variant="secondary" className="flex items-center gap-3 rounded-full px-3 py-2 text-sm">
                      <Avatar className="h-6 w-6">
                        {logo ? (
                          <AvatarImage src={logo} alt={l} />
                        ) : (
                          <AvatarFallback>{l.slice(0, 2).toUpperCase()}</AvatarFallback>
                        )}
                      </Avatar>
                      <span className="font-medium">{l}</span>
                      <button className="ml-2 rounded-full bg-black/5 p-1 hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/20" aria-label={`Unfollow ${l}`} onClick={() => unfollowLeague(l)}>
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Smart suggestions</h2>
              <Button size="sm" variant="ghost" onClick={() => { setActiveSearchTab("team"); setAddQuery(""); setIsAddDialogOpen(true); }}>
                Browse all
              </Button>
            </div>
            {topSuggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">We&apos;ll surface tailored suggestions here once we learn more about the teams you follow.</p>
            ) : (
              <div className="rounded-lg border bg-muted/10 p-4">
                <p className="text-xs text-muted-foreground mb-3">Tap to add teams instantly.</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {topSuggestions.map(s => {
                    const logo = resolveTeamLogo(s);
                    return (
                      <Button
                        key={s}
                        variant="outline"
                        className="justify-start gap-3 rounded-lg border border-border/60 bg-background py-2"
                        onClick={() => addTeam(s)}
                      >
                        <Avatar className="h-7 w-7">
                          {logo ? (
                            <AvatarImage src={logo} alt={s} />
                          ) : (
                            <AvatarFallback>{s.slice(0, 2).toUpperCase()}</AvatarFallback>
                          )}
                        </Avatar>
                        <span className="font-medium">{s}</span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        </CardContent>
      </Card>

      <Dialog
        open={isAddDialogOpen}
        onOpenChange={(open) => setIsAddDialogOpen(open)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add favourites</DialogTitle>
            <DialogDescription>
              Search for clubs or leagues to follow. We&apos;ll keep you updated once they&apos;re saved.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={activeSearchTab} onValueChange={(value) => setActiveSearchTab(value as "team" | "league")}> 
            <TabsList className="w-full">
              <TabsTrigger value="team" className="flex-1">Teams</TabsTrigger>
              <TabsTrigger value="league" className="flex-1">Leagues</TabsTrigger>
            </TabsList>
          </Tabs>

          <Input
            ref={dialogInputRef}
            placeholder={activeSearchTab === "team" ? "Search clubs, national teams, or academies" : "Search leagues or tournaments"}
            value={addQuery}
            onChange={(event) => setAddQuery(event.target.value)}
          />

          {activeSearchTab === "team" && addQuery.trim().length === 0 && topSuggestions.length > 0 && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">Popular picks</p>
              <div className="flex flex-wrap gap-2">
                {topSuggestions.slice(0, 6).map((suggestion) => {
                  const logo = resolveTeamLogo(suggestion);
                  return (
                    <Button
                      key={suggestion}
                      size="sm"
                      variant="ghost"
                      className="gap-2 rounded-full border border-transparent bg-background px-3"
                      onClick={() => handleResultSelect({ name: suggestion, logo, type: 'team' })}
                    >
                      <Avatar className="h-6 w-6">
                        {logo ? <AvatarImage src={logo} alt={suggestion} /> : <AvatarFallback>{suggestion.slice(0, 2).toUpperCase()}</AvatarFallback>}
                      </Avatar>
                      {suggestion}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          <ScrollArea className="max-h-[320px] pr-1">
            <div className="space-y-2">
              {addQuery.trim().length === 0 && filteredResults.length === 0 && !searching && (
                <p className="text-sm text-muted-foreground">
                  Start typing to search the global database, or pick from the suggestions above.
                </p>
              )}
              {searching && (
                <p className="text-sm text-muted-foreground">Searching…</p>
              )}
              {!searching && filteredResults.length > 0 && filteredResults.map((item) => {
                const logo = item.type === 'team' ? resolveTeamLogo(item.name) || sanitizeLogoUrl(item.logo) : resolveLeagueLogo(item.name) || sanitizeLogoUrl(item.logo);
                return (
                  <button
                    key={`${item.type}-${item.name}`}
                    className="flex w-full items-center gap-3 rounded-lg border border-border/70 bg-background px-3 py-2 text-left transition hover:border-primary/60 hover:bg-muted"
                    onClick={() => handleResultSelect(item)}
                  >
                    <Avatar className="h-9 w-9">
                      {logo ? (
                        <AvatarImage src={logo} alt={item.name} />
                      ) : (
                        <AvatarFallback>{item.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      )}
                    </Avatar>
                    <div className="flex-1">
                      <div className="font-medium leading-tight">{item.name}</div>
                      <p className="text-xs capitalize text-muted-foreground">{item.type}</p>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize">{item.type}</Badge>
                  </button>
                );
              })}
              {!searching && addQuery.trim().length > 0 && filteredResults.length === 0 && (
                <p className="text-sm text-muted-foreground">No matches found. Try a different spelling or switch tabs.</p>
              )}
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsAddDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}