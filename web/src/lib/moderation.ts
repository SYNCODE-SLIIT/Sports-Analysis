// Simple rule-based moderation for summaries
// This is a lightweight client/server-safe helper. For production,
// prefer provider safety filters or a dedicated moderation API.

export type ModerationResult = {
  ok: boolean;
  reasons: string[];
  cleaned: {
    headline: string;
    paragraph: string;
    bullets: string[];
  };
};

const PROFANITY = [
  'fuck', 'shit', 'bitch', 'bastard', 'cunt', 'dick', 'asshole', 'retard', 'slut', 'whore',
];

const SLUR_HINTS = [
  // keep this list short and non-exhaustive; real systems should use vetted libs/APIs
  'nigger', 'chink', 'spic', 'faggot', 'kike',
];

const URL_REGEX = /https?:\/\/[^\s)]+/gi;
const HTML_TAG = /<[^>]*>/g;

function scrub(s: string): string {
  return String(s || '')
    .replace(HTML_TAG, '')
    .replace(URL_REGEX, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(haystack: string, list: string[]): boolean {
  const lower = haystack.toLowerCase();
  return list.some((w) => lower.includes(w));
}

export function moderateSummary(input: { headline: string; paragraph: string; bullets: string[] }): ModerationResult {
  const cleaned = {
    headline: scrub(input.headline).slice(0, 200),
    paragraph: scrub(input.paragraph).slice(0, 800),
    bullets: (Array.isArray(input.bullets) ? input.bullets : []).map((b) => scrub(String(b)).slice(0, 200)).slice(0, 5),
  };

  const reasons: string[] = [];
  const text = [cleaned.headline, cleaned.paragraph, ...cleaned.bullets].join(' ');
  if (hasWord(text, PROFANITY)) reasons.push('profanity');
  if (hasWord(text, SLUR_HINTS)) reasons.push('hate_slur');

  const ok = reasons.length === 0;
  return { ok, reasons, cleaned };
}
