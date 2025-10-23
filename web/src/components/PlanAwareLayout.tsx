"use client";

import { usePlanContext } from "@/components/PlanProvider";
import { UpgradeToProModal } from "@/components/UpgradeToProModal";

export function PlanAwareLayout({ children }: { children: React.ReactNode }) {
  const { plan } = usePlanContext();

  return (
    <>
      {children}
      <UpgradeToProModal plan={plan} />
    </>
  );
}
