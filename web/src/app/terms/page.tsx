"use client";

export default function TermsPage() {
  return (
    <main className="container py-12 space-y-10">
      <header className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary/80">
          Legal
        </p>
        <h1 className="text-3xl font-bold">Terms of Service</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          The rules that guide how supporters, analysts, and partners interact with
          ATHLETE&apos;s football analytics platform.
        </p>
      </header>

      <section className="space-y-6">
        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Using ATHLETE</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Create an account to bookmark fixtures, tailor live alerts, and unlock
            premium predictive models. You may not reverse-engineer dashboards,
            redistribute proprietary data feeds, or use automated scripts to harvest
            statistics.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Match Insights &amp; Forecasts</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Our win-probability charts, projected lineups, and player form scores are
            model outputs. They provide decision support only. ATHLETE is not liable
            for financial decisions made from these projections.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Subscriptions &amp; Billing</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Paid tiers unlock extended historical data, tactical overlays, and
            automation tools for analysts. Subscriptions renew monthly but can be
            cancelled anytime. Refunds are handled according to the applicable
            consumer law in your region.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Community Standards</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Respect other supporters. Posting abusive content, spamming highlight
            threads, or attempting unauthorized access results in suspension.
            Violations may be reported to{" "}
            <a
              href="mailto:support@athlete.ai"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              support@athlete.ai
            </a>
            .
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Modifications</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          We iterate quickly. Significant changes to the platform or these Terms will
          be communicated via in-app notices and email updates. Continued use
          signifies acceptance of the updated terms.
        </p>
      </section>

      <footer className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center shadow-sm">
        <p className="text-sm text-primary/80">
          Questions about these Terms? Contact our legal team at{" "}
          <a
            href="mailto:legal@athlete.ai"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            legal@athlete.ai
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
