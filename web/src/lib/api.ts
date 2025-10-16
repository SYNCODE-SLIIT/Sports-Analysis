export const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;

// Types for API responses
export interface SummaryResponse {
  headline?: string;
  summary?: string;
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
  const maxAttempts = 3;
  const timeoutPerAttempt = 30000; // 30s per summarize attempt
  let attempt = 0;
  let lastErr: unknown = null;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await request<SummaryResponse>('/summarizer/summarize', {
        method: 'POST',
        body: JSON.stringify({ provider: 'auto', ...payload }),
      }, timeoutPerAttempt);
    } catch (err) {
      lastErr = err;
      // transient retryable conditions: network errors, aborted, 5xx
      // simple backoff
      const backoff = 500 * Math.pow(2, attempt - 1);
      await new Promise((res) => setTimeout(res, backoff));
    }
  }
  // If we reach here, rethrow the last error
  throw lastErr;
}