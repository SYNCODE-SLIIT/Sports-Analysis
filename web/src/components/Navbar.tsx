"use client";

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Menu, User, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ThemeToggle } from "./ThemeToggle";
import { ASSETS } from "@/lib/assets";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";
import { isAdminEmail } from "@/lib/admin";
import { NlSearchBar } from "@/components/search/NlSearchBar";
import { usePlanContext } from "@/components/PlanProvider";
import { PlanBadge } from "@/components/UpgradeBadge";

const navItems = [
  { name: "Home", href: "/" },
  { name: "About", href: "/about" },
  { name: "Live", href: "/live" },
  { name: "Leagues", href: "/leagues" },
  { name: "News", href: "/news" },
  { name: "My Teams", href: "/my-teams" },
];

export function Navbar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = React.useState(false);
  const { user } = useAuth();
  const isAdminUser = isAdminEmail(user?.email ?? undefined);
  const { plan } = usePlanContext();

  // sign-out moved to profile page

  return (
    <motion.header
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="sticky top-0 z-40 w-full glass-bg border-b"
    >
      <nav className="container flex items-center justify-between h-16">
        {/* Logo & Brand */}
        <Link href="/" className="flex items-center space-x-4">
          {/* Light mode logo */}
          <Image
            src={ASSETS.logoLight}
            alt="ATHLETE Logo"
            width={68}
            height={68}
            className="h-16 w-auto max-h-16 block dark:hidden"
            priority
          />
          {/* Dark mode logo */}
          <Image
            src={ASSETS.logoDark}
            alt="ATHLETE Logo"
            width={68}
            height={68}
            className="h-16 w-auto max-h-16 hidden dark:block"
            priority
          />
          <span className="text-2xl font-bold text-gradient">ATHLETE</span>
        </Link>        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-10">
          {navItems.map((item) => (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "relative text-sm font-medium transition-colors hover:text-primary",
                pathname === item.href
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              {item.name}
              {pathname === item.href && (
                <motion.div
                  layoutId="navbar-underline"
                  className="absolute -bottom-1 left-0 right-0 h-0.5 bg-primary rounded-full"
                  transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                />
              )}
            </Link>
          ))}
        </div>

        {/* Right Actions */}
        <div className="flex items-center space-x-2">
          <NlSearchBar className="hidden md:flex w-72 bg-background/80" />
          <ThemeToggle />
          
          {user ? (
            <>
              <PlanBadge plan={plan} />
              <Button variant="ghost" size="sm" asChild className="hidden md:flex">
                <Link href={isAdminUser ? "/admin" : "/profile"}>
                  <User className="h-4 w-4 mr-2" />
                  {isAdminUser ? "Admin" : "Profile"}
                </Link>
              </Button>
            </>
          ) : (
            <Button size="sm" asChild className="hidden md:flex">
              <Link href="/auth/login">
                <LogIn className="h-4 w-4 mr-2" />
                Login
              </Link>
            </Button>
          )}

          {/* Mobile Menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <div className="flex flex-col space-y-6 mt-8">
                <NlSearchBar className="w-full" onSubmit={() => setIsOpen(false)} />
                {navItems.map((item) => (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setIsOpen(false)}
                    className={cn(
                      "text-lg font-medium transition-colors",
                      pathname === item.href
                        ? "text-primary"
                        : "text-muted-foreground hover:text-primary"
                    )}
                  >
                    {item.name}
                  </Link>
                ))}
                
                <div className="border-t pt-6 space-y-4">
                  {user ? (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Current plan</span>
                        <PlanBadge plan={plan} />
                      </div>
                      <Button variant="outline" size="sm" asChild className="w-full justify-start">
                        <Link href={isAdminUser ? "/admin" : "/profile"} onClick={() => setIsOpen(false)}>
                          <User className="h-4 w-4 mr-2" />
                          {isAdminUser ? "Admin" : "Profile"}
                        </Link>
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" asChild className="w-full">
                      <Link href="/auth/login" onClick={() => setIsOpen(false)}>
                        <LogIn className="h-4 w-4 mr-2" />
                        Login
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </motion.header>
  );
}
