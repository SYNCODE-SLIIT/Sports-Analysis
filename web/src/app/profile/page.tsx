"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const RECOMMENDATION_LIMIT = 4;

type ItemDetails = {
  title?: string | null;
  data?: Record<string, unknown> | null;
  teams?: string[] | null;
  leagues?: string[] | null;
};

type RecentView = {
  itemId: string;
  event: string | null;
  viewedAt: string;
  title: string;
  eventId: string | null;
  teams: string[];
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
  const recs = useRecommendations();
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasPrefs = preferences.favorite_teams.length > 0 || preferences.favorite_leagues.length > 0;

  useEffect(() => {
    if (!loading && user && isAdmin) {
      router.replace("/admin");
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
    if (!user || isAdmin) return;
    try {
      recs.refetch?.();
    } catch {
      /* ignore */
    }
  }, [isAdmin, prefsVersion, recs, user]);

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
        setPreferences((prev) => ({
          ...prev,
          favorite_team_logos: { ...prev.favorite_team_logos, ...resolved },
        }));
      }
    })();
  }, [isAdmin, preferences.favorite_team_logos, preferences.favorite_teams, resolveLogos, user]);

  useEffect(() => {
    if (!user || isAdmin) return;
    if (!preferences.favorite_leagues.length) return;
    void (async () => {
      const resolved = await resolveLogos("league", preferences.favorite_leagues, preferences.favorite_league_logos);
      if (Object.keys(resolved).length) {
        setPreferences((prev) => ({
          ...prev,
          favorite_league_logos: { ...prev.favorite_league_logos, ...resolved },
        }));
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
          .select("item_id, event, created_at, items:items(title, data, teams, leagues)")
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
          const titleCandidate = typeof details?.title === "string" ? details?.title.trim() : "";
          const title = titleCandidate || (teams.length ? teams.join(" vs ") : "Match insight");
          mapped.push({
            itemId,
            event: typeof row.event === "string" ? row.event : null,
            viewedAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
            title,
            eventId,
            teams,
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
  }, [supabase, user, interactionsVersion, recs]);

  const shareRecommendation = useCallback(
    async (itemId: string, item: Record<string, unknown> | undefined) => {
      const title = (item?.title as string) || "Sports Analysis";
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const link = `${origin}/`;
      try {
        const nav = (typeof navigator !== "undefined" ? (navigator as Navigator) : undefined) as NavigatorWithShare | undefined;
        if (nav?.share) {
          try {
            await nav.share({ title, text: "Check this out", url: link });
            await sendInteraction(itemId, "share");
            toast.success("Shared");
            return;
          } catch (error) {
            const err = error as unknown as { name?: string };
            if (err?.name === "AbortError") return;
          }
        }
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(link);
          await sendInteraction(itemId, "share");
          toast.success("Link copied to clipboard");
        }
      } catch {
        toast.error("Unable to share this pick right now");
      }
    },
    [sendInteraction],
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
      <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8 }}>
        <Card className="neon-card">
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
                    variant="secondary"
                    size="icon"
                    className="neon-button absolute top-1/2 -right-15 h-10 w-10 -translate-y-1/2 rounded-full shadow-md"
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
              <div className="flex items-center gap-3">
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
                      className="neon-button bg-primary/80 text-primary-foreground px-5"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save changes"}
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="neon-button px-5"
                    onClick={() => setEditing(true)}
                  >
                    <Settings className="h-4 w-4 mr-2" />
                    Edit profile
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="neon-button px-5"
                  onClick={async () => {
                    try {
                      await supabase.auth.signOut();
                    } finally {
                      try { router.replace('/'); } catch {}
                    }
                  }}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </Button>
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
          <Card className="neon-card">
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
          <Card className="neon-card">
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
          <Card className="neon-card">
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
          <Card className="neon-card h-full">
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
                    if (view.teams.length) metaPieces.push(view.teams.join(" • "));
                    if (relative) metaPieces.push(relative);
                    if (view.event && view.event !== "view") metaPieces.push(view.event);
                    const subtitle = metaPieces.join(" • ");
                    const href = view.eventId ? `/match/${encodeURIComponent(view.eventId)}?src=profile_recent` : null;
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
          <Card className="neon-card h-full">
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
        <Card className="neon-card">
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
                            className="neon-tile flex items-center gap-3 p-3"
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
                            className="neon-tile flex items-center gap-3 p-3"
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
        <Card className="neon-card">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-300" />
              <CardTitle className="text-foreground">
                {hasPrefs ? "Tailored picks for you" : "Trending spotlight"}
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="neon-button px-4"
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
                    <RefreshCcw className="h-4 w-4" /> Refresh
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
                  const reason = rec.reason ? rec.reason : `Score: ${Math.round(rec.score ?? 0)}`;
                  const isLiked = !!localLiked[rec.item_id];
                  const isSaved = !!localSaved[rec.item_id];
                  const title = ((rec.item as Record<string, unknown> | undefined)?.title as string | undefined) ?? rec.item_id;
                  return (
                    <motion.div
                      key={rec.item_id}
                      whileHover={{ scale: 1.01, translateY: -3 }}
                      transition={{ type: "spring", stiffness: 240, damping: 18 }}
                      className="neon-tile flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
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
                          onClick={() => toggleLocalLike(rec.item_id)}
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
                          onClick={() => toggleLocalSave(rec.item_id)}
                          disabled={sendingFeedbackId === rec.item_id}
                          title="Save"
                        >
                          <Bookmark className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="rounded-full border border-white/15 bg-white/5 transition-all duration-300 hover:-translate-y-1 hover:border-primary/70 hover:bg-primary/15"
                          onClick={() => shareRecommendation(rec.item_id, rec.item as Record<string, unknown>)}
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
                      variant="ghost"
                      size="sm"
                      className="neon-button px-4"
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