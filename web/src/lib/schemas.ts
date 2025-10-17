import { z } from 'zod';

// Win probability schema
const zWinProb = z.object({
  home: z.number().optional(),
  draw: z.number().optional(),
  away: z.number().optional(),
  method: z.string().optional(),
  explain: z.string().optional(),
});

// Match insights schema
export const zMatchInsights = z.object({
  winprob: zWinProb.optional(),
  form: z.any().optional(),
  h2h: z.any().optional(),
  meta: z.object({
    generated_at: z.string().optional(),
  }).optional(),
});

// Event schema
export const zEvent = z.object({
  id: z.string(),
  name: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  status: z.string().optional(),
  home_team: z.string().optional(),
  away_team: z.string().optional(),
  home_score: z.number().optional(),
  away_score: z.number().optional(),
  venue: z.string().optional(),
  league: z.string().optional(),
});

// Highlight schema
export const zHighlight = z.object({
  id: z.string(),
  title: z.string().optional(),
  thumbnail: z.string().optional(),
  url: z.string().optional(),
  provider: z.string().optional(),
  duration: z.number().optional(),
});

// Fixture schema
export const zFixture = z.object({
  id: z.string(),
  home_team: z.string(),
  home_team_logo: z.string().optional(),
  away_team: z.string(),
  away_team_logo: z.string().optional(),
  home_score: z.number().optional(),
  away_score: z.number().optional(),
  date: z.string(),
  time: z.string().optional(),
  league: z.string().optional(),
  status: z.string().optional(),
  venue: z.string().optional(),
});

// Types derived from schemas
export type MatchInsights = z.infer<typeof zMatchInsights>;
export type WinProb = z.infer<typeof zWinProb>;
export type Event = z.infer<typeof zEvent>;
export type Highlight = z.infer<typeof zHighlight>;
export type Fixture = z.infer<typeof zFixture>;

// Parse helpers
export function parseInsights(data: unknown): MatchInsights | null {
  const result = zMatchInsights.safeParse(data);
  return result.success ? result.data : null;
}

export function parseEvent(data: unknown): Event | null {
  const result = zEvent.safeParse(data);
  return result.success ? result.data : null;
}

export function parseHighlights(data: unknown): Highlight[] {
  if (!Array.isArray(data)) return [];
  return data.map(item => {
    const result = zHighlight.safeParse(item);
    return result.success ? result.data : null;
  }).filter(Boolean) as Highlight[];
}

export function parseFixtures(data: unknown): Fixture[] {
  if (!Array.isArray(data)) return [];
  const pick = (obj: unknown, keys: string[]): string | undefined => {
    const rec = (obj as Record<string, unknown>) || {};
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === 'string' && v.trim() !== '') return v;
      if ((k.endsWith('_key') || k.includes('id')) && (typeof v === 'number' || typeof v === 'string')) return String(v);
    }
    return undefined;
  };
  const coerceOne = (item: unknown): Record<string, unknown> => {
    const parseScoreNumber = (value: unknown): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const numericOnly = trimmed.match(/^-?\d+$/);
        if (numericOnly) {
          const parsed = Number.parseInt(numericOnly[0], 10);
          return Number.isNaN(parsed) ? undefined : parsed;
        }
      }
      return undefined;
    };

    const parseScoreFromResult = (value: unknown, side: 'home' | 'away'): number | undefined => {
      if (typeof value !== 'string') return undefined;
      const digits = value.match(/\d+/g);
      if (!digits || digits.length < 2) return undefined;
      const idx = side === 'home' ? 0 : 1;
      if (digits[idx] === undefined) return undefined;
      const parsed = Number.parseInt(digits[idx], 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    };

    const collectScore = (obj: unknown, side: 'home' | 'away'): number | undefined => {
      const rec = (obj as Record<string, unknown>) || {};
      const directKeys =
        side === 'home'
          ? ['home_score', 'homeScore', 'score_home', 'goals_home', 'home_goals', 'home_result', 'homeResult', 'intHomeScore', 'home_scored']
          : ['away_score', 'awayScore', 'score_away', 'goals_away', 'away_goals', 'away_result', 'awayResult', 'intAwayScore', 'away_scored'];

      for (const key of directKeys) {
        const parsed = parseScoreNumber(rec[key]);
        if (parsed !== undefined) return parsed;
      }

      const nestedCandidates = ['score', 'scores', 'result', 'results', 'full_time', 'ft', 'ft_score', 'final_score']
        .map(key => rec[key])
        .filter(value => value && typeof value === 'object') as Record<string, unknown>[];

      for (const nested of nestedCandidates) {
        for (const key of directKeys) {
          const parsed = parseScoreNumber(nested[key]);
          if (parsed !== undefined) return parsed;
        }
        const aliasKey = side === 'home' ? 'home' : 'away';
        const parsed = parseScoreNumber(nested[aliasKey]);
        if (parsed !== undefined) return parsed;
      }

      const resultStrings = ['event_final_result', 'event_result', 'final_result', 'ft_score', 'score']
        .map(key => rec[key])
        .filter((value): value is string => typeof value === 'string');
      for (const str of resultStrings) {
        const parsed = parseScoreFromResult(str, side);
        if (parsed !== undefined) return parsed;
      }

      return undefined;
    };

    // Coerce common provider shapes (AllSports, TSDB) into our canonical fixture fields
    const id = pick(item, ['id', 'event_key', 'idEvent', 'match_id', 'fixture_id', 'game_id', 'tsdb_event_id']);
    const home = pick(item, ['home_team', 'event_home_team', 'strHomeTeam', 'home']);
    const away = pick(item, ['away_team', 'event_away_team', 'strAwayTeam', 'away']);
    const date = pick(item, ['date', 'event_date', 'strDate']);
    const time = pick(item, ['time', 'event_time', 'strTime']);
    const league = pick(item, ['league', 'league_name', 'strLeague']);
    const status = pick(item, ['status', 'event_status']);
    const venue = pick(item, ['venue', 'stadium', 'event_venue', 'strVenue', 'location']);
    // image/logo candidates (some providers embed team objects)
    const imgKeys = ['home_team_logo','team_home_badge','strHomeTeamBadge','homeBadge','home_logo','homeBadge','home_team_badge','team_logo','logo','team_logo','logo_url','team_logo_url','team_image','image','strTeamBadge'];
    const pickImage = (obj: unknown, keys: string[]) => {
      const rec = (obj as Record<string, unknown>) || {};
      for (const k of keys) {
        const v = rec[k];
        if (typeof v === 'string' && v.trim() !== '') return v;
      }
      // nested shapes: home_team: { name, logo }
      for (const cand of ['home_team', 'away_team']) {
        const nested = rec[cand];
        if (nested && typeof nested === 'object') {
          for (const k of keys) {
            const v = (nested as Record<string, unknown>)[k];
            if (typeof v === 'string' && v.trim() !== '') return v;
          }
          // common nested key
          const common = (nested as Record<string, unknown>)['logo'] || (nested as Record<string, unknown>)['badge'] || (nested as Record<string, unknown>)['image'];
          if (typeof common === 'string' && common.trim() !== '') return common;
        }
      }
      return undefined;
    };
    const homeLogo = pickImage(item, imgKeys) ?? undefined;
    // for away logo try keys adapted for away
    const imgKeysAway = imgKeys.map(k => k.replace(/^home_/, 'away_'));
    const awayLogo = pickImage(item, imgKeysAway) ?? pickImage(item, imgKeys) ?? undefined;
    const homeScore = collectScore(item, 'home');
    const awayScore = collectScore(item, 'away');
    return {
      id: id ?? '',
      home_team: home ?? '',
      home_team_logo: homeLogo,
      away_team: away ?? '',
      away_team_logo: awayLogo,
      home_score: homeScore,
      away_score: awayScore,
      date: date ?? new Date().toISOString().split('T')[0],
      time,
      league,
      status,
      venue,
    };
  };
  return data
    .map((item) => {
      const normalized = coerceOne(item);
      const result = zFixture.safeParse(normalized);
      return result.success ? result.data : null;
    })
    .filter(Boolean) as Fixture[];
}
