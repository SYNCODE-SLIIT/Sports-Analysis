"use client";

import { createClient, type SupabaseClient, type Session, type User } from "@supabase/supabase-js";

// Singleton browser client
let supabaseBrowser: SupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (!supabaseBrowser) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn("Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }
    supabaseBrowser = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      { auth: { persistSession: true } }
    );
  }
  return supabaseBrowser;
}

export type { Session, User };
