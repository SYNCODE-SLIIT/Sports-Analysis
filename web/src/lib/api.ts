// Base URL for direct backend calls (optional; prefer Next.js API proxy for browser)
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "";

// Types for API responses
export interface SummaryResponse {
  headline?: string;
  summary?: string;
  one_paragraph?: string;
  paragraph?: string;
  bullets?: string[];
  [key: string]: unknown;
}

/**
 * Generic request function with timeout support
 */
export async function request<T>(
  path: string,
  init?: RequestInit,
  timeout: number = 10000
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Collector API - general purpose endpoint for various intents
 */
export async function collect<T>(intent: string, args: object = {}): Promise<T> {
  return request<T>('/collect', {
    method: 'POST',
    body: JSON.stringify({
      intent,
      args,
    }),
  });
}

/**
 * Summarizer API
 */
export async function summarize(payload: {
  provider?: string;
  eventId?: string;
  eventName?: string;
  date?: string;
}): Promise<SummaryResponse> {
  const body = JSON.stringify({ provider: 'auto', ...payload });
  const timeoutPerAttempt = 30000; // 30s per summarize attempt

  // Primary: use Next.js proxy route (works without CORS/env and in all environments)
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutPerAttempt);
    const r = await fetch('/api/summarizer', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (err) {
    // Fallback: if API_BASE is configured, try direct backend once
    if (API_BASE) {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), timeoutPerAttempt);
      const r2 = await fetch(`${API_BASE.replace(/\/$/, '')}/summarizer/summarize`, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, signal: controller.signal });
      clearTimeout(to);
      if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
      return await r2.json();
    }
    throw err;
  }
}