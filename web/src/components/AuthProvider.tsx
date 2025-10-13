"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Session, User } from "@supabase/supabase-js";

type AuthContextValue = {
  supabase: ReturnType<typeof getSupabaseBrowserClient>;
  session: Session | null;
  user: User | null;
  loading: boolean;
  // bump this to notify consumers that user preferences changed
  bumpPreferences: () => void;
  prefsVersion: number;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefsVersion, setPrefsVersion] = useState(0);

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(session);
      setLoading(false);
    };
    init();

    const { data: sub } = supabase.auth.onAuthStateChange((
      _event: unknown,
      session: Session | null
    ) => {
      setSession(session);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [supabase]);

  const value = useMemo<AuthContextValue>(() => ({
    supabase,
    session,
    user: session?.user ?? null,
    loading,
    bumpPreferences: () => setPrefsVersion(v => v + 1),
    prefsVersion,
  }), [supabase, session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
