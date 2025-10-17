"use client";

import { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DataObject } from "@/lib/collect";

type WinProbabilityCardProps = {
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
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
  homeTeamLogo,
  awayTeamLogo,
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
        homeTeamLogo,
        awayTeamLogo,
        rawEvent,
        teams,
      }),
    [rawInsight, fallback, homeTeam, awayTeam, homeTeamLogo, awayTeamLogo, rawEvent, teams]
  );

  const isLoading = rawInsight === undefined;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <TrendingUp className="h-5 w-5" />
        <h3 className="text-lg font-semibold">Win Probabilities</h3>
      </div>
      
      {isLoading ? (
        <ProbabilitySkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Home Team Card */}
            <Card className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center gap-4">
                  {model.home.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={model.home.logo}
                      alt={`${model.home.name} logo`}
                      className="h-20 w-20 rounded-lg border-2 bg-white object-contain p-2 shadow-sm"
                      onError={event => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
                      <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                        {model.home.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  
                  <div className="text-center">
                    <div className="text-sm font-medium text-muted-foreground">{model.home.role}</div>
                    <div className="mt-1 text-lg font-semibold">{model.home.name}</div>
                  </div>

                  <div className="text-center text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                    {formatPercent(model.home.pct)}%
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Draw Card */}
            <Card className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900">
                    <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">=</span>
                  </div>
                  
                  <div className="text-center">
                    <div className="text-sm font-medium text-muted-foreground">Result</div>
                    <div className="mt-1 text-lg font-semibold">Draw</div>
                  </div>

                  <div className="text-center text-3xl font-bold text-amber-600 dark:text-amber-400">
                    {formatPercent(model.drawPct)}%
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Away Team Card */}
            <Card className="overflow-hidden">
              <CardContent className="p-6">
                <div className="flex flex-col items-center gap-4">
                  {model.away.logo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={model.away.logo}
                      alt={`${model.away.name} logo`}
                      className="h-20 w-20 rounded-lg border-2 bg-white object-contain p-2 shadow-sm"
                      onError={event => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-lg border-2 bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-950 dark:to-sky-900">
                      <span className="text-2xl font-bold text-sky-600 dark:text-sky-400">
                        {model.away.name.charAt(0)}
                      </span>
                    </div>
                  )}
                  
                  <div className="text-center">
                    <div className="text-sm font-medium text-muted-foreground">{model.away.role}</div>
                    <div className="mt-1 text-lg font-semibold">{model.away.name}</div>
                  </div>

                  <div className="text-center text-3xl font-bold text-sky-600 dark:text-sky-400">
                    {formatPercent(model.away.pct)}%
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Combined Probability Bar */}
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              {/* Home Team Logo and Info */}
              <div className="flex items-center gap-3">
                {model.home.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={model.home.logo}
                    alt={`${model.home.name} logo`}
                    className="h-12 w-12 rounded-md border-2 bg-white object-contain p-1 shadow-sm"
                    onError={event => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border-2 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900">
                    <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {model.home.name.charAt(0)}
                    </span>
                  </div>
                )}
                <div className="hidden text-left md:block">
                  <div className="text-sm font-semibold">{model.home.name}</div>
                  <div className="text-xs text-muted-foreground">{formatPercent(model.home.pct)}%</div>
                </div>
              </div>

              {/* Center Summary */}
              <div className="hidden text-center text-sm text-muted-foreground md:block">
                {model.home.name} ({model.home.role}) {formatPercent(model.home.pct)}% • Draw {formatPercent(model.drawPct)}% • {model.away.name} ({model.away.role}) {formatPercent(model.away.pct)}%
              </div>

              {/* Away Team Logo and Info */}
              <div className="flex items-center gap-3">
                <div className="hidden text-right md:block">
                  <div className="text-sm font-semibold">{model.away.name}</div>
                  <div className="text-xs text-muted-foreground">{formatPercent(model.away.pct)}%</div>
                </div>
                {model.away.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={model.away.logo}
                    alt={`${model.away.name} logo`}
                    className="h-12 w-12 rounded-md border-2 bg-white object-contain p-1 shadow-sm"
                    onError={event => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-md border-2 bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-950 dark:to-sky-900">
                    <span className="text-lg font-bold text-sky-600 dark:text-sky-400">
                      {model.away.name.charAt(0)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Stacked Probability Bar */}
            <div className="flex h-6 w-full overflow-hidden rounded-full shadow-inner">
              <div
                className="bg-gradient-to-r from-emerald-500 to-emerald-600 transition-all duration-500"
                style={{ width: `${model.home.pct}%` }}
                title={`${model.home.name}: ${formatPercent(model.home.pct)}%`}
              />
              <div
                className="bg-gradient-to-r from-amber-500 to-amber-600 transition-all duration-500"
                style={{ width: `${model.drawPct}%` }}
                title={`Draw: ${formatPercent(model.drawPct)}%`}
              />
              <div
                className="bg-gradient-to-r from-sky-500 to-sky-600 transition-all duration-500"
                style={{ width: `${model.away.pct}%` }}
                title={`${model.away.name}: ${formatPercent(model.away.pct)}%`}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3 text-xs text-muted-foreground">
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
    </div>
  );
}

function ProbabilitySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {[1, 2, 3].map(i => (
        <Card key={i}>
          <CardContent className="p-6">
            <div className="flex flex-col items-center gap-4">
              <Skeleton className="h-20 w-20 rounded-lg" />
              <div className="space-y-2 text-center">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-5 w-32" />
              </div>
              <div className="w-full space-y-2">
                <Skeleton className="h-9 w-24 mx-auto" />
                <Skeleton className="h-3 w-full rounded-full" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function buildProbabilityModel(params: {
  insight: Record<string, unknown> | null | undefined;
  fallback: { home: number; draw: number; away: number };
  homeTeam: string;
  awayTeam: string;
  homeTeamLogo?: string;
  awayTeamLogo?: string;
  rawEvent: DataObject | null;
  teams: { home: DataObject | null; away: DataObject | null };
}): ProbabilityViewModel {
  const { insight, fallback, homeTeam, awayTeam, homeTeamLogo, awayTeamLogo, rawEvent, teams } = params;

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

  // Use provided logo props first, fallback to resolving from data
  const homeLogo = homeTeamLogo || resolveLogo("home", names.home, teams.home, rawEvent);
  const awayLogo = awayTeamLogo || resolveLogo("away", names.away, teams.away, rawEvent);

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
