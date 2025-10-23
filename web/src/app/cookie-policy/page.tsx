"use client";

export default function CookiePolicyPage() {
  return (
    <main className="container py-12 space-y-10">
      <header className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary/80">
          Legal
        </p>
        <h1 className="text-3xl font-bold">Cookie Policy</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Explaining how ATHLETE uses cookies and tracking pixels to deliver fast,
          personalized football insights.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Essential Cookies</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            These keep the site running. Session cookies remember your preferred
            leagues, identity tokens secure sign-ins, and load balancer cookies ensure
            real-time statistics stream without interruption.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Performance &amp; Analytics</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We measure how supporters interact with win-probability graphs, lineup
            visualizations, and highlight reels. Aggregated insights help us polish
            UX and prioritize new analytical modules.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Personalization</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            Preference cookies surface your favourite clubs, tailor the news feed, and
            adjust notification cadence. Disable them and you&apos;ll still get core
            stats, but the experience becomes more generic.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Managing Cookies</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            You can update choices anytime through our cookie banner or your browser
            settings. For device-specific instructions, visit the help pages for
            Chrome, Safari, Edge, or Firefox. You may also email{" "}
            <a
              href="mailto:privacy@athlete.ai"
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              privacy@athlete.ai
            </a>{" "}
            with removal requests.
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Third-Party Cookies</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Highlight providers and streaming partners may set their own cookies when
          you view embedded content. These partners are vetted and contractually
          obliged to honour your privacy preferences. You can opt out via their
          respective settings.
        </p>
      </section>

      <footer className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center shadow-sm">
        <p className="text-sm text-primary/80">
          Updated for the 2024/25 season. We&apos;ll notify you in-app before
          deploying substantial changes to cookie usage.
        </p>
      </footer>
    </main>
  );
}
