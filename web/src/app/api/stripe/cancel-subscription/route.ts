import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import { getStripeClient } from "@/lib/stripe/client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export async function POST() {
  const supabaseServer = await getSupabaseServerClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseServer.auth.getUser();

  if (authError) {
    console.error("Failed to get auth user for cancellation", authError);
  }

  if (!user) {
    return NextResponse.json(
      {
        error: "Authentication required",
        loginUrl: `${SITE_URL}/auth/login?next=/profile`,
      },
      { status: 401 },
    );
  }

  let supabaseService;
  try {
    supabaseService = getSupabaseServiceRoleClient();
  } catch (error) {
    console.error("Service role client not configured", error);
    return NextResponse.json({ error: "Server not configured for subscription changes." }, { status: 500 });
  }

  const { data: subscription, error: subscriptionError } = await supabaseService
    .from("subscriptions")
    .select(
      "user_id, plan, subscription_status, current_period_end, stripe_price_id, stripe_subscription_id, stripe_customer_id",
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (subscriptionError) {
    console.error("Failed to fetch subscription for cancellation", subscriptionError);
    return NextResponse.json({ error: "Unable to load subscription." }, { status: 500 });
  }

  if (!subscription) {
    return NextResponse.json({ success: true, plan: "free" });
  }

  const alreadyFree = subscription.plan !== "pro" && subscription.subscription_status !== "pro";

  if (!alreadyFree && subscription.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(subscription.stripe_subscription_id, {
        invoice_now: false,
        prorate: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Allow missing subscription errors to pass through
      if (!message.includes("No such subscription")) {
        console.error("Stripe cancellation failed", error);
        return NextResponse.json({ error: "Stripe cancellation failed. Try again or contact support." }, { status: 502 });
      }
    }
  }

  const updates = {
    user_id: user.id,
    plan: "free" as const,
    subscription_status: "free" as const,
    current_period_end: null,
    stripe_price_id: null,
    stripe_subscription_id: null,
    stripe_customer_id: subscription.stripe_customer_id ?? null,
  };

  const { error: updateError } = await supabaseService.from("subscriptions").upsert(updates, { onConflict: "user_id" });

  if (updateError) {
    console.error("Failed to update subscription after cancellation", updateError);
    return NextResponse.json({ error: "Failed to update subscription status." }, { status: 500 });
  }

  return NextResponse.json({ success: true, plan: "free" });
}
