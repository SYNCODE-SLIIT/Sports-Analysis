"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MatchCard } from "@/components/MatchCard";
import { listSeasons, postCollect, sanitizeInput, type DataObject, type Json } from "@/lib/collect";
import { parseFixtures, type Fixture } from "@/lib/schemas";

type Props = {
  leagueName?: string;
  seasonLabel?: string; // e.g., "Current Season", "2023/2024", or "2023"
  title?: string;
};

const CURRENT_SEASON_KEY = "__current__";

const toISODate = (d: Date) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const seasonRangeFor = (labelRaw?: string): { from: string; to: string } | null => {
  if (!labelRaw) return null;
  const label = labelRaw.trim();
  const now = new Date();
  const asDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

  if (/current/i.test(label) || label === CURRENT_SEASON_KEY) {
    const y = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const start = month >= 6 ? asDate(y, 6, 1) : asDate(y - 1, 6, 1); // July = 6
    const end = asDate(start.getUTCFullYear() + 1, 5, 30);
    return { from: toISODate(start), to: toISODate(end) };
  }

  const mSeason = label.match(/^(\d{4})[\/\-](\d{2}|\d{4})$/);
  if (mSeason) {
    const startYear = Number(mSeason[1]);
    const endRaw = mSeason[2];
    const endYear = endRaw.length === 2 ? Number(`${String(startYear).slice(0, 2)}${endRaw}`) : Number(endRaw);
    const start = asDate(startYear, 6, 1);
    const end = asDate(endYear, 5, 30);
    return { from: toISODate(start), to: toISODate(end) };
  }

  const mYear = label.match(/^(\d{4})$/);
  if (mYear) {
    const y = Number(mYear[1]);
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }

  return null;
};

const MAX_SEASON_OPTIONS = 5;

type SeasonOption = {
  value: string;
  label: string;
};

type SeasonFormat = "split" | "calendar";

const normalizeSeasonLabel = (value: unknown): string | null => {
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

const seasonSortValue = (label: string): number => {
  const lower = label.toLowerCase();
  if (lower.includes("current")) return Number.POSITIVE_INFINITY;
  const matches = label.match(/\d{4}/g);
  if (!matches || matches.length === 0) return Number.NEGATIVE_INFINITY;
  return Number(matches[0]);
};

const detectSeasonFormat = (label?: string | null): SeasonFormat => {
  if (!label) return "split";
  const trimmed = label.trim();
  if (!trimmed) return "split";
  if (/^\d{4}$/.test(trimmed)) return "calendar";
  if (/current/i.test(trimmed)) return "split";
  if (/^\d{4}[\/\-](\d{2}|\d{4})$/.test(trimmed)) return "split";
  return "split";
};

const labelToValue = (label: string): string => (/current/i.test(label) ? CURRENT_SEASON_KEY : label);

const valueToLabel = (value: string, options: SeasonOption[]): string | undefined => {
  if (!value) return undefined;
  const match = options.find(opt => opt.value === value);
  if (match) return match.label;
  if (value === CURRENT_SEASON_KEY) return "Current Season";
  return undefined;
};

const seasonStartYearFromLabel = (label: string | undefined, format: SeasonFormat): number | null => {
  if (!label) return null;
  const normalized = normalizeSeasonLabel(label) ?? label.trim();
  const yearOnly = normalized.match(/^(\d{4})$/);
  if (yearOnly) return Number(yearOnly[1]);
  const match = normalized.match(/^(\d{4})[\/\-](\d{2}|\d{4})$/);
  if (match) return Number(match[1]);
  if (format === "calendar") {
    const numeric = Number(normalized.slice(0, 4));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

const currentStartYear = (format: SeasonFormat): number => {
  const now = new Date();
  const year = now.getUTCFullYear();
  if (format === "calendar") return year;
  return now.getUTCMonth() >= 6 ? year : year - 1;
};

const buildSequentialLabels = (
  format: SeasonFormat,
  existingLabels: string[],
  preferredLabel?: string,
  count = 0
): string[] => {
  if (count <= 0) return [];
  const normalizedPreferred = preferredLabel ? normalizeSeasonLabel(preferredLabel) ?? preferredLabel.trim() : undefined;
  const labelPool = [...existingLabels];
  if (normalizedPreferred) labelPool.push(normalizedPreferred);

  const numericYears = labelPool
    .map(label => seasonStartYearFromLabel(label, format))
    .filter((year): year is number => year !== null);

  const anchor = numericYears.length ? Math.max(...numericYears, currentStartYear(format)) : currentStartYear(format);

  const existingKeys = new Set(existingLabels.map(label => label.toLowerCase()));
  if (normalizedPreferred) existingKeys.add(normalizedPreferred.toLowerCase());

  const extras: string[] = [];
  let offset = 0;
  const maxAttempts = count * 6;
  while (extras.length < count && offset < maxAttempts) {
    const year = anchor - offset;
    offset += 1;
    const label = format === "calendar" ? String(year) : `${year}/${year + 1}`;
    const key = label.toLowerCase();
    if (existingKeys.has(key)) continue;
    extras.push(label);
    existingKeys.add(key);
  }
  return extras;
};

const buildSeasonOptions = (apiLabels: string[], preferredLabel?: string): SeasonOption[] => {
  const normalizedPreferred = preferredLabel ? normalizeSeasonLabel(preferredLabel) ?? preferredLabel.trim() : undefined;
  const normalizedApi = apiLabels
    .map(item => {
      const normalized = normalizeSeasonLabel(item);
      if (normalized) return normalized;
      return typeof item === "string" ? item.trim() : "";
    })
    .filter((item): item is string => Boolean(item));

  const format = detectSeasonFormat(normalizedPreferred ?? normalizedApi[0]);

  const optionsMap = new Map<string, string>();
  const addLabel = (label?: string | null) => {
    if (!label) return;
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!optionsMap.has(key)) optionsMap.set(key, trimmed);
  };

  normalizedApi.forEach(addLabel);
  if (format === "split") addLabel("Current Season");
  addLabel(normalizedPreferred);

  const extrasNeeded = Math.max(0, MAX_SEASON_OPTIONS - optionsMap.size);
  if (extrasNeeded > 0) {
    const existingValues = Array.from(optionsMap.values());
    if (format === "split" && optionsMap.has("current season")) {
      const currentYear = currentStartYear(format);
      existingValues.push(`${currentYear}/${currentYear + 1}`);
    }
    const extras = buildSequentialLabels(format, existingValues, normalizedPreferred, extrasNeeded);
    extras.forEach(addLabel);
  }

  const sorted = Array.from(optionsMap.values()).sort((a, b) => seasonSortValue(b) - seasonSortValue(a));
  return sorted.slice(0, MAX_SEASON_OPTIONS).map(label => ({ value: labelToValue(label), label }));
};

const extractSeasonLabels = (raw: unknown): string[] => {
  const labels = new Set<string>();
  const add = (candidate: unknown) => {
    const normalized = normalizeSeasonLabel(candidate);
    if (normalized) labels.add(normalized);
  };

  const walk = (value: unknown) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      Object.entries(obj).forEach(([key, val]) => {
        if (/season/i.test(key)) add(val);
      });
      Object.values(obj).forEach(walk);
      return;
    }
    add(value);
  };

  walk(raw);
  return Array.from(labels).sort((a, b) => seasonSortValue(b) - seasonSortValue(a));
};

const derivePreferredValue = (options: SeasonOption[], preferredLabel?: string): string => {
  if (!options.length) return "";
  if (preferredLabel) {
    const trimmed = preferredLabel.trim();
    if (trimmed) {
      const preferredValue = labelToValue(trimmed);
      const matchByValue = options.find(opt => opt.value === preferredValue);
      if (matchByValue) return matchByValue.value;
      const normalized = normalizeSeasonLabel(trimmed) ?? trimmed;
      const matchByLabel = options.find(opt => opt.label.toLowerCase() === normalized.toLowerCase());
      if (matchByLabel) return matchByLabel.value;
    }
  }
  return options[0].value;
};

export function LeagueSeasonMatches({ leagueName, seasonLabel, title = "Season Matches" }: Props) {
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<number>(24);
  const initialOptionsRef = useRef<SeasonOption[] | null>(null);
  if (!initialOptionsRef.current) {
    initialOptionsRef.current = buildSeasonOptions([], seasonLabel);
  }
  const [rawSeasonLabels, setRawSeasonLabels] = useState<string[]>([]);
  const [seasonOptions, setSeasonOptions] = useState<SeasonOption[]>(initialOptionsRef.current ?? []);
  const [selectedSeason, setSelectedSeason] = useState<string>(() =>
    derivePreferredValue(initialOptionsRef.current ?? [], seasonLabel)
  );
  const [userOverride, setUserOverride] = useState<boolean>(false);
  const prevSeasonLabelRef = useRef<string | undefined>(seasonLabel);

  useEffect(() => {
    if (!leagueName) {
      setRawSeasonLabels([]);
      return;
    }
    let cancelled = false;
    listSeasons({ leagueName })
      .then(resp => {
        if (cancelled) return;
        const payload = (resp?.data as { seasons?: unknown })?.seasons ?? resp?.data;
        const extracted = extractSeasonLabels(payload);
        setRawSeasonLabels(extracted);
      })
      .catch(() => {
        if (!cancelled) setRawSeasonLabels([]);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueName]);

  useEffect(() => {
    const nextOptions = buildSeasonOptions(rawSeasonLabels, seasonLabel);
    setSeasonOptions(nextOptions);

    const seasonChanged = seasonLabel !== prevSeasonLabelRef.current;
    if (seasonChanged) {
      prevSeasonLabelRef.current = seasonLabel;
      if (userOverride) setUserOverride(false);
    }

    setSelectedSeason(prevValue => {
      if (seasonChanged) {
        return derivePreferredValue(nextOptions, seasonLabel);
      }
      if (prevValue && nextOptions.some(opt => opt.value === prevValue)) {
        if (userOverride) return prevValue;
      }
      if (!nextOptions.length) return "";
      return derivePreferredValue(nextOptions, seasonLabel);
    });
  }, [rawSeasonLabels, seasonLabel, userOverride]);

  useEffect(() => {
    if (!leagueName) return;
    const fallbackValue = seasonLabel ? labelToValue(seasonLabel) : "";
    const activeValue = selectedSeason || fallbackValue;
    const activeLabel = valueToLabel(activeValue, seasonOptions) ?? seasonLabel ?? "";
    if (!activeLabel) return;

    const labelCandidates: string[] = [];
    labelCandidates.push(activeLabel);
    const normalizedActive = normalizeSeasonLabel(activeLabel);
    if (normalizedActive) labelCandidates.push(normalizedActive);
    if (seasonLabel) {
      labelCandidates.push(seasonLabel);
      const normalizedProp = normalizeSeasonLabel(seasonLabel);
      if (normalizedProp) labelCandidates.push(normalizedProp);
    }
    const range =
      labelCandidates.reduce<{ from: string; to: string } | null>((acc, label) => acc ?? seasonRangeFor(label), null);
    if (!range) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setVisible(24);

    const args: Record<string, Json> = {
      leagueName: sanitizeInput(leagueName),
      from: range.from,
      to: range.to,
    };

    postCollect<{ events?: DataObject[]; result?: DataObject[]; results?: DataObject[] }>("events.list", args)
      .then(resp => {
        if (cancelled) return;
        const d = resp?.data as Record<string, unknown> | undefined;
        let raw: unknown = [];
        if (d && typeof d === "object") {
          const get = (key: string) => (d as Record<string, unknown>)[key];
          raw =
            (get("events") as unknown) ??
            (get("result") as unknown) ??
            (get("results") as unknown) ??
            (get("items") as unknown) ??
            [];
        }
        const parsed = parseFixtures(Array.isArray(raw) ? raw : []);

        const seen = new Set<string>();
        const unique = parsed.filter(match => {
          const keyBase = match.id || `${match.home_team}-${match.away_team}-${match.date}-${match.time ?? ""}`;
          if (!keyBase) return true;
          if (seen.has(keyBase)) return false;
          seen.add(keyBase);
          return true;
        });

        const ts = (f: Fixture) => {
          const rawDate = f.date ?? "";
          if (rawDate.includes("T")) {
            const parsed = Date.parse(rawDate);
            if (!Number.isNaN(parsed)) return parsed;
          }
          const baseDate = rawDate.split("T")[0];
          const t = f.time ?? "00:00";
          const hhmmss = t.length === 5 ? `${t}:00` : t;
          const parsed = Date.parse(`${baseDate}T${hhmmss}Z`);
          return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
        };
        const sorted = unique.sort((a, b) => ts(a) - ts(b));
        setFixtures(sorted);
      })
      .catch(error => {
        if (!cancelled) setError(error instanceof Error ? error.message : "Failed to load season matches.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [leagueName, selectedSeason, seasonOptions, seasonLabel]);

  const handleSeasonChange = (value: string) => {
    setUserOverride(true);
    setSelectedSeason(value);
  };

  const effectiveSelectedSeason = selectedSeason || (seasonOptions[0]?.value ?? "");

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-xl font-semibold text-foreground">{title}</CardTitle>
        {seasonOptions.length > 1 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Season</span>
            <select
              value={effectiveSelectedSeason}
              onChange={evt => handleSeasonChange(evt.target.value)}
              className="rounded-md border border-border/60 bg-background px-3 py-1 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {seasonOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[360px] w-full rounded-2xl" />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-destructive">{error}</div>
        ) : fixtures.length === 0 ? (
          <div className="text-sm text-muted-foreground">No matches found for this season window.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {fixtures.slice(0, visible).map(fx => (
                <MatchCard key={`${fx.id}-${fx.date}`} fixture={fx} className="h-full" />
              ))}
            </div>
            {visible < fixtures.length ? (
              <div className="mt-4 flex justify-center">
                <Button variant="outline" onClick={() => setVisible(v => v + 24)}>
                  Show more ({fixtures.length - visible} more)
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default LeagueSeasonMatches;
