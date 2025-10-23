"use client";

export default function PrivacyPolicyPage() {
  return (
    <main className="container py-12 space-y-10">
      <header className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary/80">
          Legal
        </p>
        <h1 className="text-3xl font-bold">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          How ATHLETE collects, processes, and protects data across real-time match
          insight, predictive models, and personalized alerts.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Information We Collect</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            When you browse match dashboards, subscribe to live win-probability
            updates, or sign in to personalize favourite teams, we collect minimal
            profile data and usage analytics. These signals help us surface relevant
            fixtures, calibrate machine-learning models, and keep the platform secure.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">How Data Is Used</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Data powers our live forecasting engine, player heatmaps, and alert
            system. We never sell user information. Aggregated, anonymized metrics
            refine the accuracy of expected-goal models and highlight reels so the
            community always receives trustworthy match intelligence.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Storage &amp; Security</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            ATHLETE encrypts data in transit and at rest using industry-standard
            protocols. Role-based access controls ensure only authorized analysts can
            review training datasets that fuel our models, and retention schedules
            automatically purge stale match logs.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Your Controls</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Update notification preferences, delete saved teams, or request data
            exports any time from your profile settings. For compliance requests,
            contact{" "}
            <a
              href="mailto:privacy@athlete.ai"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              privacy@athlete.ai
            </a>
            .
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Third-Party Services</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          We integrate reputable providers for payment processing, streaming
          highlights, and crash analytics. Each partner signs strict data-processing
          agreements aligned with GDPR and regional requirements. Links to partner
          policies are available on request.
        </p>
      </section>

      <footer className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center shadow-sm">
        <p className="text-sm text-primary/80">
          Staying transparent keeps the game fair. We review this policy every season
          to reflect new features across the ATHLETE platform.
        </p>
      </footer>
    </main>
  );
}
