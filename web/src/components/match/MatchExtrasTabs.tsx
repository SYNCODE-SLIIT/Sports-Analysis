"use client";

import { useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DataObject } from "@/lib/collect";

export type MatchExtrasTabsProps = {
  loading: boolean;
  homeTeam: string;
  awayTeam: string;
  teams: { home: DataObject | null; away: DataObject | null };
  players: { home: DataObject[]; away: DataObject[] };
  leagueTable: Array<{ position?: number; team?: string; played?: number; points?: number }>;
  odds: { listed: DataObject[]; live: DataObject[] };
  probabilities: { home: number; draw: number; away: number };
  form: { home: unknown[]; away: unknown[] };
  comments: Array<{ time?: string; text?: string; author?: string }>;
  seasons: DataObject[];
  h2h: { matches: DataObject[] } | null;
  errors?: Partial<Record<TabKey | "general", string>>;
};

type TabKey =
  | "teams"
  | "players"
  | "table"
  | "odds"
  | "probabilities"
  | "form"
  | "comments"
  | "seasons"
  | "h2h";

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: "teams", label: "Teams", icon: "👥" },
  { key: "players", label: "Players", icon: "⚽" },
  { key: "table", label: "League Table", icon: "🏆" },
  { key: "odds", label: "Odds", icon: "📊" },
  { key: "probabilities", label: "Probabilities", icon: "📈" },
  { key: "form", label: "Form", icon: "📋" },
  { key: "comments", label: "Comments", icon: "💬" },
  { key: "seasons", label: "Seasons", icon: "📅" },
  { key: "h2h", label: "H2H", icon: "⚔️" },
];

export function MatchExtrasTabs({
  loading,
  homeTeam,
  awayTeam,
  teams,
  players,
  leagueTable,
  odds,
  probabilities,
  form,
  comments,
  seasons,
  h2h,
  errors = {},
}: MatchExtrasTabsProps) {
  const [active, setActive] = useState<TabKey>("teams");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Match Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-wrap gap-2">
          {tabs.map(tab => (
            <button
              key={tab.key}
              type="button"
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                active === tab.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary"
              }`}
              onClick={() => setActive(tab.key)}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="rounded-xl border bg-card p-4">
          {loading && <div className="text-sm text-muted-foreground">Loading details…</div>}
          {!loading && (
            <ExtrasContent
              active={active}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              teams={teams}
              players={players}
              leagueTable={leagueTable}
              odds={odds}
              probabilities={probabilities}
              form={form}
              comments={comments}
              seasons={seasons}
              h2h={h2h}
              errors={errors}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ExtrasContent({
  active,
  homeTeam,
  awayTeam,
  teams,
  players,
  leagueTable,
  odds,
  probabilities,
  form,
  comments,
  seasons,
  h2h,
  errors,
}: Omit<MatchExtrasTabsProps, "loading"> & { active: TabKey; errors: Partial<Record<TabKey | "general", string>> }) {
  if (errors[active]) {
    return <div className="text-sm text-muted-foreground">{errors[active]}</div>;
  }

  switch (active) {
    case "teams":
      return <TeamsSection homeTeam={homeTeam} awayTeam={awayTeam} teams={teams} />;
    case "players":
      return <PlayersSection homeTeam={homeTeam} awayTeam={awayTeam} players={players} />;
    case "table":
      return <LeagueTableSection rows={leagueTable} />;
    case "odds":
      return <OddsSection odds={odds} />;
    case "probabilities":
      return <ProbabilitiesSection probabilities={probabilities} homeTeam={homeTeam} awayTeam={awayTeam} />;
    case "form":
      return <FormSection data={form} homeTeam={homeTeam} awayTeam={awayTeam} />;
    case "comments":
      return <CommentsSection comments={comments} />;
    case "seasons":
      return <SeasonsSection seasons={seasons} />;
    case "h2h":
      return <H2HSection data={h2h} homeTeam={homeTeam} awayTeam={awayTeam} />;
    default:
      return null;
  }
}

function TeamsSection({ teams, homeTeam, awayTeam }: { teams: { home: DataObject | null; away: DataObject | null }; homeTeam: string; awayTeam: string }) {
  const cards = [
    { label: homeTeam, data: teams.home },
    { label: awayTeam, data: teams.away },
  ];

  if (!cards.some(card => card.data)) {
    return <div className="text-sm text-muted-foreground">No team information available.</div>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {cards.map(card => (
        <div key={card.label} className="rounded-xl border p-4">
          <div className="mb-3 text-base font-semibold">{card.label}</div>
          {card.data ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              {buildTeamInfo(card.data).map(item => (
                <div key={`${card.label}-${item.label}`} className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className="text-right">{item.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No data.</div>
          )}
        </div>
      ))}
    </div>
  );
}

function buildTeamInfo(team: DataObject): Array<{ label: string; value: string }> {
  const record = team as Record<string, unknown>;
  const fields: Array<{ label: string; keys: string[] }> = [
    { label: "Founded", keys: ["team_founded", "intFormedYear"] },
    { label: "Stadium", keys: ["team_venue", "strStadium"] },
    { label: "Manager", keys: ["team_manager", "strManager"] },
    { label: "League", keys: ["league_name", "strLeague"] },
    { label: "Country", keys: ["team_country", "strCountry"] },
    { label: "Website", keys: ["team_website", "strWebsite"] },
  ];
  return fields
    .map(({ label, keys }) => ({ label, value: pickString(record, keys) }))
    .filter(entry => entry.value.trim().length > 0);
}

function PlayersSection({ players, homeTeam, awayTeam }: { players: { home: DataObject[]; away: DataObject[] }; homeTeam: string; awayTeam: string }) {
  if (!players.home.length && !players.away.length) {
    return <div className="text-sm text-muted-foreground">Squad information is not available.</div>;
  }

  const renderGroup = (label: string, roster: DataObject[]) => (
    <div className="space-y-2">
      <div className="text-base font-semibold">{label}</div>
      <div className="overflow-hidden rounded-lg border">
        <table className="min-w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Player</th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Position</th>
              <th className="px-3 py-2">Stats</th>
            </tr>
          </thead>
          <tbody>
            {roster.slice(0, 24).map((player, idx) => {
              const row = player as Record<string, unknown>;
              const name = pickString(row, ["player_name", "name", "strPlayer"]) || `Player ${idx + 1}`;
              const number = pickString(row, ["player_number", "number", "strNumber"]);
              const position = pickString(row, ["player_type", "position", "strPosition"]);
              const goals = pickString(row, ["player_goals", "goals", "scored"]);
              const assists = pickString(row, ["player_assists", "assists"]);
              const stats = [goals ? `G:${goals}` : null, assists ? `A:${assists}` : null].filter(Boolean).join(" • ");
              return (
                <tr key={`${label}-${name}-${idx}`} className="border-t">
                  <td className="px-3 py-2 font-medium text-foreground">{name}</td>
                  <td className="px-3 py-2">{number}</td>
                  <td className="px-3 py-2">{position}</td>
                  <td className="px-3 py-2 text-muted-foreground">{stats || "–"}</td>
                </tr>
              );
            })}
            {roster.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-sm text-muted-foreground">
                  No players found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {renderGroup(homeTeam, players.home)}
      {renderGroup(awayTeam, players.away)}
    </div>
  );
}

function LeagueTableSection({ rows }: { rows: Array<{ position?: number; team?: string; played?: number; points?: number }> }) {
  if (!rows.length) {
    return <div className="text-sm text-muted-foreground">League table data unavailable.</div>;
  }
  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">#</th>
            <th className="px-3 py-2">Team</th>
            <th className="px-3 py-2">P</th>
            <th className="px-3 py-2">Pts</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row, idx) => (
            <tr key={`${row.team ?? idx}`} className="border-t">
              <td className="px-3 py-2">{row.position ?? idx + 1}</td>
              <td className="px-3 py-2 font-medium text-foreground">{row.team ?? "–"}</td>
              <td className="px-3 py-2">{row.played ?? "–"}</td>
              <td className="px-3 py-2">{row.points ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OddsSection({ odds }: { odds: { listed: DataObject[]; live: DataObject[] } }) {
  const renderBook = (label: string, data: DataObject[]) => {
    if (!data.length) {
      return (
        <div className="rounded-lg border p-3 text-sm text-muted-foreground" key={label}>
          {label}: No data
        </div>
      );
    }
    return (
      <div key={label} className="rounded-lg border p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">{label}</div>
        <div className="overflow-hidden rounded-md border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Bookmaker</th>
                <th className="px-3 py-2">Home</th>
                <th className="px-3 py-2">Draw</th>
                <th className="px-3 py-2">Away</th>
              </tr>
            </thead>
            <tbody>
              {data.slice(0, 10).map((entry, idx) => {
                const record = entry as Record<string, unknown>;
                const bk = pickString(record, ["bookmaker", "name", "provider", "site"]);
                const home = pickNumeric(record, ["home", "odd_home", "home_win", "price_home"]);
                const draw = pickNumeric(record, ["draw", "odd_draw", "price_draw"]);
                const away = pickNumeric(record, ["away", "odd_away", "away_win", "price_away"]);
                return (
                  <tr key={`${label}-${idx}`} className="border-t">
                    <td className="px-3 py-2 font-medium text-foreground">{bk || "Bookmaker"}</td>
                    <td className="px-3 py-2">{home ?? "–"}</td>
                    <td className="px-3 py-2">{draw ?? "–"}</td>
                    <td className="px-3 py-2">{away ?? "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {renderBook("Listed Odds", odds.listed)}
      {renderBook("Live Odds", odds.live)}
    </div>
  );
}

function ProbabilitiesSection({ probabilities, homeTeam, awayTeam }: { probabilities: { home: number; draw: number; away: number }; homeTeam: string; awayTeam: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <ProbabilityCard label={`${homeTeam} Win`} value={probabilities.home} tone="success" />
      <ProbabilityCard label="Draw" value={probabilities.draw} tone="warning" />
      <ProbabilityCard label={`${awayTeam} Win`} value={probabilities.away} tone="info" />
    </div>
  );
}

function ProbabilityCard({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "info" }) {
  const color =
    tone === "success" ? "text-emerald-600" : tone === "warning" ? "text-amber-600" : "text-blue-600";
  return (
    <div className="rounded-lg border p-4 text-center">
      <div className={`text-2xl font-semibold ${color}`}>{Math.max(0, Math.round(value))}%</div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

function FormSection({ data, homeTeam, awayTeam }: { data: { home: unknown[]; away: unknown[] }; homeTeam: string; awayTeam: string }) {
  const renderFormList = (label: string, list: unknown[]) => (
    <div className="rounded-lg border p-3">
      <div className="mb-2 text-sm font-semibold text-foreground">{label}</div>
      {Array.isArray(list) && list.length ? (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {list.slice(0, 8).map((item, idx) => {
            if (typeof item === "string") return <li key={`${label}-${idx}`}>{item}</li>;
            if (item && typeof item === "object") {
              const rec = item as Record<string, unknown>;
              const opponent = pickString(rec, ["opponent", "opposition", "vs", "team"]);
              const result = pickString(rec, ["result", "score", "outcome"]);
              const date = pickString(rec, ["date", "played" ]);
              return (
                <li key={`${label}-${idx}`}>
                  {[result, opponent, date].filter(Boolean).join(" • ")}
                </li>
              );
            }
            return <li key={`${label}-${idx}`}>{String(item)}</li>;
          })}
        </ul>
      ) : (
        <div className="text-sm text-muted-foreground">No recent form available.</div>
      )}
    </div>
  );

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {renderFormList(homeTeam, Array.isArray(data.home) ? data.home : [])}
      {renderFormList(awayTeam, Array.isArray(data.away) ? data.away : [])}
    </div>
  );
}

function CommentsSection({ comments }: { comments: Array<{ time?: string; text?: string; author?: string }> }) {
  if (!comments.length) {
    return <div className="text-sm text-muted-foreground">No comments available.</div>;
  }
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      {comments.map((comment, idx) => (
        <div key={`${comment.author ?? "comment"}-${idx}`} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground/80">
            {comment.time && <span className="font-mono">{comment.time}</span>}
            {comment.author && <span>{comment.author}</span>}
          </div>
          <div className="mt-2 text-foreground">{comment.text}</div>
        </div>
      ))}
    </div>
  );
}

function SeasonsSection({ seasons }: { seasons: DataObject[] }) {
  if (!seasons.length) {
    return <div className="text-sm text-muted-foreground">No season data available.</div>;
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {seasons.slice(0, 10).map((season, idx) => {
        const rec = season as Record<string, unknown>;
        const name = pickString(rec, ["season_name", "name", "season"]);
        const year = pickString(rec, ["year", "season_year"]);
        const status = pickString(rec, ["status", "stage"]);
        return (
          <li key={`${name}-${idx}`} className="rounded-lg border p-3 text-sm">
            <div className="font-semibold text-foreground">{name || `Season ${idx + 1}`}</div>
            <div className="text-muted-foreground">{[year, status].filter(Boolean).join(" • ") || "Info unavailable"}</div>
          </li>
        );
      })}
    </ul>
  );
}

function H2HSection({ data, homeTeam, awayTeam }: { data: { matches: DataObject[] } | null; homeTeam: string; awayTeam: string }) {
  if (!data || !Array.isArray(data.matches) || data.matches.length === 0) {
    return <div className="text-sm text-muted-foreground">No head-to-head data available.</div>;
  }
  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      {data.matches.slice(0, 6).map((match, idx) => {
        const rec = match as Record<string, unknown>;
        // Prefer explicit fields for team names, logos, and score
        const home = pickString(rec, ["event_home_team", "home_team", "home", "homeTeam"]);
        const away = pickString(rec, ["event_away_team", "away_team", "away", "awayTeam"]);
        const homeLogo = pickString(rec, ["home_team_logo", "home_logo", "homeTeamLogo"]);
        const awayLogo = pickString(rec, ["away_team_logo", "away_logo", "awayTeamLogo"]);
        const score = pickString(rec, ["event_final_result", "final_score", "score", "result"]);
        const venue = pickString(rec, ["venue", "location"]);
        const date = pickString(rec, ["date", "played_on", "match_date"]);
        const competition = pickString(rec, ["competition", "league"]);
        return (
          <div key={`${competition || home + '-' + away}-${idx}`} className="rounded-lg border p-3 flex items-center gap-4">
            <div className="flex items-center gap-2 min-w-0">
              {homeLogo ? (
                <Image
                  src={homeLogo}
                  alt={home || homeTeam}
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded object-contain border bg-white"
                  unoptimized
                />
              ) : (
                <span className="w-7 h-7 flex items-center justify-center rounded bg-muted/40 border text-xs font-bold text-primary">
                  {(home || homeTeam).substring(0,2).toUpperCase()}
                </span>
              )}
              <span className="font-semibold text-foreground truncate max-w-[80px]">{home || homeTeam}</span>
            </div>
            <div className="flex-shrink-0 font-bold text-lg text-foreground tabular-nums">{score || '-'}</div>
            <div className="flex items-center gap-2 min-w-0">
              {awayLogo ? (
                <Image
                  src={awayLogo}
                  alt={away || awayTeam}
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded object-contain border bg-white"
                  unoptimized
                />
              ) : (
                <span className="w-7 h-7 flex items-center justify-center rounded bg-muted/40 border text-xs font-bold text-primary">
                  {(away || awayTeam).substring(0,2).toUpperCase()}
                </span>
              )}
              <span className="font-semibold text-foreground truncate max-w-[80px]">{away || awayTeam}</span>
            </div>
            <div className="ml-auto text-xs text-muted-foreground text-right min-w-[120px]">
              {[competition, venue, date].filter(Boolean).join(" • ") || "Details unavailable"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function pickNumeric(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") return value.toFixed(2);
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export default MatchExtrasTabs;
