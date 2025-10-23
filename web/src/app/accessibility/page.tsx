"use client";

export default function AccessibilityPage() {
  return (
    <main className="container py-12 space-y-10">
      <header className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-primary/80">
          Legal
        </p>
        <h1 className="text-3xl font-bold">Accessibility Statement</h1>
        <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
          Ensuring every supporter can explore live analytics, match forecasts, and
          news stories on ATHLETE.
        </p>
      </header>

      <section className="space-y-6">
        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Our Commitment</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            We strive to meet WCAG 2.1 AA guidelines, focusing on keyboard-friendly
            navigation, sufficient contrast, and clear content structure across live
            dashboards and articles. Accessible sports data helps every fan stay close
            to the action.
          </p>
        </article>

        <article className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Features</h2>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>• Keyboard support for tab navigation between match sections.</li>
            <li>• Screen reader-friendly labels for probabilities, timelines, and charts.</li>
            <li>• Adjustable themes with high-contrast palettes.</li>
            <li>• Captions on highlight videos when provided by streaming partners.</li>
          </ul>
        </article>
      </section>

      <section className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm">
        <h2 className="text-lg font-semibold">Feedback</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Spot a barrier? Email{" "}
          <a
            href="mailto:accessibility@athlete.ai"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            accessibility@athlete.ai
          </a>{" "}
          with details about the page, assistive tech used, and the issue encountered.
          We respond within five business days and prioritize fixes in upcoming
          sprints.
        </p>
      </section>

      <footer className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center shadow-sm">
        <p className="text-sm text-primary/80">
          Accessibility is a continuous journey. We audit the experience each season
          as new analytics modules roll out.
        </p>
      </footer>
    </main>
  );
}
