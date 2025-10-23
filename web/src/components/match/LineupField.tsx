"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";

export type LineupPlayer = {
  id?: string;
  name: string;
  number?: string;
  position?: number;
  image?: string;
  role?: string;
};

export type LineupTeamData = {
  teamName: string;
  formation?: string;
  logo?: string;
  starters: LineupPlayer[];
  substitutes: LineupPlayer[];
};

type LineupFieldProps = {
  home: LineupTeamData;
  away: LineupTeamData;
};

const getInitials = (value?: string | null) => {
  if (!value) return "NA";
  const parts = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return value.slice(0, 2).toUpperCase();
  return parts
    .slice(0, 2)
    .map((segment) => segment[0]?.toUpperCase() ?? "")
    .join("");
};

const parseFormation = (formation?: string) => {
  if (!formation) return [];
  const segments = formation
    .split(/[-\s]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const numbers = segments
    .map((segment) => Number(segment))
    .filter((num) => Number.isFinite(num) && num >= 0);
  return numbers;
};

const orderStarters = (starters: LineupPlayer[]) => {
  const sorted = [...starters];
  sorted.sort((a, b) => {
    const posA = a.position ?? Number.POSITIVE_INFINITY;
    const posB = b.position ?? Number.POSITIVE_INFINITY;
    if (posA !== posB) return posA - posB;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
  return sorted;
};

const chunkPlayersByFormation = (players: LineupPlayer[], formation: number[]) => {
  if (!players.length) return [];

  const sorted = orderStarters(players);
  const gkIndex = sorted.findIndex((player) => player.position === 1);
  const keeper = gkIndex >= 0 ? sorted.splice(gkIndex, 1)[0] : sorted.shift();

  if (!formation.length || sorted.length === 0) {
    return keeper ? [[keeper], ...sorted.map((player) => [player])] : sorted.map((player) => [player]);
  }

  const rows: LineupPlayer[][] = [];
  if (keeper) rows.push([keeper]);

  let cursor = 0;
  formation.forEach((count) => {
    if (count <= 0) return;
    const slice = sorted.slice(cursor, cursor + count);
    if (slice.length) rows.push(slice);
    cursor += count;
  });

  const remaining = sorted.slice(cursor);
  if (remaining.length) {
    rows.push(remaining);
  }

  return rows;
};

const FieldLines = () => (
  <div aria-hidden className="pointer-events-none absolute inset-0 opacity-50">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.12)_0,_transparent_60%)]" />
    <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/20" />
    <div className="absolute inset-y-8 left-8 right-8 border border-white/20" />
    <div className="absolute inset-y-16 left-16 right-16 border border-white/25" />
    <div className="absolute top-1/2 left-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/25" />
    <div className="absolute top-1/2 left-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" />
  </div>
);

const PlayerBadge = ({ player }: { player: LineupPlayer }) => (
  <div className="flex flex-col items-center gap-1 text-center text-white drop-shadow">
    <div className="relative">
      <Avatar className="h-12 w-12 border-2 border-white/70 bg-emerald-900/70 text-sm">
        {player.image ? (
          <AvatarImage src={player.image} alt={player.name} />
        ) : (
          <AvatarFallback className="text-[0.7rem] font-semibold uppercase">
            {getInitials(player.name)}
          </AvatarFallback>
        )}
      </Avatar>
      {player.number ? (
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-2 text-[0.65rem] font-bold text-emerald-800 shadow">
          {player.number}
        </span>
      ) : null}
    </div>
    <span className="max-w-[7rem] truncate text-xs font-semibold">
      {player.name}
    </span>
  </div>
);

const BenchList = ({
  players,
  teamName,
}: {
  players: LineupPlayer[];
  teamName: string;
}) => {
  if (!players.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground">Bench</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        {players.map((player) => (
          <div
            key={player.id ?? `${teamName}-${player.name}`}
            className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/70 p-2 text-sm"
          >
            <Avatar className="h-9 w-9 border border-border/40 bg-muted">
              {player.image ? (
                <AvatarImage src={player.image} alt={player.name} />
              ) : (
                <AvatarFallback className="text-xs font-semibold uppercase">
                  {getInitials(player.name)}
                </AvatarFallback>
              )}
            </Avatar>
            <div className="min-w-0">
              <div className="truncate font-medium">{player.name}</div>
              <div className="text-xs text-muted-foreground">
                {player.number ? `#${player.number}` : player.role ?? ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const TeamField = ({
  team,
  alignment,
}: {
  team: LineupTeamData;
  alignment: "left" | "right";
}) => {
  const formationNumbers = parseFormation(team.formation);
  const rows = chunkPlayersByFormation(team.starters, formationNumbers);
  const hasLineup = rows.length > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-10 w-10 border border-border/40 bg-muted">
            {team.logo ? (
              <AvatarImage src={team.logo} alt={team.teamName} />
            ) : (
              <AvatarFallback className="text-xs font-semibold uppercase">
                {getInitials(team.teamName)}
              </AvatarFallback>
            )}
          </Avatar>
          <div className="min-w-0">
            <div className="truncate text-base font-semibold">{team.teamName}</div>
            <div className="text-xs text-muted-foreground">
              Formation: {team.formation ?? "N/A"}
            </div>
          </div>
        </div>
        <Badge variant="outline" className="self-start text-xs uppercase tracking-wide">
          Starting XI
        </Badge>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-emerald-700/50 bg-gradient-to-b from-emerald-900 via-emerald-800 to-emerald-900 shadow-inner shadow-emerald-900/60">
        <FieldLines />
        <div
          className={`relative flex min-h-[420px] flex-col justify-between px-4 py-8 sm:px-8`}
        >
          {hasLineup ? (
            rows.map((row, rowIndex) => (
              <div
                key={`${team.teamName}-row-${rowIndex}`}
                className="flex items-center justify-center gap-3"
              >
                <div
                  className={`flex w-full flex-wrap items-center justify-evenly gap-3 ${
                    alignment === "left" ? "sm:justify-evenly" : "sm:justify-evenly"
                  }`}
                >
                  {row.map((player) => (
                    <PlayerBadge
                      key={player.id ?? `${team.teamName}-${player.name}`}
                      player={player}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-white/80">
              Lineup data not available.
            </div>
          )}
        </div>
      </div>

      <BenchList players={team.substitutes} teamName={team.teamName} />
    </div>
  );
};

export function LineupField({ home, away }: LineupFieldProps) {
  const hasHome = home.starters.length > 0 || home.substitutes.length > 0;
  const hasAway = away.starters.length > 0 || away.substitutes.length > 0;

  if (!hasHome && !hasAway) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
        Lineup data not available.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-8 lg:grid-cols-2">
        {hasHome ? (
          <TeamField team={home} alignment="left" />
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            Home lineup not available.
          </div>
        )}
        {hasAway ? (
          <TeamField team={away} alignment="right" />
        ) : (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            Away lineup not available.
          </div>
        )}
      </div>
    </div>
  );
}
