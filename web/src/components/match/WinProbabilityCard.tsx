"use client";

import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DataObject } from "@/lib/collect";

type WinProbabilityCardProps = {
  homeTeam: string;
  awayTeam: string;
  fallback: { home: number; draw: number; away: number };
  rawInsight: Record<string, unknown> | null | undefined;
  rawEvent: DataObject | null;
  teams: { home: DataObject | null; away: DataObject | null };
};

type SideInfo = {
  name: string;
  role: "Home" | "Away" | "Neutral";
  pct: number;
  logo?: string;
};

type ProbabilityViewModel = {
  home: SideInfo;
  drawPct: number;
  away: SideInfo;
  method?: string;
  sample?: number;
  source: "insight" | "fallback";
};

const LOGO_KEYS = [
  "logo",
  "team_logo",
  "logo_url",
  "badge",
  "crest",
  "team_badge",
  "teamBadge",
  "team_image",
  "teamImage",
  "image",
  "strTeamBadge",
  "badge_url",
  "club_logo",
  "home_team_logo",
  "away_team_logo",
  "home_logo",
  "away_logo",
  "primary_logo",
];

export default function WinProbabilityCard({
  homeTeam,
  awayTeam,
  fallback,
  rawInsight,
  rawEvent,
  teams,
}: WinProbabilityCardProps) {
  const model = useMemo(
    () =>
      buildProbabilityModel({
        insight: rawInsight,
        fallback,
        homeTeam,
        awayTeam,
        rawEvent,
        teams,
      }),
    [rawInsight, fallback, homeTeam, awayTeam, rawEvent, teams]
  );

  const isLoading = rawInsight === undefined;

  const summary = `${model.home.name} (${model.home.role}) ${formatPercent(model.home.pct)}% • Draw ${formatPercent(model.drawPct)}% • ${model.away.name} (${model.away.role}) ${formatPercent(model.away.pct)}%`;

  const segments = [
    { key: "home", pct: model.home.pct, color: "bg-emerald-500" },
    { key: "draw", pct: model.drawPct, color: "bg-amber-500" },
    { key: "away", pct: model.away.pct, color: "bg-sky-500" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          <span>Win Probabilities</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <ProbabilitySkeleton />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 text-center md:grid-cols-3">
              <ProbabilityTile
                label={`${model.home.name} ${model.home.role === "Home" ? "Win" : model.home.role === "Away" ? "Win" : "Result"}`}
                pct={model.home.pct}
                accent="text-emerald-600"
              />
              <ProbabilityTile label="Draw" pct={model.drawPct} accent="text-amber-600" />
              <ProbabilityTile
                label={`${model.away.name} ${model.away.role === "Away" ? "Win" : model.away.role === "Home" ? "Win" : "Result"}`}
                pct={model.away.pct}
                accent="text-sky-600"
              />
            </div>

            <div className="space-y-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <TeamSpotlight side={model.home} align="start" />
                <div className="text-sm text-muted-foreground md:max-w-md md:text-center">{summary}</div>
                <TeamSpotlight side={model.away} align="end" />
              </div>

              <div className="flex h-4 overflow-hidden rounded-full bg-muted">
                {segments.map(segment => (
                  <div
                    key={segment.key}
                    className={`h-full transition-all ${segment.color}`}
                    style={{ width: `${segment.pct}%` }}
                  />
                ))}
              </div>

              <div className="space-y-3 text-sm">
                {segments.map(segment => (
                  <ProbabilityRow
                    key={segment.key}
                    label={segment.key === "home" ? `${model.home.name} (${model.home.role})` : segment.key === "away" ? `${model.away.name} (${model.away.role})` : "Draw"}
                    pct={segment.pct}
                    color={segment.color}
                  />
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <div>
                Method: {model.method ?? "unknown"}
                {typeof model.sample === "number" && model.sample > 0 ? ` • n=${Math.round(model.sample)}` : null}
              </div>
              {model.source === "fallback" ? (
                <div>Using fallback probabilities. Analysis service unavailable.</div>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type ProbabilityTileProps = {
  label: string;
  pct: number;
  accent: string;
};

function ProbabilityTile({ label, pct, accent }: ProbabilityTileProps) {
  return (
    <div className="space-y-2">
      <div className={`text-2xl font-bold ${accent}`}>{formatPercent(pct)}%</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

type ProbabilityRowProps = {
  label: string;
  pct: number;
  color: string;
};

function ProbabilityRow({ label, pct, color }: ProbabilityRowProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-muted-foreground md:w-48">{label}</span>
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right font-medium">{formatPercent(pct)}%</span>
    </div>
  );
}

type TeamSpotlightProps = {
  side: SideInfo;
  align: "start" | "end";
};

function TeamSpotlight({ side, align }: TeamSpotlightProps) {
  const content = (
    <div className="flex items-center gap-3">
      {side.logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={side.logo}
          alt={`${side.name} logo`}
          className="h-10 w-10 rounded-md border bg-white object-contain"
          onError={event => {
            event.currentTarget.style.display = "none";
          }}
        />
      ) : null}
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{side.role}</span>
        <span className="text-base font-semibold leading-tight">{side.name}</span>
      </div>
    </div>
  );

  return <div className={`flex ${align === "end" ? "justify-end" : "justify-start"}`}>{content}</div>;
}

function ProbabilitySkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-40" />
      </div>
    </div>
  );
}

function buildProbabilityModel(params: {
  insight: Record<string, unknown> | null | undefined;
  fallback: { home: number; draw: number; away: number };
  homeTeam: string;
  awayTeam: string;
  rawEvent: DataObject | null;
  teams: { home: DataObject | null; away: DataObject | null };
}): ProbabilityViewModel {
  const { insight, fallback, homeTeam, awayTeam, rawEvent, teams } = params;

  const fallbackNormalized = normalizeTriple(fallback.home, fallback.draw, fallback.away);

  const derived = deriveFromInsight(insight);
  const base = derived ?? {
    homePct: fallbackNormalized.homePct,
    drawPct: fallbackNormalized.drawPct,
    awayPct: fallbackNormalized.awayPct,
    method: undefined,
    sample: undefined,
    source: "fallback" as const,
  };

  const normalizedBase =
    base.source === "fallback" && base.homePct + base.drawPct + base.awayPct === 0
      ? {
          ...base,
          homePct: 33.4,
          drawPct: 33.3,
          awayPct: 33.3,
        }
      : base;

  const names = resolveTeamNames({ insight, teams, homeTeam, awayTeam });
  const neutral = determineNeutrality({ insight, rawEvent, homeName: names.home, awayName: names.away });

  const homeLogo = resolveLogo("home", names.home, teams.home, rawEvent);
  const awayLogo = resolveLogo("away", names.away, teams.away, rawEvent);

  return {
    home: { name: names.home, role: neutral ? "Neutral" : "Home", pct: normalizedBase.homePct, logo: homeLogo },
    drawPct: normalizedBase.drawPct,
    away: { name: names.away, role: neutral ? "Neutral" : "Away", pct: normalizedBase.awayPct, logo: awayLogo },
    method: normalizedBase.method,
    sample: normalizedBase.sample,
    source: normalizedBase.source,
  };
}

function deriveFromInsight(insight: Record<string, unknown> | null | undefined) {
  if (!insight) return null;

  const candidates: Array<Record<string, unknown> | null | undefined> = [];
  candidates.push(insight);
  if (typeof insight.data === "object" && insight.data) candidates.push(insight.data as Record<string, unknown>);
  if (typeof insight.insights === "object" && insight.insights) candidates.push(insight.insights as Record<string, unknown>);

  let method: string | undefined;
  let sample: number | undefined;

  for (const record of candidates) {
    if (!record) continue;
    const probSource = pickProbabilitySource(record);
    if (!probSource) continue;

    const homeRaw = safeProbability(probSource.home);
    const drawRaw = safeProbability(probSource.draw);
    const awayRaw = safeProbability(probSource.away);
    if (homeRaw + drawRaw + awayRaw <= 0) continue;

    method = method ?? selectString(record, ["method", "model", "model_name", "source"]);
    sample = sample ?? safeNumber(selectAny(record.inputs, ["sample_size", "effective_weight", "n"]));

    const { homePct, drawPct, awayPct } = normalizeTriple(homeRaw, drawRaw, awayRaw);
    return {
      homePct,
      drawPct,
      awayPct,
      method,
      sample,
      source: "insight" as const,
    };
  }

  return null;
}

function resolveTeamNames(params: {
  insight: Record<string, unknown> | null | undefined;
  teams: { home: DataObject | null; away: DataObject | null };
  homeTeam: string;
  awayTeam: string;
}) {
  const { insight, teams, homeTeam, awayTeam } = params;
  const insightRecord = asRecord(insight ?? null);
  const homeCandidates = [
    selectRecord(insightRecord, ["home_team", "homeTeam", "home"]),
    insightRecord,
    asRecord(teams.home),
  ];
  const awayCandidates = [
    selectRecord(insightRecord, ["away_team", "awayTeam", "away"]),
    insightRecord,
    asRecord(teams.away),
  ];

  const nameKeys = ["name", "display_name", "short_name", "team", "team_name"];

  const homeName = selectStringFromRecords(homeCandidates, nameKeys) || homeTeam;
  const awayName = selectStringFromRecords(awayCandidates, nameKeys) || awayTeam;

  return { home: homeName, away: awayName };
}

function determineNeutrality(params: {
  insight: Record<string, unknown> | null | undefined;
  rawEvent: DataObject | null;
  homeName: string;
  awayName: string;
}): boolean {
  const { insight, rawEvent, homeName, awayName } = params;
  const venue = selectRecord(insight ?? undefined, ["venue"]) ?? asRecord(rawEvent ?? null);
  if (venue && typeof venue.neutral === "boolean") return venue.neutral;

  const country = selectStringFromRecords(
    [venue, asRecord(rawEvent ?? null)],
    ["country", "country_name", "event_country", "strCountry"]
  );
  if (!country) return false;

  const countryNorm = normalizeName(country);
  const homeNorm = normalizeName(homeName);
  const awayNorm = normalizeName(awayName);
  const matchesCountry = (team: string) => {
    const norm = normalizeName(team);
    if (!norm) return false;
    return norm.includes(countryNorm) || countryNorm.includes(norm);
  };

  return Boolean(countryNorm) && !matchesCountry(homeNorm) && !matchesCountry(awayNorm);
}

function resolveLogo(side: "home" | "away", teamName: string, teamRecord: DataObject | null, rawEvent: DataObject | null) {
  const probe = (record: Record<string, unknown> | null | undefined) => {
    if (!record) return undefined;
    for (const key of LOGO_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
  };

  const direct = probe(asRecord(teamRecord));
  if (direct) return direct;

  const raw = asRecord(rawEvent ?? null);
  if (!raw) return undefined;

  const nestedKeys = side === "home" ? ["home_team", "homeTeam", "home"] : ["away_team", "awayTeam", "away"];
  for (const key of nestedKeys) {
    const logo = probe(selectRecord(raw, [key]));
    if (logo) return logo;
  }

  const teamList = raw.teams || raw.team || raw.match_teams;
  if (Array.isArray(teamList)) {
    const targetNorm = normalizeName(teamName);
    for (const entry of teamList) {
      const record = asRecord(entry);
      if (!record) continue;
      const candidate = selectString(record, ["name", "team", "team_name", "strTeam", "display_name", "short_name"]);
      if (!candidate) continue;
      const candidateNorm = normalizeName(candidate);
      if (!targetNorm || candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) {
        const logo = probe(record);
        if (logo) return logo;
      }
    }
  }

  return undefined;
}

function pickProbabilitySource(record: Record<string, unknown>) {
  const candidates = [record.winprob, record.win_prob, record.winProb, record.probs, record.probabilities];
  for (const candidate of candidates) {
    const normalized = asRecord(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function normalizeTriple(home: number, draw: number, away: number) {
  const [h, d, a] = [home, draw, away].map(v => normalizePercent(v));
  const sum = h + d + a;
  if (sum <= 0) return { homePct: 0, drawPct: 0, awayPct: 0 };

  const factor = 100 / sum;
  const homePct = round1(h * factor);
  const drawPct = round1(d * factor);
  let awayPct = round1(a * factor);

  const total = round1(homePct + drawPct + awayPct);
  if (total !== 100) {
    const diff = round1(100 - total);
    awayPct = clampPercent(awayPct + diff);
  }

  return { homePct, drawPct, awayPct };
}

function normalizePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value <= 1) return value * 100;
  return value;
}

function safeProbability(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function safeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function selectRecord(source: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!source) return null;
  for (const key of keys) {
    const value = source[key];
    const asRec = asRecord(value);
    if (asRec) return asRec;
  }
  return null;
}

function selectString(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function selectStringFromRecords(records: Array<Record<string, unknown> | null | undefined>, keys: string[]) {
  for (const record of records) {
    const value = selectString(record, keys);
    if (value) return value;
  }
  return undefined;
}

function selectAny(record: unknown, keys: string[]) {
  const asRec = asRecord(record);
  if (!asRec) return undefined;
  for (const key of keys) {
    if (asRec[key] !== undefined) return asRec[key];
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeName(value: string | undefined): string {
  return value ? value.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim() : "";
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0.0";
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}
