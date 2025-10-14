import { Metadata } from "next";

import { ChatbotPanel } from "@/components/chatbot/ChatbotPanel";

export const metadata: Metadata = {
  title: "Sports Insight Assistant",
  description: "Ask questions about sports and get answers grounded in live web sources.",
};

export default function ChatbotPage() {
  return (
    <div className="container py-16 space-y-10">
      <section className="space-y-4 text-center sm:text-left">
        <h1 className="text-4xl font-bold tracking-tight">Sports Insight Assistant</h1>
        <p className="text-lg text-muted-foreground">
          Combine web search with Groq models to get fast, cited answers about ongoing sports stories.
        </p>
      </section>
      <ChatbotPanel />
    </div>
  );
}
