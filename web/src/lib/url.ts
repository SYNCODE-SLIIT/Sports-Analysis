const DEFAULT_SITE_ORIGIN = "https://athlete-analysis.vercel.app";
const ENV_SITE_URL = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_SITE_URL : undefined;

const normalizeOrigin = (value: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const candidate = new URL(trimmed);
    return candidate.origin;
  } catch {
    try {
      const candidate = new URL(`https://${trimmed}`);
      return candidate.origin;
    } catch {
      return trimmed.replace(/\/+$/, "") || null;
    }
  }
};

export const getSiteOrigin = (): string => {
  const envOrigin = ENV_SITE_URL ? normalizeOrigin(ENV_SITE_URL) : null;
  if (envOrigin) return envOrigin;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_SITE_ORIGIN;
};
