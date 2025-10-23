import { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UpgradeCta } from "@/components/pro/UpgradeCta";

export const metadata: Metadata = {
  title: "Upgrade to Pro",
  description: "Unlock premium sports analysis features with a Pro subscription.",
};

const monthlyPriceId =
  process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE ??
  process.env.STRIPE_PRO_MONTHLY_PRICE_ID ??
  process.env.STRIPE_PRO_MONTHLY_PRICE ??
  process.env.STRIPE_PRICE_PRO_MONTHLY ??
  "";

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "per month",
    description: "For casual fans getting started.",
    features: [
      "Core stats and live scores",
      "Limited highlights and win-probability",
      "Follow up to 3 teams",
      "Community Q&A access",
    ],
  },
  {
    id: "pro-monthly",
    name: "Pro",
    badge: "Best value",
    price: "$2",
    cadence: "per month",
    description: "Unlock everything with a 7-day free trial, billed at $2/month after the trial ends.",
    features: [
      "Unlimited highlights & AI insights",
      "Advanced live analytics and betting lines",
      "Unlimited favorites & personalized alerts",
      "Export data and custom dashboards",
    ],
    priceId: monthlyPriceId,
  },
];

export default function ProPage() {
  return (
    <div className="container mx-auto max-w-5xl py-12 space-y-12">
      <header className="text-center space-y-3">
        <span className="inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Unlock advanced features
        </span>
        <h1 className="text-4xl font-bold tracking-tight">Choose the plan that fits your club</h1>
        <p className="text-muted-foreground text-lg">
          Compare the Free and Pro tiers. Upgrade in seconds with a secure $2/month checkout powered by Stripe.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        {plans.map((plan) => (
          <Card key={plan.id} className={plan.id.includes("pro") ? "border-primary/60 shadow-lg" : ""}>
            <CardHeader className="space-y-1">
              <div className="flex items-center justify-between">
                <CardTitle className="text-2xl font-semibold">{plan.name}</CardTitle>
                {plan.badge && (
                  <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                    {plan.badge}
                  </span>
                )}
              </div>
              <p className="text-muted-foreground text-sm">{plan.description}</p>
              <div className="pt-2">
                <span className="text-4xl font-bold">{plan.price}</span>
                <span className="ml-2 text-sm text-muted-foreground">{plan.cadence}</span>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <ul className="space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.id === "pro-monthly" ? (
                <UpgradeCta
                  priceId={plan.priceId}
                  label="Start 7-day trial"
                  planName="Sports Analysis Pro"
                  planPrice={plan.price}
                  planCadence={plan.cadence}
                  planDescription={plan.description}
                  planFeatures={plan.features}
                />
              ) : (
                <Button variant="outline" size="lg" disabled>
                  Included in your account
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="rounded-2xl bg-muted/40 p-8">
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold">What's included in the Pro trial?</h2>
          <p className="text-muted-foreground">
            Take the full Sports Analysis suite for a spin. Launch the 7-day trial from this page to unlock premium
            analytics with no upfront charge. Cancel online anytime before your trial ends to avoid billing.
          </p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Unlimited highlights, AI insights, and detailed match breakdowns.</li>
            <li>• Personalized alerts and team tracking with no limits.</li>
            <li>• Manage billing or cancel anytime from the profile portal.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
