"use client";

import type { TLItem } from "@/lib/match-mappers";

export default function Timeline({ items }: { items: TLItem[] }) {
  if (!items?.length) {
    return <div className="text-sm opacity-70">No timeline events available.</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((event, index) => (
        <div key={`${event.type}-${index}`} className="flex items-center gap-2">
          <div className="text-xs w-10 text-right">{event.minute}&apos;</div>
          <div className={`flex-1 text-sm ${event.team === "home" ? "text-left" : "text-right"}`}>
            {renderIcon(event.type)} {event.player ?? ""}
            {event.assist ? ` (↦ ${event.assist})` : ""}
            {event.note ? ` — ${event.note}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function renderIcon(type: TLItem["type"]) {
  switch (type) {
    case "goal":
      return "⚽";
    case "own_goal":
      return "🥅";
    case "pen_score":
      return "✅";
    case "pen_miss":
      return "❌";
    case "yellow":
      return "🟨";
    case "red":
      return "🔴";
    case "sub":
      return "🔁";
    case "ht":
      return "HT";
    case "ft":
      return "FT";
    default:
      return "•";
  }
}
