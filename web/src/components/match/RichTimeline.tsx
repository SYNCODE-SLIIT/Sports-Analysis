"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from 'react-dom';
import { useTheme } from "next-themes";
import { getEventBrief, postCollect, getComments } from "@/lib/collect";
import { summarizeEventBriefs } from "@/lib/summarizer";
import { resolvePlayerImageByName, resolvePlayerImageFromObj, getTeamRoster } from "@/lib/roster";
import type { TLItem } from "@/lib/match-mappers";
import { cn } from "@/lib/utils";

type BasicRecord = Record<string, unknown>;
type TeamContext = { home?: BasicRecord | null; away?: BasicRecord | null } | null;
type PlayersContext = { home: BasicRecord[]; away: BasicRecord[] } | null;
type Props = {
  items: TLItem[];
  homeTeam?: string;
  awayTeam?: string;
  // optional context to resolve player photos / team logos
  matchRaw?: BasicRecord | null;
  players?: PlayersContext;
  teams?: TeamContext;
};

const toRecord = (value: unknown): BasicRecord | null => (value && typeof value === "object" ? (value as BasicRecord) : null);
const toRecordArray = (value: unknown): BasicRecord[] =>
  Array.isArray(value) ? value.filter((entry): entry is BasicRecord => Boolean(entry) && typeof entry === "object") : [];
const toStringSafe = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    const str = String(value).trim();
    return str ? str : undefined;
  }
  return undefined;
};
const toNumberSafe = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

// Professional SVG icons and neon color mapping for football events
const iconFor = (type: TLItem["type"]) => {
  switch (type) {
    case "goal":
    case "pen_score":
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 13.5L6 11l1.41-1.41L10.5 12.67l6.59-6.59L18.5 7.5l-8 8z"/>
      </svg>`;
    case "own_goal":
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>`;
    case "pen_miss":
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
      </svg>`;
    case "yellow":
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <rect x="6" y="2" width="12" height="16" rx="2" ry="2"/>
      </svg>`;
    case "red":
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <rect x="6" y="2" width="12" height="16" rx="2" ry="2"/>
      </svg>`;
    case "sub":
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-5 h-5">
        <path d="M7.41 8.58L12 13.17l4.59-4.59L18 10l-6 6-6-6 1.41-1.42z"/>
        <path d="M16.59 15.42L12 10.83l-4.59 4.59L6 14l6-6 6 6-1.41 1.42z"/>
      </svg>`;
    case "ht":
      return "HT";
    case "ft":
      return "FT";
    default:
      return `<svg viewBox="0 0 24 24" fill="currentColor" class="w-4 h-4">
        <circle cx="12" cy="12" r="3"/>
      </svg>`;
  }
};

const colorFor = (type: TLItem["type"]) => {
  switch (type) {
    case "goal":
    case "pen_score":
      return "#00ff88"; // neon green
    case "own_goal":
      return "#00d4ff"; // neon cyan
    case "pen_miss":
      return "#ff0066"; // neon pink/red
    case "yellow":
      return "#ffdd00"; // neon yellow
    case "red":
      return "#ff0044"; // neon red
    case "sub":
      return "#8844ff"; // neon purple
    default:
      return "#6b7280"; // gray
  }
};

const glowColorFor = (type: TLItem["type"]) => {
  switch (type) {
    case "goal":
    case "pen_score":
      return "0, 255, 136"; // neon green RGB
    case "own_goal":
      return "0, 212, 255"; // neon cyan RGB
    case "pen_miss":
      return "255, 0, 102"; // neon pink/red RGB
    case "yellow":
      return "255, 221, 0"; // neon yellow RGB
    case "red":
      return "255, 0, 68"; // neon red RGB
    case "sub":
      return "136, 68, 255"; // neon purple RGB
    default:
      return "107, 114, 128"; // gray RGB
  }
};

function toMinuteNumber(m: number | string | undefined) {
  if (m === undefined || m === null) return NaN;
  const s = String(m);
  if (s.includes("+")) {
    const [a, b] = s.split("+");
    const na = Number(a) || 0;
    const nb = Number(b) || 0;
    return na + nb;
  }
  const n = Number(String(m).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : NaN;
}

// Format a display label for a minute with stoppage time (e.g., 45+2, 90+5)
function formatMinuteLabel(minute: number) {
  if (!Number.isFinite(minute)) return "";
  if (minute <= 45) return `${minute}`;
  if (minute > 45 && minute < 60) return `45+${minute - 45}`;
  if (minute > 90) return `90+${minute - 90}`;
  return `${minute}`;
}

// Cluster events by minute, preserving order and side
function clusterItems(items: TLItem[]) {
  const byMinute = new Map<number, TLItem[]>();
  for (const it of items) {
    const min = toMinuteNumber(it.minute);
    if (!Number.isFinite(min)) continue;
    if (!byMinute.has(min)) byMinute.set(min, []);
    byMinute.get(min)!.push(it);
  }
  return Array.from(byMinute.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([minute, group]) => ({ minute, group }));
}

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export default function RichTimeline({ items, homeTeam, awayTeam, matchRaw, players, teams }: Props) {
  const { resolvedTheme } = useTheme();
  const prefersDark = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (_err) {
      return false;
    }
  }, []);
  const isDark = resolvedTheme ? resolvedTheme === "dark" : prefersDark;

  const surfaceStyles = useMemo(() => {
    if (isDark) {
      return {
        background: "linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.9))",
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 12px 32px rgba(15, 23, 42, 0.45)",
      } as const;
    }
    return {
      // Pure white surface for light mode so it blends with the app background
      background: "white",
      boxShadow: "0 8px 20px rgba(15,23,42,0.04)",
    } as const;
  }, [isDark]);

  // Ensure we always have at least HT/FT anchors so the track is meaningful
  const baseItems = useMemo<TLItem[]>(() => {
    const arr = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!arr.length) {
      // Add some test events for demonstration
      return [
        { minute: 15, team: "home", type: "goal", player: "Test Player" },
        { minute: 23, team: "away", type: "yellow", player: "Away Player" },
        { minute: 45, team: "home", type: "ht" },
        { minute: 67, team: "home", type: "sub", player: "Sub In", assist: "Sub Out" },
        { minute: 90, team: "home", type: "ft" },
      ];
    }
    return arr;
  }, [items]);

  const cleaned = useMemo(() => baseItems.slice().sort((a, b) => a.minute - b.minute), [baseItems]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(scrollerRef);

  useEffect(() => {
    // Helpful debug: print provided raw match payload and context so we can map fields
    if (process.env.NODE_ENV !== 'production') {
      try {
        console.debug('[RichTimeline] debug', { matchRaw, items, players, teams });
      } catch {}
    }
  }, [matchRaw, items, players, teams]);

  // Pre-warm roster cache for home/away teams when match loads
  useEffect(() => {
    try {
      const raw = toRecord(matchRaw) ?? {};
      const resolveName = (key: "home" | "away") =>
        toStringSafe(teams?.[key]?.name) ??
        toStringSafe(raw[`${key === "home" ? "event_home_team" : "event_away_team"}`]) ??
        toStringSafe(raw[`${key}_team`]) ??
        toStringSafe(raw[key === "home" ? "strHomeTeam" : "strAwayTeam"]);

      const homeName = resolveName("home");
      const awayName = resolveName("away");

      if (homeName) getTeamRoster(homeName).catch(() => {});
      if (awayName) getTeamRoster(awayName).catch(() => {});
    } catch {
      // ignore background pre-fetch errors
    }
  }, [matchRaw, teams]);


  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel as EventListener, { passive: false });
    return () => el.removeEventListener("wheel", onWheel as EventListener);
  }, []);

  // Simple hover tooltip
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string; above?: boolean } | null>(null);
  const tooltipRef = useRef<{ x: number; y: number; html: string; above?: boolean } | null>(null);

  useEffect(() => {
    tooltipRef.current = tooltip;
  }, [tooltip]);

  const hideTooltip = useCallback(() => {
    setTooltip((prev) => (prev ? null : prev));
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let raf = 0;
    const handleScroll = () => {
      if (!tooltipRef.current) return;
      if (raf) cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(hideTooltip);
    };
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hideTooltip]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;
    const handleWindowScroll = () => {
      if (!tooltipRef.current) return;
      if (raf) cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(hideTooltip);
    };
    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleWindowScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [hideTooltip]);



  // If the passed timeline is effectively empty (only HT/FT anchors), try to synthesize from raw match data
  const synthesized = useMemo(() => {
    const isOnlyAnchors = cleaned.length <= 2 && cleaned.every(i => i.type === 'ht' || i.type === 'ft');
    if (!isOnlyAnchors && cleaned.length > 0) return null;
    const m = matchRaw as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return null;

    const asArray = (keys: string[]) => {
      // Check top-level and several common nested locations
      const mm = m as Record<string, unknown>;
      const candidates: Array<Record<string, unknown>> = [
        mm,
        (mm.event as Record<string, unknown>) ||
          (mm.data as Record<string, unknown>) ||
          (mm.match as Record<string, unknown>) ||
          (mm.raw as Record<string, unknown>) ||
          (mm.payload as Record<string, unknown>) ||
          {},
      ];
      for (const c of candidates) {
        if (!c || typeof c !== 'object') continue;
        for (const k of keys) {
          const v = c[k as keyof typeof c];
          if (Array.isArray(v) && v.length) return v as unknown[];
        }
      }
      // Fallback: scan all object values for first array-looking value
      for (const k of Object.keys(mm)) {
        const v = (mm as Record<string, unknown>)[k];
        if (Array.isArray(v) && v.length) return v as unknown[];
      }
      return [] as unknown[];
    };

  const out: TLItem[] = [];

  // goals
  const goalKeys = ['timeline','events','event_timeline','eventTimeline','event_entries','goalscorers','goals','scorers','scorers_list','goal_scorers','scorers_list','scorer_list'];
    const goals = asArray(goalKeys) as Array<Record<string, unknown>>;
    for (const g of goals) {
      const minute = toMinuteNumber((g.time as number | string | undefined) ?? (g.minute as number | string | undefined) ?? (g.elapsed as number | string | undefined) ?? (g.match_minute as number | string | undefined) ?? (g.min as number | string | undefined));
      const toStr = (v: unknown): string | undefined => {
        const s = v === undefined || v === null ? '' : String(v);
        return s.trim() ? s : undefined;
      };
      const player = toStr(g.scorer ?? g.player ?? g.home_scorer ?? g.away_scorer);
      const assist = toStr(g.assist ?? g.home_assist ?? g.away_assist);
      const isOwn = Boolean(g.own_goal ?? g.ownGoal);
      const type: TLItem['type'] = isOwn ? 'own_goal' : ((g.penalty ?? g.pen) ? 'pen_score' : 'goal');
      const side: 'home' | 'away' = (g.home_scorer || g.side === 'home' || g.team === 'home' || g.team === 'Home') ? 'home' : 'away';
      out.push({ minute: Number(minute)||0, team: side, type, player, assist });
    }

    // cards
  const cardKeys = ['cards','bookings','cards_list','bookings_list','discipline'];
    const cards = asArray(cardKeys) as Array<Record<string, unknown>>;
    for (const c of cards) {
      const minute = toMinuteNumber((c.time as number | string | undefined) ?? (c.minute as number | string | undefined) ?? (c.elapsed as number | string | undefined) ?? (c.match_minute as number | string | undefined));
      const toStr = (v: unknown): string | undefined => {
        const s = v === undefined || v === null ? '' : String(v);
        return s.trim() ? s : undefined;
      };
      const player = toStr(c.player ?? c.home_fault ?? c.away_fault);
      const isRed = String((c.card ?? c.type) ?? '').toLowerCase().includes('red');
      const type: TLItem['type'] = isRed ? 'red' : 'yellow';
      const side: 'home' | 'away' = (c.home_fault || c.side === 'home' || c.team === 'home' || c.team === 'Home') ? 'home' : 'away';
      const note = toStr(c.reason ?? c.info);
      out.push({ minute: Number(minute)||0, team: side, type, player, note });
    }

    // substitutions
  const subKeys = ['substitutes','subs','substitutions','substitutions_list','changes','sub_list'];
    const subs = asArray(subKeys) as Array<Record<string, unknown>>;
    for (const s of subs) {
      const minute = toMinuteNumber((s.time as number | string | undefined) ?? (s.minute as number | string | undefined) ?? (s.elapsed as number | string | undefined) ?? (s.match_minute as number | string | undefined));
      const toStr = (v: unknown): string | undefined => {
        const ss = v === undefined || v === null ? '' : String(v);
        return ss.trim() ? ss : undefined;
      };
      const inName = toStr(s.in_player ?? s.player_in ?? (typeof s.player === 'string' ? s.player : undefined));
      const outName = toStr(s.out_player ?? s.player_out);
      const side: 'home' | 'away' = (s.home || s.side === 'home' || s.team === 'home' || s.team === 'Home') ? 'home' : 'away';
      out.push({ minute: Number(minute)||0, team: side, type: 'sub', player: inName, assist: outName });
    }

    // If still empty, try to synthesize from comments list if present on raw
    if (out.length === 0) {
      try {
        const comments = (m?.comments || m?.comments_list || m?.all_comments || []) as unknown[];
        for (const cmRaw of comments) {
          const cm = cmRaw as Record<string, unknown>;
          const minuteVal = (cm.minute ?? cm.time ?? cm.elapsed ?? cm.match_minute) as number | string | undefined;
          const minute = toMinuteNumber(minuteVal);
          const text = String(cm.comment ?? cm.text ?? cm.description ?? "");
          const tags = detectTagsFromText(text);
          const t = deriveEventType(text, tags, cm);
          if (t) {
            const side = (cm.side === 'home' || /home/i.test(String(cm.team || ''))) ? 'home' : 'away';
            const { inName, outName } = parseSubstitutionPlayers({ description: text });
            const player = inName || String(cm.player || cm.player_name || cm.scorer || '' ) || undefined;
            const assist = outName || undefined;
            out.push({ minute: Number(minute) || 0, team: side as 'home'|'away', type: t as TLItem['type'], player, assist, note: text });
          }
        }
      } catch {}
    }

    if (out.length === 0) return null;
    out.sort((a,b) => (a.minute - b.minute));
    return out;
  }, [matchRaw, cleaned]);

  const allItems = synthesized && synthesized.length ? synthesized : cleaned;
  const allClusters = useMemo(() => clusterItems(allItems), [allItems]);

  // Horizontal layout configuration (compressed spacing)
  const cfg = useMemo(() => ({ pxPerMinute: 9, maxGapPx: 110, minGapPx: 24, leftPad: 36, rightPad: 44, startGapPx: 28, anchorGapPx: 28 }), []);

  const positions = useMemo(() => {
    let curX = cfg.leftPad + (cfg.startGapPx || 0); // add a gap after 0' so first event doesn't overlap the 0' tick
    const xs: number[] = [];
    for (let i = 0; i < allClusters.length; i++) {
      if (i === 0) {
        xs.push(curX);
        continue;
      }
      const prevMin = allClusters[i - 1].minute;
      const thisMin = allClusters[i].minute;
      const gapMin = Math.max(0, thisMin - prevMin);
      const rawGap = gapMin * cfg.pxPerMinute;
      const gapPx = Math.min(Math.max(rawGap, cfg.minGapPx), cfg.maxGapPx);
      // Give extra breathing room around half-time (45') and full-time (90') boundaries
      const crosses45 = prevMin < 45 && thisMin >= 45;
      const crosses90 = prevMin < 90 && thisMin >= 90;
      const extra = (crosses45 ? (cfg.anchorGapPx || 0) : 0) + (crosses90 ? (cfg.anchorGapPx || 0) : 0);
      curX += gapPx + extra;
      xs.push(curX);
    }
    let total = (xs.length ? xs[xs.length - 1] : cfg.leftPad) + cfg.rightPad;
    // Stretch to container width to look good
    const viewport = Math.max(width || 0, 0) - 48; // padding allowance
    if (viewport > 0 && total < viewport) {
      const extra = viewport - total;
      const bump = extra / (xs.length + 1);
      for (let i = 0; i < xs.length; i++) xs[i] += bump * (i + 1);
      total = viewport;
    }
    return { xs, total };
  }, [allClusters, width, cfg]);

  const minutesAll = allItems.map((e) => e.minute).filter((n) => Number.isFinite(n));
  const maxMinute = minutesAll.length ? Math.max(90, Math.max(...minutesAll)) : 90;

  // cluster label measurement/de-duplication removed; we show all labels on the baseline

  // --- Helpers to resolve images from provided context ---
  // Use roster resolver when available for higher-quality player images
  const findPlayerImage = (name?: string, team?: string) => {
    // First try resolve from roster/cache asynchronously (but we expose sync placeholder)
    // We'll try synchronous resolution from provided players array or matchRaw, otherwise return '';
    try {
      // Prefer explicit players prop arrays
      const keys = ['photo', 'headshot', 'player_image', 'player_photo', 'thumbnail', 'strThumb', 'photo_url', 'image', 'avatar', 'cutout', 'player_cutout'];
      const sources: any[] = [];
      if (Array.isArray(players?.home)) sources.push(...players!.home);
      if (Array.isArray(players?.away)) sources.push(...players!.away);
      const m = matchRaw as any;
      if (m && typeof m === 'object') {
        const candidates = m.players || m.players_list || m.squads || m.lineup || [];
        if (Array.isArray(candidates)) sources.push(...candidates);
      }
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
      const needle = norm(name || '');
      for (const p of sources) {
        if (!p || typeof p !== 'object') continue;
        const n = String(p.name || p.player || p.fullname || p.player_name || p.playerName || p.displayName || '').trim();
        if (!n) continue;
        if (norm(n).includes(needle) || needle.includes(norm(n))) {
          for (const k of keys) {
            const v = p[k];
            if (typeof v === 'string' && v.trim()) return v;
          }
        }
      }
      // Last resort: try to extract direct image fields from matchRaw object
      return resolvePlayerImageFromObj(m);
    } catch (_e) {
      return '';
    }
  };

  const findTeamLogo = (teamSide: 'home' | 'away'): string | '' => {
    try {
      const t = teamSide === 'home' ? teams?.home : teams?.away;
      if (t && typeof t === 'object') {
        // look for common logo fields
        const logoKeys = ['logo', 'badge', 'crest', 'team_logo', 'teamLogo', 'image', 'photo', 'thumbnail'];
        for (const k of logoKeys) if ((t as any)[k]) return String((t as any)[k]);
      }
      // try matchRaw fallback
      const m = matchRaw as Record<string, unknown> | null;
      if (m && typeof m === 'object') {
        const home = (m as Record<string, unknown>).event_home_team || (m as Record<string, unknown>).home_team || (m as Record<string, unknown>).strHomeTeam;
        const away = (m as Record<string, unknown>).event_away_team || (m as Record<string, unknown>).away_team || (m as Record<string, unknown>).strAwayTeam;
        const teamKey = teamSide === 'home' ? home : away;
        if (teamKey && (m as Record<string, unknown>).teams && Array.isArray((m as Record<string, unknown>).teams)) {
          const rec = (m as { teams: Array<Record<string, unknown>> }).teams.find((x: Record<string, unknown>) => String((x.name || x.team || x.team_name || x.strTeam) as string).toLowerCase() === String(teamKey).toLowerCase());
          if (rec) {
            const keys = ['logo', 'team_logo', 'logo_url', 'team_logo_url', 'team_image', 'image', 'strTeamBadge'];
            for (const k of keys) {
              const v = (rec as Record<string, unknown>)[k];
              if (typeof v === 'string' && v.trim()) return v;
            }
          }
        }
      }
    } catch {}
    return '';
  };

  // local in-memory brief cache keyed by `${minute}:${type}`
  const briefCacheRef = useRef<Record<string, string>>({});
  // sessionStorage-backed cache key prefix so cached briefs survive repeated hovers until page refresh
  const sessionPrefix = (() => {
    try {
      const m = matchRaw as any;
      const id = String(m?.id ?? m?.eventId ?? m?.event_id ?? m?.fixture_id ?? `${homeTeam || ''}-${awayTeam || ''}`);
      return `rt_brief_${id}_`;
    } catch { return `rt_brief_`; }
  })();
  // hydrate from sessionStorage once
  useEffect(() => {
    try {
      for (const k of Object.keys(sessionStorage)) {
        if (!k.startsWith(sessionPrefix)) continue;
        const val = sessionStorage.getItem(k);
        if (val) briefCacheRef.current[k.replace(sessionPrefix, '')] = val;
      }
    } catch {}
  }, [sessionPrefix]);
  // local in-memory player image cache to avoid repeated async fetches
  const playerImgCacheRef = useRef<Record<string, string>>({});

  return (
    <div className="space-y-6">
      <div className={cn("text-lg font-bold flex items-center gap-3 transition-colors duration-300", isDark ? "text-white" : "text-slate-900")}
      >
                    <div
          className={cn(
            "w-1 h-6 rounded-full shadow-lg transition-colors duration-300",
            isDark
              ? "bg-gradient-to-b from-blue-500 to-purple-600 shadow-blue-500/50"
              : "bg-gradient-to-b from-blue-500/80 to-purple-500/70 shadow-blue-400/40"
          )}
        ></div>
        Match Timeline
      </div>
      <div 
        ref={scrollerRef} 
        className={cn(
          "relative w-full overflow-x-auto overflow-y-hidden px-4 py-6 rounded-2xl backdrop-blur-sm transition-all duration-300",
          isDark ? "border border-slate-700/60" : "border border-slate-200/80 shadow-lg"
        )}
        style={{ 
          scrollBehavior: "smooth",
          background: surfaceStyles.background,
          boxShadow: surfaceStyles.boxShadow
        }}
      >
        <div 
          ref={trackRef} 
          className="relative" 
          style={{ height: 140, width: Math.max(positions.total, 600) }}
          title="Match Timeline - Hover over event markers to see details"
        >
          {/* Baseline */}
          <div className="absolute left-0 right-0" style={{ top: "50%", height: 3, transform: "translateY(calc(-50% - 1px))" }}>
            {/* Enhanced baseline with neon glow */}
          <div className="absolute left-0 right-0" style={{ top: "50%", height: 4, transform: "translateY(calc(-50% - 2px))" }}>
            {(() => {
              const startX = cfg.leftPad + (cfg.startGapPx || 0);
              const endX = (positions.total || 0) - cfg.rightPad;
              const ftX = tickX(90, allClusters, positions.xs, cfg);
              const greenW = Math.max(0, ftX - startX);
              const redW = Math.max(0, endX - ftX);
              return (
                <div className="absolute" style={{ left: startX, right: cfg.rightPad, height: 4 }}>
                  <div 
                    className="absolute h-full rounded-full" 
                    style={{ 
                      left: 0, 
                      width: greenW, 
                      background: "linear-gradient(90deg, #00ff88, #00d4aa)",
                      boxShadow: "0 0 15px rgba(0, 255, 136, 0.8), 0 0 30px rgba(0, 255, 136, 0.4), inset 0 0 10px rgba(255, 255, 255, 0.2)",
                      border: "1px solid rgba(0, 255, 136, 0.6)"
                    }} 
                  />
                  <div 
                    className="absolute h-full rounded-full" 
                    style={{ 
                      left: greenW, 
                      width: redW, 
                      background: "linear-gradient(90deg, #ff4444, #ff0066)",
                      boxShadow: "0 0 15px rgba(255, 68, 68, 0.8), 0 0 30px rgba(255, 68, 68, 0.4), inset 0 0 10px rgba(255, 255, 255, 0.2)",
                      border: "1px solid rgba(255, 68, 68, 0.6)"
                    }} 
                  />
                </div>
              );
            })()}
          </div>
          </div>

              {/* home logo removed per user request */}

              {/* away logo removed per user request */}
          {/* Sparse ticks for 0,45,90(+ET) rendered on baseline */}
          {[0, 45, 90].map((t) => (
            <Tick key={t} x={tickX(t, allClusters, positions.xs, cfg)} label={`${formatMinuteLabel(t)}\u0027`} isDark={isDark} />
          ))}
          {maxMinute > 90 && (
            <Tick x={tickX(maxMinute, allClusters, positions.xs, cfg)} label={`${formatMinuteLabel(maxMinute)}\u0027`} isDark={isDark} />
          )}

          {/* Markers per cluster */}
          {allClusters.map((c, i) => {
            const cx = positions.xs[i];
            const showLabel = true;
            return (
        <Cluster
              key={`c-${c.minute}-${i}`}
              x={cx}
              minute={c.minute}
              group={c.group}
              findPlayerImage={findPlayerImage}
              findTeamLogo={findTeamLogo}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              raw={matchRaw}
              briefCacheRef={briefCacheRef}
              eventId={String((matchRaw as any)?.eventId ?? (matchRaw as any)?.event_id ?? (matchRaw as any)?.event_key ?? (matchRaw as any)?.idEvent ?? (matchRaw as any)?.id ?? (matchRaw as any)?.fixture_id ?? '')}
              playerImgCacheRef={playerImgCacheRef}
              sessionPrefix={sessionPrefix}
              showLabel={showLabel}
          isDark={isDark}
              onHover={(html, ev) => {
                // Prefer to position tooltip relative to the hovered element's bounding rect
                const anyEv = ev as any;
                const getRect = (): DOMRect | null => {
                  try {
                    if (anyEv && anyEv.currentTarget && typeof anyEv.currentTarget.getBoundingClientRect === 'function') {
                      return anyEv.currentTarget.getBoundingClientRect();
                    }
                    if (anyEv && anyEv.target && typeof anyEv.target.getBoundingClientRect === 'function') {
                      return anyEv.target.getBoundingClientRect();
                    }
                  } catch {
                    return null;
                  }
                  return null;
                };
                const rect = getRect();
                if (rect && rect.width) {
                  const centerX = rect.left + rect.width / 2;
                  // If there's enough space above the element, show above; otherwise below
                  const showAbove = rect.top > 160;
                  const baseY = showAbove ? rect.top : rect.bottom;
                  setTooltip({ x: Math.round(centerX), y: Math.round(baseY), html, above: showAbove });
                } else {
                  // Fallback to mouse coords
                  const mx = (ev as any)?.clientX ?? (window.innerWidth / 2);
                  const my = (ev as any)?.clientY ?? (window.innerHeight / 3);
                  setTooltip({ x: mx + 8, y: my - 10, html, above: true });
                }
              }}
              onLeave={() => setTooltip(null)}
            />
            );
          })}

          {/* Overlay layer: explicitly render all cluster minute labels on the baseline to ensure perfect alignment */}
          <div className="absolute left-0 right-0 top-0 pointer-events-none">
            {allClusters.map((c, i) => {
              const cx = positions.xs[i];
              // Skip if this minute equals any tick minute (dedupe)
              const isTickMinute = c.minute === 0 || c.minute === 45 || c.minute === 90 || (maxMinute > 90 && c.minute === maxMinute);
              if (isTickMinute) return null;
              // Place label so its bottom aligns just above the baseline (avoid overlapping the line)
              return (
                <div
                  key={`lbl-${i}`}
                  className={cn(
                    "absolute text-[12px] font-semibold select-none transition-colors duration-200",
                    isDark ? "text-white" : "text-slate-700"
                  )}
                  style={{ left: cx, top: '50%', zIndex: 60, transform: 'translateX(-50%) translateY(230%)' }}
                >
                  <div
                    className={cn(
                      "px-2 py-0.5 rounded-md border transition-colors duration-200",
                      isDark ? "bg-slate-900/60 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"
                    )}
                    style={{ backdropFilter: "blur(6px)" }}
                    >
                    {`${formatMinuteLabel(c.minute)}\u0027`}
                  </div>
                </div>
              );
            })}
          </div>

          {/* measurement-based dedupe removed - all cluster labels render on the baseline */}

          {/* Enhanced glowing tooltip */}
          {tooltip && createPortal(
            (() => {
              // Constrain tooltip to viewport and translate to center horizontally
              const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
              const preferredWidth = 420;
              const halfW = Math.min(preferredWidth, vw - 40) / 2;
              const px = Math.min(Math.max(tooltip.x, 20 + halfW), vw - 20 - halfW);
              const top = tooltip.above ? (tooltip.y - 12) : (tooltip.y + 12);
              const translateY = tooltip.above ? '-100%' : '0%';
              const arrowTop = tooltip.above ? '100%' : '-8px';
              const arrowTransform = tooltip.above ? 'translateX(-50%) rotate(0deg)' : 'translateX(-50%) rotate(180deg)';
              return (
                <div className="pointer-events-none fixed z-[9999]" style={{ left: px, top, width: preferredWidth, maxWidth: Math.min(preferredWidth, vw - 40), transform: 'translateX(-50%)' }}>
                  <div style={{ position: 'relative', transform: `translateY(${translateY})` }}>
                      <div
                        className={cn(
                          "relative rounded-2xl border backdrop-blur-md shadow-2xl p-4 text-sm leading-6 rt-tooltip",
                          isDark ? "rt-tooltip-dark neon-card" : "rt-tooltip-light"
                        )}
                        style={(() => {
                          if (isDark) return {
                            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))",
                            borderColor: "rgba(148, 163, 184, 0.3)",
                            boxShadow: `0 25px 50px -12px rgba(0,0,0,0.5), 0 0 0 1px rgba(148,163,184,0.1), 0 0 20px rgba(59,130,246,0.12)`,
                            color: "white",
                            width: '100%'
                          };
                          return {
                            // visual fallback in case CSS is not loaded; primary styling lives in globals.css
                            background: 'white',
                            borderColor: 'rgba(226,232,240,0.9)',
                            boxShadow: `0 14px 30px rgba(15,23,42,0.06)`,
                            color: '#0f172a',
                            width: '100%'
                          };
                        })()}
                        dangerouslySetInnerHTML={{ __html: tooltip.html }}
                      />
                    {/* Arrow */}
                    <div style={{ position: 'absolute', left: '50%', top: arrowTop, transform: arrowTransform, width: 16, height: 8, overflow: 'visible' }}>
                      <svg width="16" height="8" viewBox="0 0 16 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M8 0L16 8H0L8 0Z" fill={isDark ? "rgba(15,23,42,0.95)" : "rgba(255,255,255,0.98)"} />
                      </svg>
                    </div>
                    <div
                      className="absolute inset-0 rounded-2xl opacity-60"
                      style={{
                        background: isDark ? "linear-gradient(135deg, rgba(59, 130, 246, 0.06), rgba(147, 51, 234, 0.04))" : "linear-gradient(180deg, rgba(255,255,255,0.6), rgba(240,243,246,0.6))",
                        filter: "blur(8px)",
                        zIndex: -1
                      }}
                    />
                  </div>
                </div>
              );
            })(),
            document.body
          )}
        </div>
      </div>
      {/* Enhanced Legend with professional icons */}
      <div className="flex flex-wrap gap-6 text-sm">
        <LegendItem color="#00ff88" label="Goal" type="goal" isDark={isDark} />
        <LegendItem color="#ffdd00" label="Yellow Card" type="yellow" isDark={isDark} />
        <LegendItem color="#ff0044" label="Red Card" type="red" isDark={isDark} />
        <LegendItem color="#8844ff" label="Substitution" type="sub" isDark={isDark} />
        <LegendItem color="#ff0066" label="Penalty Miss" type="pen_miss" isDark={isDark} />
        <LegendItem color="#00d4ff" label="Own Goal" type="own_goal" isDark={isDark} />
      </div>
    </div>
  );
}

function Tick({ x, label, isDark }: { x: number; label: string; isDark: boolean }) {
  return (
    <div
      data-label-type="tick"
      className={cn(
        "absolute text-xs font-semibold select-none transition-colors duration-200",
        isDark ? "text-slate-300" : "text-slate-500"
      )}
      style={{ left: x - 16, top: '50%', transform: 'translateY(-50%)' }}
    >
      {/* small vertical tick line above the baseline */}
      <div style={{ position: 'absolute', left: '50%', top: '-28px', transform: 'translateX(-50%)' }}>
        <div
          className={cn(
            "h-5 w-0.5 mx-auto rounded-full shadow-lg",
            isDark ? "bg-gradient-to-b from-gray-400 to-gray-600" : "bg-gradient-to-b from-slate-300 to-slate-400"
          )}
          style={{ boxShadow: isDark ? "0 0 8px rgba(156, 163, 175, 0.5)" : "0 0 6px rgba(148, 163, 184, 0.35)" }}
        />
      </div>
        <div
        className={cn(
          "text-center px-2 py-0.5 rounded-md border transition-colors duration-200",
          isDark ? "bg-slate-900/60 border-slate-700/50" : "bg-white border-slate-200 shadow-sm"
        )}
        style={{ backdropFilter: "blur(6px)", margin: '0 auto' }}
      >
        {label}
      </div>
    </div>
  );
}

function tickX(minute: number, clusters: { minute: number; group: TLItem[] }[], xs: number[], cfg: { leftPad: number }) {
  // For 0', pin to the true left pad (start of baseline), not the first cluster's X
  if (minute <= 0) return cfg.leftPad;
  if (!clusters.length) return cfg.leftPad;
  // If before first cluster, pin at first cluster X
  if (minute <= clusters[0].minute) return xs[0] ?? cfg.leftPad;
  for (let i = 1; i < clusters.length; i++) {
    if (minute <= clusters[i].minute) return xs[i];
  }
  return xs[xs.length - 1] ?? cfg.leftPad;
}

function Cluster({ x, minute, group, onHover, onLeave, findPlayerImage, findTeamLogo, homeTeam, awayTeam, raw, briefCacheRef, eventId, playerImgCacheRef, sessionPrefix, showLabel, clusterIndex, isDark }: { x: number; minute: number; group: TLItem[]; onHover: (html: string, ev: MouseEvent | React.MouseEvent) => void; onLeave: () => void; findPlayerImage: (name?: string, team?: string) => string; findTeamLogo: (side: 'home'|'away', name?: string) => string; homeTeam?: string; awayTeam?: string; raw?: unknown; briefCacheRef?: React.MutableRefObject<Record<string,string>>; eventId?: string; playerImgCacheRef?: React.MutableRefObject<Record<string,string>>; sessionPrefix?: string; showLabel?: boolean; clusterIndex?: number; isDark?: boolean; }) {
  const home = group.filter((g) => g.team === "home");
  const away = group.filter((g) => g.team === "away");
  // increased gap to avoid overlapping icons / minute badge
  const stackGap = 26;

  // Enhanced HTML builders with better styling
  // imgBox accepts optional primary src and an optional fallback (team logo).
  // If the primary image 404s, the img onerror will swap to the fallback; if neither exists it removes the img so placeholder can show.
  const imgBox = (src?: string, fallback?: string) => {
    const s = src ? escapeHtml(String(src)) : '';
    const fb = fallback ? escapeHtml(String(fallback)) : '';
    if (!s && !fb) return "";
    // Use data-fallback so the onerror handler can attempt to swap to the team logo when player image is missing/404
    return `<div style="width:48px;height:48px;overflow:hidden;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#1e293b,#334155);border:2px solid rgba(255,255,255,0.2);margin-right:12px;box-shadow:0 4px 12px rgba(0,0,0,0.4)"><img src="${s || fb}" data-fallback="${fb}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.onerror=null; if(this.dataset && this.dataset.fallback && this.src!==this.dataset.fallback){ this.src=this.dataset.fallback; } else { this.remove(); }"/></div>`;
  };

  const placeholderBox = () => `<div style="width:48px;height:48px;overflow:hidden;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#1e293b,#334155);border:2px solid rgba(255,255,255,0.2);margin-right:12px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.4)">👤</div>`;

  const tagChip = (t: string, glowColor?: string) => {
    const rgb = glowColor || "59, 130, 246";
    return `<span style="background:linear-gradient(135deg, rgba(${rgb}, 0.2), rgba(${rgb}, 0.1));border:1px solid rgba(${rgb}, 0.4);border-radius:20px;padding:4px 12px;font-size:11px;color:white;font-weight:600;box-shadow:0 0 10px rgba(${rgb}, 0.3);text-shadow:0 1px 2px rgba(0,0,0,0.8)">${escapeHtml(t)}</span>`;
  };

  const chipsHtmlFrom = (chips: string[], eventType?: TLItem["type"]) => {
    if (!chips.length) return '';
    const glowRGB = eventType ? glowColorFor(eventType) : "59, 130, 246";
    return `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${chips.map(c => tagChip(c, glowRGB)).join('')}</div>`;
  };

  const makeHtml = (brief?: string, loading = false) => {
    const rows = group.map((g) => {
      const icon = iconFor(g.type);
      const whoParts = [g.player ? escapeHtml(g.player) : '', g.assist ? ` (↦ ${escapeHtml(g.assist)})` : '', g.note ? ` — ${escapeHtml(g.note)}` : ''];
      const who = whoParts.filter(Boolean).join('');
      // Prefer cache-resolved image to avoid visual jump; fall back to sync resolver
      const normName = (s: string | undefined) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const cachedKey = normName(g.player);
      const pImgFromCache = (playerImgCacheRef && playerImgCacheRef.current && cachedKey) ? playerImgCacheRef.current[cachedKey] : '';
      const pImg = pImgFromCache || (typeof findPlayerImage === 'function' ? findPlayerImage(g.player, g.team === 'home' ? homeTeam : awayTeam) : '');
      const teamLogo = typeof findTeamLogo === 'function' ? findTeamLogo(g.team as any, g.team === 'home' ? homeTeam : awayTeam) : '';
      
  const left = loading ? placeholderBox() : imgBox(pImg, teamLogo);
      
      // Build enhanced tag chips with event-specific colors
      const chips: string[] = [];
      const typeToTag: Record<string, string> = { goal: 'GOAL', own_goal: 'OWN GOAL', pen_miss: 'PEN MISS', pen_score: 'PEN GOAL', yellow: 'YELLOW CARD', red: 'RED CARD', sub: 'SUBSTITUTION' };
      if (typeToTag[g.type]) chips.push(typeToTag[g.type]);
      chips.push(g.team === 'home' ? 'HOME' : 'AWAY');
      
      try {
        const base = (raw as Record<string, unknown>) || {};
        const rawTLUnknown = (base.timeline ?? base.timeline_items ?? base.events ?? base.event_timeline) as unknown;
        const rawTL = Array.isArray(rawTLUnknown) ? (rawTLUnknown as Array<Record<string, unknown>>) : [];
        if (rawTL.length) {
          const mt = (g.minute ?? 0);
          const cand = rawTL.find((it: Record<string, unknown>) => {
            const val = (it.minute ?? it.time ?? it.elapsed ?? '') as unknown;
            const m = typeof val === 'string' || typeof val === 'number' ? String(val) : '';
            const mm = Number(m.replace(/[^0-9]/g, '')) || 0;
            return mm === (Number(mt) || 0);
          });
          const tagsUnknown = (cand as Record<string, unknown> | undefined)?.predicted_tags as unknown;
          const tags = Array.isArray(tagsUnknown) ? tagsUnknown : [];
          for (const t of tags) {
            const up = String(t).toUpperCase();
            if (!chips.includes(up)) chips.push(up);
          }
          const scHome = cand?.score_home ?? cand?.home_score ?? cand?.homeGoals ?? cand?.goals_home;
          const scAway = cand?.score_away ?? cand?.away_score ?? cand?.awayGoals ?? cand?.goals_away;
          if (scHome !== undefined && scAway !== undefined) chips.push(`${scHome}-${scAway}`);
        }
      } catch {}

      const tagHtml = chipsHtmlFrom(chips, g.type);
      
      // Use emoji icons for tooltip since SVG doesn't render well in innerHTML
      const getEmojiIcon = (type: TLItem["type"]) => {
        switch (type) {
          case "goal":
          case "pen_score":
            return "⚽";
          case "own_goal":
            return "🥅";
          case "pen_miss":
            return "❌";
          case "yellow":
            return "🟨";
          case "red":
            return "🟥";
          case "sub":
            return "🔄";
          case "ht":
            return "HT";
          case "ft":
            return "FT";
          default:
            return "⚪";
        }
      };
      
      const emojiIcon = getEmojiIcon(g.type);
      const iconHtml = `<div style="width:24px;height:24px;color:${colorFor(g.type)};filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8));display:flex;align-items:center;justify-content:center;font-size:18px">${emojiIcon}</div>`;
      
      return `<div style="display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-bottom:1px solid rgba(148,163,184,0.1)">${left}<div style="display:flex;flex-direction:column;gap:8px;flex:1"><div style="display:flex;flex-direction:row;gap:12px;align-items:center">${iconHtml}<span style="color:white;font-weight:600;font-size:16px">${who || '<i style="color:#94a3b8">Event</i>'}</span></div>${tagHtml}</div></div>`;
    }).join('');
    
    const briefHtml = loading 
      ? `<div style="margin-top:12px;color:#94a3b8;font-size:14px;font-style:italic"><em>Loading details…</em></div>` 
      : (brief ? `<div style="margin-top:12px;color:#e2e8f0;font-size:14px;line-height:1.5;padding:12px;background:rgba(30,41,59,0.5);border-radius:8px;border-left:3px solid #3b82f6">${escapeHtml(brief)}</div>` : '');
    
  const finalHtml = `<div style="color:white"><div style="font-weight:700;margin-bottom:12px;font-size:18px;color:#f1f5f9;text-shadow:0 2px 4px rgba(0,0,0,0.8)">${formatMinuteLabel(minute)}'</div>${rows}${briefHtml}</div>`;
    return finalHtml;
  };

  // Async fetch brief if missing in cache and augment tooltip when available
  // Fetch brief and resolve player image, then update tooltip via provided event
  const isBriefPoor = (b: string | undefined | null) => {
    if (!b) return true;
    const s = String(b || '').trim();
    if (!s) return true;
    // Common poor patterns from providers: single token + ':' or 'yellow:' or just a tag
    if (/^[a-zA-Z]+:\s*$/.test(s)) return true;
    if (s.length < 6) return true; // too short to be useful
    return false;
  };
  
  const ensureBrief = async (ev?: MouseEvent | React.MouseEvent) => {
    try {
      const key = `${minute}:${group.map(g => g.type).join(',')}`;
      const cache = briefCacheRef?.current ?? {};
      
      // Build local fallback brief
      const buildFallbackBrief = () => {
        const g0 = group[0] || {};
        const playerName = g0.player ? String(g0.player).trim() : '';
        const eventTypeLabel = ({ 
          goal: 'Goal', own_goal: 'Own goal', pen_score: 'Penalty goal', 
          pen_miss: 'Penalty miss', yellow: 'Yellow card', red: 'Red card', sub: 'Substitution' 
        } as Record<string,string>)[g0.type || ''] || (g0.type ? String(g0.type) : 'Event');
        const teamSideLabel = g0.team ? (g0.team === 'home' ? (homeTeam || 'Home') : (awayTeam || 'Away')) : '';
        
        const parts: string[] = [];
        if (playerName) parts.push(playerName);
        if (eventTypeLabel) parts.push(eventTypeLabel);
        if (!playerName && teamSideLabel) parts.push(teamSideLabel);
        
        return parts.length ? `${parts.join(' — ')} (${minute}')` : `${eventTypeLabel} (${minute}')`;
      };
      
      const fallbackBrief = buildFallbackBrief();
      
      if (cache[key]) {
        // If cached, use cached brief
        const brief = cache[key];
        if (ev) onHover(makeHtml(brief, false), ev);
        return brief;
      }
      
      // Show fallback immediately while loading detailed brief
      if (ev) onHover(makeHtml(fallbackBrief, false), ev);

      // Resolve player image from roster and store in cache
      try {
        const primaryPlayer = group[0]?.player;
        const teamName = group[0]?.team === 'home' ? homeTeam : awayTeam;
        if (primaryPlayer && playerImgCacheRef) {
          const normName = (s: string | undefined) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const pkey = normName(String(primaryPlayer));
          if (!playerImgCacheRef.current[pkey]) {
            const img = await resolvePlayerImageByName(teamName, primaryPlayer).catch(() => '');
            if (img) {
              playerImgCacheRef.current[pkey] = img;
            } else {
              // try synchronous resolver from props/context as a last resort
              try {
                const syncImg = (typeof findPlayerImage === 'function') ? findPlayerImage(String(primaryPlayer), teamName) : '';
                if (syncImg) playerImgCacheRef.current[pkey] = syncImg;
              } catch {}
            }
          }
        }
      } catch (e) {}

      // Try to get detailed brief from summarizer
      let detailedBrief = '';
      try {
        const m = raw as any;
        const homeName = (m && (m.event_home_team || m.home_team || m.strHomeTeam)) || homeTeam;
        const awayName = (m && (m.event_away_team || m.away_team || m.strAwayTeam)) || awayTeam;
        const eventName = (!eventId && homeName && awayName) ? `${homeName} vs ${awayName}` : undefined;
        
        const ev = {
          minute: String(minute),
          type: group[0]?.type,
          description: group[0]?.note || undefined,
          player: group[0]?.player || undefined,
          team: group[0]?.team || undefined,
        };
        const payload: any = { events: [ev] };
        if (eventId) payload.eventId = String(eventId);
        if (eventName) payload.eventName = String(eventName);
        if (!payload.eventName && homeName && awayName) payload.eventName = `${homeName} vs ${awayName}`;
        
        const sum = await summarizeEventBriefs(payload).catch(() => null);
        const first = sum?.items?.[0];
        
        if (first?.brief) {
          detailedBrief = first.brief;
          
          // capture player image or team logo from summarizer item when present
          const pimg = first?.player_image;
          const tlogo = first?.team_logo;
          if ((pimg || tlogo) && group[0]?.player && playerImgCacheRef) {
            const pkey = String(group[0].player).toLowerCase().trim();
            if (!playerImgCacheRef.current[pkey]) playerImgCacheRef.current[pkey] = (pimg || tlogo) as string;
          }
        }
      } catch {
        detailedBrief = fallbackBrief;
      }

      // Use detailed brief if available, otherwise fallback
      const finalBrief = detailedBrief || fallbackBrief;
      
      // Cache the result
      const cacheObj = briefCacheRef?.current ?? {};
      cacheObj[key] = finalBrief;
      try {
        sessionStorage.setItem(sessionPrefix + key, finalBrief);
      } catch {}
      
      // Update tooltip with final brief
      if (ev) onHover(makeHtml(finalBrief, false), ev);
      return finalBrief;
    } catch (e) {
      console.error('Error in ensureBrief:', e);
      return '';
    }
  };

  return (
    <div className="absolute" style={{ left: x }}>
      {/* Home side (top) */}
      {home.map((g, i) => (
        <Marker key={`h-${i}`} y={40 - i * stackGap} color={colorFor(g.type)} icon={iconFor(g.type)} type={g.type} isDark={isDark}
          onMouseEnter={async (ev) => { 
            onHover(makeHtml(undefined, true), ev); 
            await ensureBrief(ev); 
          }} 
          onMouseLeave={onLeave} 
        />
      ))}

      {/* cluster minute label removed from here; labels are rendered together in an overlay so they're all exactly on the baseline */}

      {/* Away side (bottom) */}
      {away.map((g, i) => (
        <Marker key={`a-${i}`} y={112 + i * stackGap} color={colorFor(g.type)} icon={iconFor(g.type)} type={g.type} isDark={isDark}
          onMouseEnter={async (ev) => { 
            onHover(makeHtml(undefined, true), ev); 
            await ensureBrief(ev); 
          }} 
          onMouseLeave={onLeave} 
        />
      ))}
    </div>
  );
}

function Marker({ y, color, icon, onMouseEnter, onMouseLeave, type, isDark }: { y: number; color: string; icon: string; type?: TLItem["type"]; onMouseEnter: (ev: React.MouseEvent<HTMLDivElement>) => void; onMouseLeave: () => void; isDark?: boolean; }) {
  const glowRGB = type ? glowColorFor(type) : "107, 114, 128";
  
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 hover:scale-110"
      style={{ top: y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex flex-col items-center gap-2" style={{ zIndex: 30 }}>
        {/* Enhanced marker with neon glow */}
        <div 
          className="relative w-6 h-6 rounded-full border-2 border-white flex items-center justify-center transition-all duration-300 hover:scale-125" 
          style={{ 
            background: `linear-gradient(135deg, ${color}, ${color}dd)`,
            boxShadow: `
              0 0 20px rgba(${glowRGB}, 0.8),
              0 0 40px rgba(${glowRGB}, 0.4),
              0 0 60px rgba(${glowRGB}, 0.2),
              inset 0 0 10px rgba(255, 255, 255, 0.3)
            `,
            border: `2px solid rgba(${glowRGB}, 0.8)`
          }}
        >
          {/* Icon container with proper SVG rendering */}
            <div 
              className={cn("drop-shadow-lg", isDark ? "text-white" : "text-slate-800")}
              style={{ color: isDark ? "white" : "#0f172a", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.08))" }}
              dangerouslySetInnerHTML={{ __html: icon }}
            />
          
          {/* Pulsing glow ring */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `rgba(${glowRGB}, 0.18)`,
              boxShadow: `0 0 12px rgba(${glowRGB}, 0.35)`,
              transform: 'scale(1.25)',
              opacity: 0.85,
              pointerEvents: 'none'
            }}
          />
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label, type, isDark }: { color: string; label: string; type: TLItem["type"]; isDark: boolean }) {
  const glowRGB = glowColorFor(type);
  const icon = iconFor(type);
  
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-lg border backdrop-blur-sm transition-all duration-300",
        isDark
          ? "bg-slate-900/50 border-slate-700/60 hover:border-slate-600/50"
          : "bg-white border-slate-200 hover:border-slate-300 shadow-sm"
      )}
    >
      {/* Icon with glow */}
      <div 
        className={cn("w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold", isDark ? "text-white" : "text-slate-800")}
        style={{ 
          background: `linear-gradient(135deg, ${color}, ${color}dd)`,
          boxShadow: `0 0 10px rgba(${glowRGB}, 0.6), inset 0 0 5px rgba(255, 255, 255, 0.2)`,
          border: `1px solid rgba(${glowRGB}, 0.8)`
        }}
      >
        <div 
          className={isDark ? "text-white" : "text-slate-800"}
          style={{ filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.06))" }}
          dangerouslySetInnerHTML={{ __html: icon }}
        />
      </div>
      <span className={cn("font-medium transition-colors duration-200", isDark ? "text-slate-200" : "text-slate-700")}>{label}</span>
    </div>
  );
}

function escapeHtml(s: string | undefined) {
  return String(s ?? "").replace(/[&<>"'`=\/]/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "/": "&#x2F;", "`": "&#x60;", "=": "&#x3D;" } as Record<string, string>)[ch] || ch
  );
}

// --- Ported helpers from legacy timeline.js (simplified and adapted for the React component) ---
function getEventIcon(description?: string | null, tags?: any) {
  const desc = String(description || '').toLowerCase();
  const tagStr = Array.isArray(tags) ? tags.join(' ').toLowerCase() : String(tags || '').toLowerCase();
  if (desc.includes('goal') || tagStr.includes('goal')) return '⚽';
  if (desc.includes('yellow') || tagStr.includes('yellow')) return '🟨';
  if (desc.includes('red') || tagStr.includes('red')) return '🟥';
  if (desc.includes('substitution') || tagStr.includes('substitution')) return '↔️';
  if (desc.includes('corner') || tagStr.includes('corner')) return '📐';
  if (desc.includes('penalty') || tagStr.includes('penalty')) return '⚽';
  if (desc.includes('offside') || tagStr.includes('offside')) return '🚩';
  return '•';
}

function getEventColor(description?: string | null, tags?: any) {
  const desc = String(description || '').toLowerCase();
  const tagStr = Array.isArray(tags) ? tags.join(' ').toLowerCase() : String(tags || '').toLowerCase();
  if (desc.includes('goal') || tagStr.includes('goal')) return '#10b981';
  if (desc.includes('yellow') || tagStr.includes('yellow')) return '#f59e0b';
  if (desc.includes('red') || tagStr.includes('red')) return '#ef4444';
  if (desc.includes('substitution') || tagStr.includes('substitution')) return '#8b5cf6';
  return '#6b7280';
}

function getTagColor(tag?: string) {
  const t = String(tag || '').toLowerCase();
  if (t.includes('goal')) return '#10b981';
  if (t.includes('card')) return '#f59e0b';
  if (t.includes('substitution')) return '#8b5cf6';
  if (t.includes('penalty')) return '#ef4444';
  return '#6b7280';
}

function normalizeEventTags(evt?: any): string[] {
  const out: string[] = [];
  if (!evt) return out;
  const candidates: any[] = [];
  if (evt.tags) candidates.push(evt.tags);
  if (evt.predicted_tags) candidates.push(evt.predicted_tags);
  if (evt.predictedTags) candidates.push(evt.predictedTags);
  if (evt.labels) candidates.push(evt.labels);
  if (evt.labels_list) candidates.push(evt.labels_list);
  if (evt.card) candidates.push(evt.card);
  for (const c of candidates) {
    if (!c) continue;
    if (Array.isArray(c)) {
      for (const it of c) if (typeof it === 'string' && it.trim()) out.push(it.trim());
    } else if (typeof c === 'string') {
      const parts = c.split(/[;,|]/).map(s => s.trim()).filter(Boolean);
      out.push(...parts);
    } else if (typeof c === 'object') {
      // Accept objects with text/name fields
      if (c.text) out.push(String(c.text));
      else if (c.name) out.push(String(c.name));
    }
  }
  // De-duplicate and normalize
  const seen = new Set<string>();
  return out.map(s => String(s).trim()).filter(s => { const k = s.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

function detectTagsFromText(text?: string) {
  if (!text) return [] as string[];
  const t = String(text).toLowerCase();
  const tags = new Set<string>();
  if (t.includes('goal') || /scores?|scored|goal by|assist/.test(t)) tags.add('goal');
  if (t.includes('penalty')) tags.add('penalty');
  if (t.includes('yellow card') || t.includes('yellow')) tags.add('yellow card');
  if (t.includes('red card') || t.includes('sent off') || t.includes('red')) tags.add('red card');
  if (t.includes('substitution') || t.includes('sub') || t.includes('replaced')) tags.add('substitution');
  if (t.includes('corner')) tags.add('corner');
  if (t.includes('offside')) tags.add('offside');
  if (t.includes('penalty shootout') || t.includes('shootout')) tags.add('shootout');
  return Array.from(tags);
}

function parseSubstitutionPlayers(event: any) {
  const out = { inName: '', outName: '' };
  try {
    if (!event) return out;
    if (event.player_in || event.playerIn || event.player_in_name) out.inName = String(event.player_in || event.playerIn || event.player_in_name || '');
    if (event.player_out || event.playerOut || event.player_out_name) out.outName = String(event.player_out || event.playerOut || event.player_out_name || '');
    if (out.inName || out.outName) return out;
    const raw = event.raw || {};
    if (raw && typeof raw === 'object') {
      if (raw.in) out.inName = String(raw.in);
      if (raw.out) out.outName = String(raw.out);
    }
    if (out.inName || out.outName) return out;
    const desc = String(event.description || event.text || event.event || '');
    // Try a pattern like "Player A replaced Player B"
    const m = desc.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\s+(?:replaced|in for|on for)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)/i);
    if (m) {
      out.inName = m[1];
      out.outName = m[2];
    }
  } catch (_e) {}
  return out;
}

function deriveEventType(description?: string | null, tags?: string[] | undefined, ev?: any) {
  const t = (Array.isArray(tags) ? tags.join(' ').toLowerCase() : String(tags || '').toLowerCase());
  const d = String(description || '').toLowerCase();
  if (t.includes('goal') || /\bgoal\b|scored|scores?/.test(d)) return 'goal';
  if (t.includes('red') || d.includes('sent off') || d.includes('red card')) return 'red';
  if (t.includes('yellow') || d.includes('yellow card')) return 'yellow';
  if (t.includes('substitution') || /\bsub\b|replaced/.test(d)) return 'sub';
  return null;
}
