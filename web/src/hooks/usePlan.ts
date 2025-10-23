"use client";

import useSWR from "swr";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const KNOWN_STATUSES = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
  "free",
] as const;

export type PlanStatus = (typeof KNOWN_STATUSES)[number] | null;

export type PlanInfo = {
  plan: "free" | "pro";
  subscription_status: PlanStatus;
  current_period_end: string | null;
  stripe_price_id: string | null;
  trial_consumed: boolean;
  trial_end_at: string | null;
};

function normalizeSubscriptionStatus(value: unknown): PlanStatus {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "pro") return "active";
  if (KNOWN_STATUSES.includes(trimmed as (typeof KNOWN_STATUSES)[number])) {
    return trimmed as PlanStatus;
  }
  return null;
}

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
  .select("plan, subscription_status, current_period_end, stripe_price_id, trial_consumed, trial_end_at")
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Failed to load plan", error);
    throw error;
  }

  if (!data) return null;
  const normalizedStatus = normalizeSubscriptionStatus(data.subscription_status);
  return {
    plan: data.plan === "pro" ? "pro" : "free",
    subscription_status: normalizedStatus,
    current_period_end: data.current_period_end ?? null,
    stripe_price_id: data.stripe_price_id ?? null,
    trial_consumed: Boolean(data.trial_consumed),
    trial_end_at: data.trial_end_at ?? null,
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
    trial_consumed: false,
    trial_end_at: null,
  };

  return {
    planInfo,
    plan: planInfo.plan,
    loadingPlan: isLoading,
    planError: error,
    refreshPlan: mutate,
  };
}
