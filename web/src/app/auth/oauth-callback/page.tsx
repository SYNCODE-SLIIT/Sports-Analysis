"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";

export default function OAuthCallbackPage() {
  const { supabase } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    let active = true;
    const finalize = async () => {
      // Wait for session to be available after redirect
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!session || !active) return;

      // Ensure profile + preferences
      try {
        await supabase.from("profiles").upsert({
          id: session.user.id,
          full_name: session.user.user_metadata?.full_name ?? null,
          avatar_url: session.user.user_metadata?.avatar_url ?? null,
        });
        try {
          await supabase.rpc("ensure_user_preferences", { uid: session.user.id });
        } catch {
          await supabase.from("user_preferences").insert({ user_id: session.user.id });
        }
      } catch {}

      const next = params.get("next") || "/";
      router.replace(next);
    };
    finalize();
    return () => {
      active = false;
    };
  }, [params, router, supabase]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-sm text-muted-foreground">Finalizing sign-in…</div>
    </div>
  );
}
