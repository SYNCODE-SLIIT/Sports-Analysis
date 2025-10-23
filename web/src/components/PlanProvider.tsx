"use client";

import { createContext, useContext } from "react";
import { usePlan } from "@/hooks/usePlan";

const PlanContext = createContext<ReturnType<typeof usePlan> | undefined>(undefined);

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const planState = usePlan();
  return <PlanContext.Provider value={planState}>{children}</PlanContext.Provider>;
}

export function usePlanContext() {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlanContext must be used within PlanProvider");
  return ctx;
}
