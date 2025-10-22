import { z } from 'zod';

// Schema and helpers to normalize and clamp model output
export const SummarySchema = z.object({
  headline: z
    .preprocess((v) => String(v ?? '').replace(/\s+/g, ' ').trim(), z.string())
    .transform((s) => (s.length ? s.slice(0, 140) : 'Match Summary'))
    .default('Match Summary'),
  paragraph: z
    .preprocess((v) => String(v ?? '').replace(/\s+/g, ' ').trim(), z.string())
    .transform((s) => s.slice(0, 1000))
    .optional()
    .default(''),
  bullets: z
    .array(
      z
        .preprocess((v) => String(v ?? '').replace(/\s+/g, ' ').trim(), z.string())
        .transform((s) => s.slice(0, 120))
    )
    .max(5)
    .optional()
    .default([]),
});

export type Summary = z.infer<typeof SummarySchema>;

export function toSummary(input: unknown): Summary {
  const shape: Record<string, unknown> =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  type InShape = {
    headline?: unknown;
    paragraph?: unknown;
    one_paragraph?: unknown;
    summary?: unknown;
    bullets?: unknown;
  };

  const s = shape as InShape;
  const getStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const bulletsRaw = Array.isArray(s.bullets) ? (s.bullets as unknown[]) : [];
  const normalized = {
    headline: getStr(s.headline || 'Match Summary'),
    paragraph: getStr(s.paragraph ?? s.one_paragraph ?? s.summary ?? ''),
    bullets: bulletsRaw.map((b) => getStr(b)),
  };
  return SummarySchema.parse(normalized);
}

export const EMPTY_SUMMARY: Summary = {
  headline: 'Match Summary',
  paragraph: '',
  bullets: [],
};

// Coerce without clamping: used when callers want the full model text.
export function coerceSummaryLoose(input: unknown): { headline: string; paragraph: string; bullets: string[] } {
  const shape: Record<string, unknown> =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  const getStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  const bulletsRaw = Array.isArray((shape.bullets as unknown)) ? (shape.bullets as unknown[]) : [];
  return {
    headline: getStr('headline' in shape ? shape.headline : 'Match Summary'),
    paragraph: getStr(
      'paragraph' in shape
        ? shape.paragraph
        : 'one_paragraph' in shape
        ? (shape as { one_paragraph?: unknown }).one_paragraph
        : 'summary' in shape
        ? (shape as { summary?: unknown }).summary
        : ''
    ),
    bullets: bulletsRaw.map((b) => getStr(b)),
  };
}
