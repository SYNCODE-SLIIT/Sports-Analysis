import { NextRequest, NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient } from "@/lib/stripe/client";

const DEFAULT_PRO_PRICE_ID =
  process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE ??
  process.env.STRIPE_PRO_MONTHLY_PRICE_ID ??
  process.env.STRIPE_PRO_MONTHLY_PRICE ??
  process.env.STRIPE_PRICE_PRO_MONTHLY ??
  "";

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function isPlanValue(value: unknown): value is "free" | "pro" {
  return value === "free" || value === "pro";
}

async function requireAdminUser() {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!isAdminEmail(user.email ?? undefined)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return { user, supabase } as const;
}

function normalizeRow(row: any) {
  if (!row) return null;
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    userId: row.user_id as string,
    plan: row.plan ?? null,
    subscriptionStatus: row.subscription_status ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    stripePriceId: row.stripe_price_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    stripeCustomerId: row.stripe_customer_id ?? null,
    fullName: profile?.full_name ?? null,
    email: profile?.email ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export async function GET() {
  const authResult = await requireAdminUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("subscriptions")
    .select(
      "user_id, plan, subscription_status, current_period_end, stripe_price_id, stripe_subscription_id, stripe_customer_id, updated_at, profiles:profiles(full_name,email)"
    )
    .order("plan", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Failed to load subscriptions", error);
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 500 });
  }

  const rows = (data ?? []).map(normalizeRow).filter(Boolean);
  return NextResponse.json({ data: rows });
}

export async function PATCH(req: NextRequest) {
  const authResult = await requireAdminUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const body = await req.json().catch(() => null);
  const userId = typeof body?.userId === "string" && body.userId.trim() ? body.userId.trim() : null;
  const targetPlan = isPlanValue(body?.plan) ? (body.plan as "free" | "pro") : null;
  const cancelStripe = body?.cancelStripe !== false; // default true when downgrading
  const customPriceId = typeof body?.stripePriceId === "string" ? body.stripePriceId.trim() : null;
  const providedPeriodEnd = typeof body?.currentPeriodEnd === "string" ? body.currentPeriodEnd : null;

  if (!userId || !targetPlan) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data: existingRow, error: fetchError } = await supabase
    .from("subscriptions")
    .select(
      "user_id, plan, subscription_status, current_period_end, stripe_price_id, stripe_subscription_id, stripe_customer_id"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (fetchError) {
    console.error("Failed to fetch subscription", fetchError);
    return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 });
  }

  const updates: Record<string, unknown> = {
    user_id: userId,
    plan: targetPlan,
    subscription_status: targetPlan,
    stripe_customer_id: existingRow?.stripe_customer_id ?? null,
  };

  if (targetPlan === "pro") {
    const nextPeriodEnd = providedPeriodEnd ? new Date(providedPeriodEnd) : new Date(Date.now() + ONE_MONTH_MS);
    updates.current_period_end = Number.isNaN(nextPeriodEnd.getTime()) ? null : nextPeriodEnd.toISOString();

    const chosenPriceId =
      customPriceId && customPriceId.startsWith("price_")
        ? customPriceId
        : existingRow?.stripe_price_id && existingRow.stripe_price_id.startsWith("price_")
        ? existingRow.stripe_price_id
        : DEFAULT_PRO_PRICE_ID && DEFAULT_PRO_PRICE_ID.startsWith("price_")
        ? DEFAULT_PRO_PRICE_ID
        : null;

    updates.stripe_price_id = chosenPriceId;
    updates.stripe_subscription_id = existingRow?.stripe_subscription_id ?? null;
  } else {
    updates.current_period_end = null;
    updates.stripe_price_id = null;
    updates.stripe_subscription_id = null;
  }

  if (
    targetPlan === "free" &&
    cancelStripe &&
    existingRow?.stripe_subscription_id &&
    process.env.STRIPE_SECRET_KEY
  ) {
    try {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(existingRow.stripe_subscription_id, { invoice_now: false, prorate: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Allow resource_missing errors to pass through since the subscription may have been cancelled elsewhere.
      if (!message.includes("No such subscription")) {
        console.error("Failed to cancel Stripe subscription", error);
        return NextResponse.json({ error: "Unable to cancel Stripe subscription" }, { status: 502 });
      }
    }
  }

  const { data: upserted, error: upsertError } = await supabase
    .from("subscriptions")
    .upsert(updates, { onConflict: "user_id" })
    .select(
      "user_id, plan, subscription_status, current_period_end, stripe_price_id, stripe_subscription_id, stripe_customer_id, updated_at, profiles:profiles(full_name,email)"
    )
    .maybeSingle();

  if (upsertError) {
    console.error("Failed to update subscription", upsertError);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }

  return NextResponse.json({ data: normalizeRow(upserted) });
}
