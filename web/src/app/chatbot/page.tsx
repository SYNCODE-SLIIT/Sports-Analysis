import { Metadata } from "next";

import { ChatbotPanel } from "@/components/chatbot/ChatbotPanel";

export const metadata: Metadata = {
  title: "Sports Insight Assistant",
  description: "Ask questions about sports and get answers grounded in live web sources.",
};

export default function ChatbotPage() {
  return (
    <div className="container py-2 flex flex-col h-[calc(100vh-1rem)]">
      <section className="space-y-1 text-center sm:text-left flex-shrink-0 mb-2">
        <h1 className="text-2xl font-bold tracking-tight">Sports Insight Assistant</h1>
        <p className="text-xs text-muted-foreground">
          Combine web search with Groq models to get fast, cited answers about ongoing sports stories.
        </p>
      </section>
      <div className="flex-1 min-h-0">
        <ChatbotPanel />
      </div>
    </div>
  );
}
