"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { LeagueInfoHero, LeagueHeroInfo } from "@/components/league/LeagueInfoHero";
import LeagueSummaryCard from "@/components/league/LeagueSummaryCard";
import { LeagueStandingsCard, StandingRow, SelectOption } from "@/components/league/LeagueStandingsCard";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getLeagueInfo, getLeagueTable, listSeasons, postCollect, Json } from "@/lib/collect";
import LeagueLiveMatches from "@/components/league/LeagueLiveMatches";
import LeagueSeasonMatches from "@/components/league/LeagueSeasonMatches";
import LeagueStatistics from "@/components/league/LeagueStatistics";
import LeagueLatestNews from "@/components/league/LeagueLatestNews";


type LeagueListEntry = {
  id?: string;
  rawId?: string;
  name: string;
  country?: string;
  leagueLogo?: string;
  countryLogo?: string;
  aliases?: string[];
};

type ProviderResponse = {
  data?: unknown;
};

const CURRENT_SEASON_KEY = "__current__";
const OVERALL_STAGE_KEY = "__overall__";
const ALL_STAGE_KEY = "__all";

const pickFirstString = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && !Number.isNaN(value)) return String(value);
  }
  return undefined;
};

const pickFirstNumber = (obj: Record<string, unknown>, keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  }
  return undefined;
};

const isStandingRow = (candidate: Record<string, unknown>): boolean => {
  const team = pickFirstString(candidate, ["standing_team", "team_name", "team", "strTeam", "team_name_local"]);
  const points = pickFirstNumber(candidate, ["standing_PTS", "points", "standing_points"]);
  const played = pickFirstNumber(candidate, ["standing_P", "played", "matches_played"]);
  return Boolean(team) && (points !== undefined || played !== undefined);
};

const extractStandingsRows = (raw: unknown): Record<string, unknown>[] => {
  const asObject = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };
  const asRowArray = (value: unknown): Record<string, unknown>[] | null => {
    if (!Array.isArray(value)) return null;
    return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  };
  const getCaseInsensitive = (obj: Record<string, unknown>, key: string) => {
    const match = Object.keys(obj).find(k => k.toLowerCase() === key.toLowerCase());
    return match ? obj[match] : undefined;
  };
  const getByPath = (value: unknown, path: string[]): Record<string, unknown>[] | null => {
    let current: unknown = value;
    for (const segment of path) {
      const obj = asObject(current);
      if (!obj) return null;
      current = getCaseInsensitive(obj, segment);
      if (current === undefined) return null;
    }
    return asRowArray(current);
  };

  // Prefer explicit "total" (overall standings) before falling back.
  const preferredPaths: string[][] = [
    ["result", "total"],
    ["data", "total"],
    ["total"],
    ["result", "overall"],
    ["result", "table"],
    ["result", "standings"],
    ["data", "standings"],
    ["standings"],
    ["table"],
    ["rows"],
  ];

  for (const path of preferredPaths) {
    const candidate = getByPath(raw, path);
    if (candidate && candidate.length) return candidate;
  }

  const rows: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  const shouldSkipKey = (key: string) => {
    const lower = key.toLowerCase();
    return lower.includes("home") || lower.includes("away");
  };
  const walk = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(item => walk(item));
      return;
    }
    if (typeof value !== "object") return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    const obj = value as Record<string, unknown>;
    if (isStandingRow(obj)) {
      rows.push(obj);
      return;
    }
    Object.entries(obj).forEach(([key, item]) => {
      if (shouldSkipKey(key)) return;
      walk(item);
    });
  };
  walk(raw);
  return rows;
};

const mapStandingRow = (obj: Record<string, unknown>, index: number): StandingRow | null => {
  const team = pickFirstString(obj, ["standing_team", "team_name", "team", "strTeam", "club_name"]);
  if (!team) return null;

  const position =
    pickFirstNumber(obj, ["standing_place", "rank", "position", "standing_position", "intRank"]) ?? index + 1;
  const played = pickFirstNumber(obj, ["standing_P", "played", "matches_played", "overall_gp"]);
  const wins = pickFirstNumber(obj, ["standing_W", "wins", "overall_w", "total_w"]);
  const draws = pickFirstNumber(obj, ["standing_D", "draw", "draws", "overall_d"]);
  const losses = pickFirstNumber(obj, ["standing_L", "loss", "losses", "overall_l"]);
  const goalsFor = pickFirstNumber(obj, ["standing_F", "goals_for", "goals_scored", "gf"]);
  const goalsAgainst = pickFirstNumber(obj, ["standing_A", "goals_against", "ga"]);
  const goalDifference =
    pickFirstNumber(obj, ["standing_GD", "goal_diff", "gd"]) ??
    (goalsFor !== undefined && goalsAgainst !== undefined ? goalsFor - goalsAgainst : undefined);
  const points = pickFirstNumber(obj, ["standing_PTS", "points", "standing_points", "pts"]);
  const stageRaw = pickFirstString(obj, ["stage_name", "group", "league_round", "standing_place_type", "round"]);
  const stageKey = stageRaw ? stageRaw.toLowerCase() : OVERALL_STAGE_KEY;
  const stageLabel = stageRaw || "Overall";
  const seasonRaw = pickFirstString(obj, ["league_season", "season", "season_name"]);
  const seasonKey = seasonRaw ?? CURRENT_SEASON_KEY;
  const seasonLabel = seasonRaw ?? "Current Season";
  const form =
    pickFirstString(obj, ["standing_form", "form", "last_five", "recent_form"])?.replace(/[^WDL]/gi, "") ?? undefined;
  const updatedAt = pickFirstString(obj, ["standing_updated", "updated", "last_update"]);
  const logo = pickFirstString(obj, [
    "team_logo",
    "logo",
    "badge",
    "team_badge",
    "image",
    "team_logo_url",
    "team_logo_path",
  ]);
  const country = pickFirstString(obj, ["country_name", "country", "nation"]);

  return {
    id: `${team}-${seasonKey}-${stageKey}-${position}`,
    team,
    position,
    played,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    goalDifference,
    points,
    logo: logo ?? undefined,
    stageKey,
    stageLabel,
    seasonKey,
    seasonLabel,
    form,
    updatedAt,
    country: country ?? undefined,
  };
};

const mergeHeroInfo = (prev: LeagueHeroInfo | null, patch: Partial<LeagueHeroInfo>): LeagueHeroInfo => {
  const dedupe = (arr: string[] | undefined) =>
    Array.from(new Set((arr ?? []).map(item => item.trim()).filter(Boolean)));

  return {
    name: patch.name ?? prev?.name ?? "League",
    country: patch.country ?? prev?.country,
    leagueLogo: patch.leagueLogo ?? prev?.leagueLogo,
    countryLogo: patch.countryLogo ?? prev?.countryLogo,
    alternateNames: dedupe([...(prev?.alternateNames ?? []), ...(patch.alternateNames ?? [])]),
    founded: patch.founded ?? prev?.founded,
    currentSeason: patch.currentSeason ?? prev?.currentSeason,
    website: patch.website ?? prev?.website,
    description: patch.description ?? prev?.description,
  };
};

const extractLeagueEntries = (raw: unknown): LeagueListEntry[] => {
  const entries: LeagueListEntry[] = [];

  const coerce = (value: unknown): LeagueListEntry | null => {
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    const name = pickFirstString(obj, ["league_name", "name", "league", "strLeague"]);
    if (!name) return null;
    const trimmedName = name.trim();
    const idCandidate = pickFirstString(obj, ["league_id", "league_key", "idLeague", "id", "key"]);
    const trimmedId = idCandidate ? idCandidate.trim() : undefined;
    const id = trimmedId ?? trimmedName;
    const countryRaw = pickFirstString(obj, ["country_name", "country", "nation", "strCountry"]);
    const country = countryRaw ? countryRaw.trim() : undefined;
    const leagueLogo = pickFirstString(obj, [
      "league_logo",
      "league_logo_url",
      "logo",
      "badge",
      "strBadge",
      "strLogo",
      "image",
    ]);
    const countryLogo = pickFirstString(obj, ["country_logo", "flag", "country_flag"]);
    const aliasesRaw = pickFirstString(obj, ["league_alternates", "strLeagueAlternate"]);
    const aliases = aliasesRaw ? aliasesRaw.split(";", 6).map(item => item.trim()).filter(Boolean) : [];
    return {
      id,
      rawId: trimmedId,
      name: trimmedName,
      country,
      leagueLogo: leagueLogo ?? undefined,
      countryLogo: countryLogo ?? undefined,
      aliases,
    };
  };

  const walk = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== "object") return;
    const obj = value as Record<string, unknown>;
    const maybe = coerce(obj);
    if (maybe) {
      entries.push(maybe);
      return;
    }
    Object.values(obj).forEach(walk);
  };

  walk(raw);
  return entries;
};

const normalizeString = (value: string | undefined | null): string => (value ?? "").trim().toLowerCase();

const buildEntryIdentityKey = (entry: LeagueListEntry): string =>
  [normalizeString(entry.id), normalizeString(entry.name), normalizeString(entry.country)].join("|");

const matchLeagueEntry = (
  entries: LeagueListEntry[],
  options: {
    providerId?: string;
    slugId?: string;
    targetName?: string;
    targetCountry?: string;
    identityKey?: string;
  } = {}
): LeagueListEntry | null => {
  if (!entries.length) return null;
  const normalizedIdentity = normalizeString(options.identityKey);
  if (normalizedIdentity) {
    const byIdentity = entries.find(entry => buildEntryIdentityKey(entry) === normalizedIdentity);
    if (byIdentity) return byIdentity;
  }

  const normalizedProviderId = normalizeString(options.providerId);
  const normalizedSlugId = normalizeString(options.slugId);
  const normalizedName = normalizeString(options.targetName);
  const normalizedCountry = normalizeString(options.targetCountry);

  let slugName: string | undefined;
  let slugCountry: string | undefined;
  if (normalizedSlugId) {
    if (normalizedSlugId.includes("::")) {
      const [slugNamePart, slugCountryPart] = normalizedSlugId.split("::");
      slugName = slugNamePart || undefined;
      slugCountry = slugCountryPart || undefined;
    } else if (!normalizedProviderId) {
      slugName = normalizedSlugId;
    }
  }

  const candidateCountries = new Set<string>();
  if (normalizedCountry) candidateCountries.add(normalizedCountry);
  if (slugCountry) candidateCountries.add(slugCountry);

  const nameCandidates = [normalizedName, slugName].filter(Boolean) as string[];
  const idCandidates = [normalizedProviderId].filter(Boolean) as string[];
  if (normalizedSlugId) idCandidates.push(normalizedSlugId);

  const countryMatches = (entry: LeagueListEntry) => {
    if (!candidateCountries.size) return true;
    const entryCountry = normalizeString(entry.country);
    return candidateCountries.has(entryCountry);
  };

  const tryFind = (predicate: (entry: LeagueListEntry) => boolean) => entries.find(predicate);

  const idExact = tryFind(
    entry => idCandidates.some(candidate => candidate === normalizeString(entry.id)) && countryMatches(entry)
  );
  if (idExact) return idExact;

  if (idCandidates.length) {
    const idExactFallback = tryFind(entry => idCandidates.some(candidate => candidate === normalizeString(entry.id)));
    if (idExactFallback) return idExactFallback;
  }

  const nameExact = tryFind(
    entry => nameCandidates.some(candidate => candidate === normalizeString(entry.name)) && countryMatches(entry)
  );
  if (nameExact) return nameExact;

  if (nameCandidates.length) {
    const nameExactFallback = tryFind(entry => nameCandidates.some(candidate => candidate === normalizeString(entry.name)));
    if (nameExactFallback) return nameExactFallback;
  }

  const idPartial = tryFind(
    entry =>
      idCandidates.some(candidate => normalizeString(entry.id).includes(candidate)) && countryMatches(entry)
  );
  if (idPartial) return idPartial;

  if (idCandidates.length) {
    const idPartialFallback = tryFind(entry =>
      idCandidates.some(candidate => normalizeString(entry.id).includes(candidate))
    );
    if (idPartialFallback) return idPartialFallback;
  }

  const namePartial = tryFind(
    entry =>
      nameCandidates.some(candidate => normalizeString(entry.name).includes(candidate)) && countryMatches(entry)
  );
  if (namePartial) return namePartial;

  if (nameCandidates.length) {
    const namePartialFallback = tryFind(entry =>
      nameCandidates.some(candidate => normalizeString(entry.name).includes(candidate))
    );
    if (namePartialFallback) return namePartialFallback;
  }

  return entries[0];
};

const parseSeasons = (
  raw: unknown,
  criteria: { leagueId?: string; leagueName?: string }
): string[] => {
  const seasons = new Set<string>();
  const normalizedId = criteria.leagueId?.trim().toLowerCase();
  const normalizedName = criteria.leagueName?.trim().toLowerCase();

  const normalizeSeason = (value: unknown): string | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
      const n = Math.trunc(value);
      if (n >= 1900 && n <= 2100) return String(n);
      return null;
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;
      if (/^\d{4}$/.test(trimmed)) return trimmed;
      const match = trimmed.match(/^(\d{4})[\/\-](\d{2}|\d{4})$/);
      if (match) {
        const [, start, endRaw] = match;
        const end = endRaw.length === 2 ? `${start.slice(0, 2)}${endRaw}` : endRaw;
        return `${start}/${end}`;
      }
      if (/^\d{4}[\/\-]\d{4}$/.test(trimmed)) {
        return trimmed.replace("-", "/");
      }
    }
    return null;
  };

  const collectFromObject = (obj: Record<string, unknown>, force: boolean) => {
    if (!force) return;
    const keys = ["league_season", "season", "season_name", "current_season", "strSeason", "seasonYear"];
    keys.forEach(key => {
      const normalized = normalizeSeason(obj[key]);
      if (normalized) seasons.add(normalized);
    });
  };

  const matchesLeague = (obj: Record<string, unknown>): boolean => {
    if (!normalizedId && !normalizedName) return true;
    const candidateId = pickFirstString(obj, ["league_key", "league_id", "idLeague", "leagueId", "id"]);
    const candidateName = pickFirstString(obj, ["league_name", "strLeague", "name", "league"]);
    const idMatch = normalizedId && candidateId && candidateId.trim().toLowerCase() === normalizedId;
    const nameMatch = normalizedName && candidateName && candidateName.trim().toLowerCase() === normalizedName;
    return Boolean(idMatch || nameMatch);
  };

  const walk = (value: unknown, matched: boolean) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(entry => walk(entry, matched));
      return;
    }
    if (typeof value !== "object") {
      if (matched && typeof value === "string") {
        const normalized = normalizeSeason(value);
        if (normalized) seasons.add(normalized);
      }
      return;
    }
    const obj = value as Record<string, unknown>;
    const thisMatches = matchesLeague(obj);
    const nextMatched = matched || thisMatches;
    collectFromObject(obj, nextMatched);
    Object.values(obj).forEach(entry => walk(entry, nextMatched));
  };

  walk(raw, false);
  return Array.from(seasons)
    .filter(Boolean)
    .sort((a, b) => seasonSortValue(b) - seasonSortValue(a));
};

const seasonSortValue = (label: string): number => {
  const lower = label.toLowerCase();
  if (lower.includes("current")) return Number.POSITIVE_INFINITY;
  const matches = label.match(/\d{4}/g);
  if (!matches || matches.length === 0) return Number.NEGATIVE_INFINITY;
  return Number(matches[0]);
};

const computeLastUpdated = (rows: StandingRow[]): string | undefined => {
  const timestamps = rows
    .map(row => row.updatedAt)
    .filter((val): val is string => typeof val === "string" && val.trim().length > 0);
  if (!timestamps.length) return undefined;
  return timestamps.sort((a, b) => (a > b ? -1 : 1))[0];
};

export default function LeagueDetailPage() {
  const { leagueId } = useParams<{ leagueId: string }>();
  const decodedLeagueId = leagueId ? decodeURIComponent(leagueId) : "";
  const searchParams = useSearchParams();
  const initialNameParam = searchParams?.get("name") ?? "";
  const initialCountryParam = searchParams?.get("country") ?? "";
  const identityKeyParam = searchParams?.get("key") ?? "";
  const providerOverrideParam = searchParams?.get("providerId") ?? "";
  const providerLeagueId = providerOverrideParam?.trim()
    ? providerOverrideParam.trim()
    : decodedLeagueId && /^\d+$/.test(decodedLeagueId)
      ? decodedLeagueId
      : undefined;
  const slugIdentifier = providerLeagueId ? undefined : decodedLeagueId || undefined;

  const [resolvedLeagueId, setResolvedLeagueId] = useState<string | undefined>(providerLeagueId);
  const [leagueName, setLeagueName] = useState<string>(initialNameParam);
  const [heroInfo, setHeroInfo] = useState<LeagueHeroInfo | null>(
    initialNameParam ? { name: initialNameParam, country: initialCountryParam || undefined } : null
  );
  const [infoError, setInfoError] = useState<string | null>(null);

  const [standingsLoading, setStandingsLoading] = useState<boolean>(false);
  const [standingsError, setStandingsError] = useState<string | null>(null);
  const [seasonCache, setSeasonCache] = useState<Record<string, StandingRow[]>>({});
  const [seasonLabels, setSeasonLabels] = useState<Record<string, string>>({});
  const [selectedSeason, setSelectedSeason] = useState<string>("");
  const [selectedStage, setSelectedStage] = useState<string>(ALL_STAGE_KEY);

  // Live matches moved to LeagueLiveMatches component

  // Season matches moved to LeagueSeasonMatches component

  // ---- Load league metadata from list (logos, base info) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const args: Record<string, Json> = {};
        if (providerLeagueId) args.leagueId = providerLeagueId;
        if (initialNameParam) args.leagueName = initialNameParam;
        if (!Object.keys(args).length && leagueName) {
          args.leagueName = leagueName;
        }
        const resp = (await postCollect("leagues.list", args)) as ProviderResponse;
        let entries = extractLeagueEntries(resp?.data);
        if (!entries.length) {
          const fallback = (await postCollect("leagues.list", {})) as ProviderResponse;
          entries = extractLeagueEntries(fallback?.data);
        }
        const match = matchLeagueEntry(entries, {
          providerId: providerLeagueId,
          slugId: slugIdentifier,
          targetName: initialNameParam || leagueName,
          targetCountry: initialCountryParam,
          identityKey: identityKeyParam,
        });
        if (!match || cancelled) return;
        if (!leagueName && match.name) setLeagueName(match.name);
        const providerCandidate = match.rawId ?? match.id;
        if (providerCandidate) {
          setResolvedLeagueId(prev => (prev === providerCandidate ? prev : providerCandidate));
        }
        setHeroInfo(prev => mergeHeroInfo(prev, { name: match.name, country: match.country, leagueLogo: match.leagueLogo, countryLogo: match.countryLogo, alternateNames: match.aliases }));
      } catch (error) {
        if (!cancelled) setInfoError(error instanceof Error ? error.message : "Failed to load league info");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerLeagueId, initialNameParam, leagueName, slugIdentifier, initialCountryParam, identityKeyParam]);

  // ---- Detailed league info (TSDB lookupleague) ----
  useEffect(() => {
    if (!leagueName && !resolvedLeagueId) return;
    let cancelled = false;
    const args: { leagueId?: string; leagueName?: string } = {};
    if (resolvedLeagueId) args.leagueId = resolvedLeagueId;
    if (!resolvedLeagueId && leagueName) args.leagueName = leagueName;

    getLeagueInfo(args)
      .then(resp => {
        if (cancelled) return;
        const league = resp?.data?.league;
        if (!league || typeof league !== "object") return;
        const obj = league as Record<string, unknown>;

        const descriptionRaw = pickFirstString(obj, [
          "description",
          "strDescriptionEN",
          "strDescription",
          "league_description",
        ]);
        let description: string | undefined;
        if (descriptionRaw) {
          description = descriptionRaw.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim();
        }

        const alternateNamesRaw = pickFirstString(obj, [
          "strLeagueAlternate",
          "league_alternates",
          "leagueAlternates",
          "alternate_names",
        ]);
        const alternateNames = alternateNamesRaw
          ? Array.from(
              new Set(
                alternateNamesRaw
                  .split(/[;,]/)
                  .map(item => item.trim())
                  .filter(Boolean)
              )
            )
          : undefined;

        const patch: Partial<LeagueHeroInfo> = {
          name: pickFirstString(obj, ["strLeague", "league_name", "name"]) ?? undefined,
          country: pickFirstString(obj, ["strCountry", "country"]) ?? undefined,
          leagueLogo: pickFirstString(obj, [
            "strBadge",
            "strLogo",
            "strLeagueLogo",
            "league_logo",
            "league_badge",
            "badge",
          ]) ?? undefined,
          countryLogo: pickFirstString(obj, [
            "strCountryBadge",
            "strFlag",
            "country_logo",
            "flag",
          ]) ?? undefined,
          founded: pickFirstString(obj, ["intFormedYear", "strFormedYear", "formedYear"]) ?? undefined,
          currentSeason: pickFirstString(obj, ["strCurrentSeason", "currentSeason"]) ?? undefined,
          website: pickFirstString(obj, ["strWebsite", "officialWebsite", "website"]) ?? undefined,
          description,
          alternateNames,
        };

        const hasPatch = Object.values(patch).some(value => {
          if (Array.isArray(value)) return value.length > 0;
          return value !== undefined && value !== null && value !== "";
        });
        if (hasPatch) {
          setHeroInfo(prev => mergeHeroInfo(prev, patch));
          setInfoError(prev => prev && prev.startsWith("Failed to load league info") ? null : prev);
        }
      })
      .catch(error => {
        if (cancelled) return;
        setInfoError(prev => prev ?? (error instanceof Error ? error.message : "Failed to load league info"));
      });

    return () => {
      cancelled = true;
    };
  }, [leagueName, resolvedLeagueId]);

  // ---- Seasons list for selector ----
  useEffect(() => {
    if (!leagueName && !resolvedLeagueId) return;
    let cancelled = false;
    const args: { leagueId?: string; leagueName?: string } = {};
    if (resolvedLeagueId) args.leagueId = resolvedLeagueId;
    if (!resolvedLeagueId && leagueName) args.leagueName = leagueName;
    listSeasons(args)
      .then(resp => {
        if (cancelled) return;
        const seasons = parseSeasons(resp?.data, { leagueId: resolvedLeagueId, leagueName });
        if (!seasons.length) return;
        setSeasonLabels(prev => {
          const next = { ...prev };
          seasons.forEach(season => {
            if (!next[season]) next[season] = season;
          });
          return next;
        });
      })
      .catch(() => {
        // ignore season lookup errors (not critical)
      });
    return () => {
      cancelled = true;
    };
  }, [leagueName, resolvedLeagueId]);

  const fetchStandings = useCallback(
    async (requestedSeasonKey?: string, seasonParam?: string | null) => {
      if (!leagueName && !resolvedLeagueId) return;
      const fallbackKey = requestedSeasonKey ?? (seasonParam ?? CURRENT_SEASON_KEY);
      setStandingsLoading(true);
      setStandingsError(null);
      try {
        const options: { season?: string; leagueId?: string } = {};
        if (seasonParam && seasonParam !== CURRENT_SEASON_KEY) {
          options.season = seasonParam;
        }
        if (resolvedLeagueId) options.leagueId = resolvedLeagueId;
        const params: { leagueId?: string; leagueName?: string; season?: string } = {};
        if (options.leagueId) {
          params.leagueId = options.leagueId;
        } else if (leagueName) {
          params.leagueName = leagueName || undefined;
        } else {
          params.leagueName = undefined;
        }
        if (options.season) params.season = options.season;
        const resp = await getLeagueTable(params);
        const raw = resp?.data;
        const rowsRaw = extractStandingsRows(raw);
        if (!rowsRaw.length) {
          if (fallbackKey) {
            setSeasonCache(prev => ({ ...prev, [fallbackKey]: [] }));
            setSeasonLabels(prev => ({
              ...prev,
              [fallbackKey]: fallbackKey === CURRENT_SEASON_KEY ? "Current Season" : fallbackKey,
            }));
          }
          setStandingsError("No standings available for this selection.");
          return;
        }
        const mapped = rowsRaw
          .map((row, idx) => mapStandingRow(row, idx))
          .filter((row): row is StandingRow => row !== null);
        if (!mapped.length) {
          if (fallbackKey) {
            setSeasonCache(prev => ({ ...prev, [fallbackKey]: [] }));
            setSeasonLabels(prev => ({
              ...prev,
              [fallbackKey]: fallbackKey === CURRENT_SEASON_KEY ? "Current Season" : fallbackKey,
            }));
          }
          setStandingsError("Unable to parse standings data.");
          return;
        }

        const grouped = mapped.reduce<Record<string, StandingRow[]>>((acc, row) => {
          const key = row.seasonKey ?? fallbackKey;
          if (!key) return acc;
          acc[key] = acc[key] ? [...acc[key], row] : [row];
          return acc;
        }, {});

        const entries = Object.entries(grouped).map(([key, rows]) => ({
          key,
          rows: rows
            .slice()
            .sort(
              (a, b) =>
                (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER)
            ),
          label: rows[0]?.seasonLabel ?? (key === CURRENT_SEASON_KEY ? "Current Season" : key),
        }));

        setSeasonCache(prev => {
          const next = { ...prev };
          entries.forEach(({ key, rows }) => {
            next[key] = rows;
          });
          return next;
        });

        setSeasonLabels(prev => {
          const next = { ...prev };
          entries.forEach(({ key, label }) => {
            next[key] = label;
          });
          return next;
        });

        const preference: string[] = [];
        if (seasonParam && seasonParam !== CURRENT_SEASON_KEY) preference.push(seasonParam);
        if (requestedSeasonKey) preference.push(requestedSeasonKey);
        entries
          .slice()
          .sort((a, b) => seasonSortValue(b.label) - seasonSortValue(a.label))
          .forEach(entry => {
            if (!preference.includes(entry.key)) preference.push(entry.key);
          });

        setSelectedSeason(prev => {
          if (prev && entries.some(entry => entry.key === prev)) {
            return prev;
          }
          return preference[0] ?? prev ?? "";
        });
        setStandingsError(null);
      } catch (error) {
        setStandingsError(error instanceof Error ? error.message : "Failed to load standings.");
      } finally {
        setStandingsLoading(false);
      }
    },
    [leagueName, resolvedLeagueId]
  );

  // ---- Initial standings load ----
  useEffect(() => {
    if (!leagueName && !resolvedLeagueId) return;
    if (Object.keys(seasonCache).length > 0) return;
    fetchStandings(undefined, null);
  }, [leagueName, resolvedLeagueId, seasonCache, fetchStandings]);

  // ---- Load standings when season changes ----
  useEffect(() => {
    if (!selectedSeason) return;
    if (seasonCache[selectedSeason]) return;
    const seasonParam = selectedSeason === CURRENT_SEASON_KEY ? null : selectedSeason;
    fetchStandings(selectedSeason, seasonParam);
  }, [selectedSeason, seasonCache, fetchStandings]);

  // Live matches logic is encapsulated in LeagueLiveMatches


  const seasonOptions: SelectOption[] = useMemo(() => {
    const entries = Object.entries(seasonLabels);
    entries.sort((a, b) => seasonSortValue(b[1]) - seasonSortValue(a[1]));
    return entries.map(([value, label]) => ({ value, label }));
  }, [seasonLabels]);

  useEffect(() => {
    if (!seasonOptions.length) return;
    setSelectedSeason(prev => {
      if (prev && seasonOptions.some(opt => opt.value === prev)) {
        return prev;
      }
      return seasonOptions[0]?.value ?? prev ?? "";
    });
  }, [seasonOptions]);

  const currentRows = useMemo(
    () => (selectedSeason ? seasonCache[selectedSeason] ?? [] : []),
    [seasonCache, selectedSeason]
  );

  const stageOptions: SelectOption[] = useMemo(() => {
    const map = new Map<string, string>();
    currentRows.forEach(row => {
      const key = row.stageKey ?? OVERALL_STAGE_KEY;
      const label = row.stageLabel ?? "Overall";
      map.set(key, label);
    });
    const entries = Array.from(map.entries());
    entries.sort((a, b) => {
      if (a[0] === OVERALL_STAGE_KEY) return -1;
      if (b[0] === OVERALL_STAGE_KEY) return 1;
      return a[1].localeCompare(b[1]);
    });
    const options = entries.map(([value, label]) => ({ value, label }));
    if (options.length > 1) {
      return [{ value: ALL_STAGE_KEY, label: "All Stages" }, ...options];
    }
    return options.length ? options : [{ value: OVERALL_STAGE_KEY, label: "Overall" }];
  }, [currentRows]);

  const selectedSeasonLabel = useMemo(() => {
    if (!selectedSeason) return undefined;
    return seasonLabels[selectedSeason] || selectedSeason;
  }, [seasonLabels, selectedSeason]);

  const selectedStageLabel = useMemo(() => {
    if (selectedStage === ALL_STAGE_KEY) return "All stages";
    return stageOptions.find(opt => opt.value === selectedStage)?.label ?? (selectedStage === OVERALL_STAGE_KEY ? "Overall" : undefined);
  }, [stageOptions, selectedStage]);

  useEffect(() => {
    if (!stageOptions.length) {
      setSelectedStage(ALL_STAGE_KEY);
      return;
    }
    if (!stageOptions.some(opt => opt.value === selectedStage)) {
      setSelectedStage(stageOptions[0].value);
    }
  }, [stageOptions, selectedStage]);

  const filteredRows = useMemo(() => {
    if (!currentRows.length) return [];
    if (selectedStage === ALL_STAGE_KEY) return currentRows;
    return currentRows.filter(row => (row.stageKey ?? OVERALL_STAGE_KEY) === selectedStage);
  }, [currentRows, selectedStage]);

  const lastUpdated = useMemo(() => computeLastUpdated(filteredRows), [filteredRows]);



  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" />
        <Link href="/leagues" className="font-medium text-primary hover:text-primary/80">
          Back to leagues
        </Link>
      </div>

      {infoError && !heroInfo ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{infoError}</CardContent>
        </Card>
      ) : heroInfo ? (
        <LeagueInfoHero info={heroInfo} />
      ) : !infoError ? (
        <Card className="border-border/60">
          <CardContent className="flex items-center gap-4 p-6">
            <Skeleton className="h-20 w-20 rounded-xl" />
            <div className="flex-1 space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-4 w-56" />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <LeagueSummaryCard
        leagueName={leagueName}
        info={heroInfo}
        rows={filteredRows}
        seasonLabel={selectedSeasonLabel}
        stageLabel={selectedStageLabel}
        lastUpdated={lastUpdated}
      />

      {standingsError && filteredRows.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{standingsError}</CardContent>
        </Card>
      ) : null}

      <LeagueStandingsCard
        rows={filteredRows}
        loading={standingsLoading && !filteredRows.length}
        error={filteredRows.length ? null : standingsError}
        seasonOptions={seasonOptions}
        selectedSeason={selectedSeason}
        onSelectSeason={setSelectedSeason}
        stageOptions={stageOptions}
        selectedStage={selectedStage}
        onSelectStage={setSelectedStage}
        lastUpdated={lastUpdated}
      />

      {/* League statistics derived from standings */}
      <LeagueStatistics
        rows={filteredRows}
        leagueName={leagueName || heroInfo?.name}
        seasonLabel={selectedSeasonLabel}
        stageLabel={selectedStageLabel}
      />

      {/* Live matches for this league */}
      <LeagueLiveMatches leagueId={resolvedLeagueId} leagueName={leagueName || heroInfo?.name} />

      {/* Season matches for selected season */}
      <LeagueSeasonMatches
        leagueId={resolvedLeagueId}
        leagueName={leagueName || heroInfo?.name}
        seasonLabel={selectedSeasonLabel}
      />
      {/* Latest news related to this league */}
      <LeagueLatestNews leagueName={leagueName || heroInfo?.name} />

    </div>
  );
}
