"use client";

import { motion } from "framer-motion";
import { LiveNowSection } from "@/components/LiveNowSection";
import { ScheduledTodaySection } from "@/components/ScheduledTodaySection";

export default function LivePage() {
  return (
    <div className="container py-8 space-y-10">
      <motion.header
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-4"
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Live Football Center</h1>
          <p className="text-muted-foreground max-w-2xl">
            Track the matches that are happening right now and preview the fixtures on today&apos;s schedule. Data updates automatically every few minutes from our collector.
          </p>
        </div>
      </motion.header>

      <LiveNowSection />

      <ScheduledTodaySection />
    </div>
  );
}
