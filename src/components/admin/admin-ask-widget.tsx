"use client";

// Widget floating "Copilot Admin" (NR49 Paket B — upgrade dari "Tanya Data").
// Tombol bulat kanan-bawah + dialog chat. Copilot menjawab pertanyaan statistik
// rekrutmen DAN (bila relevan) mengusulkan aksi panel sebagai chip berlabel
// risiko. Eksekusi aksi memakai KONFIRMASI 2 LANGKAH (klik pertama meminta
// kepastian, reset otomatis 6 detik; klik kedua menjalankan). Server tetap
// memverifikasi ulang tipe, izin, dan parameter (UI tidak dipercaya).
// Hanya dirender di panel admin. PENTING: dimount di level atas admin-app (di
// luar <header>) — backdrop-blur header menciptakan containing block yang
// membuat position:fixed tombol salah anchor bila diletakkan di dalamnya.

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  ArrowRightCircle,
  Bot,
  Check,
  ListX,
  Loader2,
  Send,
  ToggleLeft,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { CopilotProposedAction } from "@/lib/ai-features";
import { useAdminSession } from "./admin-context";
import { ApiError, apiPost } from "./api";

type AskMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** true = bubble peringatan (mis. pesan gate AI 503) dengan gaya amber. */
  warning?: boolean;
  actions?: CopilotProposedAction[];
};

/** Maksimal riwayat yang disimpan: 5 pasang tanya-jawab. */
const MAX_MESSAGES = 10;
/** Jeda reset otomatis konfirmasi chip (detik). */
const CONFIRM_RESET_MS = 6000;

const SUGGESTIONS = [
  "Berapa lamaran baru minggu ini?",
  "Posisi mana yang paling banyak dilamar?",
  "Ada lamaran lama yang belum ditinjau?",
];

const RISK_BADGES: Record<
  CopilotProposedAction["risk"],
  { label: string; className: string }
> = {
  low: {
    label: "Aman",
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  medium: {
    label: "Perlu konfirmasi",
    className:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
  },
  high: {
    label: "Berisiko",
    className:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400",
  },
};

const ACTION_ICONS: Record<CopilotProposedAction["type"], LucideIcon> = {
  set_application_status: ArrowRightCircle,
  toggle_position: ToggleLeft,
  bulk_reject_stale: ListX,
};

type ChipState = "idle" | "confirm" | "busy" | "done";

/** Chip satu aksi usulan Copilot: label + badge risiko + konfirmasi 2 langkah. */
function CopilotActionChip({
  action,
  onExecute,
}: {
  action: CopilotProposedAction;
  onExecute: (action: CopilotProposedAction) => Promise<boolean>;
}) {
  const [state, setState] = useState<ChipState>("idle");
  const Icon = ACTION_ICONS[action.type] ?? Bot;
  const risk = RISK_BADGES[action.risk] ?? RISK_BADGES.medium;

  // Reset otomatis state konfirmasi setelah 6 detik tanpa keputusan.
  useEffect(() => {
    if (state !== "confirm") return;
    const timer = setTimeout(() => setState("idle"), CONFIRM_RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function run() {
    setState("busy");
    const ok = await onExecute(action);
    setState(ok ? "done" : "idle");
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1.5">
      <Icon className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
      <span className="text-xs font-medium">{action.label}</span>
      <Badge className={`px-1.5 py-0 text-[10px] ${risk.className}`} variant="outline">
        {risk.label}
      </Badge>
      {state === "done" ? (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" aria-hidden="true" />
          Dijalankan
        </span>
      ) : state === "confirm" ? (
        <span className="inline-flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            className="h-8 bg-rose-600 px-2.5 text-xs text-white hover:bg-rose-700"
            onClick={() => void run()}
            disabled={state === "busy"}
          >
            {state === "busy" ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              "Yakin? Jalankan"
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs text-muted-foreground"
            onClick={() => setState("idle")}
            disabled={state === "busy"}
          >
            Batal
          </Button>
        </span>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 px-2.5 text-xs"
          onClick={() => setState("confirm")}
          aria-label={`Jalankan aksi: ${action.label}`}
        >
          Jalankan
        </Button>
      )}
    </div>
  );
}

// Widget Copilot Admin: tombol bulat floating kanan-bawah (z-50).
export function AdminAskWidget() {
  const { role, reportError } = useAdminSession();
  const viewer = role === "VIEWER";
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const idRef = useRef(0);

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

  /** Eksekusi aksi chip via /api/admin/copilot/execute. Return true bila sukses. */
  async function executeAction(action: CopilotProposedAction): Promise<boolean> {
    try {
      const res = await apiPost<{ message: string }>("/api/admin/copilot/execute", {
        type: action.type,
        params: action.params,
      });
      toast.success(res.message);
      toast.info("Muat ulang halaman untuk melihat perubahan terbaru.");
      return true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        reportError(err); // 401 -> login ulang, 403 -> toast akses ditolak
      } else {
        toast.error(err instanceof Error ? err.message : "Gagal menjalankan aksi Copilot.");
      }
      return false;
    }
  }

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    setInput("");
    const userMsg: AskMessage = { id: ++idRef.current, role: "user", content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);
    try {
      const res = await apiPost<{ reply: string; actions?: CopilotProposedAction[] }>(
        "/api/admin/copilot",
        { question: trimmed }
      );
      setMessages((prev) => {
        const next: AskMessage[] = [
          ...prev,
          {
            id: ++idRef.current,
            role: "assistant",
            content: res.reply,
            actions: viewer ? [] : (res.actions ?? []),
          },
        ];
        // Riwayat singkat: maksimal 5 pasang tanya-jawab.
        return next.slice(-MAX_MESSAGES);
      });
    } catch (err) {
      // 503 dari gate AI (fitur dimatikan/kuota habis): tampilkan pesan di area
      // jawaban dengan gaya amber — JANGAN crash dan JANGAN buang pertanyaan.
      if (err instanceof ApiError && err.status === 503) {
        setMessages((prev) =>
          [
            ...prev,
            { id: ++idRef.current, role: "assistant", content: err.message, warning: true },
          ].slice(-MAX_MESSAGES)
        );
        return;
      }
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
        aria-label="Buka Copilot Admin"
      >
        <Bot className="size-6" aria-hidden="true" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Copilot Admin
            </DialogTitle>
            <DialogDescription>
              Tanya data rekrutmen dan minta usulan aksi panel. Aksi hanya dijalankan
              setelah konfirmasi dua langkah.
            </DialogDescription>
          </DialogHeader>

          {viewer ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
              Sebagai Pengamat, Anda dapat bertanya, tetapi usulan aksi tidak ditampilkan.
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

            {messages.map((message) => (
              <div key={message.id} className="flex flex-col gap-1.5">
                <div
                  className={
                    message.role === "user"
                      ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-rose-600 px-3.5 py-2 text-sm text-white"
                      : message.warning
                        ? "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm whitespace-pre-wrap text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                        : "mr-auto max-w-[85%] rounded-2xl rounded-bl-md border bg-background px-3.5 py-2 text-sm whitespace-pre-wrap"
                  }
                >
                  {message.content}
                </div>
                {!viewer && message.role === "assistant" && (message.actions?.length ?? 0) > 0 ? (
                  <div className="mr-auto flex max-w-[85%] flex-col gap-1.5">
                    {message.actions!.map((action, actionIndex) => (
                      <CopilotActionChip
                        key={`${message.id}-${actionIndex}`}
                        action={action}
                        onExecute={executeAction}
                      />
                    ))}
                  </div>
                ) : null}
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
              placeholder="Tulis pertanyaan untuk Copilot..."
              maxLength={500}
              disabled={loading}
              className="h-11 flex-1"
              aria-label="Pertanyaan untuk Copilot Admin"
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
              disabled={loading || input.trim().length === 0}
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
