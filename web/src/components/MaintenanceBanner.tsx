"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Timer } from "lucide-react";

import { useAuth } from "@/components/AuthProvider";
import { isAdminEmail } from "@/lib/admin";
import {
  defaultMaintenanceState,
  formatCountdown,
  formatScheduledLabel,
  isFutureDate,
  parseMaintenanceValue,
} from "@/lib/maintenance";

export function MaintenanceBanner() {
  const { supabase, user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState(defaultMaintenanceState);
  const [, forceTick] = useState(0);
  const adminUser = useMemo(() => isAdminEmail(user?.email ?? undefined), [user?.email]);
  const isAuthRoute = pathname?.startsWith("/auth") ?? false;

  useEffect(() => {
    let mounted = true;

    const fetchInitial = async () => {
      const { data, error } = await supabase.rpc("get_maintenance_state");
      if (!mounted) return;
      if (error) {
        console.error("Failed to load maintenance settings", error);
        return;
      }
      setState(parseMaintenanceValue(data));
    };

    fetchInitial();

    const channel = supabase
      .channel("public:system_settings:maintenance")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_settings", filter: "key=eq.maintenance" },
        (payload) => {
          if (!payload.new) return;
          const next = parseMaintenanceValue((payload.new as { value?: unknown }).value);
          setState(next);
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      try {
        supabase.removeChannel(channel);
      } catch (err) {
        console.error("Failed to remove maintenance channel", err);
      }
    };
  }, [supabase]);

  useEffect(() => {
    const id = setInterval(() => forceTick(value => value + 1), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (loading || !state.enabled) return;
    if (adminUser) return;
    if (isAuthRoute) return;
    if (pathname?.startsWith("/status") || pathname?.startsWith("/admin")) return;
    router.replace("/status");
  }, [adminUser, isAuthRoute, loading, pathname, router, state.enabled]);

  if (adminUser || isAuthRoute) {
    return null;
  }

  const scheduledFuture = !state.enabled && isFutureDate(state.scheduledFor);
  if (!scheduledFuture) {
    return null;
  }

  const countdown = formatCountdown(state.scheduledFor);
  const scheduledLabel = formatScheduledLabel(state.scheduledFor);
  const bannerMessage = state.message?.trim().length
    ? state.message.trim()
    : "Scheduled maintenance is coming up.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-amber-200 bg-amber-50"
    >
      <div className="container flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-sm text-amber-900">
        <span className="inline-flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" />
          {bannerMessage}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide">
          {scheduledLabel && (
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3.5 w-3.5" />
              {scheduledLabel}
            </span>
          )}
          {countdown && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/70 px-2 py-0.5 font-semibold text-amber-900">
              Starts in {countdown}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
