"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Bot, Loader2, MessageCircle, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/components/landing/lang-context";
import { cn } from "@/lib/utils";

type ChatMessage = { id: number; role: "user" | "bot"; content: string };

const MAX_MESSAGES = 12;

export function ChatWidget() {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorBubble, setErrorBubble] = useState<string | null>(null);
  const idRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  function pushMessage(role: ChatMessage["role"], content: string) {
    idRef.current += 1;
    const message: ChatMessage = { id: idRef.current, role, content };
    setMessages((prev) => [...prev, message].slice(-MAX_MESSAGES));
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setErrorBubble(null);
    pushMessage("user", trimmed);
    setInput("");
    setLoading(true);
    try {
      const history = messages
        .filter((m) => m.role === "user" || m.role === "bot")
        .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });
      const data = (await res.json().catch(() => null)) as { reply?: unknown } | null;
      const reply =
        res.ok && data && typeof data.reply === "string" ? data.reply : null;
      if (reply) {
        pushMessage("bot", reply);
      } else {
        setErrorBubble(t.chat.error);
      }
    } catch {
      setErrorBubble(t.chat.error);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(input);
  }

  return (
    <>
      {/* Tombol bulat mengambang */}
      <Button
        type="button"
        size="icon"
        aria-label={open ? t.chat.close : t.chat.open}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-rose-600 to-amber-500 text-white shadow-lg transition-transform hover:scale-105 hover:from-rose-600 hover:to-amber-500"
      >
        {open ? (
          <X className="h-6 w-6" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-6 w-6" aria-hidden="true" />
        )}
      </Button>

      {/* Panel obrolan */}
      {open ? (
        <div
          role="dialog"
          aria-label={t.chat.title}
          className="fixed bottom-20 right-5 z-50 flex max-h-[min(70vh,560px)] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl border bg-card shadow-xl"
        >
          <div className="flex items-center gap-3 bg-gradient-to-r from-rose-600 to-rose-500 px-4 py-3 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold">{t.chat.title}</p>
              <p className="flex items-center gap-1.5 text-xs text-white/85">
                <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                {t.chat.online}
              </p>
            </div>
          </div>

          <div
            ref={bodyRef}
            role="log"
            aria-live="polite"
            className="nice-scrollbar flex max-h-80 min-h-40 flex-1 flex-col gap-2 overflow-y-auto p-3"
          >
            <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
              {t.chat.welcome}
            </div>

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                  message.role === "user"
                    ? "ml-auto rounded-br-sm bg-primary text-primary-foreground"
                    : "mr-auto rounded-bl-sm bg-muted",
                )}
              >
                {message.content}
              </div>
            ))}

            {errorBubble ? (
              <div className="mx-auto rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                {errorBubble}
              </div>
            ) : null}

            {loading ? (
              <div className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ...
              </div>
            ) : null}
          </div>

          {messages.length === 0 ? (
            <div className="flex flex-wrap gap-2 border-t px-3 pt-2.5">
              {t.chat.chips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => void send(chip)}
                  className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  {chip}
                </button>
              ))}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="flex items-center gap-2 p-3">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.chat.inputPh}
              aria-label={t.chat.send}
              className="h-10 flex-1"
              maxLength={500}
            />
            <Button
              type="submit"
              size="icon"
              className="h-10 w-10 shrink-0"
              aria-label={t.chat.send}
              disabled={loading || !input.trim()}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}
