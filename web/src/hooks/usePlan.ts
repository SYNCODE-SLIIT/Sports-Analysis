"use client";

import useSWR from "swr";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export type PlanInfo = {
  plan: "free" | "pro";
  subscription_status: "free" | "pro" | null;
  current_period_end: string | null;
  stripe_price_id: string | null;
};

async function fetchPlan(): Promise<PlanInfo | null> {
  const supabase = getSupabaseBrowserClient();
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.error("Failed to retrieve session for plan", sessionError);
    return null;
  }

  if (!session?.user) {
    return null;
  }

  const { data, error } = await supabase
    .from("user_subscription_plan")
    .select("plan, subscription_status, current_period_end, stripe_price_id")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Failed to load plan", error);
    throw error;
  }

  if (!data) return null;
  const normalizedStatus = data.subscription_status === "pro" ? "pro" : data.subscription_status === "free" ? "free" : null;
  return {
    plan: data.plan === "pro" ? "pro" : "free",
    subscription_status: normalizedStatus,
    current_period_end: data.current_period_end ?? null,
    stripe_price_id: data.stripe_price_id ?? null,
  };
}

export function usePlan() {
  const { data, error, mutate, isLoading } = useSWR("user-plan", fetchPlan, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });

  const planInfo: PlanInfo = data ?? {
    plan: "free",
    subscription_status: "free",
    current_period_end: null,
    stripe_price_id: null,
  };

  return {
    planInfo,
    plan: planInfo.plan,
    loadingPlan: isLoading,
    planError: error,
    refreshPlan: mutate,
  };
}
