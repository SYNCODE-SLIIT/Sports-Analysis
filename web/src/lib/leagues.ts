export const POPULAR_LEAGUES = [
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "UEFA Champions League",
];

export function isPopularLeague(name?: string): boolean {
  if (!name) return false;
  return POPULAR_LEAGUES.some(l => l.toLowerCase() === name.toLowerCase());
}

export function matchLeague(query: string, league?: string): boolean {
  if (!query) return true;
  if (!league) return false;
  return league.toLowerCase().includes(query.toLowerCase());
}
