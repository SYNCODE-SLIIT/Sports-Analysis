"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient, Session, User } from "@supabase/supabase-js";

let supabaseBrowser: SupabaseClient | undefined;

export function getSupabaseBrowserClient() {
  if (!supabaseBrowser) {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.warn("Supabase env vars missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }
    supabaseBrowser = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
    );
  }
  return supabaseBrowser;
}

export type { Session, User };
