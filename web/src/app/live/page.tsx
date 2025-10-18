"use client";


import { useState } from "react";
import { motion } from "framer-motion";
import { LiveNowSection } from "@/components/LiveNowSection";
import { ScheduledTodaySection } from "@/components/ScheduledTodaySection";

const TABS = [
  { key: "live", label: "Live Now" },
  { key: "upcoming", label: "Upcoming Fixtures" },
];

export default function LivePage() {
  const [activeTab, setActiveTab] = useState("live");

  // Scroll to top of page
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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

      <div className="flex gap-4 border-b mb-6">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`px-4 py-2 font-semibold border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ display: activeTab === "live" ? undefined : "none" }}>
        <LiveNowSection onPageChangeAction={scrollToTop} />
      </div>
      <div style={{ display: activeTab === "upcoming" ? undefined : "none" }}>
        <ScheduledTodaySection onPageChangeAction={scrollToTop} />
      </div>
    </div>
  );
}
