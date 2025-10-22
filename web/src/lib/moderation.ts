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

export function moderateSummary(
  input: { headline: string; paragraph: string; bullets: string[] },
  options?: { clamp?: boolean }
): ModerationResult {
  const clamp = options?.clamp !== false;
  const clampStr = (s: string, n: number) => (clamp ? s.slice(0, n) : s);
  const clampArr = <T,>(arr: T[], n: number) => (clamp ? arr.slice(0, n) : arr);

  const cleaned = {
    headline: clampStr(scrub(input.headline), 200),
    paragraph: clampStr(scrub(input.paragraph), 10000),
    bullets: clampArr((Array.isArray(input.bullets) ? input.bullets : []).map((b) => clampStr(scrub(String(b)), 1000)), 50),
  };

  const reasons: string[] = [];
  const text = [cleaned.headline, cleaned.paragraph, ...cleaned.bullets].join(' ');
  if (hasWord(text, PROFANITY)) reasons.push('profanity');
  if (hasWord(text, SLUR_HINTS)) reasons.push('hate_slur');

  const ok = reasons.length === 0;
  return { ok, reasons, cleaned };
}
