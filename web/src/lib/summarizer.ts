// Lightweight client for the Next.js summarizer proxy

export type EventBriefIn = {
  minute?: string | number | null;
  type?: string | null;
  description?: string | null;
  player?: string | null;
  team?: string | null; // 'home' | 'away' or provider string
  tags?: string[] | null;
};

export type EventBriefOut = {
  minute?: string | null;
  type?: string | null;
  brief: string;
  player_image?: string | null;
  team_logo?: string | null;
  player?: string | null;
  player_id?: string | null;
};

export async function summarizeEventBriefs(payload: {
  eventId?: string;
  eventName?: string;
  date?: string;
  provider?: 'auto' | 'tsdb' | 'allsports';
  events: EventBriefIn[];
}): Promise<{ ok: boolean; items: EventBriefOut[] }> {
  const r = await fetch('/api/summarizer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`summarizer failed: ${r.status}`);

  const json: any = await r.json();
  // If already in the items shape, return as-is
  if (json && Array.isArray(json.items)) return json as { ok: boolean; items: EventBriefOut[] };

  const shorten = (txt: string, maxSentences = 3, maxLines = 4) => {
    if (!txt) return '';
    const s = String(txt).trim().replace(/\s+/g, ' ');
    const sentences = s.split(/(?<=[.!?])\s+/);
    if (sentences.length <= maxSentences) {
      const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return lines.slice(0, maxLines).join(' ');
    }
    return sentences.slice(0, maxSentences).join(' ');
  };

  const outItems: EventBriefOut[] = [];
  try {
    const reqEvents = Array.isArray(payload.events) ? payload.events : [];

    // Single-event request
    if (reqEvents.length === 1) {
      const ev0 = reqEvents[0];
      const wantMin = ev0?.minute != null ? String(ev0.minute) : undefined;
      const wantPlayer = ev0?.player ? String(ev0.player).toLowerCase().trim() : undefined;

      // Prefer selecting the best key_event for this event if provided
      if (json && Array.isArray(json.key_events) && json.key_events.length) {
        let best: any = null;
        let bestScore = -1;
        for (const ke of json.key_events) {
          const km = ke?.minute != null ? String(ke.minute) : undefined;
          const kp = ke?.player ? String(ke.player).toLowerCase().trim() : undefined;
          let score = 0;
          if (km && wantMin && km === wantMin) score += 2;
          if (kp && wantPlayer && (kp.includes(wantPlayer) || wantPlayer.includes(kp))) score += 1;
          if (score > bestScore) { bestScore = score; best = ke; }
        }
        const sel = best || json.key_events[0];
        const minute = sel?.minute != null ? String(sel.minute) : wantMin;
        const type = sel?.type != null ? String(sel.type).toLowerCase() : (ev0?.type ?? undefined);
        const player = sel?.player != null ? String(sel.player) : (ev0?.player ?? undefined);
        const note = sel?.note != null ? String(sel.note) : undefined;
        const player_image = sel?.player_image ?? json.player_image ?? undefined;
        const team_logo = sel?.team_logo ?? json.team_logo ?? undefined;

        const typeLabel = type ? (type === 'goal' ? 'Goal' : (type === 'yellow' ? 'Yellow card' : (type === 'red' ? 'Red card' : String(type)))) : 'Event';
        const parts: string[] = [];
        if (player) parts.push(player);
        parts.push(typeLabel);
        if (note) parts.push(note);
        const rawBrief = parts.length ? parts.join(' — ') + (minute ? ' (' + minute + ")" : '') : '';
        const brief = shorten(rawBrief, 1, 2);
        outItems.push({ minute, type, brief, player, player_image, team_logo, player_id: undefined });
      } else {
        // Build directly from the requested event
        const minute = wantMin;
        const type = ev0?.type ?? undefined;
        const player = ev0?.player ?? undefined;
        const desc = ev0?.description ?? undefined;
        const typeLabel = type ? (type === 'goal' ? 'Goal' : (type === 'yellow' ? 'Yellow card' : (type === 'red' ? 'Red card' : String(type)))) : 'Event';
        const parts: string[] = [];
        if (player) parts.push(player);
        parts.push(typeLabel);
        if (desc) parts.push(String(desc));
        const brief = shorten(parts.join(' — '), 1, 2);
        outItems.push({ minute, type, brief, player, player_image: undefined, team_logo: undefined, player_id: undefined });
      }
    } else if (json && Array.isArray(json.key_events) && json.key_events.length) {
      // Multi-event: map key_events into short items
      for (const ke of json.key_events) {
        const minute = ke?.minute != null ? String(ke.minute) : undefined;
        const type = ke?.type != null ? String(ke.type).toLowerCase() : undefined;
        const player = ke?.player != null ? String(ke.player) : undefined;
        const note = ke?.note != null ? String(ke.note) : undefined;
        const player_image = ke?.player_image ?? json.player_image ?? undefined;
        const team_logo = ke?.team_logo ?? json.team_logo ?? undefined;
        const typeLabel = type ? (type === 'goal' ? 'Goal' : (type === 'yellow' ? 'Yellow card' : (type === 'red' ? 'Red card' : String(type)))) : 'Event';
        const parts: string[] = [];
        if (player) parts.push(player);
        parts.push(typeLabel);
        if (note) parts.push(note);
        const rawBrief = parts.length ? parts.join(' — ') + (minute ? ' (' + minute + ")" : '') : '';
        const brief = shorten(rawBrief, 1, 2);
        outItems.push({ minute, type, brief, player, player_image, team_logo, player_id: undefined });
      }
    } else if (Array.isArray(payload.events) && payload.events.length) {
      // Fallback: build short items from provided events
      for (const ev of payload.events) {
        const minute = ev?.minute != null ? String(ev.minute) : undefined;
        const type = ev?.type ?? undefined;
        const player = ev?.player ?? undefined;
        const desc = ev?.description ?? undefined;
        const typeLabel = type ? (type === 'goal' ? 'Goal' : (type === 'yellow' ? 'Yellow card' : (type === 'red' ? 'Red card' : String(type)))) : 'Event';
        const parts: string[] = [];
        if (player) parts.push(player);
        parts.push(typeLabel);
        if (desc) parts.push(String(desc));
        const brief = shorten(parts.join(' — '), 1, 2);
        outItems.push({ minute, type, brief, player, player_image: undefined, team_logo: undefined, player_id: undefined });
      }
    }
  } catch (_e) {
    // swallow and return what we have
  }

  return { ok: Boolean(json?.ok ?? true), items: outItems };
}
