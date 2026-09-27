"use client";

// Widget floating "Tanya Data" (Task 20-c) — tombol bulat kanan-bawah + dialog chat.
// Menjawab pertanyaan statistik rekrutmen admin dari data DB via POST /api/admin/ask-data.
// Hanya dirender di panel admin (diimpor & dimount oleh admin-app.tsx setelah NotificationBell).

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Bot, Loader2, Send, Trash2 } from "lucide-react";
import { useAdminSession } from "./admin-context";
import { apiPost } from "./api";

type AskMessage = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Berapa lamaran baru minggu ini?",
  "Posisi mana yang paling banyak dilamar?",
  "Berapa offer yang masih menunggu jawaban?",
];

// Widget chatbot data untuk admin: tombol bulat floating kanan-bawah (z-50).
export function AdminAskWidget() {
  const { role, reportError } = useAdminSession();
  const viewer = role === "VIEWER";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll ke bawah saat riwayat/loading berubah.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, loading, open]);

  // Fokus input saat dialog dibuka.
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(timer);
    }
  }, [open]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading || viewer) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setLoading(true);
    try {
      const res = await apiPost<{ reply: string }>("/api/admin/ask-data", {
        question: trimmed,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.reply }]);
    } catch (err) {
      reportError(err);
      // Hapus bubble user agar pertanyaan tidak "menggantung" tanpa jawaban.
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.map((m) => m.role).lastIndexOf("user");
        if (idx !== -1) next.splice(idx, 1);
        return next;
      });
      setInput(trimmed); // kembalikan ke input agar mudah dikirim ulang
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        className="fixed bottom-5 right-5 z-50 size-14 rounded-full shadow-lg active:scale-95"
        onClick={() => setOpen(true)}
        aria-label="Buka Tanya Data"
      >
        <Bot className="size-6" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Tanya Data
            </DialogTitle>
            <DialogDescription>
              Tanya statistik rekrutmen (lamaran, offer, wawancara, karyawan). Jawaban
              berdasarkan data terkini di database.
            </DialogDescription>
          </DialogHeader>

          {viewer ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
              Tanya Data hanya tersedia untuk OWNER dan HR.
            </p>
          ) : null}

          <div
            ref={scrollRef}
            className="flex max-h-96 min-h-40 flex-col gap-3 overflow-y-auto nice-scrollbar rounded-xl border bg-zinc-50/60 p-3 dark:bg-zinc-900/40"
          >
            {messages.length === 0 && !loading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
                <Bot className="size-8 text-zinc-400" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">Tanyakan apa saja tentang data rekrutmen.</p>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-rose-300 hover:text-rose-600 dark:hover:text-rose-400"
                      onClick={() => void ask(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div
                key={index}
                className={
                  message.role === "user"
                    ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-rose-600 px-3.5 py-2 text-sm text-white"
                    : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {message.content}
              </div>
            ))}

            {loading ? (
              <div className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-md border bg-background px-3.5 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Menganalisis data...
              </div>
            ) : null}
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={viewer ? "Mode Pengamat — tidak bisa bertanya" : "Tulis pertanyaan..."}
              maxLength={500}
              disabled={viewer || loading}
              className="h-11 flex-1"
              aria-label="Pertanyaan untuk Tanya Data"
            />
            {messages.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 text-muted-foreground hover:text-foreground sm:size-10"
                onClick={() => setMessages([])}
                disabled={loading}
                aria-label="Bersihkan riwayat chat"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            ) : null}
            <Button
              type="submit"
              className="size-11 shrink-0 rounded-full sm:size-10"
              disabled={viewer || loading || input.trim().length === 0}
              aria-label="Kirim pertanyaan"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
