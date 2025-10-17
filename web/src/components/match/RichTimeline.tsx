"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { summarizeEventBriefs } from "@/lib/summarizer";
import { resolvePlayerImageByName, resolvePlayerImageFromObj, getTeamRoster } from "@/lib/roster";
import type { TLItem } from "@/lib/match-mappers";

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

// Basic icon/color mapping inspired by the provided timeline.js helpers
const iconFor = (type: TLItem["type"]) => {
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
      return "↔️";
    case "ht":
      return "HT";
    case "ft":
      return "FT";
    default:
      return "•";
  }
};

const colorFor = (type: TLItem["type"]) => {
  switch (type) {
    case "goal":
    case "pen_score":
      return "#10b981"; // green
    case "own_goal":
      return "#06b6d4"; // cyan
    case "pen_miss":
      return "#ef4444"; // red
    case "yellow":
      return "#f59e0b"; // amber
    case "red":
      return "#ef4444"; // red
    case "sub":
      return "#8b5cf6"; // violet
    default:
      return "#6b7280"; // gray
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
  // Ensure we always have at least HT/FT anchors so the track is meaningful
  const baseItems = useMemo<TLItem[]>(() => {
    const arr = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!arr.length) {
      return [
        { minute: 45, team: "home", type: "ht" },
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
  const [tooltip, setTooltip] = useState<{ x: number; y: number; html: string } | null>(null);

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
        const comments = (m?.comments || m?.comments_list || m?.all_comments || []) as any[];
        for (const cm of comments) {
          const minute = toMinuteNumber(cm.minute ?? cm.time ?? cm.elapsed ?? cm.match_minute);
          const text = String(cm.comment ?? cm.text ?? cm.description ?? "");
          const tags = detectTagsFromText(text);
          const t = deriveEventType(text, tags, cm);
          if (t) {
            const side = (cm.side === 'home' || /home/i.test(String(cm.team || ''))) ? 'home' : 'away';
            const { inName, outName } = parseSubstitutionPlayers({ description: text });
            const player = inName || String(cm.player || cm.player_name || cm.scorer || '' ) || undefined;
            const assist = outName || undefined;
            out.push({ minute: Number(minute) || 0, team: side as any, type: t as any, player, assist, note: text });
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
  const cfg = useMemo(() => ({ pxPerMinute: 9, maxGapPx: 110, minGapPx: 24, leftPad: 36, rightPad: 44 }), []);

  const positions = useMemo(() => {
    let curX = cfg.leftPad;
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
      curX += gapPx;
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
    const buildLocalBrief = (grp: TLItem[], min: number) => {
      try {
        const parts: string[] = [];
        const primary = grp[0] || {} as TLItem;
        const player = primary.player ? String(primary.player).trim() : '';
        const assist = primary.assist ? String(primary.assist).trim() : '';
        const note = primary.note ? String(primary.note).trim() : '';
        const typeMap: Record<string,string> = { goal: 'Goal', own_goal: 'Own goal', pen_score: 'Penalty (scored)', pen_miss: 'Penalty (missed)', yellow: 'Yellow card', red: 'Red card', sub: 'Substitution' };
        const tlabel = typeMap[primary.type || ''] || (primary.type ? String(primary.type) : 'Event');
        if (player) parts.push(player);
        parts.push(tlabel);
        if (assist) parts.push(`Assist: ${assist}`);
        if (note) parts.push(note);
        // include side if present
        if (primary.team) parts.push(primary.team === 'home' ? (homeTeam || 'Home') : (awayTeam || 'Away'));
        return `${parts.join(' — ')} (${min}')`;
      } catch (_e) { return `${grp.map(g=>g.type).join(', ')} (${min}')`; }
    };
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
        const keys = ['logo', 'team_logo', 'logo_url', 'team_logo_url', 'team_image', 'image', 'strTeamBadge'];
        for (const k of keys) {
          const v = (t as Record<string, unknown>)[k];
          if (typeof v === 'string' && v.trim()) return v;
        }
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
    <div className="space-y-3">
      <div className="text-base font-semibold">Match Timeline</div>
      <div ref={scrollerRef} className="relative w-full overflow-x-auto overflow-y-hidden px-2 pb-1" style={{ scrollBehavior: "smooth" }}>
        <div ref={trackRef} className="relative" style={{ height: 120, width: Math.max(positions.total, 600) }}>
          {/* Baseline */}
          <div className="absolute left-0 right-0" style={{ top: "50%", height: 3, transform: "translateY(calc(-50% - 1px))" }}>
            {/* Colored baseline: 0-90 green, 90+ red based on computed x positions */}
            {(() => {
              const startX = cfg.leftPad;
              const endX = (positions.total || 0) - cfg.rightPad;
              const ftX = tickX(90, allClusters, positions.xs, cfg);
              const greenW = Math.max(0, ftX - startX);
              const redW = Math.max(0, endX - ftX);
              return (
                <div className="absolute" style={{ left: startX, right: cfg.rightPad, height: 3 }}>
                  <div className="absolute h-full" style={{ left: 0, width: greenW, background: "linear-gradient(90deg,#10b981,#059669)", boxShadow: "0 0 6px rgba(16,185,129,0.35)", borderRadius: 2 }} />
                  <div className="absolute h-full" style={{ left: greenW, width: redW, background: "linear-gradient(90deg,#ef4444,#dc2626)", boxShadow: "0 0 6px rgba(239,68,68,0.35)", borderRadius: 2 }} />
                </div>
              );
            })()}
          </div>

          {/* Sparse ticks for 0,45,90(+ET) */}
          {[0, 45, 90].map((t) => (
            <Tick key={t} x={tickX(t, allClusters, positions.xs, cfg)} label={`${t}'`} />
          ))}
          {maxMinute > 90 && (
            <Tick x={tickX(maxMinute, allClusters, positions.xs, cfg)} label={`${maxMinute}'`} />
          )}

          {/* Markers per cluster */}
          {allClusters.map((c, i) => (
            <Cluster
              key={`c-${c.minute}-${i}`}
              x={positions.xs[i]}
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
              onHover={(html, ev) => {
                // If the event is a synthetic MouseEvent without client coords, place tooltip near center of screen
                const x = (ev as any)?.clientX ?? (window.innerWidth / 2);
                const y = (ev as any)?.clientY ?? (window.innerHeight / 3);
                setTooltip({ x: x + 8, y: y - 10, html });
              }}
              onLeave={() => setTooltip(null)}
            />
          ))}

          {/* Tooltip */}
          {tooltip && (
            <div
              className="pointer-events-none fixed z-[9999]"
              style={{ left: tooltip.x, top: tooltip.y, maxWidth: 380 }}
            >
              <div
                className="rounded-xl border bg-white/95 shadow-xl backdrop-blur p-3 text-xs leading-5"
                dangerouslySetInnerHTML={{ __html: tooltip.html }}
              />
            </div>
          )}
        </div>
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        <LegendItem color="#10b981" label="Goal" icon="⚽" />
        <LegendItem color="#f59e0b" label="Yellow" icon="🟨" />
        <LegendItem color="#ef4444" label="Red / Miss" icon="🟥/❌" />
        <LegendItem color="#8b5cf6" label="Substitution" icon="↔️" />
      </div>
    </div>
  );
}

function Tick({ x, label }: { x: number; label: string }) {
  return (
    <div className="absolute text-[10px] text-gray-500 select-none" style={{ left: x - 6, top: 10 }}>
      <div className="h-3 w-[1px] bg-gray-300 mx-auto" />
      <div className="mt-1">{label}</div>
    </div>
  );
}

function tickX(minute: number, clusters: { minute: number; group: TLItem[] }[], xs: number[], cfg: { leftPad: number }) {
  if (!clusters.length) return cfg.leftPad;
  if (minute <= clusters[0].minute) return xs[0] ?? cfg.leftPad;
  for (let i = 1; i < clusters.length; i++) {
    if (minute <= clusters[i].minute) return xs[i];
  }
  return xs[xs.length - 1] ?? cfg.leftPad;
}

function Cluster({ x, minute, group, onHover, onLeave, findPlayerImage, findTeamLogo, homeTeam, awayTeam, raw, briefCacheRef, eventId, playerImgCacheRef, sessionPrefix }: { x: number; minute: number; group: TLItem[]; onHover: (html: string, ev: MouseEvent | React.MouseEvent) => void; onLeave: () => void; findPlayerImage: (name?: string, team?: string) => string; findTeamLogo: (side: 'home'|'away', name?: string) => string; homeTeam?: string; awayTeam?: string; raw?: unknown; briefCacheRef?: React.MutableRefObject<Record<string,string>>; eventId?: string; playerImgCacheRef?: React.MutableRefObject<Record<string,string>>; sessionPrefix?: string; }) {
  const home = group.filter((g) => g.team === "home");
  const away = group.filter((g) => g.team === "away");
  const stackGap = 18;

  // Local HTML builders (self-contained, do not depend on timeline.js)
  const imgBox = (src?: string) => {
    if (!src) return "";
    const s = escapeHtml(String(src));
    return `<div style="width:36px;height:36px;overflow:hidden;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;margin-right:8px"><img src="${s}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.remove()"/></div>`;
  };

  const placeholderBox = () => `<div style="width:36px;height:36px;overflow:hidden;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;margin-right:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px"> </div>`;

  const tagChip = (t: string) => `<span style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;font-size:10px;color:#374151">${escapeHtml(t)}</span>`;

  const chipsHtmlFrom = (chips: string[]) => chips.length ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${chips.map(tagChip).join('')}</div>` : '';

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
      const imgBox = (src: string) => src ? `<div style="width:36px;height:36px;overflow:hidden;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;margin-right:8px"><img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.remove()"/></div>` : '';
      const placeholderBox = () => `<div style="width:36px;height:36px;overflow:hidden;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;margin-right:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:12px"> </div>`;
      const left = loading ? placeholderBox() : imgBox(pImg || teamLogo);
      // Build tag chips from type + any predicted_tags present on raw timeline entries + side + score
      const chips: string[] = [];
      const typeToTag: Record<string, string> = { goal: 'GOAL', own_goal: 'OWN GOAL', pen_miss: 'PEN MISS', pen_score: 'PEN GOAL', yellow: 'YELLOW CARD', red: 'RED CARD', sub: 'SUBSTITUTION' };
      if (typeToTag[g.type]) chips.push(typeToTag[g.type]);
      // tag team side
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
          // add score at minute if present
          const scHome = cand?.score_home ?? cand?.home_score ?? cand?.homeGoals ?? cand?.goals_home;
          const scAway = cand?.score_away ?? cand?.away_score ?? cand?.awayGoals ?? cand?.goals_away;
          if (scHome !== undefined && scAway !== undefined) chips.push(`${scHome}-${scAway}`);
        }
      } catch {}

      const tagHtml = chips.length
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${chips.map(t => `<span style=\"background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;font-size:10px;color:#374151\">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';
      return `<div style="display:flex;gap:8px;align-items:center">${left}<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start"><div style=\"display:flex;flex-direction:row;gap:8px;align-items:center\"><span style=\"font-size:16px;\">${icon}</span><span>${who || '<i>Event</i>'}</span></div>${tagHtml}</div></div>`;
    }).join('');
    const briefHtml = loading ? `<div style="margin-top:8px;color:#374151;font-size:12px"><em>Loading…</em></div>` : (brief ? `<div style="margin-top:8px;color:#374151;font-size:12px">${escapeHtml(brief)}</div>` : '');
    return `<div><div style="font-weight:700;margin-bottom:6px">${minute}'</div>${rows}${briefHtml}</div>`;
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
      if (cache[key]) {
        // If cached, also ensure images from cache are used (no-op)
        const brief = cache[key];
        if (ev) onHover(makeHtml(brief, false), ev);
        return brief;
      }
  // If we don't have a numeric/explicit eventId, attempt to call brief by eventName
  const m = raw as any;
  const homeName = (m && (m.event_home_team || m.home_team || m.strHomeTeam)) || homeTeam;
  const awayName = (m && (m.event_away_team || m.away_team || m.strAwayTeam)) || awayTeam;
  const eventName = (!eventId && homeName && awayName) ? `${homeName} vs ${awayName}` : undefined;
  // Build a small local fallback brief so tooltip doesn't stay empty
  const g0 = group[0] || {};
  const localBriefParts: string[] = [];
  const playerLabel = g0.player ? String(g0.player).trim() : '';
  const typeLabel = ({ goal: 'Goal', own_goal: 'Own goal', pen_score: 'Penalty goal', pen_miss: 'Penalty miss', yellow: 'Yellow card', red: 'Red card', sub: 'Substitution' } as Record<string,string>)[g0.type || ''] || (g0.type ? String(g0.type) : 'Event');
  if (playerLabel) localBriefParts.push(`${playerLabel}`);
  if (typeLabel) localBriefParts.push(typeLabel);
  const sideLabel = g0.team ? (g0.team === 'home' ? (homeName || 'Home') : (awayName || 'Away')) : '';
  if (!playerLabel && sideLabel) localBriefParts.push(sideLabel);
  const localFallbackBrief = localBriefParts.length ? `${localBriefParts.join(' — ')} (${minute}')` : `${typeLabel} (${minute}')`;

      // Resolve primary player image (if any) from roster and store in cache
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

      // Always call the summarizer for uncached events (single-event payload) and cache the result for the session
      let brief = '';
      try {
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
  if (first?.brief) brief = first.brief;
  else brief = localFallbackBrief;
        // capture player image or team logo from summarizer item when present
        const pimg = first?.player_image;
        const tlogo = first?.team_logo;
        if ((pimg || tlogo) && group[0]?.player && playerImgCacheRef) {
          const pkey = String(group[0].player).toLowerCase().trim();
          if (!playerImgCacheRef.current[pkey]) playerImgCacheRef.current[pkey] = (pimg || tlogo) as string;
        }
      } catch {
        brief = localFallbackBrief;
      }
      const cacheObj = briefCacheRef?.current ?? {};
    // final local fallback if summarizer didn't return anything
  if (!brief) brief = localFallbackBrief;
  cacheObj[key] = brief;
  try {
    sessionStorage.setItem(sessionPrefix + key, brief);
  } catch {}
      if (ev) onHover(makeHtml(brief, false), ev);
      return brief;
    } catch (e) {
      return '';
    }
  };

  return (
    <div className="absolute" style={{ left: x }}>
      {/* Home side (top) */}
      {home.map((g, i) => (
        <Marker key={`h-${i}`} y={40 - i * stackGap} color={colorFor(g.type)} icon={iconFor(g.type)}
          onMouseEnter={async (ev) => { onHover(makeHtml(undefined, true), ev); await ensureBrief(ev); }} onMouseLeave={onLeave} />
      ))}

      {/* Minute label bubble */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] text-gray-700 select-none" style={{ top: 60 }}>
  <div className="rounded-md bg-gray-100 px-1.5 py-0.5 border border-white shadow-sm">{minute}&rsquo;</div>
      </div>

      {/* Away side (bottom) */}
      {away.map((g, i) => (
        <Marker key={`a-${i}`} y={80 + i * stackGap} color={colorFor(g.type)} icon={iconFor(g.type)}
          onMouseEnter={async (ev) => { onHover(makeHtml(undefined, true), ev); await ensureBrief(ev); }} onMouseLeave={onLeave} />
      ))}
    </div>
  );
}

function Marker({ y, color, icon, onMouseEnter, onMouseLeave }: { y: number; color: string; icon: string; onMouseEnter: (ev: React.MouseEvent<HTMLDivElement>) => void; onMouseLeave: () => void; }) {
  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ top: y }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex flex-col items-center gap-1">
        <div className="w-2 h-2 rounded-full border-[3px] border-white" style={{ background: color, boxShadow: `0 0 0 2px ${color}` }} />
        <div className="text-sm leading-none" style={{ color }}>{icon}</div>
      </div>
    </div>
  );
}

function LegendItem({ color, icon, label }: { color: string; icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      <span className="text-xs">{icon} {label}</span>
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
