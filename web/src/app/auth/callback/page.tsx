"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { isAdminEmail } from "@/lib/admin";

function AuthCallbackInner() {
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
  let needsOnboarding = false;
  const nextParam = params.get("next") || "/";
  const next = nextParam.startsWith("/") ? nextParam : "/";
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
        const { data: prefs } = await supabase
          .from("user_preferences")
          .select("favorite_teams, favorite_leagues, favorite_countries")
          .eq("user_id", session.user.id)
          .maybeSingle();
        needsOnboarding = !prefs ||
          (Array.isArray(prefs.favorite_teams) ? prefs.favorite_teams.length === 0 : true) &&
          (Array.isArray(prefs.favorite_leagues) ? prefs.favorite_leagues.length === 0 : true) &&
          (Array.isArray(prefs.favorite_countries) ? prefs.favorite_countries.length === 0 : true);
      } catch {}

      const adminRedirect = isAdminEmail(session.user.email ?? undefined) ? "/admin/overview" : null;
      if (adminRedirect) {
        router.replace(adminRedirect);
        return;
      }
      if (needsOnboarding) {
        router.replace(`/onboarding?next=${encodeURIComponent(next)}`);
      } else {
        router.replace(next);
      }
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

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="text-sm text-muted-foreground">Finalizing sign-in…</div>
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  );
}
