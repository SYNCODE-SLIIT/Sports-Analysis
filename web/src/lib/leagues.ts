import leagueMetadataJson from "@/app/leagues/league-metadata.json";

type LeagueMetadataEntry = {
  id?: number | string;
  slug: string;
  name: string;
  country?: string;
  aliases?: string[];
  league_key?: string | number;
};

const RAW_LEAGUE_METADATA = leagueMetadataJson as LeagueMetadataEntry[];

const normalize = (value: string | number | undefined | null): string => {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
};

const LEAGUE_METADATA_BY_KEY = new Map<string, LeagueMetadataEntry>();
const LEAGUE_METADATA_BY_NAME = new Map<string, LeagueMetadataEntry>();

RAW_LEAGUE_METADATA.forEach(entry => {
  const key = normalize(entry.league_key ?? entry.id);
  if (key) {
    if (!LEAGUE_METADATA_BY_KEY.has(key)) {
      LEAGUE_METADATA_BY_KEY.set(key, entry);
    }
  }
  const baseName = normalize(entry.name);
  if (baseName && !LEAGUE_METADATA_BY_NAME.has(baseName)) {
    LEAGUE_METADATA_BY_NAME.set(baseName, entry);
  }
  (entry.aliases ?? []).forEach(alias => {
    const normalizedAlias = normalize(alias);
    if (normalizedAlias && !LEAGUE_METADATA_BY_NAME.has(normalizedAlias)) {
      LEAGUE_METADATA_BY_NAME.set(normalizedAlias, entry);
    }
  });
});

export const POPULAR_LEAGUES = [
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
];

export function isPopularLeague(name?: string): boolean {
  if (!name) return false;
  return POPULAR_LEAGUES.some(l => l.toLowerCase() === name.toLowerCase());
}

export function matchLeague(query: string, league?: string): boolean {
  if (!query) return true;
  if (!league) return false;
  return league.toLowerCase().includes(query.toLowerCase());
}

export function findLeagueMetadata(options: { leagueId?: string | null; leagueName?: string | null }): LeagueMetadataEntry | null {
  const { leagueId, leagueName } = options;
  const idKey = normalize(leagueId);
  if (idKey) {
    const byKey = LEAGUE_METADATA_BY_KEY.get(idKey);
    if (byKey) return byKey;
  }
  const nameKey = normalize(leagueName);
  if (nameKey) {
    const byName = LEAGUE_METADATA_BY_NAME.get(nameKey);
    if (byName) return byName;
  }
  return null;
}

const fallbackSlugFromName = (name?: string | null) => {
  if (!name) return "";
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "");
};

export function buildLeagueHref(league: { id?: string | null; name?: string | null; country?: string | null }): string | null {
  const metadata = findLeagueMetadata({ leagueId: league.id, leagueName: league.name });
  const slugSource = metadata?.slug ?? fallbackSlugFromName(league.name);
  const target = slugSource || normalize(league.id) || null;
  if (!target) return null;

  const params = new URLSearchParams();
  if (league.id) params.set("providerId", league.id);
  if (league.name) params.set("name", league.name);
  if (league.country) params.set("country", league.country);
  if (metadata?.league_key) params.set("key", String(metadata.league_key));

  const query = params.toString();
  return `/leagues/${encodeURIComponent(target)}${query ? `?${query}` : ""}`;
}
