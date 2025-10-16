// Minimal roster and image resolver helpers for the frontend
// Provides memoized roster lookups and player image resolution.

import { listTeamPlayers } from "./collect";

type Player = { id?: string | number; name?: string; photo?: string; headshot?: string; thumbnail?: string; [k: string]: any };

const rosterCache = new Map<string, Player[]>(); // key: teamName
const playerImageCache = new Map<string, string>(); // key: normalized player name or id

function normalizeName(s?: string) {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

export async function getTeamRoster(teamName: string) {
  const key = String(teamName || "");
  if (!key) return [] as Player[];
  if (rosterCache.has(key)) return rosterCache.get(key)!;
  try {
    const res = await listTeamPlayers(teamName);
    const players = (res?.data?.players ?? []) as Player[];
    rosterCache.set(key, players);
    return players;
  } catch (e) {
    rosterCache.set(key, []);
    return [] as Player[];
  }
}

export async function resolvePlayerImageByName(teamName: string | undefined, playerName?: string) {
  const norm = normalizeName(playerName);
  if (!norm) return "";
  if (playerImageCache.has(norm)) return playerImageCache.get(norm)!;

  // Check local roster cache for the provided team first
  try {
    if (teamName) {
      const roster = await getTeamRoster(teamName);
      for (const p of roster) {
        const pn = normalizeName(p.name || p.player || p.fullname || p.displayName || p.player_name);
        if (!pn) continue;
        if (pn === norm || pn.includes(norm) || norm.includes(pn)) {
          const keys = ["photo", "headshot", "thumbnail", "image", "player_photo", "player_image", "avatar", "cutout"];
          for (const k of keys) {
            const v = p[k];
            if (typeof v === 'string' && v.trim()) {
              playerImageCache.set(norm, v);
              return v;
            }
          }
        }
      }
    }
  } catch {}

  // If not found, try across all cached rosters
  for (const roster of rosterCache.values()) {
    for (const p of roster) {
      const pn = normalizeName(p.name || p.player || p.fullname || p.displayName || p.player_name);
      if (!pn) continue;
      if (pn === norm || pn.includes(norm) || norm.includes(pn)) {
        const keys = ["photo", "headshot", "thumbnail", "image", "player_photo", "player_image", "avatar", "cutout"];
        for (const k of keys) {
          const v = p[k];
          if (typeof v === 'string' && v.trim()) {
            playerImageCache.set(norm, v);
            return v;
          }
        }
      }
    }
  }

  playerImageCache.set(norm, "");
  return "";
}

export function resolvePlayerImageFromObj(obj?: any) {
  if (!obj || typeof obj !== 'object') return "";
  const keys = ["photo", "headshot", "thumbnail", "image", "player_photo", "player_image", "avatar", "cutout", "strThumb"];
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v;
  }
  return "";
}
