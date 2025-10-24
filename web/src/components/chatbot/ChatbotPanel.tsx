"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "./MarkdownMessage";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
};

type ChatCitation = {
  title?: string | null;
  url?: string | null;
  snippet?: string | null;
  score?: number | null;
};

type ApiResponse =
  | {
      answer: string;
      citations: ChatCitation[];
    }
  | {
      ok: false;
      error?: { message?: string; detail?: string };
      detail?: { message?: string };
    };

const DEFAULT_TOP_K = 5;

const FALLBACK_PROMPTS = [
  "What storylines should I watch in this weekend's Premier League matches?",
  "Which players are in top form ahead of the Champions League fixtures?",
  "Show me recent results and trends for Manchester City and Liverpool.",
  "Who are the underdog teams to watch across major European leagues this week?",
];

export function ChatbotPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [topK, setTopK] = useState<number>(DEFAULT_TOP_K);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);
  const [isLoadingPrompts, setIsLoadingPrompts] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastUserMessageRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const setLastUserMessageRef = useCallback((node: HTMLDivElement | null) => {
    lastUserMessageRef.current = node;
  }, []);

  useEffect(() => {
    if (messages.length === 0) return;
    const latestMessage = messages[messages.length - 1];
    if (latestMessage.role === "user") {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }
    lastUserMessageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [messages]);

  useEffect(() => {
    let isMounted = true;

    const loadPrompts = async () => {
      setIsLoadingPrompts(true);
      try {
        const resp = await fetch("/api/chatbot/prompts", { cache: "no-store" });
        if (!resp.ok) {
          throw new Error(`Prompts request failed with status ${resp.status}`);
        }
        const data: { prompts?: unknown } = await resp.json();
        if (!isMounted) return;
        const prompts = Array.isArray(data.prompts)
          ? (data.prompts as unknown[]).filter(
              (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
            )
          : [];
        setSuggestedPrompts(prompts.slice(0, 4));
      } catch {
        if (isMounted) {
          setSuggestedPrompts([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingPrompts(false);
        }
      }
    };

    void loadPrompts();
    return () => {
      isMounted = false;
    };
  }, []);

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question) {
      setError("Ask a question about sports to get started.");
      return;
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
    };

    const historyPayload = [...messages, userMessage].map(({ role, content }) => ({
      role,
      content,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
    setError(null);
    setPendingQuestion(question);

    try {
      const resp = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, top_k: topK, history: historyPayload }),
      });
      const data: ApiResponse = await resp.json();

      if (!resp.ok) {
        const message =
          ("detail" in data && data.detail?.message) ||
          ("error" in data && data.error?.message) ||
          "Chatbot request failed.";
        throw new Error(message);
      }

      // Narrow the union type to the success shape before accessing fields
      if (!("answer" in data)) {
        throw new Error("Invalid response from chatbot service.");
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.answer ?? "",
        citations: Array.isArray(data.citations) ? data.citations : [],
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setIsLoading(false);
      setPendingQuestion(null);
    }
  };

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    if (event) event.preventDefault();
    await sendQuestion(inputValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit();
    }
  };

  const handleClear = () => {
    setMessages([]);
    setError(null);
    setPendingQuestion(null);
  };

  const handleSuggestionSelect = (prompt: string) => {
    setError(null);
    if (isLoading) return;
    void sendQuestion(prompt);
    inputRef.current?.focus();
  };

  const loadingStatus =
    pendingQuestion && pendingQuestion.trim().length > 0
      ? `Searching ${pendingQuestion.replace(/[?!.\s]+$/, "")}...`
      : "Searching for results...";

  const promptsToRender = (suggestedPrompts.length > 0 ? suggestedPrompts : FALLBACK_PROMPTS).slice(0, 4);

  return (
    <Card className="shadow-lg border-primary/10 bg-background/70 backdrop-blur flex flex-col h-full min-h-[75vh]">
      <CardHeader className="pb-1.5 pt-2 flex-shrink-0 hidden">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-3 w-3" />
              </span>
              Sports Insight Assistant
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              Ask about teams, players, or matches. Answers cite live web sources.
            </CardDescription>
          </div>
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-2 pb-2 flex flex-col flex-1 min-h-0 relative overflow-hidden">
        <div className="flex-1 min-h-0 mb-3">
          {messages.length > 0 ? (
            <ScrollArea className="h-full rounded-xl border bg-muted/30 p-4">
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    ref={msg.role === "user" ? setLastUserMessageRef : undefined}
                    className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
                  >
                    <div
                      className={cn(
                        "rounded-lg border p-3 shadow-sm max-w-full sm:max-w-[75%] break-words",
                        msg.role === "user"
                          ? "border-primary/40 bg-primary/10 text-primary-foreground/90 dark:text-primary-foreground"
                          : "border-border bg-background"
                      )}
                    >
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {msg.role === "user" ? "You" : "Assistant"}
                      </div>
                      {msg.role === "assistant" ? (
                        <div className="mt-2 break-words">
                          <MarkdownMessage content={msg.content} />
                        </div>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                          {msg.content}
                        </p>
                      )}
                      {msg.role === "assistant" && msg.citations && msg.citations.length > 0 && (
                        <div className="mt-3 space-y-2 text-xs">
                          <p className="font-semibold text-muted-foreground uppercase">Sources</p>
                          <ul className="grid gap-1.5 max-w-full">
                            {msg.citations.map((cite, idx) => (
                              <li
                                key={cite.url ?? idx}
                                className="rounded-md border border-border/60 bg-muted/20 p-2 break-words max-w-full overflow-hidden"
                              >
                                <a
                                  href={cite.url ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="block text-xs font-medium text-primary hover:underline break-words"
                                >
                                  {cite.title || cite.url || "Source"}
                                </a>
                                {cite.snippet && (
                                  <p className="mt-1 text-xs text-muted-foreground leading-relaxed line-clamp-3 break-words">
                                    {cite.snippet}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {loadingStatus}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </ScrollArea>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-6 rounded-xl border border-dashed border-primary/30 bg-muted/15 p-8 text-center">
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-foreground">Ask about the sports world</h3>
                <p className="text-sm text-muted-foreground">Try one of these prompts to explore matches, players, and trends.</p>
              </div>
              <div className="grid w-full gap-3 sm:grid-cols-2">
                {promptsToRender.map((prompt) => (
                  <Button
                    key={prompt}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal px-4 py-3 text-left text-sm"
                    onClick={() => handleSuggestionSelect(prompt)}
                    disabled={isLoading}
                  >
                    {prompt}
                  </Button>
                ))}
              </div>
              {isLoadingPrompts && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Updating suggestions…
                </div>
              )}
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground/80">ATHLETE AI can make mistakes</p>
            </div>
          )}
        </div>

        <div className="mt-auto space-y-1.5">
          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-1.5 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/80 text-center sm:text-left">
            ATHLETE AI can make mistakes
          </p>
          <form onSubmit={handleSubmit} className="space-y-1.5">
            <textarea
              id="question"
              name="question"
              ref={inputRef}
              value={inputValue}
              onChange={(event) => setInputValue(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question... (Enter to send, Shift+Enter for new line)"
              rows={2}
              className="w-full resize-none rounded-lg border border-input bg-background px-2.5 py-1.5 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                Depth
                <select
                  value={topK}
                  onChange={(event) => setTopK(Number(event.currentTarget.value))}
                  className="rounded-md border border-input bg-background px-2 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                >
                  {[3, 5, 7, 10].map((value) => (
                    <option key={value} value={value}>
                      Top {value} sources
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" size="sm" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Thinking…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Ask
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
