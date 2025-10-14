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
  // bump this when an interaction (like/click/save/view/share/dismiss) is recorded
  bumpInteractions: () => void;
  interactionsVersion: number;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [prefsVersion, setPrefsVersion] = useState(0);
  const [interactionsVersion, setInteractionsVersion] = useState(0);

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
      try { sub.subscription.unsubscribe(); } catch {}
    };
  }, [supabase]);

  // Realtime subscriptions to user_preferences and user_interactions for the signed-in user.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) return;
    // create channels filtered to the current user
    const prefChannel = supabase
      .channel(`public:user_preferences:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_preferences', filter: `user_id=eq.${userId}` }, () => {
        setPrefsVersion(v => v + 1);
      })
      .subscribe();

    const interactionsChannel = supabase
      .channel(`public:user_interactions:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_interactions', filter: `user_id=eq.${userId}` }, () => {
        setInteractionsVersion(v => v + 1);
      })
      .subscribe();

    return () => {
      try { supabase.removeChannel(prefChannel); } catch {}
      try { supabase.removeChannel(interactionsChannel); } catch {}
    };
  }, [supabase, session?.user?.id]);

  const value = useMemo<AuthContextValue>(() => ({
    supabase,
    session,
    user: session?.user ?? null,
    loading,
    bumpPreferences: () => setPrefsVersion(v => v + 1),
    prefsVersion,
    bumpInteractions: () => setInteractionsVersion(v => v + 1),
    interactionsVersion,
  }), [supabase, session, loading, prefsVersion, interactionsVersion]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
