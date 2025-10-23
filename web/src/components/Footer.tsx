import Link from "next/link";
import { ASSETS } from "@/lib/assets";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container py-6 md:py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_0.9fr] items-start gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4 text-center lg:text-left">
            <Link href="/" className="flex items-center justify-center space-x-3 lg:justify-start">
              {/* Light mode logo */}
              <Image
                src={ASSETS.logoLight}
                alt="ATHLETE Logo"
                width={120}
                height={120}
                className="w-24 h-24 sm:w-28 sm:h-28 block dark:hidden"
                priority
              />
              {/* Dark mode logo */}
              <Image
                src={ASSETS.logoDark}
                alt="ATHLETE Logo"
                width={120}
                height={120}
                className="w-24 h-24 sm:w-28 sm:h-28 hidden dark:block"
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
          <div className="space-y-4 text-center flex flex-col items-center group">
            <div className="space-y-0.5">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Explore</h4>
              <span className="relative block h-0.5 w-14 overflow-hidden rounded-full">
                <span className="absolute inset-0 h-full w-full bg-gradient-to-r from-primary/40 via-primary/60 to-primary/40 dark:from-white/30 dark:via-white/60 dark:to-white/30" />
                <span className="absolute inset-0 h-full w-full translate-x-[-100%] bg-gradient-to-r from-white/0 via-white/60 to-white/0 dark:from-primary/10 dark:via-primary/60 dark:to-primary/10 animate-[marquee_2.8s_linear_infinite]" />
              </span>
            </div>
            <div className="flex flex-col items-center space-y-3 text-sm">
              <Link href="/live" className="text-muted-foreground hover:text-primary transition-colors">
                Live Matches
              </Link>
              <Link href="/leagues" className="text-muted-foreground hover:text-primary transition-colors">
                League Explorer
              </Link>
              <Link href="/about" className="text-muted-foreground hover:text-primary transition-colors">
                About Us
              </Link>
              <Link href="/news" className="text-muted-foreground hover:text-primary transition-colors">
                News & Trends
              </Link>
            </div>
          </div>

          {/* Media */}
          <div className="space-y-4 text-center flex flex-col items-center group">
            <div className="space-y-0.5">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Media</h4>
              <span className="relative block h-0.5 w-14 overflow-hidden rounded-full">
                <span className="absolute inset-0 h-full w-full bg-gradient-to-r from-primary/40 via-primary/60 to-primary/40 dark:from-white/30 dark:via-white/60 dark:to-white/30" />
                <span className="absolute inset-0 h-full w-full translate-x-[-100%] bg-gradient-to-r from-white/0 via-white/60 to-white/0 dark:from-primary/10 dark:via-primary/60 dark:to-primary/10 animate-[marquee_2.8s_linear_infinite]" />
              </span>
            </div>
            <div className="space-y-3 w-full max-w-xs">
              <a
                href="https://facebook.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 rounded-full border border-border/40 bg-background/60 px-4 py-2 text-sm text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                aria-label="Facebook"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20 dark:bg-white/15 dark:text-white">
                  <Image
                    src="/logo/facebook.svg"
                    alt="Facebook"
                    width={18}
                    height={18}
                    className="opacity-80"
                  />
                </span>
                <span className="flex-1 text-left">Facebook Highlights Hub</span>
              </a>
              <a
                href="https://www.tiktok.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 rounded-full border border-border/40 bg-background/60 px-4 py-2 text-sm text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                aria-label="TikTok"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20 dark:bg-white/15 dark:text-white">
                  <Image
                    src="/logo/tiktok.svg"
                    alt="TikTok"
                    width={18}
                    height={18}
                    className="opacity-80"
                  />
                </span>
                <span className="flex-1 text-left">TikTok Short Plays</span>
              </a>
              <a
                href="https://www.youtube.com/"
                target="_blank"
                rel="noreferrer noopener"
                className="group flex items-center gap-3 rounded-full border border-border/40 bg-background/60 px-4 py-2 text-sm text-muted-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary"
                aria-label="YouTube"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary/20 dark:bg-white/15 dark:text-white">
                  <Image
                    src="/logo/youtube.svg"
                    alt="YouTube"
                    width={18}
                    height={18}
                    className="opacity-80"
                  />
                </span>
                <span className="flex-1 text-left">YouTube Match Replays</span>
              </a>
            </div>
          </div>

          {/* Legal */}
          <div className="space-y-4 text-center flex flex-col items-center group">
            <div className="space-y-0.5">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Legal</h4>
              <span className="relative block h-0.5 w-14 overflow-hidden rounded-full">
                <span className="absolute inset-0 h-full w-full bg-gradient-to-r from-primary/40 via-primary/60 to-primary/40 dark:from-white/30 dark:via-white/60 dark:to-white/30" />
                <span className="absolute inset-0 h-full w-full translate-x-[-100%] bg-gradient-to-r from-white/0 via-white/60 to-white/0 dark:from-primary/10 dark:via-primary/60 dark:to-primary/10 animate-[marquee_2.8s_linear_infinite]" />
              </span>
            </div>
            <div className="flex flex-col items-center space-y-3 text-sm text-muted-foreground">
              <Link href="/privacy-policy" className="hover:text-primary transition-colors">
                Privacy Policy
              </Link>
              <Link href="/terms" className="hover:text-primary transition-colors">
                Terms of Service
              </Link>
              <Link href="/cookie-policy" className="hover:text-primary transition-colors">
                Cookie Policy
              </Link>
              <Link href="/accessibility" className="hover:text-primary transition-colors">
                Accessibility
              </Link>
            </div>
          </div>
        </div>

        <div className="border-t mt-8 pt-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-1 text-[11px] text-muted-foreground md:flex-row md:items-center md:gap-4">
              <p>© 2024 ATHLETE. All rights reserved.</p>
              <p className="max-w-md md:max-w-none">
                <strong className="font-semibold">Disclaimer:</strong> Probabilities are model estimates and may differ from actual outcomes. Use for informational purposes only.
              </p>
              <p className="text-[11px] text-muted-foreground md:pl-4 md:border-l md:border-border/40">
                Contact: <a href="mailto:support@athlete.ai" className="underline hover:text-primary transition-colors">support@athlete.ai</a>
              </p>
            </div>

            <Link
              href="https://syncode.lk"
              target="_blank"
              rel="noreferrer noopener"
              className="group relative flex w-full flex-col overflow-hidden rounded-3xl border border-border/60 bg-background/70 px-6 py-4 text-left shadow-sm backdrop-blur transition-transform hover:-translate-y-0.5 hover:shadow-xl sm:w-auto sm:flex-row sm:items-center sm:gap-5"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
              <div className="relative flex items-center gap-4">
                <div className="relative flex h-10 w-10 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary/60 opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.34em] text-muted-foreground">
                    Powered by
                  </span>
                  <span className="text-xs font-medium text-muted-foreground/90">
                    SYNCODE
                  </span>
                </div>
                <div className="flex items-center sm:pl-4">
                  <Image
                    src={ASSETS.poweredByLight}
                    alt="SYNCODE"
                    width={104}
                    height={32}
                    className="h-8 w-auto drop-shadow-sm dark:hidden"
                  />
                  <Image
                    src={ASSETS.poweredByDark}
                    alt="SYNCODE"
                    width={104}
                    height={32}
                    className="hidden h-8 w-auto drop-shadow-sm dark:block"
                  />
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
