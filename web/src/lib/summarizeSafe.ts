export type SafeSummary = {
  ok?: boolean;
  headline: string;
  paragraph: string;
  bullets: string[];
};

export async function safeSummarize(payload: {
  provider?: string;
  eventId?: string;
  eventName?: string;
  date?: string;
  venue?: string;
  homeTeam?: string;
  awayTeam?: string;
}): Promise<SafeSummary> {
  const r = await fetch('/api/safe-summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`safeSummarize failed: ${r.status}`);
  return r.json();
}

export async function sendSummaryFeedback(payload: {
  eventKey: string;
  headline: string;
  paragraph: string;
  bullets: string[];
  reason?: string;
}) {
  await fetch('/api/summary-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
