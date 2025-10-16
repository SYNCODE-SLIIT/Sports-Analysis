"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  const findPlayerImage = (name?: string): string | '' => {
    if (!name) return '';
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    const needle = norm(name);
    const sources: Array<Record<string, unknown>> = [];
    if (Array.isArray(players?.home)) sources.push(...players!.home as Array<Record<string, unknown>>);
    if (Array.isArray(players?.away)) sources.push(...players!.away as Array<Record<string, unknown>>);
    // fall back to matchRaw players array if present
    try {
      const m = matchRaw as Record<string, unknown> | null;
      if (m && typeof m === 'object') {
        const candidates = (m as Record<string, unknown>).players
          || (m as Record<string, unknown>).players_list
          || (m as Record<string, unknown>).squads
          || (m as Record<string, unknown>).lineup
          || [];
        if (Array.isArray(candidates)) sources.push(...candidates as Array<Record<string, unknown>>);
      }
  } catch {}

    const keys = ['photo', 'headshot', 'player_image', 'player_photo', 'thumbnail', 'strThumb', 'photo_url', 'image', 'avatar', 'cutout', 'player_cutout'];
    for (const p of sources) {
      if (!p || typeof p !== 'object') continue;
      const n = String(((p as Record<string, unknown>).name
        || (p as Record<string, unknown>).player
        || (p as Record<string, unknown>).fullname
        || (p as Record<string, unknown>).player_name
        || (p as Record<string, unknown>).playerName
        || (p as Record<string, unknown>).displayName
        ) || '').trim();
      if (!n) continue;
      if (norm(n).includes(needle) || needle.includes(norm(n))) {
        for (const k of keys) {
          const v = (p as Record<string, unknown>)[k];
          if (typeof v === 'string' && v.trim()) return v;
        }
      }
    }
    return '';
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
              onHover={(html, ev) => {
                setTooltip({ x: ev.clientX + 8, y: ev.clientY - 10, html });
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

function Cluster({ x, minute, group, onHover, onLeave, findPlayerImage, findTeamLogo, homeTeam, awayTeam, raw }: { x: number; minute: number; group: TLItem[]; onHover: (html: string, ev: MouseEvent | React.MouseEvent) => void; onLeave: () => void; findPlayerImage: (name?: string) => string; findTeamLogo: (side: 'home'|'away', name?: string) => string; homeTeam?: string; awayTeam?: string; raw?: unknown; }) {
  const home = group.filter((g) => g.team === "home");
  const away = group.filter((g) => g.team === "away");
  const stackGap = 18;

  const makeHtml = () => {
    const rows = group.map((g) => {
      const icon = iconFor(g.type);
      const whoParts = [g.player ? escapeHtml(g.player) : '', g.assist ? ` (↦ ${escapeHtml(g.assist)})` : '', g.note ? ` — ${escapeHtml(g.note)}` : ''];
      const who = whoParts.filter(Boolean).join('');
      const pImg = typeof findPlayerImage === 'function' ? findPlayerImage(g.player) : '';
  const teamLogo = typeof findTeamLogo === 'function' ? findTeamLogo(g.team, g.team === 'home' ? homeTeam : awayTeam) : '';
      const imgBox = (src: string) => src ? `<div style="width:36px;height:36px;overflow:hidden;border-radius:8px;flex-shrink:0;background:linear-gradient(135deg,#f3f4f6,#e5e7eb);border:2px solid white;margin-right:8px"><img src="${src}" style="width:100%;height:100%;object-fit:cover;display:block" onerror="this.remove()"/></div>` : '';
      const left = imgBox(pImg || teamLogo);
      // Build tag chips from type + any predicted_tags present on raw timeline entries
      const chips: string[] = [];
      const typeToTag: Record<string, string> = { goal: 'GOAL', own_goal: 'OWN GOAL', pen_miss: 'PEN MISS', pen_score: 'PEN GOAL', yellow: 'YELLOW CARD', red: 'RED CARD', sub: 'SUBSTITUTION' };
      if (typeToTag[g.type]) chips.push(typeToTag[g.type]);
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
        }
      } catch {}

      const tagHtml = chips.length
        ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">${chips.map(t => `<span style=\"background:#f3f4f6;border:1px solid #e5e7eb;border-radius:999px;padding:2px 8px;font-size:10px;color:#374151\">${escapeHtml(t)}</span>`).join('')}</div>`
        : '';

      return `<div style="display:flex;gap:8px;align-items:center">${left}<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start"><div style=\"display:flex;flex-direction:row;gap:8px;align-items:center\"><span style=\"font-size:16px;\">${icon}</span><span>${who || '<i>Event</i>'}</span></div>${tagHtml}</div></div>`;
    }).join('');
    return `<div><div style="font-weight:700;margin-bottom:6px">${minute}'</div>${rows}</div>`;
  };

  return (
    <div className="absolute" style={{ left: x }}>
      {/* Home side (top) */}
      {home.map((g, i) => (
        <Marker key={`h-${i}`} y={40 - i * stackGap} color={colorFor(g.type)} icon={iconFor(g.type)}
          onMouseEnter={(ev) => onHover(makeHtml(), ev)} onMouseLeave={onLeave} />
      ))}

      {/* Minute label bubble */}
      <div className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] text-gray-700 select-none" style={{ top: 60 }}>
  <div className="rounded-md bg-gray-100 px-1.5 py-0.5 border border-white shadow-sm">{minute}&rsquo;</div>
      </div>

      {/* Away side (bottom) */}
      {away.map((g, i) => (
        <Marker key={`a-${i}`} y={80 + i * stackGap} color={colorFor(g.type)} icon={iconFor(g.type)}
          onMouseEnter={(ev) => onHover(makeHtml(), ev)} onMouseLeave={onLeave} />
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
