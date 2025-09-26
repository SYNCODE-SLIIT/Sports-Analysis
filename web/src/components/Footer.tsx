import Link from "next/link";
import { ASSETS } from "@/lib/assets";
import Image from "next/image";

export function Footer() {
  return (
    <footer className="border-t bg-muted/30">
      <div className="container py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="space-y-4">
            <Link href="/" className="flex items-center space-x-3">
              {/* Light mode logo */}
              <Image
                src={ASSETS.logoLight}
                alt="ATHLETE Logo"
                width={24}
                height={24}
                className="w-6 h-6 block dark:hidden"
                priority
              />
              {/* Dark mode logo */}
              <Image
                src={ASSETS.logoDark}
                alt="ATHLETE Logo"
                width={24}
                height={24}
                className="w-6 h-6 hidden dark:block"
                priority
              />
              <span className="font-bold text-gradient">ATHLETE</span>
            </Link>
            <p className="text-sm text-muted-foreground">
              Advanced football analytics and live match insights.
            </p>
          </div>

          {/* Quick Links */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Quick Links</h4>
            <div className="space-y-2">
              <Link href="/live" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Live Matches
              </Link>
              <Link href="/leagues" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Leagues
              </Link>
              <Link href="/about" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                About
              </Link>
            </div>
          </div>

          {/* Account */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Account</h4>
            <div className="space-y-2">
              <Link href="/auth/login" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Login
              </Link>
              <Link href="/auth/signup" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                Sign Up
              </Link>
              <Link href="/my-teams" className="block text-sm text-muted-foreground hover:text-primary transition-colors">
                My Teams
              </Link>
            </div>
          </div>

          {/* Legal */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold">Legal</h4>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Privacy Policy
              </p>
              <p className="text-xs text-muted-foreground">
                Terms of Service
              </p>
            </div>
          </div>
        </div>

        <div className="border-t mt-8 pt-8">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <p className="text-xs text-muted-foreground">
              © 2024 ATHLETE. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground text-center md:text-right max-w-md">
              <strong>Disclaimer:</strong> Probabilities are model estimates and may differ from actual outcomes. 
              Use for informational purposes only.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}