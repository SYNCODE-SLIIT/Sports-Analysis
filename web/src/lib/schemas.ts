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
    return {
      id: id ?? '',
      home_team: home ?? '',
      home_team_logo: homeLogo,
      away_team: away ?? '',
      away_team_logo: awayLogo,
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
