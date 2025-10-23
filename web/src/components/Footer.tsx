import Link from "next/link";
import { ASSETS } from "@/lib/assets";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container py-6 md:py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.9fr] gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center space-x-3">
              {/* Light mode logo */}
              <Image
                src={ASSETS.logoLight}
                alt="ATHLETE Logo"
                width={96}
                height={96}
                className="w-20 h-20 sm:w-24 sm:h-24 block dark:hidden"
                priority
              />
              {/* Dark mode logo */}
              <Image
                src={ASSETS.logoDark}
                alt="ATHLETE Logo"
                width={96}
                height={96}
                className="w-20 h-20 sm:w-24 sm:h-24 hidden dark:block"
                priority
              />
              <span className="font-bold text-gradient">ATHLETE</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Advanced football analytics and live match insights.
            </p>
            <ul className="text-xs text-muted-foreground space-y-1 mt-2">
              <li>• Live win-probability models</li>
              <li>• Player performance breakdowns</li>
              <li>• Compact match highlights</li>
            </ul>
          </div>

          {/* Explore */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Explore</h4>
            <div className="space-y-2 text-sm">
              <Link href="/live" className="block text-muted-foreground hover:text-primary transition-colors">
                Live Matches
              </Link>
              <Link href="/leagues" className="block text-muted-foreground hover:text-primary transition-colors">
                League Explorer
              </Link>
              <Link href="/news" className="block text-muted-foreground hover:text-primary transition-colors">
                News & Trends
              </Link>
              <Link href="/upcoming-fixtures" className="block text-muted-foreground hover:text-primary transition-colors">
                Upcoming Fixtures
              </Link>
            </div>
          </div>

          {/* Media */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Media</h4>
            <div className="space-y-3">
              <a
                href="https://facebook.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
                aria-label="Facebook"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-sm border border-border/50">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M13.5 9H15V6h-1.5C11.57 6 11 7.79 11 9.23V11H9v3h2v6h3v-6h2.14l.36-3H14v-1.4c0-.41.32-.6.76-.6z" />
                  </svg>
                </span>
                Facebook Highlights Hub
              </a>
              <a
                href="https://www.tiktok.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
                aria-label="TikTok"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-sm border border-border/50">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M21 8.25a5.86 5.86 0 01-3.2-1V14a5 5 0 11-5-5c.17 0 .34 0 .5.02V7.1a8.17 8.17 0 01-1.5-.1V4h2.69A4.3 4.3 0 0016.5 7a3.3 3.3 0 001.94.28V8.25zM10.5 18a2 2 0 002-2v-2.76c-.16-.02-.33-.04-.5-.04a2.25 2.25 0 000 4.5z" />
                  </svg>
                </span>
                TikTok Short Plays
              </a>
              <a
                href="https://www.youtube.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-3 text-sm text-muted-foreground hover:text-primary transition-colors"
                aria-label="YouTube"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-background shadow-sm border border-border/50">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M21.8 8s-.2-1.4-.8-2c-.7-.8-1.5-.8-1.8-.9C16.8 5 12 5 12 5h0s-4.8 0-7.2.1c-.3 0-1.1.1-1.8.9-.6.6-.8 2-.8 2S2 9.6 2 11.2v1.6C2 14.4 2.2 16 2.2 16s.2 1.4.8 2c.7.8 1.6.8 2 .9 1.4.1 7 .1 7 .1s4.8 0 7.2-.1c.3 0 1.1-.1 1.8-.9.6-.6.8-2 .8-2s.2-1.6.2-3.2v-1.6C22 9.6 21.8 8 21.8 8zM10 14.65V9.35L15.2 12l-5.2 2.65z" />
                  </svg>
                </span>
                YouTube Match Replays
              </a>
            </div>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Legal</h4>
            <div className="space-y-2 text-sm text-muted-foreground">
              <Link href="#" className="hover:text-primary transition-colors">Privacy Policy</Link>
              <Link href="#" className="hover:text-primary transition-colors">Terms of Service</Link>
              <Link href="#" className="hover:text-primary transition-colors">Cookie Preferences</Link>
            </div>
          </div>
        </div>

        <div className="border-t mt-8 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="flex items-center gap-4">
              <p className="text-xs text-muted-foreground">
                © 2024 ATHLETE. All rights reserved.
              </p>
              <p className="text-xs text-muted-foreground hidden md:block">
                <strong>Disclaimer:</strong> Probabilities are model estimates and may differ from actual outcomes.
              </p>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-3">
              <p className="text-xs text-muted-foreground text-center md:text-right max-w-md">
                Use for informational purposes only.
              </p>
              <Link
                href="https://syncode.lk"
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 rounded-full border border-border/60 bg-background px-4 py-1.5 shadow-sm"
              >
                <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                  Powered by
                </span>
                <Image
                  src={ASSETS.poweredBy}
                  alt="Powered by SYNCODE"
                  width={120}
                  height={32}
                  className="h-7 w-auto"
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}