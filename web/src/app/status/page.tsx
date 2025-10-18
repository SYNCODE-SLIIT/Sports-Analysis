"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Home, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/components/AuthProvider";
import {
  defaultMaintenanceState,
  formatCountdown,
  formatScheduledLabel,
  isFutureDate,
  parseMaintenanceValue,
} from "@/lib/maintenance";

export default function StatusPage() {
  const { supabase } = useAuth();
  const [state, setState] = useState(defaultMaintenanceState);
  const [loading, setLoading] = useState(true);
  const [, forceTick] = useState(0);

  const loadState = useCallback(async () => {
    const { data, error } = await supabase.rpc("get_maintenance_state");
    if (error) {
      console.error("Failed to load maintenance state", error);
      setState(defaultMaintenanceState);
    } else {
      setState(parseMaintenanceValue(data));
    }
  }, [supabase]);

  useEffect(() => {
    let mounted = true;

    const initialize = async () => {
      try {
        await loadState();
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initialize();

    const channel = supabase
      .channel("public:system_settings:maintenance:status")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "system_settings", filter: "key=eq.maintenance" },
        payload => {
          const next = parseMaintenanceValue((payload.new as { value?: unknown })?.value);
          setState(next);
        },
      )
      .subscribe();

    return () => {
      mounted = false;
      try {
        supabase.removeChannel(channel);
      } catch (error) {
        console.error("Failed to remove maintenance channel", error);
      }
    };
  }, [loadState, supabase]);

  useEffect(() => {
    const id = setInterval(() => forceTick(value => value + 1), 60000);
    return () => clearInterval(id);
  }, []);

  const countdown = useMemo(() => formatCountdown(state.scheduledFor), [state.scheduledFor]);
  const scheduledLabel = useMemo(() => formatScheduledLabel(state.scheduledFor), [state.scheduledFor]);
  const scheduledFuture = useMemo(() => !state.enabled && isFutureDate(state.scheduledFor), [state.enabled, state.scheduledFor]);

  return (
    <main className="flex flex-1 items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 py-16">
      <Card className="w-full max-w-2xl border-slate-800 bg-slate-900/80 text-slate-100 shadow-2xl">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/20 text-rose-200">
            <AlertTriangle className="h-8 w-8" />
          </div>
          <CardTitle className="text-3xl font-semibold">We&rsquo;re away for maintenance</CardTitle>
          <p className="text-sm text-slate-300">
            The platform is temporarily unavailable while we roll out upgrades. We&rsquo;ll be back online as soon as this window closes.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking maintenance window…
            </div>
          ) : state.enabled ? (
            <div className="rounded-lg border border-rose-400/40 bg-rose-500/15 p-4 text-sm text-rose-100">
              <p className="font-medium">Maintenance mode is active.</p>
              {state.message?.trim() ? <p className="mt-1 text-rose-50/90">{state.message.trim()}</p> : null}
              {scheduledLabel ? (
                <p className="mt-2 text-xs uppercase tracking-wide text-rose-200/80">Planned window: {scheduledLabel}</p>
              ) : null}
            </div>
          ) : scheduledFuture ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              <p className="font-medium">Maintenance hasn&rsquo;t started yet.</p>
              <p className="mt-1 text-amber-50/90">
                {state.message?.trim() || "We&rsquo;ll keep everything running until the window begins."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-amber-200/80">
                {scheduledLabel ? <span>Window: {scheduledLabel}</span> : null}
                {countdown ? <span className="rounded-full bg-amber-300/30 px-2 py-0.5 font-semibold text-amber-900">Starts in {countdown}</span> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              <p className="font-medium">We&rsquo;re back online.</p>
              <p className="mt-1 text-emerald-50/90">If you&rsquo;re seeing this page, try returning to the homepage.</p>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button asChild variant="secondary" className="gap-2">
              <Link href="/auth/login">
                <Home className="h-4 w-4" />
                Go to login
              </Link>
            </Button>
            <Button
              onClick={() => {
                setLoading(true);
                loadState().finally(() => setLoading(false));
              }}
              variant="outline"
              className="gap-2 border-slate-700 text-slate-200 hover:bg-slate-800"
            >
              <RotateCcw className="h-4 w-4" />
              Refresh status
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
