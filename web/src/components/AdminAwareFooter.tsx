"use client";

import { usePathname } from "next/navigation";

import { Footer } from "./Footer";

export function AdminAwareFooter() {
  const pathname = usePathname();
  const isAdminRoute = pathname?.startsWith("/admin");

  return <Footer showExplore={!isAdminRoute} />;
}
