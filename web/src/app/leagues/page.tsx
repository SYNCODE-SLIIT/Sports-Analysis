"use client";
import { toast } from "sonner";


import { useCallback, useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Check, ChevronRight, Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { postCollect, getLeagueNews } from "@/lib/collect";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/AuthProvider";
import rawLeagueMetadata from "./league-metadata.json";
import rawCategoryMetadata from "./category-metadata.json";
import { LeagueSearch } from "./LeagueSearch";

type LeagueLite = {
  id: string;
  rawId?: string;
  slug: string;
  identityKey: string;
  league_name: string;
  country_name?: string;
  logo?: string;
};

type LeagueMetadata = {
  id: number;
  slug: string;
  name: string;
  country?: string;
  confederation?: string;
  type?: string;
  category?: string;
  categories?: string[];
  fame_rank?: number;
  aliases?: string[];
  active?: boolean;
  strength_score?: number;
  league_key?: string;
};

type DisplayLeague = LeagueLite & {
  rawName: string;
  displayName: string;
  displayCountry?: string;
  displayLabel: string;
  metadata?: ResolvedMetadata;
};

type FeaturedSection = {
  id: string;
  title: string;
  description?: string;
  leagues: DisplayLeague[];
};

// Navigator with optional Web Share API

const LEAGUE_METADATA: LeagueMetadata[] = rawLeagueMetadata as LeagueMetadata[];
type CategoryMetadata = { id: string; title?: string; description?: string };
const CATEGORY_METADATA_LIST: CategoryMetadata[] = rawCategoryMetadata as CategoryMetadata[];
const CATEGORY_PRIORITY = new Map<string, number>();
const CATEGORY_LOOKUP = new Map<string, CategoryMetadata>();
CATEGORY_METADATA_LIST.forEach((item, index) => {
  CATEGORY_PRIORITY.set(item.id, index);
  CATEGORY_LOOKUP.set(item.id, item);
});
const CATEGORY_PRIORITY_DEFAULT = Number.MAX_SAFE_INTEGER;
const getCategoryPriority = (id: string) => CATEGORY_PRIORITY.get(id) ?? CATEGORY_PRIORITY_DEFAULT;

const normalizeValue = (value: string | undefined | null) => {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ");
};

const normalizeKeyValue = (value: string | number | undefined | null) => {
  if (value === undefined || value === null) return "";
  return String(value).trim().toLowerCase();
};

type AggregatedMetadata = {
  primary: LeagueMetadata;
  categories: Set<string>;
  fameRank: number;
  aliasKeys: Set<string>;
  countryKeys: Set<string>;
  leagueKeys: Set<string>;
};

type ResolvedMetadata = {
  primary: LeagueMetadata;
  categories: string[];
  fameRank: number;
};

const formatRelativeTime = (value?: string) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const divisions: { amount: number; name: Intl.RelativeTimeFormatUnit }[] = [
    { amount: 60, name: "second" },
    { amount: 60, name: "minute" },
    { amount: 24, name: "hour" },
    { amount: 7, name: "day" },
    { amount: 4.34524, name: "week" },
    { amount: 12, name: "month" },
    { amount: Number.POSITIVE_INFINITY, name: "year" },
  ];

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let duration = seconds;

  for (const division of divisions) {
    if (Math.abs(duration) < division.amount) {
      return formatter.format(Math.round(duration), division.name);
    }

    duration /= division.amount;
  }

  return null;
};

const REMAINING_INITIAL_ROWS = 3;
const REMAINING_INCREMENT_ROWS = 5;
const ITEMS_PER_ROW_DESKTOP = 4;
const INITIAL_REMAINING_COUNT = REMAINING_INITIAL_ROWS * ITEMS_PER_ROW_DESKTOP;
const INCREMENT_REMAINING_COUNT = REMAINING_INCREMENT_ROWS * ITEMS_PER_ROW_DESKTOP;

const buildMetadataIndex = () => {
  const aggregated = new Map<string, AggregatedMetadata>();

  const ensureEntry = (item: LeagueMetadata) => {
    const nameKey = normalizeValue(item.name);
    if (!nameKey) return null;
    const countryKey = normalizeValue(item.country);
    const mapKey = `${countryKey}|${nameKey}`;
    let entry = aggregated.get(mapKey);
    if (!entry) {
      entry = {
        primary: item,
        categories: new Set<string>(),
        fameRank: item.fame_rank ?? Number.MAX_SAFE_INTEGER,
        aliasKeys: new Set<string>(),
        countryKeys: new Set<string>(),
        leagueKeys: new Set<string>(),
      };
      aggregated.set(mapKey, entry);
    } else {
      const currentRank = entry.primary.fame_rank ?? Number.MAX_SAFE_INTEGER;
      const nextRank = item.fame_rank ?? Number.MAX_SAFE_INTEGER;
      const currentPopular = entry.primary.category === "popular";
      const nextPopular = item.category === "popular";
      if ((nextPopular && !currentPopular) || (!nextPopular && currentPopular ? false : nextRank < currentRank)) {
        entry.primary = item;
      }
      entry.fameRank = Math.min(entry.fameRank, nextRank);
    }

    const categoriesValue = Array.isArray(item.categories) && item.categories.length
      ? item.categories
      : item.category
        ? [item.category]
        : [];
    categoriesValue.forEach(cat => { if (cat) entry?.categories.add(cat); });

    const addAlias = (alias: string | undefined | null) => {
      const aliasKey = normalizeValue(alias);
      if (!aliasKey) return;
      entry?.aliasKeys.add(aliasKey);
    };
    addAlias(item.name);
    (item.aliases ?? []).forEach(addAlias);

    const addCountryVariant = (country: string | undefined | null) => {
      const variant = normalizeValue(country);
      entry?.countryKeys.add(variant);
      if (variant.includes("/")) {
        variant.split("/").forEach(part => entry?.countryKeys.add(part));
      }
    };
    addCountryVariant(item.country);
    if (!item.country) {
      entry?.countryKeys.add("");
    }

    const addLeagueKey = (keyValue: string | number | undefined | null) => {
      const normalized = normalizeKeyValue(keyValue);
      if (!normalized) return;
      entry?.leagueKeys.add(normalized);
    };
    const maybeKeys = (item as unknown as { league_keys?: Array<string | number> }).league_keys;
    if (Array.isArray(maybeKeys) && maybeKeys.length) {
      maybeKeys.forEach(addLeagueKey);
    } else {
      addLeagueKey(item.league_key);
    }

    return entry;
  };

  LEAGUE_METADATA.forEach(item => {
    ensureEntry(item);
  });

  const aliasIndex = new Map<string, AggregatedMetadata>();
  aggregated.forEach(entry => {
    const countries = entry.countryKeys.size ? entry.countryKeys : new Set<string>([""]);
    countries.forEach(countryKey => {
      entry.aliasKeys.forEach(aliasKey => {
        const key = `${countryKey}|${aliasKey}`;
        const existing = aliasIndex.get(key);
        if (!existing || entry.fameRank < existing.fameRank) {
          aliasIndex.set(key, entry);
        }
      });
    });
    if (entry.countryKeys.has("")) {
      entry.aliasKeys.forEach(aliasKey => {
        const key = `|${aliasKey}`;
        const existing = aliasIndex.get(key);
        if (!existing || entry.fameRank < existing.fameRank) {
          aliasIndex.set(key, entry);
        }
      });
    }
  });

  const keyIndex = new Map<string, AggregatedMetadata>();
  aggregated.forEach(entry => {
    entry.leagueKeys.forEach(key => {
      const existing = keyIndex.get(key);
      if (!existing || entry.fameRank < existing.fameRank) {
        keyIndex.set(key, entry);
      }
    });
  });

  return { aliasIndex, keyIndex };
};

const useMetadataIndex = () => useMemo(buildMetadataIndex, []);

const formatCategoryTitle = (id: string) =>
  id
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const getCategoryTitle = (id: string) => CATEGORY_LOOKUP.get(id)?.title ?? formatCategoryTitle(id);

const sortLeaguesWithinCategory = (leagues: DisplayLeague[]) =>
  [...leagues].sort((a, b) => {
    const rankA = a.metadata?.fameRank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.metadata?.fameRank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.displayName.localeCompare(b.displayName);
  });

type LeagueCardItemProps = {
  league: DisplayLeague;
  isSelected: boolean;
  isFavorited?: boolean;
  favoriteBusy?: boolean;
  onSelect: (league: DisplayLeague) => void;
  onToggleFavorite?: (league: DisplayLeague) => void;
  variant?: "grid" | "carousel";
};

function LeagueCardItem({
  league,
  isSelected,
  isFavorited = false,
  favoriteBusy = false,
  onSelect,
  onToggleFavorite,
  variant = "grid",
}: LeagueCardItemProps) {
  const router = useRouter();
  const favoriteDisabled = favoriteBusy || !onToggleFavorite;

  const handleSelect = () => {
    onSelect(league);
    try {
      const slugSource =
        league.slug ??
        league.rawId ??
        league.id ??
        league.displayName ??
        league.rawName;
      if (!slugSource) return;

      const params = new URLSearchParams();
      if (league.rawName) params.set("name", league.rawName);
      const countryParam =
        league.country_name ?? league.displayCountry ?? league.metadata?.primary.country;
      if (countryParam) params.set("country", countryParam);
      if (league.identityKey) params.set("key", league.identityKey);
      if (league.rawId) params.set("providerId", league.rawId);

      const slug = encodeURIComponent(slugSource);
      const query = params.toString();
      const url = query ? `/leagues/${slug}?${query}` : `/leagues/${slug}`;
      router.push(url);
    } catch {
      // ignore navigation errors
    }
  };
  const handleFavoriteClick = (evt: MouseEvent<HTMLButtonElement>) => {
    evt.preventDefault();
    evt.stopPropagation();
    if (!favoriteDisabled) onToggleFavorite?.(league);
  };
  const handleFavoriteKeyDown = (evt: KeyboardEvent<HTMLButtonElement>) => {
    if (evt.key === " " || evt.key === "Enter") {
      evt.preventDefault();
      evt.stopPropagation();
      if (!favoriteDisabled) onToggleFavorite?.(league);
    }
  };
  const baseClasses = [
    "relative",
    "cursor-pointer",
    "border",
    "hover:shadow-md",
    "focus-within:ring-2",
    "focus-within:ring-primary",
    "focus-within:ring-offset-2",
    "transition-transform",
    "active:scale-95",
    isSelected ? "border-primary shadow-lg" : "",
    variant === "carousel" ? "min-w-[240px] flex-shrink-0" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const subtitle = [league.metadata?.primary.confederation, league.rawName !== league.displayName ? league.rawName : undefined]
    .filter(Boolean)
    .join(" • ");

  return (
    <Card
      className={baseClasses}
      onClick={handleSelect}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onKeyDown={evt => {
        if ((evt.key === "Enter" || evt.key === " ") && evt.target === evt.currentTarget) {
          evt.preventDefault();
          handleSelect();
        }
      }}
    >
      <motion.button
        type="button"
  aria-label={isFavorited ? "Remove league from favorites" : "Save league"}
        onClick={handleFavoriteClick}
        onKeyDown={handleFavoriteKeyDown}
        disabled={favoriteDisabled}
        className={[
          "absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full border bg-background/95 text-muted-foreground shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          isFavorited ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary hover:text-primary",
          favoriteDisabled ? "cursor-default opacity-60" : "cursor-pointer",
        ].join(" ")}
        whileTap={favoriteDisabled ? undefined : { scale: 0.9 }}
        whileHover={favoriteDisabled ? undefined : { scale: 1.05 }}
        animate={isFavorited ? { scale: [1, 1.15, 1], rotate: [0, -6, 6, 0] } : { scale: 1, rotate: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        data-state={isFavorited ? "saved" : "idle"}
      >
        {favoriteBusy ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/60 border-t-transparent" />
        ) : isFavorited ? (
          <Check className="h-4 w-4" />
        ) : (
          <Plus className="h-4 w-4" />
        )}
      </motion.button>
      <CardContent className="flex items-center gap-4 p-4 pr-12">
        <div
          className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border text-sm font-semibold ${
            league.logo ? "border-transparent" : "border-border bg-muted text-muted-foreground"
          }`}
          style={
            league.logo
              ? { backgroundImage: `url(${league.logo})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        >
          {!league.logo && getInitials(league.displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{league.displayLabel}</div>
          {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

type FeaturedCategorySectionProps = {
  section: FeaturedSection;
  onSelect: (league: DisplayLeague) => void;
  selectedLeagueKey: string;
  favLeagues: string[];
  pendingFavorites: Set<string>;
  onToggleFavorite: (league: DisplayLeague) => void;
};

function FeaturedCategorySection({ section, onSelect, selectedLeagueKey, favLeagues, pendingFavorites, onToggleFavorite }: FeaturedCategorySectionProps) {
  if (!section.leagues.length) return null;
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-xl font-semibold">{section.title}</h3>
        {section.description && <p className="text-sm text-muted-foreground max-w-3xl">{section.description}</p>}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {section.leagues.map(league => (
          <LeagueCardItem
            key={`${section.id}-${league.identityKey}`}
            league={league}
            isSelected={getLeagueKey(league) === selectedLeagueKey}
            onSelect={onSelect}
            onToggleFavorite={onToggleFavorite}
            isFavorited={favLeagues.includes(league.rawName)}
            favoriteBusy={pendingFavorites.has(league.rawName)}
            variant="carousel"
          />
        ))}
      </div>
    </div>
  );
}

const POPULAR_LEAGUES = [
  "Premier League",
  "UEFA Champions League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Major League Soccer",
];

const isPopularLeague = (name: string) =>
  POPULAR_LEAGUES.some(popular => name.toLowerCase().includes(popular.toLowerCase()));

const getInitials = (name: string): string =>
  name
    .split(" ")
    .filter(Boolean)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "?";

const getFirstString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

// Try many common keys and nested shapes to find a logo URL
const getLogoFromObject = (obj: Record<string, unknown>): string | undefined => {
  const keys = [
    "league_logo",
    "league_logo_url",
    "league_badge",
    "badge",
    "logo",
    "image",
    "strLogo",
    "strBadge",
    "strBadgeWide",
    "logo_path",
    "logo_url",
    "image_url",
    "thumb",
    "badge_url",
    "strLeagueLogo",
    "strLogoWide",
    "strThumb",
  ];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object") {
      const nested = (v as Record<string, unknown>).url || (v as Record<string, unknown>).src || (v as Record<string, unknown>).image || (v as Record<string, unknown>).path;
      if (typeof nested === "string" && nested.trim()) return nested.trim();
    }
  }

  // try media arrays
  const mediaCandidates = ["media", "images", "logos", "thumbnails"];
  for (const mk of mediaCandidates) {
    const mv = obj[mk];
    if (Array.isArray(mv) && mv.length) {
      for (const item of mv) {
        if (typeof item === "string" && item.trim()) return item.trim();
        if (item && typeof item === "object") {
          const nested = (item as Record<string, unknown>).url || (item as Record<string, unknown>).src || (item as Record<string, unknown>).image;
          if (typeof nested === "string" && nested.trim()) return nested.trim();
        }
      }
    }
  }

  return undefined;
};

const extractLeagueInfo = (entry: unknown): LeagueLite | null => {
  const createIdentityKey = (idPart: string, namePart: string, countryPart: string) =>
    [idPart, namePart, countryPart].join("|");

  if (typeof entry === "string") {
    const rawName = entry.trim();
    if (!rawName) return null;
    const normalizedName = rawName.toLowerCase();
    const identityKey = createIdentityKey("", normalizedName, "");
    return {
      id: normalizedName,
      slug: rawName,
      identityKey,
      league_name: rawName,
    };
  }

  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const nameRaw = getFirstString(obj, ["league_name", "name", "league"]);
    if (!nameRaw) return null;
    const trimmedName = nameRaw.trim();
    if (!trimmedName) return null;

    const countryRaw = getFirstString(obj, ["country_name", "country", "nation"]);
    const trimmedCountry = countryRaw ? countryRaw.trim() : undefined;

    const idRaw = getFirstString(obj, ["league_id", "league_key", "id", "key", "idLeague"]);
    const providerId = idRaw ? idRaw.trim() : undefined;

    const logoCandidate =
      getLogoFromObject(obj) ??
      getFirstString(obj, [
        "league_logo",
        "league_logo_url",
        "league_badge",
        "badge",
        "logo",
        "image",
        "strLogo",
        "strBadge",
        "strBadgeWide",
      ]);
    const trimmedLogo = logoCandidate ? logoCandidate.trim() : undefined;

    const normalizedId = providerId?.toLowerCase() ?? "";
    const normalizedName = trimmedName.toLowerCase();
    const normalizedCountry = trimmedCountry?.toLowerCase() ?? "";
    const identityKey = createIdentityKey(normalizedId, normalizedName, normalizedCountry);

    const slugBase =
      providerId && providerId.length > 0
        ? providerId
        : [trimmedName, trimmedCountry].filter(Boolean).join("::");
    const slug = (slugBase || trimmedName).trim();

    return {
      id: normalizedId || normalizedName,
      rawId: providerId,
      slug,
      identityKey,
      league_name: trimmedName,
      country_name: trimmedCountry,
      logo: trimmedLogo || undefined,
    };
  }

  return null;
};

const mapLeagues = (raw: unknown): LeagueLite[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const normalized: LeagueLite[] = [];
  for (const entry of raw) {
    const info = extractLeagueInfo(entry);
    if (!info) continue;
    if (seen.has(info.identityKey)) continue;
    seen.add(info.identityKey);
    normalized.push(info);
  }
  return normalized;
};

const getLeagueKey = (league: LeagueLite | DisplayLeague | null | undefined): string => {
  if (!league) return "";
  const rawId = typeof league.rawId === "string" ? league.rawId.trim() : "";
  const fallback = typeof league.id === "string" ? league.id.trim() : "";
  return rawId || fallback;
};

export default function LeaguesPage() {
  const { user, supabase } = useAuth();
  const [allLeagues, setAllLeagues] = useState<LeagueLite[]>([]);
  const [initialLeagueParam, setInitialLeagueParam] = useState<string | null>(null);
  const [initialProviderParam, setInitialProviderParam] = useState<string | null>(null);
  const [selectedLeagueKey, setSelectedLeagueKey] = useState<string>("");
  const [selectedLeagueName, setSelectedLeagueName] = useState<string>("");
  const [news, setNews] = useState<Array<{ id?: string; title?: string; url?: string; summary?: string; imageUrl?: string; source?: string; publishedAt?: string }>>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [remainingVisibleCount, setRemainingVisibleCount] = useState<number>(INITIAL_REMAINING_COUNT);
  const [favLeagues, setFavLeagues] = useState<string[]>([]);
  const [pendingFavorites, setPendingFavorites] = useState<Set<string>>(new Set());

  const updateFavoritePending = useCallback((leagueName: string, pending: boolean) => {
    setPendingFavorites(prev => {
      const next = new Set(prev);
      if (pending) next.add(leagueName);
      else next.delete(leagueName);
      return next;
    });
  }, []);

  const skeletonCount = useMemo(() => (news.length ? Math.min(news.length, 6) : 4), [news.length]);

  const metadataIndex = useMetadataIndex();

  const updateSelectionInUrl = useCallback((leagueName?: string, providerId?: string) => {
    try {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (leagueName) params.set("league", leagueName);
      else params.delete("league");
      if (providerId) params.set("providerId", providerId);
      else params.delete("providerId");
      const query = params.toString();
      const next = query ? `?${query}` : "";
      window.history.replaceState(null, "", `${window.location.pathname}${next}`);
    } catch {
      // ignore history failures
    }
  }, []);

  useEffect(() => {
    setRemainingVisibleCount(INITIAL_REMAINING_COUNT);
  }, [allLeagues]);

  useEffect(() => {
    let active = true;
    if (!user) {
      setFavLeagues([]);
      setPendingFavorites(new Set());
      return () => {
        active = false;
      };
    }
    (async () => {
      try {
        const { data } = await supabase
          .from('user_preferences')
          .select('favorite_leagues')
          .eq('user_id', user.id)
          .single();
        if (!active) return;
        const leagues = Array.isArray(data?.favorite_leagues)
          ? (data.favorite_leagues as string[])
          : [];
        setFavLeagues(leagues);
      } catch {
        if (!active) return;
        setFavLeagues([]);
      } finally {
        if (active) setPendingFavorites(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [user, supabase]);

  const findMetadataForLeague = useCallback(
    (league: LeagueLite): ResolvedMetadata | undefined => {
      if (!league) return undefined;
      const leagueKey = normalizeKeyValue(getLeagueKey(league));
      let entry: AggregatedMetadata | undefined;
      if (leagueKey) {
        entry = metadataIndex.keyIndex.get(leagueKey);
      }
      if (!entry) {
        const nameKey = normalizeValue(league.league_name);
        if (!nameKey) return undefined;
        const countryKey = normalizeValue(league.country_name);

        const keysToTry: string[] = [];
        if (countryKey) {
          keysToTry.push(`${countryKey}|${nameKey}`);
          if (countryKey.includes("/")) {
            countryKey.split("/").forEach(part => {
              const variant = normalizeValue(part);
              if (variant) keysToTry.push(`${variant}|${nameKey}`);
            });
          }
        } else {
          keysToTry.push(`|${nameKey}`);
        }

        for (const key of keysToTry) {
          entry = metadataIndex.aliasIndex.get(key);
          if (entry) break;
        }
      }
      if (!entry) return undefined;

      const categories = Array.from(entry.categories)
        .filter(Boolean)
        .sort((a, b) => {
          const order = getCategoryPriority(a) - getCategoryPriority(b);
          if (order !== 0) return order;
          return a.localeCompare(b);
        });

      return {
        primary: entry.primary,
        categories,
        fameRank: entry.fameRank,
      };
    },
    [metadataIndex]
  );

  const createDisplayLeague = useCallback(
    (league: LeagueLite): DisplayLeague => {
      const metadata = findMetadataForLeague(league);
      const displayName = league.league_name;
      const displayCountry = league.country_name || metadata?.primary.country;
      const displayLabel = displayCountry ? `${displayCountry} • ${displayName}` : displayName;
      return {
        ...league,
        rawName: league.league_name,
        displayName,
        displayCountry: displayCountry || undefined,
        displayLabel,
        metadata,
      };
    },
    [findMetadataForLeague]
  );

  const orderedLeagues = useMemo(() => {
    const ordered = [...allLeagues];
    ordered.sort((a, b) => {
      const aPop = isPopularLeague(a.league_name) ? 0 : 1;
      const bPop = isPopularLeague(b.league_name) ? 0 : 1;
      if (aPop !== bPop) return aPop - bPop;
      return a.league_name.localeCompare(b.league_name);
    });
    return ordered;
  }, [allLeagues]);

  const displayLeagues = useMemo(() => orderedLeagues.map(createDisplayLeague), [orderedLeagues, createDisplayLeague]);

  const { featuredSections, remainingLeagues } = useMemo(() => {
    const categoryMap = new Map<string, DisplayLeague[]>();
    const uncategorized: DisplayLeague[] = [];

    displayLeagues.forEach(league => {
      const categories = league.metadata?.categories ?? [];
      if (categories.length === 0) {
        uncategorized.push(league);
        return;
      }
      categories.forEach(category => {
        const bucket = categoryMap.get(category) ?? [];
        bucket.push(league);
        categoryMap.set(category, bucket);
      });
    });

    const sections: FeaturedSection[] = [];

    CATEGORY_METADATA_LIST.forEach(meta => {
      const leagues = categoryMap.get(meta.id);
      if (leagues && leagues.length) {
        sections.push({
          id: meta.id,
          title: meta.title ?? formatCategoryTitle(meta.id),
          description: meta.description,
          leagues: sortLeaguesWithinCategory(leagues),
        });
        categoryMap.delete(meta.id);
      }
    });

    Array.from(categoryMap.entries())
      .sort((a, b) => {
        const priorityDiff = getCategoryPriority(a[0]) - getCategoryPriority(b[0]);
        if (priorityDiff !== 0) return priorityDiff;
        return getCategoryTitle(a[0]).localeCompare(getCategoryTitle(b[0]));
      })
      .forEach(([id, leagues]) => {
        const info = CATEGORY_LOOKUP.get(id);
        sections.push({
          id,
          title: info?.title ?? formatCategoryTitle(id),
          description: info?.description,
          leagues: sortLeaguesWithinCategory(leagues),
        });
      });

    return {
      featuredSections: sections,
      remainingLeagues: uncategorized,
    };
  }, [displayLeagues]);

  useEffect(() => {
    setRemainingVisibleCount(prev => {
      if (!remainingLeagues.length) return INITIAL_REMAINING_COUNT;
      if (prev > remainingLeagues.length) {
        return Math.max(INITIAL_REMAINING_COUNT, remainingLeagues.length);
      }
      return prev;
    });
  }, [remainingLeagues.length]);

  const visibleRemainingLeagues = useMemo(
    () => remainingLeagues.slice(0, remainingVisibleCount),
    [remainingLeagues, remainingVisibleCount]
  );

  const canShowMore = remainingLeagues.length > visibleRemainingLeagues.length;
  const canShowLess = remainingVisibleCount > INITIAL_REMAINING_COUNT;

  const selectedDisplayLeague = useMemo(() => {
    if (!selectedLeagueKey) return undefined;
    const raw = allLeagues.find(l => getLeagueKey(l) === selectedLeagueKey);
    return raw ? createDisplayLeague(raw) : undefined;
  }, [allLeagues, selectedLeagueKey, createDisplayLeague]);

  const selectedDisplayRawName = selectedDisplayLeague?.rawName;
  const selectedDisplayName = selectedDisplayLeague?.displayName ?? selectedLeagueName;
  const selectedDisplayLabel = selectedDisplayLeague?.displayLabel ?? selectedDisplayName;
  useEffect(() => {
    if (selectedDisplayRawName && selectedDisplayRawName !== selectedLeagueName) {
      setSelectedLeagueName(selectedDisplayRawName);
    }
  }, [selectedDisplayRawName, selectedLeagueName]);

  useEffect(() => {
    let active = true;

    const loadLeagues = async () => {
      try {
        const env = await postCollect("leagues.list", {});
        // env.data can be many shapes: array, { leagues: [...] }, { result: [...] }, or provider raw
        const rawPayload = env?.data as unknown;
        let arr: unknown[] = [];
        if (Array.isArray(rawPayload)) arr = rawPayload as unknown[];
        else if (rawPayload && typeof rawPayload === 'object') {
          const obj = rawPayload as Record<string, unknown>;
          if (Array.isArray(obj.leagues)) arr = obj.leagues as unknown[];
          else if (Array.isArray(obj.result)) arr = obj.result as unknown[];
          else if (Array.isArray(obj.results)) arr = obj.results as unknown[];
          else if (Array.isArray(obj.data)) arr = obj.data as unknown[];
        }
        const data = mapLeagues(arr);
        if (active && data.length) {
          setAllLeagues(data);
          return;
        }
      } catch (error) {
        console.debug("[leagues] collect fallback", error);
      }

      try {
        const response = await fetch("/api/leagues");
        if (!response.ok) throw new Error("Failed to load leagues");
        const json = (await response.json()) as { leagues?: unknown };
        if (!active) return;
        setAllLeagues(mapLeagues(json.leagues ?? []));
      } catch (error) {
        console.debug("[leagues] api fallback", error);
        if (active) setAllLeagues([]);
      }
    };

    loadLeagues();
    return () => {
      active = false;
    };
  }, []);

  // Read initial ?league=... param on first render so we can preselect a league when the
  // page is opened via a link. We store it separately and reconcile once `allLeagues` loads.
  useEffect(() => {
    try {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const leagueParam = params.get('league');
      if (leagueParam) setInitialLeagueParam(leagueParam);
      const providerParam = params.get('providerId') ?? params.get('leagueId');
      if (providerParam) setInitialProviderParam(providerParam);
    } catch {
      // ignore
    }
  }, []);

  // Ensure a league item exists and log interaction
  const ensureLeagueItemAndSend = useCallback(async (
    leagueName: string,
    evt: "view" | "click" | "like" | "save" | "share" | "dismiss",
    leagueKey?: string
  ) => {
    if (!user || !leagueName) return;
    try {
      const league = allLeagues.find(l => (leagueKey ? getLeagueKey(l) === leagueKey : l.league_name === leagueName));
      const { data: item_id } = await supabase.rpc("ensure_league_item", {
        p_league_name: leagueName,
        p_logo: league?.logo ?? null,
        p_popularity: 0,
      });
      if (!item_id) return;
      await supabase.from("user_interactions").insert({ user_id: user.id, item_id, event: evt });
    } catch {}
  }, [user, supabase, allLeagues]);

  // When the leagues list arrives, reconcile any initial query params with canonical league keys.
  useEffect(() => {
    if (!allLeagues.length) return;
    if (selectedLeagueKey) return;

    const providerParam = initialProviderParam?.trim();
    const nameParam = initialLeagueParam?.trim();
    let processed = false;

    if (providerParam) {
      const providerLower = providerParam.toLowerCase();
      const matchByKey = allLeagues.find(l => getLeagueKey(l).toLowerCase() === providerLower);
      if (matchByKey) {
        const key = getLeagueKey(matchByKey);
        setSelectedLeagueKey(key);
        setSelectedLeagueName(matchByKey.league_name);
        void ensureLeagueItemAndSend(matchByKey.league_name, "view", key);
        updateSelectionInUrl(matchByKey.league_name, key);
      } else if (nameParam) {
        setSelectedLeagueName(prev => (prev ? prev : nameParam));
      }
      processed = true;
    }

    if (!processed && nameParam) {
      const lower = nameParam.toLowerCase();
      let match = allLeagues.find(
        l => l.league_name.toLowerCase() === lower || getLeagueKey(l).toLowerCase() === lower
      );
      if (!match) {
        match = allLeagues.find(
          l =>
            l.league_name.toLowerCase().includes(lower) ||
            getLeagueKey(l).toLowerCase().includes(lower)
        );
      }
      if (match) {
        const key = getLeagueKey(match);
        setSelectedLeagueKey(key);
        setSelectedLeagueName(match.league_name);
        void ensureLeagueItemAndSend(match.league_name, "view", key);
        updateSelectionInUrl(match.league_name, key);
      } else {
        setSelectedLeagueName(nameParam);
        updateSelectionInUrl(nameParam, undefined);
      }
      processed = true;
    }

    if (processed) {
      if (initialProviderParam) setInitialProviderParam(null);
      if (initialLeagueParam) setInitialLeagueParam(null);
    }
  }, [
    allLeagues,
    selectedLeagueKey,
    initialProviderParam,
    initialLeagueParam,
    ensureLeagueItemAndSend,
    updateSelectionInUrl,
  ]);

  const handleLeagueSelect = useCallback(
    (league: DisplayLeague) => {
      if (!league) return;
      const key = getLeagueKey(league);
      setSelectedLeagueKey(key);
      setSelectedLeagueName(league.rawName);
      void ensureLeagueItemAndSend(league.rawName, "view", key);
      updateSelectionInUrl(league.rawName, key);
    },
    [ensureLeagueItemAndSend, updateSelectionInUrl]
  );

  const removeFavoriteLeague = useCallback(async (league: DisplayLeague) => {
    const name = league.rawName;
    const displayLabel = league.displayLabel || league.displayName;
    if (!user || !name) return;
    if (pendingFavorites.has(name)) return;
    updateFavoritePending(name, true);
    setFavLeagues(prev => prev.filter(item => item !== name));
    try {
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos')
        .eq('user_id', user.id)
        .single();
      const existingTeams = (prefs?.favorite_teams ?? []) as string[];
      const existingLeagues = (prefs?.favorite_leagues ?? []) as string[];
      const existingTeamLogos = (prefs?.favorite_team_logos ?? {}) as Record<string, string>;
      const existingLeagueLogos = (prefs?.favorite_league_logos ?? {}) as Record<string, string>;
      const nextLeagues = existingLeagues.filter(item => item !== name);
      const nextLeagueLogos = { ...existingLeagueLogos } as Record<string, string>;
      delete nextLeagueLogos[name];
      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        favorite_teams: existingTeams,
        favorite_leagues: nextLeagues,
        favorite_team_logos: existingTeamLogos,
        favorite_league_logos: nextLeagueLogos,
      });
      try {
        const { data: itemId } = await supabase.rpc('ensure_league_item', {
          p_league_name: name,
          p_logo: league.logo ?? null,
          p_popularity: 0,
        });
        if (itemId) {
          await supabase
            .from('user_interactions')
            .delete()
            .match({ user_id: user.id, item_id: itemId, event: 'save' });
          try {
            await supabase
              .from('user_interactions')
              .insert({ user_id: user.id, item_id: itemId, event: 'dismiss' });
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore failures when cleaning up interactions
      }
  // Removed bumpPreferences (no-op)
      toast.success(`${displayLabel} removed from favorites`);
    } catch {
      setFavLeagues(prev => (prev.includes(name) ? prev : [...prev, name]));
      toast.error(`Couldn't remove ${displayLabel}`);
    } finally {
      updateFavoritePending(name, false);
    }
  }, [user, supabase, pendingFavorites, updateFavoritePending]);

  const addFavoriteLeague = useCallback(async (league: DisplayLeague) => {
    const name = league.rawName;
    const displayLabel = league.displayLabel || league.displayName;
    if (!name) return;
    if (!user) {
      toast.info('Sign in to save leagues');
      return;
    }
    if (pendingFavorites.has(name)) return;
    if (favLeagues.includes(name)) {
      toast.info(`${displayLabel} is already saved`);
      return;
    }

    updateFavoritePending(name, true);
    setFavLeagues(prev => [...prev, name]);
    try {
      await ensureLeagueItemAndSend(name, 'save');
      const { data: prefs } = await supabase
        .from('user_preferences')
        .select('favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos')
        .eq('user_id', user.id)
        .single();
      const existingTeams = (prefs?.favorite_teams ?? []) as string[];
      const existingLeagues = (prefs?.favorite_leagues ?? []) as string[];
      const existingTeamLogos = (prefs?.favorite_team_logos ?? {}) as Record<string, string>;
      const existingLeagueLogos = (prefs?.favorite_league_logos ?? {}) as Record<string, string>;
      const nextLeagues = Array.from(new Set([...existingLeagues, name]));
      const nextLeagueLogos = { ...existingLeagueLogos } as Record<string, string>;
      if (league.logo) nextLeagueLogos[name] = league.logo;
      await supabase.from('user_preferences').upsert({
        user_id: user.id,
        favorite_teams: existingTeams,
        favorite_leagues: nextLeagues,
        favorite_team_logos: existingTeamLogos,
        favorite_league_logos: nextLeagueLogos,
      });
      setFavLeagues(nextLeagues);
  // Removed bumpPreferences (no-op)
      try {
        await supabase.rpc('upsert_cached_league', {
          p_provider_id: null,
          p_name: name,
          p_logo: league.logo ?? '',
          p_metadata: {},
        });
      } catch {
        // ignore cached league updates
      }
      toast.success(`${displayLabel} added to favorites`, {
        action: {
          label: 'Undo',
          onClick: () => {
            void removeFavoriteLeague(league);
          },
        },
      });
    } catch {
      setFavLeagues(prev => prev.filter(item => item !== name));
      toast.error(`Couldn't save ${displayLabel}`);
    } finally {
      updateFavoritePending(name, false);
    }
  }, [user, supabase, favLeagues, pendingFavorites, ensureLeagueItemAndSend, updateFavoritePending, removeFavoriteLeague]);

  const toggleFavoriteLeague = useCallback((league: DisplayLeague) => {
    const name = league.rawName;
    if (!name) return;
    if (favLeagues.includes(name)) {
      void removeFavoriteLeague(league);
    } else {
      void addFavoriteLeague(league);
    }
  }, [favLeagues, addFavoriteLeague, removeFavoriteLeague]);

  // Removed unused handleLeagueShare and NavigatorWithShare

  const fetchLeagueNews = useCallback(async (leagueName: string) => {
    if (!leagueName) return;
    setNewsLoading(true);
    setNewsError(null);
    try {
      const resp = await getLeagueNews(leagueName, 20);
      const articlesRaw = resp?.data?.articles || resp?.data?.result || resp?.data || [];
      const normalized = (Array.isArray(articlesRaw) ? articlesRaw : []).map((item, index) => {
        if (!item || typeof item !== "object") {
          return { id: `news-${index}` };
        }
        const record = item as Record<string, unknown>;
        const pick = (keys: string[]): string | undefined => {
          const value = getFirstString(record, keys);
          return value ? value : undefined;
        };
        let imageUrl = pick(["image", "imageUrl", "urlToImage", "thumbnail", "image_url"]);
        if (!imageUrl) {
          const mediaValue = record["media"];
          if (Array.isArray(mediaValue)) {
            for (const mediaItem of mediaValue) {
              if (typeof mediaItem === "string" && mediaItem.trim()) {
                imageUrl = mediaItem.trim();
                break;
              }
              if (mediaItem && typeof mediaItem === "object") {
                const mediaRecord = mediaItem as Record<string, unknown>;
                const nested = getFirstString(mediaRecord, ["url", "src", "image"]);
                if (nested) {
                  imageUrl = nested;
                  break;
                }
              }
            }
          }
        }
        return {
          id: pick(["id", "articleId", "url"]) ?? `news-${index}`,
          title: pick(["title", "headline", "name"]),
          url: pick(["url", "link", "article_url"]),
          summary: pick(["summary", "description", "excerpt"]),
          imageUrl,
          source: pick(["source", "publisher"]),
          publishedAt: pick(["publishedAt", "pubDate", "published"]),
        };
      });
      setNews(normalized);
    } catch (err) {
      setNewsError(err instanceof Error ? err.message : String(err));
    } finally {
      setNewsLoading(false);
    }
  }, []);
  const selectedNewsLeague = selectedDisplayLeague?.rawName ?? selectedLeagueName;

  useEffect(() => {
    if (!selectedNewsLeague) {
      setNews([]);
      setNewsError(null);
      return;
    }
    fetchLeagueNews(selectedNewsLeague);
  }, [selectedNewsLeague, fetchLeagueNews]);

  return (
    <div className="container py-8 space-y-12">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4 text-center"
      >
        <h1 className="text-4xl font-bold">Football Leagues</h1>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Explore fixtures, results, and live analysis from the world&apos;s top football leagues.
          Get detailed insights and win probabilities for every match.
        </p>
      </motion.div>

      {/* All Leagues + Search */}
      <section className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-2xl font-bold">Browse Leagues & Competitions</h2>
          <p className="text-muted-foreground">Use search or explore curated collections of the world&apos;s most followed leagues.</p>
        </div>
        <LeagueSearch
          leagues={displayLeagues}
          renderResultCard={(league, index) => (
            <LeagueCardItem
              key={`search-${league.identityKey}-${index}`}
              league={league}
              isSelected={getLeagueKey(league) === selectedLeagueKey}
              onSelect={handleLeagueSelect}
              onToggleFavorite={toggleFavoriteLeague}
              isFavorited={favLeagues.includes(league.rawName)}
              favoriteBusy={pendingFavorites.has(league.rawName)}
              variant="carousel"
            />
          )}
        />
        {displayLeagues.length === 0 ? (
          <div className="text-sm text-muted-foreground">Leagues will appear here once available.</div>
        ) : (
          <div className="space-y-8">
            {featuredSections.length > 0 && (
              <div className="space-y-8">
                {featuredSections.map(section => (
                  <FeaturedCategorySection
                    key={section.id}
                    section={section}
                    onSelect={handleLeagueSelect}
                    selectedLeagueKey={selectedLeagueKey}
                    favLeagues={favLeagues}
                    pendingFavorites={pendingFavorites}
                    onToggleFavorite={toggleFavoriteLeague}
                  />
                ))}
              </div>
            )}
            {remainingLeagues.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-xl font-semibold">All Other Leagues</h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleRemainingLeagues.map(league => (
                    <LeagueCardItem
                      key={league.identityKey}
                      league={league}
                      isSelected={getLeagueKey(league) === selectedLeagueKey}
                      onSelect={handleLeagueSelect}
                      onToggleFavorite={toggleFavoriteLeague}
                      isFavorited={favLeagues.includes(league.rawName)}
                      favoriteBusy={pendingFavorites.has(league.rawName)}
                    />
                  ))}
                </div>
                {(canShowMore || canShowLess) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {canShowMore && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRemainingVisibleCount(prev => Math.min(prev + INCREMENT_REMAINING_COUNT, remainingLeagues.length))}
                      >
                        Show more
                      </Button>
                    )}
                    {canShowLess && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemainingVisibleCount(INITIAL_REMAINING_COUNT)}
                      >
                        Show less
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {selectedNewsLeague && (
          <div className="space-y-6">
            <div>
              <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background via-background/80 to-primary/5 shadow-md">
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-y-6 -right-16 h-44 w-44 rounded-full bg-primary/10 blur-3xl"
                />
                <CardHeader className="relative space-y-2 pb-6">
                  <CardTitle className="text-2xl font-bold tracking-tight">
                    Latest News for {selectedDisplayLabel}
                  </CardTitle>
                  <CardDescription className="text-sm text-muted-foreground">
                    Breaking stories, match reactions, and transfer chatter curated for {selectedDisplayLabel}.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {newsLoading ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      {Array.from({ length: skeletonCount }).map((_, index) => (
                        <div
                          key={`league-news-skeleton-${index}`}
                          className="relative overflow-hidden rounded-xl border border-border/50 bg-card/60 p-4 shadow-sm"
                        >
                          <div className="flex animate-pulse flex-col gap-4 sm:flex-row">
                            <div className="h-24 w-full rounded-lg bg-muted sm:h-24 sm:w-32" />
                            <div className="flex-1 space-y-3">
                              <div className="h-4 w-3/4 rounded bg-muted/80" />
                              <div className="h-3 w-full rounded bg-muted/60" />
                              <div className="h-3 w-4/5 rounded bg-muted/60" />
                              <div className="flex gap-2 pt-2">
                                <div className="h-3 w-16 rounded-full bg-muted/50" />
                                <div className="h-3 w-24 rounded-full bg-muted/50" />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : newsError ? (
                    <div className="text-sm text-destructive">{newsError}</div>
                  ) : news.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No recent headlines available right now.</div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2">
                      {news.map((article) => {
                        const displayTitle = article.title || "Untitled headline";
                        const relativeTime = formatRelativeTime(article.publishedAt);

                        return (
                          <a
                            key={article.id}
                            href={article.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group relative block overflow-hidden rounded-xl border border-border/60 bg-background/80 p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/60 hover:bg-background hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                          >
                            <span
                              aria-hidden
                              className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-br from-primary/0 via-primary/5 to-primary/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                            />
                            <div className="flex flex-col gap-4 sm:flex-row">
                              {article.imageUrl ? (
                                <Image
                                  src={article.imageUrl}
                                  alt={displayTitle}
                                  width={128}
                                  height={96}
                                  className="h-24 w-full flex-shrink-0 rounded-lg object-cover shadow-sm sm:h-24 sm:w-32"
                                  onError={(event) => {
                                    (event.currentTarget as HTMLImageElement).style.display = "none";
                                  }}
                                />
                              ) : null}
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold uppercase tracking-wide text-primary/70">
                                  Latest headline
                                </div>
                                <div className="mt-1 text-base font-semibold leading-tight text-foreground transition-colors group-hover:text-primary">
                                  {displayTitle}
                                </div>
                                {article.summary ? (
                                  <p className="mt-2 text-sm text-muted-foreground line-clamp-3">{article.summary}</p>
                                ) : null}
                                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  {article.source ? (
                                    <span className="rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary/80">
                                      {article.source}
                                    </span>
                                  ) : null}
                                  {article.source && article.publishedAt ? (
                                    <span aria-hidden className="h-1 w-1 rounded-full bg-border" />
                                  ) : null}
                                  {article.publishedAt ? (
                                    <time
                                      dateTime={article.publishedAt}
                                      className="truncate"
                                      title={new Date(article.publishedAt).toLocaleString()}
                                    >
                                      {relativeTime ?? new Date(article.publishedAt).toLocaleDateString()}
                                    </time>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                            <span className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary/80 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                              Read full story
                              <svg
                                aria-hidden
                                className="h-3.5 w-3.5 translate-x-0 transition-transform duration-300 group-hover:translate-x-1"
                                viewBox="0 0 16 16"
                                fill="none"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  d="M4 12L12 4M12 4H6M12 4V10"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            </span>
                          </a>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}

      </section>
    </div>
  );
}
