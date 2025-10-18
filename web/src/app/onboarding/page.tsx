"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, CheckCircle2, Circle, ArrowRight, ArrowLeft, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { searchTeams, searchLeagues } from "@/lib/collect";
import useDebouncedValue from "@/hooks/useDebouncedValue";

type Option = {
  name: string;
  logo?: string;
};

type PreferencesRow = {
  favorite_teams?: string[] | null;
  favorite_leagues?: string[] | null;
  favorite_countries?: string[] | null;
  favorite_team_logos?: Record<string, string> | null;
  favorite_league_logos?: Record<string, string> | null;
};

const STEPS = [
  { id: "welcome", title: "Welcome", blurb: "Let's personalize your feed" },
  { id: "countries", title: "Favourite Countries", blurb: "Pick the football nations you care about" },
  { id: "leagues", title: "Favourite Leagues", blurb: "Select the competitions you never miss" },
  { id: "teams", title: "Favourite Teams", blurb: "Choose the clubs you follow closely" },
  { id: "summary", title: "Review", blurb: "Confirm your personalized experience" },
] as const;

const DEFAULT_COUNTRIES = [
  "England",
  "Spain",
  "Italy",
  "Germany",
  "France",
  "United States",
  "Argentina",
  "Brazil",
  "Portugal",
  "Netherlands",
  "Japan",
  "Australia",
];

const COUNTRY_FLAG_MAP: Record<string, string> = {
  England: "https://flagcdn.com/h40/gb.png",
  Spain: "https://flagcdn.com/h40/es.png",
  Italy: "https://flagcdn.com/h40/it.png",
  Germany: "https://flagcdn.com/h40/de.png",
  France: "https://flagcdn.com/h40/fr.png",
  "United States": "https://flagcdn.com/h40/us.png",
  Argentina: "https://flagcdn.com/h40/ar.png",
  Brazil: "https://flagcdn.com/h40/br.png",
  Portugal: "https://flagcdn.com/h40/pt.png",
  Netherlands: "https://flagcdn.com/h40/nl.png",
  Japan: "https://flagcdn.com/h40/jp.png",
  Australia: "https://flagcdn.com/h40/au.png",
};

const FALLBACK_LEAGUES: Option[] = [
  { name: "Premier League" },
  { name: "La Liga" },
  { name: "Serie A" },
  { name: "Bundesliga" },
  { name: "Ligue 1" },
  { name: "UEFA Champions League" },
  { name: "UEFA Europa League" },
  { name: "Major League Soccer" },
  { name: "Copa Libertadores" },
  { name: "Eredivisie" },
  { name: "Brasileirão" },
  { name: "Saudi Pro League" },
];

const FALLBACK_TEAMS = [
  "FC Barcelona",
  "Real Madrid",
  "Manchester City",
  "Arsenal",
  "Liverpool",
  "Manchester United",
  "Chelsea",
  "Bayern Munich",
  "Paris Saint-Germain",
  "Juventus",
  "Borussia Dortmund",
  "Inter Milan",
  "AC Milan",
  "Tottenham Hotspur",
  "Atletico Madrid",
  "Ajax",
  "LAFC",
  "Al Nassr",
  "Benfica",
  "Flamengo",
];

const TEAM_LOGO_KEYS = [
  "team_logo",
  "team_logo_url",
  "team_badge",
  "teamBadge",
  "strTeamBadge",
  "strTeamLogo",
  "logo",
  "badge",
  "crest",
  "image",
  "thumbnail",
  "teamBadgeUrl",
  "teamLogo",
  "logo_path",
  "logo_url",
  "badge_url",
  "shield",
  "emblem",
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
    const nestedKeys = ["url", "src", "image", "path", "logo", "badge", "thumbnail", "thumb", "href", "link", "default", "light", "dark"];
    for (const key of nestedKeys) {
      if (record[key]) {
        const candidate = sanitizeLogoUrl(record[key]);
        if (candidate) return candidate;
      }
    }
  }
  return "";
};

const extractLogo = (entry: Record<string, unknown>, candidateKeys: string[]) => {
  for (const key of candidateKeys) {
    if (key in entry) {
      const candidate = sanitizeLogoUrl(entry[key]);
      if (candidate) return candidate;
    }
  }
  return "";
};

const pickFirstString = (...values: unknown[]): string => {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return "";
};

const normalize = (value: string) => value.trim().toLowerCase();

const toOptionFromEntry = (entry: unknown, type: "team" | "league"): Option | null => {
  if (!entry) return null;
  if (typeof entry === "string") {
    const name = entry.trim();
    return name ? { name } : null;
  }
  if (typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const name = type === "team"
    ? pickFirstString(
        record.team_name,
        record.team,
        record.name,
        record.strTeam,
        record.full_name,
        record.fullname,
        record.teamName,
        record.short_name,
        record.nickname,
        record.club_name,
      )
    : pickFirstString(
        record.league_name,
        record.name,
        record.strLeague,
        record.league,
        record.leagueName,
        record.full_name,
      );
  if (!name) return null;
  const logoKeys = type === "team" ? TEAM_LOGO_KEYS : LEAGUE_LOGO_KEYS;
  const logo = extractLogo(record, logoKeys);
  return { name, logo: logo || undefined };
};

const dedupeOptions = (options: Option[]) => {
  const seen = new Set<string>();
  const out: Option[] = [];
  options.forEach(option => {
    const key = normalize(option.name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name: option.name, logo: option.logo ? sanitizeLogoUrl(option.logo) : undefined });
  });
  return out;
};

function SelectionTile({ option, selected, onToggle }: { option: Option; selected: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "group relative flex items-center gap-4 rounded-xl border bg-card/60 p-4 text-left transition",
        selected
          ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
          : "border-border hover:border-primary/60 hover:bg-muted/40"
      )}
    >
      <Avatar className="h-12 w-12 shrink-0 border border-border bg-background">
        {option.logo ? (
          <AvatarImage src={option.logo} alt={option.name} />
        ) : (
          <AvatarFallback>{option.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        )}
      </Avatar>
      <div className="flex-1">
        <p className="font-semibold leading-tight">{option.name}</p>
        <p className="text-sm text-muted-foreground">{selected ? "Added to your interests" : "Tap to follow"}</p>
      </div>
      {selected ? (
        <CheckCircle2 className="h-6 w-6 text-primary transition-transform group-hover:scale-105" />
      ) : (
        <Circle className="h-6 w-6 text-muted-foreground/50 group-hover:text-primary" />
      )}
    </button>
  );
}

function SummaryList({ title, items }: { title: string; items: Option[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="flex flex-wrap gap-3">
        {items.map(item => (
          <Badge key={item.name} variant="secondary" className="flex items-center gap-2 px-3 py-1 text-sm">
            <Avatar className="h-5 w-5 border border-border">
              {item.logo ? (
                <AvatarImage src={item.logo} alt={item.name} />
              ) : (
                <AvatarFallback className="text-[10px]">{item.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              )}
            </Avatar>
            <span>{item.name}</span>
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const { supabase, user, loading, bumpPreferences } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  const [stepIndex, setStepIndex] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [selectedLeagues, setSelectedLeagues] = useState<string[]>([]);
  const [selectedTeams, setSelectedTeams] = useState<string[]>([]);
  const [selectedLeagueLogos, setSelectedLeagueLogos] = useState<Record<string, string>>({});
  const [selectedTeamLogos, setSelectedTeamLogos] = useState<Record<string, string>>({});
  const [teamLogoCache, setTeamLogoCache] = useState<Record<string, string>>({});

  const [leagueSuggestions, setLeagueSuggestions] = useState<Option[]>(FALLBACK_LEAGUES);
  const [teamSuggestions, setTeamSuggestions] = useState<Option[]>(FALLBACK_TEAMS.map(name => ({ name })));
  const [teamSearchTerm, setTeamSearchTerm] = useState("");
  const debouncedTeamSearch = useDebouncedValue(teamSearchTerm, 350);
  const [teamSearchResults, setTeamSearchResults] = useState<Option[]>([]);
  const [teamSearchLoading, setTeamSearchLoading] = useState(false);

  const ensureTeamLogos = useCallback(async (names: string[]) => {
    const unique = Array.from(new Set(names.map(name => name.trim()).filter(Boolean)));
    const missing = unique.filter(name => !teamLogoCache[normalize(name)]);
    if (!missing.length) return;

    const results = await Promise.all(missing.map(async name => {
      try {
        const response = await searchTeams(name);
        const teams = Array.isArray(response.data?.teams) ? response.data.teams : [];
        const options = dedupeOptions(
          teams
            .map((entry: unknown) => toOptionFromEntry(entry, "team"))
            .filter((entry: Option | null): entry is Option => Boolean(entry))
        );
        if (!options.length) return null;
        const match = options.find(option => normalize(option.name) === normalize(name)) ?? options[0];
        if (!match?.logo) return null;
        return { key: normalize(name), logo: match.logo };
      } catch {
        return null;
      }
    }));

    const updates: Record<string, string> = {};
    results.forEach(item => {
      if (item?.key && item.logo) {
        updates[item.key] = item.logo;
      }
    });

    if (Object.keys(updates).length) {
      setTeamLogoCache(prev => ({ ...prev, ...updates }));
    }
  }, [teamLogoCache]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/auth/login?redirect=/onboarding");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadPreferences = async () => {
      setInitializing(true);
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select(
            "favorite_teams, favorite_leagues, favorite_countries, favorite_team_logos, favorite_league_logos"
          )
          .eq("user_id", user.id)
          .maybeSingle<PreferencesRow>();
        if (!active) return;
        if (data) {
          const teams = Array.isArray(data.favorite_teams) ? data.favorite_teams.filter(Boolean) : [];
          const leagues = Array.isArray(data.favorite_leagues) ? data.favorite_leagues.filter(Boolean) : [];
          const countries = Array.isArray(data.favorite_countries) ? data.favorite_countries.filter(Boolean) : [];
          setSelectedTeams(teams);
          setSelectedLeagues(leagues);
          setSelectedCountries(countries.length ? countries : []);

          const teamLogoMap: Record<string, string> = {};
          if (data.favorite_team_logos && typeof data.favorite_team_logos === "object") {
            Object.entries(data.favorite_team_logos).forEach(([key, value]) => {
              if (typeof value === "string" && value.trim()) {
                teamLogoMap[normalize(key)] = value;
              }
            });
          }
          setSelectedTeamLogos(teamLogoMap);

          const leagueLogoMap: Record<string, string> = {};
          if (data.favorite_league_logos && typeof data.favorite_league_logos === "object") {
            Object.entries(data.favorite_league_logos).forEach(([key, value]) => {
              if (typeof value === "string" && value.trim()) {
                leagueLogoMap[normalize(key)] = value;
              }
            });
          }
          setSelectedLeagueLogos(leagueLogoMap);

          if (teams.length || leagues.length) {
            setStepIndex(STEPS.length - 1);
          }
        } else {
          setSelectedCountries([]);
        }
      } catch {
        // ignore and use defaults
      } finally {
        if (active) setInitializing(false);
      }
    };
    loadPreferences();
    return () => {
      active = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    let active = true;
    const loadSuggestions = async () => {
      try {
        setOptionsLoading(true);
        const { data: leagues } = await supabase
          .from("cached_leagues")
          .select("name, logo")
          .order("last_updated", { ascending: false })
          .limit(24);
        if (active) {
          if (Array.isArray(leagues) && leagues.length) {
            const mapped = dedupeOptions(
              leagues
                .map(row => toOptionFromEntry(row, "league"))
                .filter((row): row is Option => !!row)
            );
            if (mapped.length) setLeagueSuggestions(mapped);
          } else {
            setLeagueSuggestions(FALLBACK_LEAGUES);
          }
        }
      } catch {
        if (active) setLeagueSuggestions(FALLBACK_LEAGUES);
      }

      try {
        const { data: popular } = await supabase.rpc("list_popular_teams", { limit_count: 24 });
        let names: string[] = [];
        if (Array.isArray(popular) && popular.length) {
          names = popular
            .map(item => {
              if (!item) return "";
              if (typeof item === "string") return item;
              if (typeof item === "object") {
                const record = item as Record<string, unknown>;
                if (typeof record.team === "string") return record.team;
              }
              return "";
            })
            .filter(Boolean);
        }
        if (!names.length) {
          const fallbackOptions = dedupeOptions(FALLBACK_TEAMS.map(name => ({ name })));
          if (active) {
            setTeamSuggestions(fallbackOptions);
            ensureTeamLogos(fallbackOptions.map(option => option.name));
          }
        } else {
          let logoMap: Record<string, string> = {};
          try {
            const { data: cached } = await supabase
              .from("cached_teams")
              .select("name, logo")
              .in("name", names as unknown[]);
            if (Array.isArray(cached) && cached.length) {
              logoMap = cached.reduce<Record<string, string>>((acc, row) => {
                if (!row || typeof row !== "object") return acc;
                const name = typeof row.name === "string" ? row.name : "";
                const logo = sanitizeLogoUrl((row as Record<string, unknown>).logo);
                if (!name || !logo) return acc;
                acc[normalize(name)] = logo;
                return acc;
              }, {});
            }
          } catch {
            // ignore logo lookup failures
          }
          const mapped = dedupeOptions(
            names.map(name => ({ name, logo: logoMap[normalize(name)] }))
          );
          if (active) {
            const next = mapped.length ? mapped : dedupeOptions(FALLBACK_TEAMS.map(name => ({ name })));
            setTeamSuggestions(next);
            ensureTeamLogos(next.map(option => option.name));
          }
        }
      } catch {
        if (active) {
          const fallbackOptions = dedupeOptions(FALLBACK_TEAMS.map(name => ({ name })));
          setTeamSuggestions(fallbackOptions);
          ensureTeamLogos(fallbackOptions.map(option => option.name));
        }
      } finally {
        if (active) setOptionsLoading(false);
      }
    };

    loadSuggestions();
    return () => {
      active = false;
    };
  }, [supabase, ensureTeamLogos]);

  useEffect(() => {
    if (!debouncedTeamSearch || debouncedTeamSearch.trim().length < 2) {
      setTeamSearchResults([]);
      setTeamSearchLoading(false);
      return;
    }
    let active = true;
    setTeamSearchLoading(true);
    (async () => {
      try {
        const query = debouncedTeamSearch.trim();
        const [teamResp, leagueResp] = await Promise.allSettled([
          searchTeams(query),
          searchLeagues(query),
        ]);

        if (!active) return;

        const teamOptions = teamResp.status === "fulfilled"
          ? dedupeOptions(
              (Array.isArray(teamResp.value.data?.teams) ? teamResp.value.data!.teams! : [])
                .map((entry: unknown) => toOptionFromEntry(entry, "team"))
                .filter((entry: Option | null): entry is Option => Boolean(entry))
            )
          : [];

        const leagueOptions = leagueResp.status === "fulfilled"
          ? dedupeOptions(
              (Array.isArray(leagueResp.value.data?.leagues) ? leagueResp.value.data!.leagues! : [])
                .map((entry: unknown) => toOptionFromEntry(entry, "league"))
                .filter((entry: Option | null): entry is Option => Boolean(entry))
            )
          : [];

        const combined = dedupeOptions([
          ...leagueOptions.slice(0, 6),
          ...teamOptions,
        ]).slice(0, 12);

        setTeamSearchResults(combined);
        const missingNames = combined.filter(option => !option.logo).map(option => option.name);
        if (missingNames.length) {
          ensureTeamLogos(missingNames);
        }
      } catch {
        if (active) setTeamSearchResults([]);
      } finally {
        if (active) setTeamSearchLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [debouncedTeamSearch, ensureTeamLogos]);

  useEffect(() => {
    setTeamSuggestions(prev => {
      let changed = false;
      const next = prev.map(option => {
        if (option.logo) return option;
        const cached = teamLogoCache[normalize(option.name)];
        if (!cached) return option;
        changed = true;
        return { ...option, logo: cached };
      });
      return changed ? next : prev;
    });
  }, [teamLogoCache]);

  const step = STEPS[stepIndex];
  const progress = useMemo(() => ((stepIndex + 1) / STEPS.length) * 100, [stepIndex]);

  const nextPath = useMemo(() => {
    const requested = params.get("next");
    if (!requested) return "/";
    return requested.startsWith("/") ? requested : "/";
  }, [params]);

  const toggleCountry = (country: string) => {
    setSelectedCountries(prev =>
      prev.includes(country) ? prev.filter(item => item !== country) : [...prev, country]
    );
  };

  const toggleLeague = (option: Option) => {
    setSelectedLeagues(prev => {
      const exists = prev.some(item => normalize(item) === normalize(option.name));
      if (exists) {
        setSelectedLeagueLogos(current => {
          const copy = { ...current };
          delete copy[normalize(option.name)];
          return copy;
        });
        return prev.filter(item => normalize(item) !== normalize(option.name));
      }
      if (option.logo) {
        const logo = option.logo;
        setSelectedLeagueLogos(current => ({ ...current, [normalize(option.name)]: logo }));
      }
      return [...prev, option.name];
    });
  };

  const toggleTeam = (option: Option) => {
    setSelectedTeams(prev => {
      const exists = prev.some(item => normalize(item) === normalize(option.name));
      if (exists) {
        setSelectedTeamLogos(current => {
          const copy = { ...current };
          delete copy[normalize(option.name)];
          return copy;
        });
        return prev.filter(item => normalize(item) !== normalize(option.name));
      }
      const resolvedLogo = option.logo ?? teamLogoCache[normalize(option.name)];
      if (resolvedLogo) {
        setSelectedTeamLogos(current => ({ ...current, [normalize(option.name)]: resolvedLogo }));
      }
      return [...prev, option.name];
    });
  };

  const goNext = () => setStepIndex(index => Math.min(index + 1, STEPS.length - 1));
  const goPrev = () => setStepIndex(index => Math.max(index - 1, 0));

  const buildLogoMap = (names: string[], lookup: Record<string, string>) => {
    return names.reduce<Record<string, string>>((acc, name) => {
      const logo = lookup[normalize(name)];
      if (logo) acc[name] = logo;
      return acc;
    }, {});
  };

  const handleFinish = async () => {
    if (!user) return;
    if (!selectedTeams.length && !selectedLeagues.length) {
      toast.error("Pick at least one team or league to tailor your experience");
      setStepIndex(Math.max(selectedLeagues.length ? 2 : 3, 1));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        favorite_countries: selectedCountries,
        favorite_leagues: selectedLeagues,
        favorite_teams: selectedTeams,
        favorite_league_logos: buildLogoMap(selectedLeagues, selectedLeagueLogos),
        favorite_team_logos: buildLogoMap(selectedTeams, selectedTeamLogos),
      };
      const { error } = await supabase.from("user_preferences").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      bumpPreferences();
      toast.success("Preferences saved. Welcome aboard!");
  router.replace(nextPath || "/");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save preferences";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const busy = initializing || optionsLoading || (loading && !user);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="absolute inset-0">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-25"
          style={{ backgroundImage: "url(/loginbg.jpg)" }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-900/85 to-slate-950/90" />
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mx-auto w-full"
        >
          <Card className="overflow-hidden border border-white/10 bg-background/90 shadow-2xl">
            <CardHeader className="relative flex flex-col items-center gap-4 border-b border-border/60 bg-gradient-to-br from-primary/10 to-primary/0 py-10">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
              <Image src="/logo/logo_transparent.svg" alt="Athlete logo" width={80} height={80} className="drop-shadow-lg" />
              <Badge variant="outline" className="flex items-center gap-2 bg-background/80 px-3 py-1 text-xs uppercase tracking-wide">
                <Sparkles className="h-4 w-4 text-primary" />
                Personalized Setup
              </Badge>
              <CardTitle className="text-center text-3xl font-semibold tracking-tight text-foreground">
                Craft your football universe
              </CardTitle>
              <p className="max-w-2xl text-center text-base text-muted-foreground">
                Tell us what you love so we can build match alerts, deep-dive analytics, and recommendations around your football heartbeat.
              </p>
            </CardHeader>

            <CardContent className="p-8">
              <div className="mb-8 space-y-3">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <span>Step {stepIndex + 1} of {STEPS.length}</span>
                  <span>{step.title}</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted">
                  <motion.div
                    className="h-2 rounded-full bg-primary"
                    initial={{ width: 0 }}
                    animate={{ width: `${progress}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                </div>
              </div>

              {busy ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Loader2 className="h-7 w-7 animate-spin" />
                  <p className="text-sm">Loading personalised options…</p>
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="space-y-8"
                  >
                    {step.id === "welcome" ? (
                      <div className="space-y-6">
                        <h2 className="text-2xl font-semibold text-foreground">Welcome to ATHLETE</h2>
                        <p className="text-base text-muted-foreground">
                          We already crunch live match data, AI-driven highlights, and tactical insights. A few quick picks now help us surface the moments that matter to you — from kickoff buzz to post-match breakdowns.
                        </p>
                        <div className="grid gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6 sm:grid-cols-3">
                          {[
                            { title: "Live feed", description: "See upcoming fixtures and live win probabilities for the clubs you back." },
                            { title: "Story spotlight", description: "Daily news radar tuned to your favourite leagues and rivalries." },
                            { title: "Smart recs", description: "Match briefs, highlight reels, and stats tailored to your football DNA." },
                          ].map(item => (
                            <div key={item.title} className="rounded-xl border border-white/10 bg-background/80 p-4 shadow">
                              <h3 className="text-sm font-semibold text-primary">{item.title}</h3>
                              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-end">
                          <Button size="lg" onClick={goNext} className="gap-2">
                            Let&apos;s go
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {step.id === "countries" ? (
                      <div className="space-y-6">
                        <div className="flex flex-col gap-2">
                          <h2 className="text-2xl font-semibold text-foreground">Where does your passion live?</h2>
                          <p className="text-base text-muted-foreground">
                            Pick the football nations you follow — we’ll surface national team stories, derbies, and player spotlights from these regions.
                          </p>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {DEFAULT_COUNTRIES.map(country => (
                            <SelectionTile
                              key={country}
                              option={{ name: country, logo: COUNTRY_FLAG_MAP[country] }}
                              selected={selectedCountries.includes(country)}
                              onToggle={() => toggleCountry(country)}
                            />
                          ))}
                        </div>
                        {!!selectedCountries.length && (
                          <div className="rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-sm text-muted-foreground">
                            You can add more later from your profile. Right now you’ve tagged {selectedCountries.length} {selectedCountries.length === 1 ? "country" : "countries"}.
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <Button variant="ghost" size="sm" onClick={goPrev} className="gap-2">
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                          <Button size="lg" onClick={goNext} className="gap-2">
                            Next step
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {step.id === "leagues" ? (
                      <div className="space-y-6">
                        <div className="flex flex-col gap-2">
                          <h2 className="text-2xl font-semibold text-foreground">Follow your favourite leagues</h2>
                          <p className="text-base text-muted-foreground">
                            Pick at least a couple of leagues so we can prioritize tables, match previews, and title race narratives for you.
                          </p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {leagueSuggestions.map(option => (
                            <SelectionTile
                              key={option.name}
                              option={option}
                              selected={selectedLeagues.some(item => normalize(item) === normalize(option.name))}
                              onToggle={() => toggleLeague(option)}
                            />
                          ))}
                        </div>
                        {selectedLeagues.length < 2 && (
                          <div className="rounded-xl border border-dashed border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-500">
                            Tip: choosing at least two leagues gives our recommendation engine stronger context.
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <Button variant="ghost" size="sm" onClick={goPrev} className="gap-2">
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                          <Button size="lg" onClick={goNext} className="gap-2">
                            Next step
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {step.id === "teams" ? (
                      <div className="space-y-7">
                        <div className="flex flex-col gap-2">
                          <h2 className="text-2xl font-semibold text-foreground">Tell us the clubs you ride with</h2>
                          <p className="text-base text-muted-foreground">
                            We’ll track every kickoff, rivalry, and breaking story for these teams.
                          </p>
                        </div>
                        <div className="grid gap-3 md:grid-cols-2">
                          {teamSuggestions.map(option => (
                            <SelectionTile
                              key={option.name}
                              option={{ ...option, logo: option.logo ?? teamLogoCache[normalize(option.name)] }}
                              selected={selectedTeams.some(item => normalize(item) === normalize(option.name))}
                              onToggle={() => toggleTeam(option)}
                            />
                          ))}
                        </div>
                        <div className="space-y-3">
                          <label className="text-sm font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="team-search">
                            Search clubs
                          </label>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              id="team-search"
                              placeholder="Try Real Madrid, Juventus, Boca Juniors…"
                              value={teamSearchTerm}
                              onChange={event => setTeamSearchTerm(event.target.value)}
                              className="pl-10"
                            />
                          </div>
                          {teamSearchLoading ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Searching…
                            </div>
                          ) : null}
                          {teamSearchResults.length ? (
                            <div className="grid gap-3 md:grid-cols-2">
                              {teamSearchResults.slice(0, 12).map(option => (
                                <SelectionTile
                                  key={`result-${option.name}`}
                                  option={option}
                                  selected={selectedTeams.some(item => normalize(item) === normalize(option.name))}
                                  onToggle={() => toggleTeam(option)}
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                        {selectedTeams.length < 3 && (
                          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-sm text-muted-foreground">
                            Add three or more clubs so we have plenty of matchups to prioritise for you.
                          </div>
                        )}
                        <div className="flex items-center justify-between">
                          <Button variant="ghost" size="sm" onClick={goPrev} className="gap-2">
                            <ArrowLeft className="h-4 w-4" />
                            Back
                          </Button>
                          <Button size="lg" onClick={goNext} className="gap-2">
                            Review picks
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : null}

                    {step.id === "summary" ? (
                      <div className="space-y-8">
                        <div className="space-y-2">
                          <h2 className="text-2xl font-semibold text-foreground">Your personalised dashboard is ready</h2>
                          <p className="text-base text-muted-foreground">
                            We’ll blend these selections with live analytics to power your My Teams hub and recommendation engine.
                          </p>
                        </div>
                        <div className="grid gap-6 md:grid-cols-2">
                          <SummaryList
                            title="Teams"
                            items={selectedTeams.map(name => ({ name, logo: selectedTeamLogos[normalize(name)] }))}
                          />
                          <SummaryList
                            title="Leagues"
                            items={selectedLeagues.map(name => ({ name, logo: selectedLeagueLogos[normalize(name)] }))}
                          />
                          <SummaryList
                            title="Countries"
                            items={selectedCountries.map(name => ({ name }))}
                          />
                        </div>
                        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-sm text-muted-foreground">
                          Expect richer match briefs, curated content in My Teams, and smarter recommendations from today onward. You can tweak preferences any time from your profile.
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Button variant="ghost" size="sm" onClick={() => setStepIndex(2)} className="gap-2">
                            Adjust selections
                          </Button>
                          <Button size="lg" onClick={handleFinish} disabled={saving} className="gap-2">
                            {saving ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Saving
                              </>
                            ) : (
                              <>
                                Finish and explore
                                <CheckCircle2 className="h-4 w-4" />
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </motion.div>
                </AnimatePresence>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
