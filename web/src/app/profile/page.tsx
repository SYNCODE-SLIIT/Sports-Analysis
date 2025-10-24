"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChangeEvent, KeyboardEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Bookmark,
  Camera,
  Clock,
  Heart,
  LineChart,
  Loader2,
  RefreshCcw,
  Settings,
  Share2,
  ThumbsUp,
  Trophy,
} from "lucide-react";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { useAuth } from "@/components/AuthProvider";
import { useRecommendations } from "@/hooks/useRecommendations";
import { toast } from "sonner";
import { searchLeagues, searchTeams } from "@/lib/collect";
import { isAdminEmail } from "@/lib/admin";
import { usePlanContext } from "@/components/PlanProvider";
import { ProfilePlanSummary } from "@/components/ProfilePlan";
import { UpgradeCta } from "@/components/pro/UpgradeCta";
import { ProfileBillingManager } from "@/components/ProfileBillingManager";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getSiteOrigin } from "@/lib/url";

type ProfileState = {
  full_name: string;
  avatar_url: string | null;
};

type Preferences = {
  favorite_teams: string[];
  favorite_leagues: string[];
  favorite_team_logos: Record<string, string>;
  favorite_league_logos: Record<string, string>;
};

const defaultPreferences: Preferences = {
  favorite_teams: [],
  favorite_leagues: [],
  favorite_team_logos: {},
  favorite_league_logos: {},
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

const AVATAR_BUCKET = process.env.NEXT_PUBLIC_SUPABASE_AVATAR_BUCKET ?? "avatars";

const sanitizeLogoUrl = (value: unknown): string | null => {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const lowered = trimmed.toLowerCase();
    if (["null", "undefined", "n/a", "none"].includes(lowered)) return null;
    if (trimmed.startsWith("data:image")) {
      return trimmed;
    }
    const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
    try {
      const url = new URL(normalized);
      if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:") {
        return url.toString();
      }
    } catch {
      return null;
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = sanitizeLogoUrl(entry);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const nestedKeys = [
      "logo",
      "badge",
      "url",
      "src",
      "image",
      "path",
      "thumbnail",
      "thumb",
      "light",
      "dark",
      "default",
    ];
    for (const key of nestedKeys) {
      if (record[key]) {
        const candidate = sanitizeLogoUrl(record[key]);
        if (candidate) return candidate;
      }
    }
  }
  return null;
};

const extractLogoFromEntry = (
  entry: Record<string, unknown> | null | undefined,
  keys: string[],
): string | null => {
  if (!entry || typeof entry !== "object") return null;
  for (const key of keys) {
    if (!(key in entry)) continue;
    const candidate = sanitizeLogoUrl((entry as Record<string, unknown>)[key]);
    if (candidate) return candidate;
  }
  return null;
};

const getTeamLogoFromEntry = (entry: Record<string, unknown> | null | undefined) =>
  extractLogoFromEntry(entry, TEAM_LOGO_KEYS);

const getLeagueLogoFromEntry = (entry: Record<string, unknown> | null | undefined) =>
  extractLogoFromEntry(entry, LEAGUE_LOGO_KEYS);

const sanitizeLogoMap = (map: Record<string, unknown>): Record<string, string> => {
  const result: Record<string, string> = {};
  Object.entries(map ?? {}).forEach(([name, raw]) => {
    const clean = sanitizeLogoUrl(raw);
    if (clean) {
      result[name] = clean;
    }
  });
  return result;
};

const normalizeKey = (value: unknown): string =>
  String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const resolveLogoFromMap = (name: string, map: Record<string, string>): string | undefined => {
  if (!name) return undefined;
  if (map[name]) return map[name];
  const target = normalizeKey(name);
  if (!target) return undefined;
  for (const [candidateName, url] of Object.entries(map)) {
    if (normalizeKey(candidateName) === target) {
      return url;
    }
  }
  return undefined;
};
    const pickString = (entry: Record<string, unknown> | null | undefined, keys: string[]): string | null => {
      if (!entry) return null;
      for (const key of keys) {
        const value = entry[key];
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) return trimmed;
        }
      }
      return null;
    };


const initialsFromName = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "U";
  const parts = trimmed.split(/\s+/).slice(0, 2);
  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "U";
};

const filterLogosForNames = (names: string[], map: Record<string, string>) => {
  const next: Record<string, string> = {};
  names.forEach((name) => {
    const logo = resolveLogoFromMap(name, map);
    if (logo) {
      next[name] = logo;
    }
  });
  return next;
};

type LogoMap = Record<string, string>;

const mergeLogoMaps = (base: LogoMap, updates: LogoMap): LogoMap | null => {
  let changed = false;
  const next: LogoMap = { ...base };
  Object.entries(updates).forEach(([key, value]) => {
    const clean = sanitizeLogoUrl(value);
    if (!clean) return;
    if (next[key] === clean) return;
    next[key] = clean;
    changed = true;
  });
  return changed ? next : null;
};

const RECOMMENDATION_LIMIT = 4;

type AnyRecord = Record<string, unknown>;

type RecommendationLinkInfo = {
  kind: "match" | "league" | "other";
  relative: string;
  absolute: string;
  title?: string;
  subtitle?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MATCH_ID_KEYS = ["event_id", "eventId", "fixture_id", "fixtureId", "match_id", "matchId", "game_id", "gameId", "id"];
const MATCH_HOME_KEYS = ["home_team", "homeTeam", "event_home_team", "home"];
const MATCH_AWAY_KEYS = ["away_team", "awayTeam", "event_away_team", "away"];

const LEAGUE_ID_KEYS = ["provider_id", "providerId", "league_id", "leagueId", "id", "league_key"];
const LEAGUE_SLUG_KEYS = ["slug", "slug_id", "slugId", "league_slug"];
const LEAGUE_NAME_KEYS = ["title", "league_name", "name"];
const LEAGUE_COUNTRY_KEYS = ["country", "country_name", "nation"];
const LEAGUE_IDENTITY_KEYS = ["identity_key", "identityKey"];

const isRecord = (value: unknown): value is AnyRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const coerceString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
};

const getValueCaseInsensitive = (record: AnyRecord, key: string): unknown => {
  if (key in record) return record[key];
  const lower = key.toLowerCase();
  const matchKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === lower);
  return matchKey ? record[matchKey] : undefined;
};

const collectRecords = (value: unknown, maxDepth = 2): AnyRecord[] => {
  const records: AnyRecord[] = [];
  const seen = new Set<object>();

  const visit = (candidate: unknown, depth: number) => {
    if (!candidate || depth > maxDepth) return;
    if (Array.isArray(candidate)) {
      candidate.forEach((entry) => visit(entry, depth + 1));
      return;
    }
    if (!isRecord(candidate)) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    records.push(candidate);
    Object.values(candidate).forEach((entry) => visit(entry, depth + 1));
  };

  visit(value, 0);
  return records;
};

type PickStringOptions = {
  skipUuid?: boolean;
};

const pickStringFromRecords = (records: AnyRecord[], keys: string[], options: PickStringOptions = {}): string | undefined => {
  for (const record of records) {
    for (const key of keys) {
      const raw = getValueCaseInsensitive(record, key);
      const str = coerceString(raw);
      if (!str) continue;
      if (options.skipUuid && key.toLowerCase() === "id" && UUID_PATTERN.test(str)) continue;
      if (key.toLowerCase() === "key" && str.includes("|") && options.skipUuid) continue;
      return str;
    }
  }
  return undefined;
};

const createIdentityKey = (providerId?: string, leagueName?: string, country?: string): string => {
  const idPart = providerId ? providerId.trim().toLowerCase() : "";
  const namePart = leagueName ? leagueName.trim().toLowerCase() : "";
  const countryPart = country ? country.trim().toLowerCase() : "";
  return [idPart, namePart, countryPart].join("|");
};

const gatherRecordsForItem = (item: AnyRecord | undefined): AnyRecord[] => {
  if (!item) return [];
  const records: AnyRecord[] = [];
  const dataRecords = collectRecords(item.data, 2);
  dataRecords.forEach((record) => {
    if (!records.includes(record)) records.push(record);
  });
  const metadataRecords = collectRecords(item.metadata, 2);
  metadataRecords.forEach((record) => {
    if (!records.includes(record)) records.push(record);
  });
  const detailsRecords = collectRecords(item.details, 2);
  detailsRecords.forEach((record) => {
    if (!records.includes(record)) records.push(record);
  });
  if (!records.includes(item)) records.push(item);
  return records;
};

const extractMatchLink = (item: AnyRecord, records: AnyRecord[], origin: string): RecommendationLinkInfo | null => {
  const eventId = pickStringFromRecords(records, MATCH_ID_KEYS, { skipUuid: true });
  if (!eventId) return null;

  let homeTeam = pickStringFromRecords(records, MATCH_HOME_KEYS);
  let awayTeam = pickStringFromRecords(records, MATCH_AWAY_KEYS);

  if ((!homeTeam || !awayTeam) && Array.isArray(item.teams) && item.teams.length >= 2) {
    const [home, away] = item.teams as unknown[];
    homeTeam = homeTeam ?? coerceString(home);
    awayTeam = awayTeam ?? coerceString(away);
  }

  const titleFromItem = coerceString(item.title);
  const title =
    titleFromItem ??
    (homeTeam && awayTeam ? `${homeTeam} vs ${awayTeam}` : homeTeam ?? awayTeam ?? undefined);

  const relative = `/match/${encodeURIComponent(eventId)}?sid=card`;
  return {
    kind: "match",
    relative,
    absolute: `${origin}${relative}`,
    title,
  };
};

const extractLeagueLink = (item: AnyRecord, records: AnyRecord[], origin: string): RecommendationLinkInfo | null => {
  let leagueName = coerceString(item.title) ?? pickStringFromRecords(records, LEAGUE_NAME_KEYS);
  if (!leagueName && Array.isArray(item.leagues) && item.leagues.length) {
    leagueName = coerceString(item.leagues[0]);
  }

  let country = pickStringFromRecords(records, LEAGUE_COUNTRY_KEYS);
  if (!country && Array.isArray(item.countries) && item.countries.length) {
    country = coerceString(item.countries[0]);
  }

  const rawProvider = pickStringFromRecords(records, LEAGUE_ID_KEYS, { skipUuid: true });
  const providerId =
    rawProvider && rawProvider.includes("|") ? undefined : rawProvider ? rawProvider.trim() : undefined;

  const slugCandidate = pickStringFromRecords(records, LEAGUE_SLUG_KEYS);
  const slugSource =
    slugCandidate && slugCandidate.trim()
      ? slugCandidate.trim()
      : providerId && providerId.trim()
        ? providerId.trim()
        : leagueName
          ? [leagueName, country].filter(Boolean).join("::")
          : undefined;

  if (!slugSource) return null;

  const params = new URLSearchParams();
  if (leagueName) params.set("name", leagueName);
  if (country) params.set("country", country);

  const identityCandidate = pickStringFromRecords(records, LEAGUE_IDENTITY_KEYS);
  const identityKey = identityCandidate ?? createIdentityKey(providerId, leagueName, country);
  if (identityKey && identityKey.replace(/\|/g, "").trim()) {
    params.set("key", identityKey);
  }
  if (providerId) {
    params.set("providerId", providerId);
  }

  const query = params.toString();
  const relative = `/leagues/${encodeURIComponent(slugSource)}${query ? `?${query}` : ""}`;

  return {
    kind: "league",
    relative,
    absolute: `${origin}${relative}`,
    title: leagueName ?? undefined,
    subtitle: country ?? undefined,
  };
};

const buildRecommendationLink = (item: AnyRecord | undefined, origin: string): RecommendationLinkInfo | null => {
  if (!item) return null;
  const records = gatherRecordsForItem(item);
  const matchLink = extractMatchLink(item, records, origin);
  if (matchLink) return matchLink;
  const leagueLink = extractLeagueLink(item, records, origin);
  if (leagueLink) return leagueLink;
  return null;
};

type ItemDetails = {
  title?: string | null;
  data?: Record<string, unknown> | null;
  teams?: string[] | null;
  leagues?: string[] | null;
  kind?: string | null;
};

type RecentView = {
  itemId: string;
  event: string | null;
  viewedAt: string;
  title: string;
  eventId: string | null;
  teams: string[];
  leagues: string[];
  primaryLeague: string | null;
  kind: string | null;
};

type InteractionEvent = {
  event: string;
  created_at: string;
};

// Navigator with optional Web Share API
type NavigatorWithShare = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<unknown>;
};

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });

export default function ProfilePage() {
  const { user, supabase, loading, prefsVersion, interactionsVersion } = useAuth();
  const { plan, planInfo, refreshPlan } = usePlanContext();
  const recs = useRecommendations();
  const refetchRecommendations = recs.refetch;
  const router = useRouter();
  const isAdmin = useMemo(() => isAdminEmail(user?.email ?? undefined), [user]);

  const [profile, setProfile] = useState<ProfileState>({ full_name: "", avatar_url: null });
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedMatchesCount, setSavedMatchesCount] = useState<number | null>(null);
  const [sendingFeedbackId, setSendingFeedbackId] = useState<string | null>(null);
  const [localLiked, setLocalLiked] = useState<Record<string, boolean>>({});
  const [localSaved, setLocalSaved] = useState<Record<string, boolean>>({});
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [recentViews, setRecentViews] = useState<RecentView[]>([]);
  const [recentViewsLoading, setRecentViewsLoading] = useState(false);
  const [interactionLog, setInteractionLog] = useState<InteractionEvent[]>([]);
  const [showBillingManager, setShowBillingManager] = useState(false);
  const [billingDialogError, setBillingDialogError] = useState<string | null>(null);
  const [cancelSubscriptionLoading, setCancelSubscriptionLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasPrefs = preferences.favorite_teams.length > 0 || preferences.favorite_leagues.length > 0;
  const [stripeConfig, setStripeConfig] = useState({
    loaded: false,
    monthlyPriceId: "",
    configured: false,
  });

  const handleViewPlans = useCallback(() => {
    router.push("/pro");
  }, [router]);

  const handleManageBilling = useCallback(() => {
    setBillingDialogError(null);
    setCancelSubscriptionLoading(false);
    setShowBillingManager(true);
  }, []);

  const handleCloseBillingManager = useCallback(() => {
    setShowBillingManager(false);
    setBillingDialogError(null);
    setCancelSubscriptionLoading(false);
  }, []);

  const handleCancelSubscription = useCallback(async () => {
    setBillingDialogError(null);
    setCancelSubscriptionLoading(true);
    try {
      const response = await fetch("/api/stripe/cancel-subscription", { method: "POST" });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        const loginUrl = typeof data?.loginUrl === "string" ? data.loginUrl : "/auth/login?next=/profile";
        window.location.href = loginUrl;
        return false;
      }

      if (!response.ok) {
        const errorMessage = typeof data?.error === "string" ? data.error : "Unable to cancel subscription.";
        setBillingDialogError(errorMessage);
        toast.error(errorMessage);
        setCancelSubscriptionLoading(false);
        return false;
      }

      await refreshPlan?.();
      setCancelSubscriptionLoading(false);
      toast.success("Subscription cancelled. You are back on the Free plan.");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setBillingDialogError(message);
      toast.error(message);
      setCancelSubscriptionLoading(false);
      return false;
    }
  }, [refreshPlan]);

  useEffect(() => {
    if (plan !== "pro") {
      setShowBillingManager(false);
      setBillingDialogError(null);
      setCancelSubscriptionLoading(false);
    }
  }, [plan]);

  useEffect(() => {
    let active = true;

    const loadStripeConfig = async () => {
      try {
        const res = await fetch("/api/config/stripe", { cache: "no-store" });
        if (!res.ok) {
          throw new Error("Failed to load Stripe info");
        }
        const data = await res.json();
        if (!active) return;
        setStripeConfig({
          loaded: true,
          monthlyPriceId: data?.monthlyPriceId ?? "",
          configured: Boolean((data?.configured ?? false) && data?.monthlyPriceId),
        });
      } catch (error) {
        console.error("Unable to load Stripe configuration", error);
        if (!active) return;
        setStripeConfig((prev) => ({ ...prev, loaded: true }));
      }
    };

    loadStripeConfig();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loading && user && isAdmin) {
      router.replace("/admin/overview");
    }
  }, [isAdmin, loading, router, user]);

  useEffect(() => {
    if (!user || isAdmin) return;
    let mounted = true;
    (async () => {
      try {
        const [{ data: profileRow }, { data: preferencesRow }] = await Promise.all([
          supabase
            .from("profiles")
            .select("full_name, avatar_url")
            .eq("id", user.id)
            .single(),
          supabase
            .from("user_preferences")
            .select("favorite_teams, favorite_leagues, favorite_team_logos, favorite_league_logos")
            .eq("user_id", user.id)
            .single(),
        ]);

        if (!mounted) return;

        const nextProfile: ProfileState = {
          full_name: (profileRow?.full_name ?? user.user_metadata?.full_name ?? user.email ?? "").trim(),
          avatar_url:
            sanitizeLogoUrl(profileRow?.avatar_url) ??
            sanitizeLogoUrl(user.user_metadata?.avatar_url) ??
            sanitizeLogoUrl(user.user_metadata?.picture) ??
            null,
        };

        const nextPreferences: Preferences = {
          favorite_teams: Array.isArray(preferencesRow?.favorite_teams)
            ? preferencesRow.favorite_teams.filter(Boolean)
            : [],
          favorite_leagues: Array.isArray(preferencesRow?.favorite_leagues)
            ? preferencesRow.favorite_leagues.filter(Boolean)
            : [],
          favorite_team_logos: sanitizeLogoMap(preferencesRow?.favorite_team_logos ?? {}),
          favorite_league_logos: sanitizeLogoMap(preferencesRow?.favorite_league_logos ?? {}),
        };

        setProfile(nextProfile);
        setPreferences(nextPreferences);

        try {
          const { count, error } = await supabase
            .from("user_interactions")
            .select("item_id", { count: "exact", head: false })
            .eq("user_id", user.id)
            .eq("event", "save");
          if (mounted) {
            setSavedMatchesCount(!error && typeof count === "number" ? count : 0);
          }
        } catch {
          if (mounted) setSavedMatchesCount(0);
        }

        try {
          const { data: interactions } = await supabase
            .from("user_interactions")
            .select("item_id, event, created_at")
            .eq("user_id", user.id);
          if (!mounted) return;
          const liked: Record<string, boolean> = {};
          const saved: Record<string, boolean> = {};
          const timeline: InteractionEvent[] = [];
          (interactions ?? []).forEach((entry) => {
              if (!entry) return;
              const row = entry as Record<string, unknown>;
              const id = String(row.item_id ?? "");
            if (!id) return;
            if (entry.event === "like") liked[id] = true;
            if (entry.event === "save") saved[id] = true;
            if (typeof entry.created_at === "string" && typeof entry.event === "string") {
              timeline.push({ event: entry.event, created_at: entry.created_at });
            }
          });
          setLocalLiked(liked);
          setLocalSaved(saved);
          setInteractionLog(
            timeline.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
          );
        } catch {
          if (!mounted) return;
          setLocalLiked({});
          setLocalSaved({});
          setInteractionLog([]);
        }
      } catch (error) {
        if (!mounted) return;
        console.error("Failed to load profile", error);
        setProfile({
          full_name: (user.user_metadata?.full_name ?? user.email ?? "").trim(),
          avatar_url:
            sanitizeLogoUrl(user.user_metadata?.avatar_url) ??
            sanitizeLogoUrl(user.user_metadata?.picture) ??
            null,
        });
        setPreferences(defaultPreferences);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [isAdmin, supabase, user, prefsVersion]);

  useEffect(() => {
    if (!user || isAdmin || !refetchRecommendations) return;
    try {
      refetchRecommendations();
    } catch {
      /* ignore */
    }
  }, [isAdmin, prefsVersion, refetchRecommendations, user]);

  const resolveLogos = useCallback(
    async (kind: "team" | "league", names: string[], existing: Record<string, string>) => {
      if (isAdmin) return {} as Record<string, string>;
      if (!supabase || !names.length) return {} as Record<string, string>;
      const lookup = new Map<string, string>();
      const pending: string[] = [];
      names.forEach((name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const key = normalizeKey(trimmed);
        if (!key || lookup.has(key)) return;
        lookup.set(key, trimmed);
        const already = resolveLogoFromMap(trimmed, existing);
        if (!already) pending.push(trimmed);
      });

      if (!pending.length) return {} as Record<string, string>;

      const results: Record<string, string> = {};
      const table = kind === "team" ? "cached_teams" : "cached_leagues";

      try {
        const { data: cached } = await supabase.from(table).select("name, logo").in("name", pending as unknown[]);
        (cached ?? []).forEach((row) => {
          if (!row) return;
          const r = row as Record<string, unknown>;
          const candidateName = typeof r.name === "string" ? r.name : "";
          const display = lookup.get(normalizeKey(candidateName));
          const clean = sanitizeLogoUrl(r.logo);
          if (display && clean) {
            results[display] = clean;
          }
        });
      } catch {
        /* ignore */
      }

      const stillMissing = pending.filter((name) => !results[name]);
      for (const name of stillMissing) {
        try {
          if (kind === "team") {
            const res = await searchTeams(name);
            const entry = (res?.data?.teams ?? [])[0] as Record<string, unknown> | undefined;
            const logo = sanitizeLogoUrl(getTeamLogoFromEntry(entry));
            if (logo) {
              results[name] = logo;
              try {
                await supabase.rpc("upsert_cached_team", {
                  p_provider_id: null,
                  p_name: name,
                  p_logo: logo,
                  p_metadata: {},
                });
              } catch {
                /* ignore */
              }
            }
          } else {
            const res = await searchLeagues(name);
            const entry = (res?.data?.leagues ?? [])[0] as Record<string, unknown> | undefined;
            const logo = sanitizeLogoUrl(getLeagueLogoFromEntry(entry));
            if (logo) {
              results[name] = logo;
              try {
                await supabase.rpc("upsert_cached_league", {
                  p_provider_id: null,
                  p_name: name,
                  p_logo: logo,
                  p_metadata: {},
                });
              } catch {
                /* ignore */
              }
            }
          }
        } catch {
          /* ignore */
        }
      }

      return results;
    },
    [isAdmin, supabase],
  );

  useEffect(() => {
    if (!user || isAdmin) return;
    if (!preferences.favorite_teams.length) return;
    void (async () => {
      const resolved = await resolveLogos("team", preferences.favorite_teams, preferences.favorite_team_logos);
      if (Object.keys(resolved).length) {
        setPreferences((prev) => {
          const merged = mergeLogoMaps(prev.favorite_team_logos, resolved);
          if (!merged) return prev;
          return {
            ...prev,
            favorite_team_logos: merged,
          };
        });
      }
    })();
  }, [isAdmin, preferences.favorite_team_logos, preferences.favorite_teams, resolveLogos, user]);

  useEffect(() => {
    if (!user || isAdmin) return;
    if (!preferences.favorite_leagues.length) return;
    void (async () => {
      const resolved = await resolveLogos("league", preferences.favorite_leagues, preferences.favorite_league_logos);
      if (Object.keys(resolved).length) {
        setPreferences((prev) => {
          const merged = mergeLogoMaps(prev.favorite_league_logos, resolved);
          if (!merged) return prev;
          return {
            ...prev,
            favorite_league_logos: merged,
          };
        });
      }
    })();
  }, [isAdmin, preferences.favorite_league_logos, preferences.favorite_leagues, resolveLogos, user]);

  const handleAvatarUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      if (!user || isAdmin) return;
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        toast.error("Please choose an image smaller than 5MB.");
        event.target.value = "";
        return;
      }
      setUploadingAvatar(true);
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const extension = file.name.split(".").pop() || "png";
        const safeId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const objectPath = `${user.id}/${safeId}.${extension}`;
        let publicUrl: string | null = null;

        try {
          const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(objectPath, file, {
            cacheControl: "3600",
            upsert: true,
          });
          if (uploadError) throw uploadError;
          const { data: publicData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);
          publicUrl = sanitizeLogoUrl(publicData?.publicUrl) ?? null;
          if (!publicUrl) throw new Error("Failed to resolve uploaded image URL");
        } catch (uploadError) {
          const message = uploadError instanceof Error ? uploadError.message : String(uploadError ?? "");
          if (message.toLowerCase().includes("bucket") && message.toLowerCase().includes("not found")) {
            publicUrl = dataUrl;
            toast.info(
              `Using inline avatar image because the '${AVATAR_BUCKET}' storage bucket was not found. ` +
                "Create the bucket in Supabase Storage for CDN hosting.",
            );
          } else {
            throw uploadError;
          }
        }

        if (!publicUrl) throw new Error("Unable to derive avatar image URL");
        setProfile((prev) => ({ ...prev, avatar_url: publicUrl }));
        await supabase.from("profiles").upsert({
          id: user.id,
          full_name: (profile.full_name || user.email || "").trim(),
          avatar_url: publicUrl,
        });
        toast.success("Profile image updated");
      } catch (error) {
        console.error("Avatar upload failed", error);
        toast.error("Unable to update profile image right now");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
        setUploadingAvatar(false);
      }
    },
    [isAdmin, profile.full_name, supabase, user],
  );

  const handleSave = useCallback(async () => {
    if (!user || isAdmin) return;
    setSaving(true);
    try {
      const trimmedTeams = preferences.favorite_teams.map((name) => name.trim()).filter(Boolean);
      const trimmedLeagues = preferences.favorite_leagues.map((name) => name.trim()).filter(Boolean);
      const teamLogos = filterLogosForNames(trimmedTeams, preferences.favorite_team_logos);
      const leagueLogos = filterLogosForNames(trimmedLeagues, preferences.favorite_league_logos);
      const trimmedName = (profile.full_name || user.email || "").trim();

      await supabase.from("profiles").upsert({
        id: user.id,
        full_name: trimmedName,
        avatar_url: profile.avatar_url,
      });

      await supabase.from("user_preferences").upsert({
        user_id: user.id,
        favorite_teams: trimmedTeams,
        favorite_leagues: trimmedLeagues,
        favorite_team_logos: teamLogos,
        favorite_league_logos: leagueLogos,
      });

      setProfile((prev) => ({ ...prev, full_name: trimmedName }));
      setPreferences((prev) => ({
        ...prev,
        favorite_teams: trimmedTeams,
        favorite_leagues: trimmedLeagues,
        favorite_team_logos: teamLogos,
        favorite_league_logos: leagueLogos,
      }));

      toast.success("Profile saved");
      setEditing(false);
      setShowAllRecommendations(false);
      recs.refetch?.();
    } catch (error) {
      console.error("Failed to save profile", error);
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  }, [isAdmin, preferences, profile.avatar_url, profile.full_name, recs, supabase, user]);

  const sendInteraction = useCallback(
    async (itemId: string, event: "like" | "save" | "dismiss" | "click" | "view" | "share") => {
      if (!user || isAdmin) return;
      setSendingFeedbackId(itemId);
      try {
        await supabase.from("user_interactions").insert({ user_id: user.id, item_id: itemId, event });
        if (event === "dismiss" || event === "like" || event === "save") {
          setTimeout(() => {
            recs.refetch?.();
          }, 200);
        }
      } finally {
        setSendingFeedbackId(null);
      }
    },
    [isAdmin, recs, supabase, user],
  );

  const toggleLocalLike = useCallback(
    (itemId: string) => {
      const willLike = !localLiked[itemId];
      setLocalLiked((prev) => ({ ...prev, [itemId]: willLike }));
      void sendInteraction(itemId, willLike ? "like" : "view");
    },
    [localLiked, sendInteraction],
  );

  const toggleLocalSave = useCallback(
    (itemId: string) => {
      const willSave = !localSaved[itemId];
      setLocalSaved((prev) => ({ ...prev, [itemId]: willSave }));
      if (willSave) {
        void sendInteraction(itemId, "save");
      } else {
        void (async () => {
          try {
            await supabase.from("user_interactions").delete().match({ user_id: user?.id, item_id: itemId, event: "save" });
          } catch {
            /* ignore */
          }
        })();
      }
    },
    [localSaved, sendInteraction, supabase, user?.id],
  );

  useEffect(() => {
    if (!user) {
      setRecentViews([]);
      return;
    }
    let active = true;
    setRecentViewsLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("user_interactions")
          .select("item_id, event, created_at, items:items(title, kind, data, teams, leagues)")
          .eq("user_id", user.id)
          .in("event", ["view", "click"])
          .order("created_at", { ascending: false })
          .limit(12);
        if (error) throw error;
        if (!active) return;
        const seen = new Set<string>();
        const mapped: RecentView[] = [];
        (data ?? []).forEach((row) => {
          if (!row) return;
          const r = row as Record<string, unknown>;
          const itemId = typeof r.item_id === "string" ? r.item_id : String(r.item_id ?? "").trim();
          if (!itemId || seen.has(itemId)) return;
          seen.add(itemId);
          const details = (row.items ?? null) as ItemDetails | null;
          const rawData = (details?.data as Record<string, unknown> | null) ?? null;
          const eventIdValue = rawData?.event_id;
          const eventId =
            typeof eventIdValue === "string"
              ? eventIdValue
              : typeof eventIdValue === "number"
                ? String(eventIdValue)
                : null;
          const teams = Array.isArray(details?.teams)
            ? (details?.teams as unknown[]).map((team) => String(team ?? "").trim()).filter(Boolean)
            : [];
          const leagues = Array.isArray(details?.leagues)
            ? (details?.leagues as unknown[]).map((league) => String(league ?? "").trim()).filter(Boolean)
            : [];
          const detailKind = typeof details?.kind === "string" ? details.kind : null;
          const rawKind = rawData && typeof rawData["kind"] === "string" ? (rawData["kind"] as string) : null;
          const kind = detailKind ?? rawKind ?? null;
          const leagueFromData = pickString(rawData, [
            "league",
            "league_name",
            "leagueName",
            "competition",
            "competition_name",
            "competitionName",
            "league_display_name",
            "leagueDisplayName",
          ]);
          const primaryLeagueCandidate = leagueFromData || leagues[0] || (kind === "league" && typeof details?.title === "string" ? details.title.trim() : "");
          const primaryLeague = primaryLeagueCandidate ? primaryLeagueCandidate : null;
          const titleCandidate = typeof details?.title === "string" ? details?.title.trim() : "";
          const title = titleCandidate || (teams.length ? teams.join(" vs ") : "Match insight");
          mapped.push({
            itemId,
            event: typeof row.event === "string" ? row.event : null,
            viewedAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
            title,
            eventId,
            teams,
            leagues,
            primaryLeague,
            kind,
          });
        });
        if (!active) return;
        setRecentViews(mapped.slice(0, 6));
      } catch (error) {
        console.error("Failed to load recent views", error);
        if (active) setRecentViews([]);
      } finally {
        if (active) setRecentViewsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [supabase, user, interactionsVersion]);

  const shareRecommendation = useCallback(
    async (itemId: string, item: Record<string, unknown> | undefined) => {
      const origin = getSiteOrigin();
      const itemRecord = isRecord(item) ? item : undefined;
      const linkInfo = buildRecommendationLink(itemRecord, origin);
      const absoluteUrl = linkInfo?.absolute ?? `${origin}/`;
      const fallbackTitle = coerceString(itemRecord?.title) ?? linkInfo?.title ?? "Sports Analysis";
      const shareText =
        linkInfo?.kind === "match"
          ? `Check out ${fallbackTitle} on Sports Analysis`
          : linkInfo?.kind === "league"
            ? `Follow ${fallbackTitle} on Sports Analysis`
            : "Check this out on Sports Analysis";

      try {
        const nav = (typeof navigator !== "undefined" ? (navigator as Navigator) : undefined) as NavigatorWithShare | undefined;
        if (nav?.share) {
          try {
            await nav.share({ title: fallbackTitle, text: shareText, url: absoluteUrl });
            await sendInteraction(itemId, "share");
            toast.success("Shared");
            return;
          } catch (error) {
            const err = error as { name?: string };
            if (err?.name === "AbortError") return;
          }
        }
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(absoluteUrl);
          await sendInteraction(itemId, "share");
          toast.success("Link copied to clipboard");
          return;
        }
        toast.error("Sharing is not supported on this device yet.");
      } catch {
        toast.error("Unable to share this pick right now");
      }
    },
    [sendInteraction],
  );

  const openRecommendation = useCallback(
    (itemId: string, item: Record<string, unknown> | undefined) => {
      const itemRecord = isRecord(item) ? item : undefined;
      const linkInfo = buildRecommendationLink(itemRecord, getSiteOrigin());
      if (!linkInfo) return;

      if (user && !isAdmin && supabase) {
        void (async () => {
          try {
            await supabase.from("user_interactions").insert({ user_id: user.id, item_id: itemId, event: "click" });
          } catch {
            /* ignore logging errors */
          }
        })();
      }

      router.push(linkInfo.relative);
    },
    [isAdmin, router, supabase, user],
  );

  const handleRecommendationKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, itemId: string, item: Record<string, unknown> | undefined) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openRecommendation(itemId, item);
      }
    },
    [openRecommendation],
  );

  const memberSince = useMemo(() => {
    if (!user?.created_at) return new Date().toLocaleDateString();
    try {
      return new Date(user.created_at).toLocaleDateString();
    } catch {
      return new Date().toLocaleDateString();
    }
  }, [user?.created_at]);

  const avatarUrl = useMemo(() => {
    const meta = user?.user_metadata ?? {};
    return profile.avatar_url ?? sanitizeLogoUrl(meta.avatar_url) ?? sanitizeLogoUrl(meta.picture) ?? null;
  }, [profile.avatar_url, user?.user_metadata]);

  const displayName = useMemo(() => {
    if (profile.full_name.trim()) return profile.full_name.trim();
    if (typeof user?.user_metadata?.full_name === "string" && user.user_metadata.full_name.trim()) {
      return user.user_metadata.full_name.trim();
    }
    return user?.email ?? "Your profile";
  }, [profile.full_name, user?.email, user?.user_metadata?.full_name]);

  const recommendationCount = recs.data?.items?.length ?? 0;

  useEffect(() => {
    setShowAllRecommendations(false);
  }, [recommendationCount]);

  const sortedRecommendations = useMemo(() => {
    const items = recs.data?.items ?? [];
    return [...items].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [recs.data?.items]);

  const displayedRecommendations = useMemo(() => {
    if (showAllRecommendations) return sortedRecommendations;
    return sortedRecommendations.slice(0, RECOMMENDATION_LIMIT);
  }, [showAllRecommendations, sortedRecommendations]);

  const hiddenCount = sortedRecommendations.length - displayedRecommendations.length;

  const likedCount = useMemo(() => Object.values(localLiked).filter(Boolean).length, [localLiked]);
  const savedPickCount = useMemo(() => Object.values(localSaved).filter(Boolean).length, [localSaved]);

  const engagementWindow = useMemo(() => {
    const clampKey = (date: Date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    const normalizeDate = (value: string) => {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      parsed.setHours(0, 0, 0, 0);
      return parsed;
    };

    const windowSize = 7;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const points = Array.from({ length: windowSize }, (_, index) => {
      const day = new Date(today);
      day.setDate(today.getDate() - (windowSize - 1 - index));
      return {
        key: clampKey(day),
        date: day,
        label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        likes: 0,
        saves: 0,
        views: 0,
        total: 0,
      };
    });

    const pointMap = new Map(points.map((point) => [point.key, point]));

    interactionLog.forEach(({ event, created_at }) => {
      const normalized = normalizeDate(created_at);
      if (!normalized) return;
      const point = pointMap.get(clampKey(normalized));
      if (!point) return;
      if (event === "like") point.likes += 1;
      if (event === "save") point.saves += 1;
      if (event !== "like" && event !== "save") point.total += 1;
    });

    recentViews.forEach(({ viewedAt }) => {
      const normalized = normalizeDate(viewedAt);
      if (!normalized) return;
      const point = pointMap.get(clampKey(normalized));
      if (!point) return;
      point.views += 1;
    });

    let maxVolume = 0;
    let likesSum = 0;
    let savesSum = 0;
    let viewsSum = 0;
    points.forEach((point) => {
      likesSum += point.likes;
      savesSum += point.saves;
      viewsSum += point.views;
      point.total += point.likes + point.saves + point.views;
      if (point.total > maxVolume) maxVolume = point.total;
    });

    return {
      points,
      maxVolume,
      hasData: maxVolume > 0,
      totals: {
        likes: likesSum,
        saves: savesSum,
        views: viewsSum,
      },
    };
  }, [interactionLog, recentViews]);

  const sparkline = useMemo(() => {
    const { points, maxVolume } = engagementWindow;
    if (!points.length) {
      return { areaPath: "", linePoints: "", coordinates: [] as { x: number; y: number; value: number }[] };
    }

    const effectiveMax = maxVolume || 1;
    const baseCoords = points.map((point, index) => {
      const ratio = points.length === 1 ? 0.5 : index / (points.length - 1);
      const x = Number((ratio * 100).toFixed(2));
      const y = Number((100 - (point.total / effectiveMax) * 100).toFixed(2));
      return { x, y, value: point.total };
    });

    const coordinates = baseCoords.length === 1
      ? [
          { x: 0, y: baseCoords[0].y, value: baseCoords[0].value },
          { x: 100, y: baseCoords[0].y, value: baseCoords[0].value },
        ]
      : baseCoords;

    let areaPath = "M 0 100 ";
    coordinates.forEach((coord) => {
      areaPath += `L ${coord.x} ${coord.y} `;
    });
    areaPath += "L 100 100 Z";

    const linePoints = coordinates.map((coord) => `${coord.x},${coord.y}`).join(" ");

    return { areaPath: areaPath.trim(), linePoints, coordinates };
  }, [engagementWindow]);

  const likeEvents = engagementWindow.totals.likes;
  const saveEvents = engagementWindow.totals.saves;
  const viewWindowCount = engagementWindow.totals.views;
  const totalTouchpoints = likeEvents + saveEvents + viewWindowCount;

  const activeDays = useMemo(
    () => engagementWindow.points.filter((point) => point.total > 0).length,
    [engagementWindow],
  );

  const lastActivityIso = useMemo(() => {
    let latest = 0;
    let iso = "";

    interactionLog.forEach(({ created_at }) => {
      const timestamp = Date.parse(created_at);
      if (Number.isNaN(timestamp)) return;
      if (timestamp > latest) {
        latest = timestamp;
        iso = created_at;
      }
    });

    recentViews.forEach(({ viewedAt }) => {
      const timestamp = Date.parse(viewedAt);
      if (Number.isNaN(timestamp)) return;
      if (timestamp > latest) {
        latest = timestamp;
        iso = viewedAt;
      }
    });

    return iso;
  }, [interactionLog, recentViews]);

  const formatRelativeTime = useCallback((iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (!Number.isFinite(diffSeconds)) return "";
    if (diffSeconds < 60) return "just now";
    if (diffSeconds < 3600) {
      const minutes = Math.max(1, Math.floor(diffSeconds / 60));
      return `${minutes} min${minutes === 1 ? "" : "s"} ago`;
    }
    if (diffSeconds < 86400) {
      const hours = Math.max(1, Math.floor(diffSeconds / 3600));
      return `${hours} hr${hours === 1 ? "" : "s"} ago`;
    }
    if (diffSeconds < 604800) {
      const days = Math.max(1, Math.floor(diffSeconds / 86400));
      return `${days} day${days === 1 ? "" : "s"} ago`;
    }
    return date.toLocaleDateString();
  }, []);

  const lastActiveDisplay = useMemo(() => {
    if (!lastActivityIso) return "No activity yet";
    const label = formatRelativeTime(lastActivityIso);
    return label || "Just now";
  }, [formatRelativeTime, lastActivityIso]);

  if (loading) {
    return <div className="container py-16 min-h-[60vh] flex items-center justify-center">Loading…</div>;
  }

  if (!loading && user && isAdmin) {
    return <div className="container py-16 min-h-[60vh] flex items-center justify-center">Redirecting to admin dashboard…</div>;
  }

  if (!user) {
    return (
      <div className="container py-16">
        <EmptyState
          type="no-teams"
          title="Login Required"
          description="Please login to view your profile and track your predictions"
          actionLabel="Go to Login"
          onAction={() => (window.location.href = "/auth/login")}
        />
      </div>
    );
  }

  return (
    <div className="container py-10 space-y-10">
      <Dialog
        open={plan === "pro" && showBillingManager}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            setShowBillingManager(true);
          } else {
            handleCloseBillingManager();
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogTitle className="sr-only">Manage subscription</DialogTitle>
          <DialogDescription className="sr-only">
            Update your Sports Analysis membership and billing preferences.
          </DialogDescription>
          {plan === "pro" ? (
            <ProfileBillingManager
              key={planInfo.stripe_price_id ?? plan}
              plan={plan}
              planInfo={planInfo}
              onClose={handleCloseBillingManager}
              onViewPlans={handleViewPlans}
              error={billingDialogError}
              onCancelSubscription={handleCancelSubscription}
              cancelPending={cancelSubscriptionLoading}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
        <Card className="surface-card">
          <CardContent className="p-8 space-y-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-5">
                <div className="relative">
                  <Avatar className="h-24 w-24 neon-avatar border border-white/15 bg-background/70">
                    {avatarUrl ? (
                      <AvatarImage src={avatarUrl} alt={displayName} />
                    ) : (
                      <AvatarFallback className="bg-primary/20 text-primary-foreground text-xl font-semibold">
                        {initialsFromName(displayName)}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  {uploadingAvatar && (
                    <div className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="profile-action absolute -bottom-3 -right-3 h-10 w-10 rounded-full"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAvatar}
                  >
                    <Camera className="h-4 w-4" />
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleAvatarUpload}
                  />
                </div>
                <div className="space-y-2">
                  <div>
                    <h1 className="text-3xl font-bold tracking-tight text-foreground">{displayName}</h1>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" />
                      <span>Member since {memberSince}</span>
                    </span>
                    {hasPrefs && <Badge className="neon-chip">Personalized feed active</Badge>}
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-3">
                <ProfilePlanSummary />
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <div className="flex w-full justify-end">
                    <UpgradeCta
                      priceId={stripeConfig.monthlyPriceId}
                      label="Start 7-day trial"
                      manageWhenPro
                      planName="Sports Analysis Pro"
                      planPrice="$2"
                      planCadence="per month"
                      planDescription="Unlock advanced match analytics, AI-driven predictions, and unlimited favourites."
                      planFeatures={[
                        "Unlimited live analytics overlays",
                        "AI-powered highlight reels and insights",
                        "Personalised alerts with unlimited saved teams",
                      ]}
                      redirectWhenFreeHref="/pro"
                      onManageBilling={handleManageBilling}
                      manageButtonClassName="w-auto"
                      manageButtonSize="sm"
                    />
                  </div>
                  {stripeConfig.loaded && !stripeConfig.configured && plan !== "pro" && (
                    <p className="text-xs text-muted-foreground max-w-xs text-right">
                      Stripe billing is not configured. Set `STRIPE_SECRET_KEY` and a monthly price environment
                      variable (e.g. `NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE` or `STRIPE_PRO_MONTHLY_PRICE_ID`) before
                      enabling upgrades.
                    </p>
                  )}

                  {editing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditing(false)}
                        disabled={saving}
                        className="px-4"
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSave}
                        disabled={saving}
                        className="profile-action px-5"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="profile-action group px-5"
                      onClick={() => setEditing(true)}
                    >
                      <Settings className="h-4 w-4 mr-2 transition-transform duration-200 group-hover:rotate-6" />
                      Edit profile
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="profile-action group px-5"
                    onClick={async () => {
                      try {
                        await supabase.auth.signOut();
                      } finally {
                        try { router.replace('/'); } catch {}
                      }
                    }}
                  >
                    <LogOut className="h-4 w-4 mr-2 transition-transform duration-200 group-hover:-translate-x-0.5" />
                    Sign out
                  </Button>
                </div>
              </div>
            </div>

            {editing && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Display name</label>
                  <Input
                    value={profile.full_name}
                    onChange={(event) =>
                      setProfile((prev) => ({ ...prev, full_name: event.target.value }))
                    }
                    placeholder="Add your full name"
                    className="bg-transparent border-white/20 focus-visible:ring-primary/60"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Contact email</label>
                  <Input value={user.email ?? ""} disabled className="bg-white/5 border-white/15" />
                </div>
              </div>
            )}

          </CardContent>
        </Card>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6 }}>
          <Card className="surface-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Teams followed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-3xl font-semibold text-foreground">{preferences.favorite_teams.length || "—"}</div>
              <div className="text-sm text-muted-foreground">
                {(preferences.favorite_teams ?? []).slice(0, 3).join(", ") || "No teams yet"}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.6 }}>
          <Card className="surface-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Leagues followed</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-3xl font-semibold text-foreground">{preferences.favorite_leagues.length || "—"}</div>
              <div className="text-sm text-muted-foreground">
                {(preferences.favorite_leagues ?? []).slice(0, 3).join(", ") || "No leagues yet"}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.6 }}>
          <Card className="surface-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">Saved matches</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="text-3xl font-semibold text-foreground">{savedMatchesCount ?? "—"}</div>
              <div className="text-sm text-muted-foreground">Matches you saved for later</div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35, duration: 0.6 }}>
          <Card className="surface-card h-full">
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                <CardTitle className="text-foreground">Recently viewed</CardTitle>
              </div>
              {recentViews.length > 0 && !recentViewsLoading && (
                <Badge variant="outline" className="text-xs font-medium">
                  {recentViews.length} {recentViews.length === 1 ? "item" : "items"}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {recentViewsLoading ? (
                <div className="text-sm text-muted-foreground">Loading recent activity…</div>
              ) : recentViews.length === 0 ? (
                <div className="text-sm text-muted-foreground">Open a match to see your viewing history here.</div>
              ) : (
                <ul className="space-y-3">
                  {recentViews.map((view) => {
                    const relative = formatRelativeTime(view.viewedAt);
                    const metaPieces: string[] = [];
                    const primarySubject = view.teams.length
                      ? view.teams.join(" • ")
                      : view.primaryLeague ?? (view.leagues.length ? view.leagues.join(" • ") : "");
                    if (primarySubject) metaPieces.push(primarySubject);
                    if (relative) metaPieces.push(relative);
                    if (view.event && view.event !== "view") metaPieces.push(view.event);
                    const subtitle = metaPieces.join(" • ");
                    const href = view.eventId
                      ? `/match/${encodeURIComponent(view.eventId)}?src=profile_recent`
                      : view.primaryLeague
                        ? `/leagues?league=${encodeURIComponent(view.primaryLeague)}&src=profile_recent`
                        : null;
                    return (
                      <li
                        key={`${view.itemId}-${view.viewedAt}`}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-background/60 px-3 py-3"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">{view.title}</p>
                          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
                        </div>
                        {href && (
                          <Button variant="ghost" size="sm" className="px-3" asChild>
                            <Link href={href}>Open</Link>
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6 }}>
          <Card className="surface-card h-full">
            <CardHeader>
              <div className="flex items-center gap-2">
                <LineChart className="h-5 w-5 text-primary" />
                <CardTitle className="text-foreground">Engagement snapshot</CardTitle>
              </div>
              <p className="text-sm text-muted-foreground">
                Following {preferences.favorite_teams.length} team{preferences.favorite_teams.length === 1 ? "" : "s"} and {preferences.favorite_leagues.length} league
                {preferences.favorite_leagues.length === 1 ? "" : "s"}.
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-xl border border-border/40 bg-background/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Activity · last 7 days</p>
                    <p className="text-sm font-medium text-foreground">{lastActiveDisplay}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-[var(--primary,#ef4444)]" aria-hidden /> Likes {likeEvents}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-muted-foreground/60" aria-hidden /> Saves {saveEvents}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-foreground/70" aria-hidden /> Views {viewWindowCount}
                    </span>
                  </div>
                </div>
                {engagementWindow.hasData ? (
                  <>
                    <div className="mt-4 h-32">
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
                        <defs>
                          <linearGradient id="engagementFill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.6" />
                            <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0.05" />
                          </linearGradient>
                        </defs>
                        <path d={sparkline.areaPath} fill="url(#engagementFill)" opacity="0.55" />
                        <polyline
                          points={sparkline.linePoints}
                          fill="none"
                          stroke="var(--primary)"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                          strokeLinecap="round"
                        />
                        {sparkline.coordinates.map((coord, index) => (
                          <circle
                            key={`spark-${coord.x}-${index}`}
                            cx={coord.x}
                            cy={coord.y}
                            r={1.6}
                            fill="var(--primary)"
                            stroke="var(--background)"
                            strokeWidth="0.6"
                          />
                        ))}
                      </svg>
                    </div>
                    <div className="mt-4 flex justify-between text-[11px] uppercase tracking-wide text-muted-foreground">
                      {engagementWindow.points.map((point, index) => {
                        const isEdge = index === 0 || index === engagementWindow.points.length - 1;
                        const middle = Math.floor(engagementWindow.points.length / 2);
                        if (!isEdge && index !== middle) return <span key={point.key} />;
                        return (
                          <span key={point.key} className="min-w-[3ch] text-center">
                            {point.label}
                          </span>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-muted-foreground">No engagement yet — start exploring matches to build your activity.</p>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-3">
                  <p className="text-2xl font-semibold text-foreground">{totalTouchpoints}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total touchpoints</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-3">
                  <p className="text-2xl font-semibold text-foreground">{likedCount}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Items liked</p>
                </div>
                <div className="rounded-lg border border-border/50 bg-background/60 px-3 py-3">
                  <p className="text-2xl font-semibold text-foreground">{savedPickCount}</p>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Items saved</p>
                </div>
              </div>
              <div className="flex flex-col gap-2 text-xs uppercase tracking-wide text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Active days this week: <span className="font-semibold text-foreground">{activeDays}</span>
                </span>
                <span>
                  Last active: <span className="font-semibold text-foreground">{lastActiveDisplay}</span>
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.6 }}>
        <Card className="surface-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-foreground">
              <Heart className="h-5 w-5 text-rose-400" />
              Favorites spotlight
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {editing ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Favorite teams (comma separated)</label>
                  <textarea
                    value={preferences.favorite_teams.join(", ")}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        favorite_teams: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      }))
                    }
                    placeholder="Manchester United, Golden State Warriors"
                    className="min-h-[90px] w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use clear names to help us fetch badges and personalize your recommendations.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-muted-foreground">Favorite leagues (comma separated)</label>
                  <textarea
                    value={preferences.favorite_leagues.join(", ")}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        favorite_leagues: event.target.value
                          .split(",")
                          .map((item) => item.trim())
                          .filter(Boolean),
                      }))
                    }
                    placeholder="Premier League, NBA, UEFA Champions League"
                    className="min-h-[90px] w-full rounded-md border border-white/20 bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Teams</h3>
                  {preferences.favorite_teams.length ? (
                    <div className="grid max-h-80 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                      {preferences.favorite_teams.map((team) => {
                        const logo = resolveLogoFromMap(team, preferences.favorite_team_logos);
                        return (
                          <motion.div
                            key={team}
                            whileHover={{ scale: 1.02, translateY: -4 }}
                            transition={{ type: "spring", stiffness: 260, damping: 20 }}
                            className="surface-tile flex items-center gap-3 p-3"
                          >
                            <Avatar className="h-12 w-12 border border-white/10 bg-background/70">
                              {logo ? (
                                <AvatarImage src={logo} alt={team} />
                              ) : (
                                <AvatarFallback className="bg-primary/20 text-primary-foreground font-semibold">
                                  {initialsFromName(team)}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div>
                              <p className="font-semibold text-foreground">{team}</p>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">Team</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Add teams you love to see them here with their badges.</p>
                  )}
                </div>
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-foreground">Leagues</h3>
                  {preferences.favorite_leagues.length ? (
                    <div className="grid max-h-80 gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                      {preferences.favorite_leagues.map((league) => {
                        const logo = resolveLogoFromMap(league, preferences.favorite_league_logos);
                        return (
                          <motion.div
                            key={league}
                            whileHover={{ scale: 1.02, translateY: -4 }}
                            transition={{ type: "spring", stiffness: 260, damping: 20 }}
                            className="surface-tile flex items-center gap-3 p-3"
                          >
                            <Avatar className="h-12 w-12 border border-white/10 bg-background/70">
                              {logo ? (
                                <AvatarImage src={logo} alt={league} />
                              ) : (
                                <AvatarFallback className="bg-primary/20 text-primary-foreground font-semibold">
                                  {initialsFromName(league)}
                                </AvatarFallback>
                              )}
                            </Avatar>
                            <div>
                              <p className="font-semibold text-foreground">{league}</p>
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">League</p>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Follow leagues to unlock curated coverage and standings.</p>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5, duration: 0.6 }}>
        <Card className="surface-card">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-300" />
              <CardTitle className="text-foreground">
                {hasPrefs ? "Tailored picks for you" : "Trending spotlight"}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="profile-action group px-4"
                onClick={() => {
                  setShowAllRecommendations(false);
                  recs.refetch?.();
                }}
                disabled={!!recs.isLoading}
              >
                {recs.isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Refreshing…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <RefreshCcw className="h-4 w-4 transition-transform duration-200 group-hover:rotate-12" /> Refresh
                  </span>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recs.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Personalizing your recommendations…
              </div>
            ) : displayedRecommendations.length ? (
              <div className="space-y-3">
                {displayedRecommendations.map((rec) => {
                  const itemRecord = isRecord(rec.item) ? (rec.item as AnyRecord) : undefined;
                  const reason = rec.reason ? rec.reason : `Score: ${Math.round(rec.score ?? 0)}`;
                  const isLiked = !!localLiked[rec.item_id];
                  const isSaved = !!localSaved[rec.item_id];
                  const title = coerceString(itemRecord?.title) ?? rec.item_id;
                  return (
                    <motion.div
                      key={rec.item_id}
                      whileHover={{ scale: 1.01, translateY: -3 }}
                      transition={{ type: "spring", stiffness: 240, damping: 18 }}
                      className="surface-tile flex cursor-pointer flex-col gap-4 p-4 outline-none transition sm:flex-row sm:items-center sm:justify-between focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      role="button"
                      tabIndex={0}
                      onClick={() => openRecommendation(rec.item_id, itemRecord)}
                      onKeyDown={(event) => handleRecommendationKeyDown(event, rec.item_id, itemRecord)}
                      aria-label={`Open ${title}`}
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-foreground">{title}</p>
                          <Badge className="neon-chip text-[10px] uppercase tracking-wide">
                            {rec.score ? `${Math.round(rec.score)} pts` : "For you"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{reason}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-pressed={isLiked}
                          className={`rounded-full border border-white/15 bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/70 hover:bg-primary/15 ${
                            isLiked ? "bg-primary/70 text-primary-foreground border-primary/70" : ""
                          }`}
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            toggleLocalLike(rec.item_id);
                          }}
                          disabled={sendingFeedbackId === rec.item_id}
                          title="Like"
                        >
                          <ThumbsUp className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-pressed={isSaved}
                          className={`rounded-full border border-white/15 bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/70 hover:bg-primary/15 ${
                            isSaved ? "bg-primary/70 text-primary-foreground border-primary/70" : ""
                          }`}
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            toggleLocalSave(rec.item_id);
                          }}
                          disabled={sendingFeedbackId === rec.item_id}
                          title="Save"
                        >
                          <Bookmark className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full border border-white/15 bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/70 hover:bg-primary/15"
                          onClick={(event: MouseEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            void shareRecommendation(rec.item_id, itemRecord);
                          }}
                          disabled={sendingFeedbackId === rec.item_id}
                          title="Share"
                        >
                          <Share2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </motion.div>
                  );
                })}
                {hiddenCount > 0 && (
                  <div className="pt-2 text-center">
                    <Button
                      variant="outline"
                      size="sm"
                      className="profile-action px-4"
                      onClick={() => setShowAllRecommendations((prev) => !prev)}
                    >
                      {showAllRecommendations ? "Show fewer recommendations" : `Show ${hiddenCount} more picks`}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                No recommendations yet — follow a few teams to unlock tailored highlights.
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
