import { NextRequest, NextResponse } from "next/server";
import { getStripeClient } from "@/lib/stripe/client";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 500 });
  }

  const stripe = getStripeClient();

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer", "line_items"],
    });

    const subscription = session.subscription as any;
    if (!subscription) {
      return NextResponse.json({ error: "No subscription found on session" }, { status: 400 });
    }

    // Extract useful fields
    const userId = (subscription.metadata && subscription.metadata.user_id) || (session.metadata && session.metadata.user_id) || null;
    const customerId = (subscription.customer && typeof subscription.customer === 'string') ? subscription.customer : (session.customer as string | null);
    const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const status = subscription.status || null;
  const isPro = status === 'active' || status === 'trialing' || status === 'past_due';
  const normalizedStatus = isPro ? 'pro' : 'free';
    const currentPeriodEnd = subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null;

    if (!userId) {
      return NextResponse.json({ error: 'Subscription missing user metadata' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRoleClient();
    const { error } = await supabase.from('subscriptions').upsert({
      user_id: userId,
      plan: normalizedStatus === 'pro' ? 'pro' : 'free',
      stripe_customer_id: customerId || null,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceId,
      subscription_status: normalizedStatus,
      current_period_end: currentPeriodEnd,
    }, { onConflict: 'user_id' });

    if (error) {
      console.error('Supabase upsert error:', error);
      return NextResponse.json({ error: 'DB error' }, { status: 500 });
    }

    return NextResponse.redirect('/pro/success');
  } catch (err: any) {
    console.error('Error fetching session:', err);
    return NextResponse.json({ error: 'Failed to retrieve session' }, { status: 500 });
  }
}
