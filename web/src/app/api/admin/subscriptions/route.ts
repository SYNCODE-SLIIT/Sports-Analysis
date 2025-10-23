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
const TRIAL_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

function isPlanValue(value: unknown): value is "free" | "pro" {
  return value === "free" || value === "pro";
}

async function requireAdminUser(): Promise<NextResponse | { userId: string }> {
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

  return { userId: user.id };
}

type ProfileRow = {
  id: string;
  full_name?: string | null;
  created_at?: string | null;
} | null;

type SubscriptionRow = {
  user_id: string;
  plan: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  stripe_price_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  updated_at?: string | null;
} | null;

type AdminSubscriptionRecord = {
  userId: string;
  fullName: string | null;
  email: string | null;
  plan: "free" | "pro";
  subscriptionStatus: "free" | "pro";
  currentPeriodEnd: string | null;
  stripePriceId: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  updatedAt: string | null;
  createdAt: string | null;
};

const normalizePlan = (value: string | null | undefined): "free" | "pro" => (value === "pro" ? "pro" : "free");

const normalizeStatus = (plan: "free" | "pro", status: string | null | undefined): "free" | "pro" => {
  if (status === "pro") return "pro";
  if (status === "free") return "free";
  return plan;
};

const toAdminRecord = (
  profile: ProfileRow,
  subscription: SubscriptionRow,
  email?: string | null
): AdminSubscriptionRecord | null => {
  const userId = profile?.id ?? subscription?.user_id ?? null;
  if (!userId) return null;

  const plan = normalizePlan(subscription?.plan);
  const subscriptionStatus = normalizeStatus(plan, subscription?.subscription_status);

  return {
    userId,
    fullName: profile?.full_name ?? email ?? null,
    email: email ?? null,
    plan,
    subscriptionStatus,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    stripePriceId: subscription?.stripe_price_id ?? null,
    stripeSubscriptionId: subscription?.stripe_subscription_id ?? null,
    stripeCustomerId: subscription?.stripe_customer_id ?? null,
    updatedAt: subscription?.updated_at ?? null,
    createdAt: profile?.created_at ?? null,
  };
};

export async function GET() {
  const authResult = await requireAdminUser();
  if (authResult instanceof NextResponse) {
    return authResult;
  }

  const supabase = getSupabaseServiceRoleClient();
  const [{ data: profileRows, error: profilesError }, { data: subscriptionRows, error: subscriptionsError }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, created_at")
      .order("created_at", { ascending: true }),
    supabase
      .from("subscriptions")
      .select(
        "user_id, plan, subscription_status, current_period_end, stripe_price_id, stripe_subscription_id, stripe_customer_id, updated_at"
      ),
  ]);

  if (profilesError) {
    console.error("Failed to load profiles", profilesError);
    return NextResponse.json({ error: "Failed to load profiles" }, { status: 500 });
  }
  if (subscriptionsError) {
    console.error("Failed to load subscriptions", subscriptionsError);
    return NextResponse.json({ error: "Failed to load subscriptions" }, { status: 500 });
  }

  const subscriptionsMap = new Map(
    (subscriptionRows ?? []).map((row) => [row.user_id, row])
  );

  const userEmailMap = new Map<string, string>();
  try {
    let page = 1;
    const perPage = 200;
    while (true) {
      const { data: userPage, error: userError } = await supabase.auth.admin.listUsers({ page, perPage });
      if (userError) {
        throw userError;
      }
      const users = userPage?.users ?? [];
      users.forEach((user) => {
        if (user?.id && typeof user.email === "string" && user.email) {
          userEmailMap.set(user.id, user.email);
        }
      });
      if (!userPage || users.length < perPage) {
        break;
      }
      page += 1;
    }
  } catch (error) {
    console.error("Failed to load auth users", error);
  }

  const combined: AdminSubscriptionRecord[] = [];
  const seenUserIds = new Set<string>();

  (profileRows ?? []).forEach((profile) => {
    if (!profile) return;
    const email = userEmailMap.get(profile.id) ?? null;
    const subscription = subscriptionsMap.get(profile.id) ?? null;
    const record = toAdminRecord(profile, subscription, email);
    if (record) {
      combined.push(record);
      seenUserIds.add(record.userId);
    }
  });

  // Include any subscriptions that reference users missing from profiles (should be rare but keeps data complete).
  subscriptionRows
    ?.filter((subscription) => !seenUserIds.has(subscription.user_id))
    .forEach((subscription) => {
      const email = userEmailMap.get(subscription.user_id) ?? null;
      const record = toAdminRecord(null, subscription, email);
      if (record) {
        combined.push(record);
        seenUserIds.add(record.userId);
      }
    });

  combined.sort((a, b) => {
    const planScore = (value: string | null) => (value === "pro" ? 0 : 1);
    const planDiff = planScore(a.plan) - planScore(b.plan);
    if (planDiff !== 0) return planDiff;
    const getDateValue = (date: string | null) => (date ? new Date(date).getTime() : 0);
    return getDateValue(b.updatedAt ?? b.createdAt ?? null) - getDateValue(a.updatedAt ?? a.createdAt ?? null);
  });

  return NextResponse.json({ data: combined });
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
    const includeTrialBuffer = (existingRow?.plan ?? "free") !== "pro";
    const defaultRenewalMs = Date.now() + ONE_MONTH_MS + (includeTrialBuffer ? TRIAL_PERIOD_MS : 0);
    const nextPeriodEnd = providedPeriodEnd ? new Date(providedPeriodEnd) : new Date(defaultRenewalMs);
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
      "user_id, plan, subscription_status, current_period_end, stripe_price_id, stripe_subscription_id, stripe_customer_id, updated_at"
    )
    .maybeSingle();

  if (upsertError) {
    console.error("Failed to update subscription", upsertError);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, created_at")
    .eq("id", userId)
    .maybeSingle();

  let email: string | null = null;
  try {
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);
    if (authError) {
      throw authError;
    }
    email = authUser?.user?.email ?? null;
  } catch (error) {
    console.error("Failed to fetch auth user", error);
  }

  const record = toAdminRecord(profile, upserted ?? null, email);
  if (!record) {
    return NextResponse.json({ error: "Failed to load updated subscription" }, { status: 500 });
  }

  return NextResponse.json({ data: record });
}
