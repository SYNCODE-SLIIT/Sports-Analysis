"use client";

import FootballNews from "@/components/FootballNews";

export default function Page() {

  return (
    <main className="container py-8">
      <h1 className="text-2xl font-bold mb-4">Football News</h1>

      {/* Option B: let component fetch from /api/news?sport=football */}
      <div>
  <FootballNews limit={100} />
      </div>
    </main>
  );
}