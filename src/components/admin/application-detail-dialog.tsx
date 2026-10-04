"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AudioLines,
  Ban,
  Banknote,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CirclePause,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  Flag,
  Globe,
  Handshake,
  HelpCircle,
  History,
  Inbox,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  LockOpen,
  Mail,
  MailPlus,
  MapPin,
  Megaphone,
  MessageCircle,
  MessageSquareText,
  Pencil,
  PauseCircle,
  Phone,
  Send,
  Share2,
  Star,
  StickyNote,
  Tag,
  Trash2,
  Undo2,
  UserX,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  HOLD_REASONS,
  HOLD_REASON_LABELS,
  KOMUTER_PLAN_LABELS,
  POSITION_TYPES,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  ROLE_LABELS,
  SHIFT_PREF_LABELS,
  STATUS_LABELS,
  type Application,
  type ApplicationHistoryItem,
  type ApplicationStatus,
  type Assessment,
  type CallLog,
  type DoNotHireEntry,
  type HoldReason,
  type InboxItem,
  type Interview,
  type Position,
  type RejectionReason,
  type Role,
  type StageKey,
  type LogEntry,
  type VideoNote,
} from "@/lib/types";
import {
  coreItemLabel,
  isExperienceEnabled,
  isFormSchemaActive,
  isMotivationEnabled,
  type FormAnswerValue,
} from "@/lib/form-schema";
import type { HiddenUiKey } from "@/lib/hidden-ui"; // NR-22 — kunci blok UI tersembunyi per posisi
import { DEFAULT_STAGES, stageLabel, stagesForPosition } from "@/lib/stages";
import { fillTemplate } from "@/components/landing/landing-utils";
import { ApiError, apiDelete, apiFetch, apiGet, apiPatch, apiPost, apiPut, jsonInit } from "./api";
import {
  actionLabel,
  actorBadgeClass,
  copyText,
  daysUntil,
  formatDate,
  formatDateTime,
  formatRelative,
  formatRupiah,
  formatShortDateTime,
  isoToLocalInput,
  localInputToIso,
  normalizeUrl,
  waHref,
} from "./format";
import { StatusBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { AiPanel } from "./ai-panel";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { useTagDefs } from "./use-tag-defs";
import {
  AssessmentSection,
  CallLogSection,
  DocExpirySection,
  InboxSection,
  InternalDocsSection,
  RelatedSection,
} from "./detail-nr24-sections";
import {
  InterviewSessionDialog,
  InterviewStatusChip,
} from "./interview-session-dialog";
import { cn } from "@/lib/utils";
import {
  buildOfferHtml,
  buildProfileHtml,
  formatTimestamp,
} from "./print-docs";

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm break-words">{children}</div>
    </div>
  );
}

/* ----------------------- NR-24-b — helper fitur per pelamar ----------------------- */


/** Konversi nilai <input type="date"> "YYYY-MM-DD" -> ISO akhir hari Jakarta (UTC+7). */
function dateToEndOfDayIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T23:59:59+07:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}




/** Label status riwayat lamaran untuk kartu riwayat (fallback teks mentah). */
function historyStatusLabel(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

/** NR-24: snoozeUntil ada di DB/PATCH tetapi belum di serialisasi Application —
 * dibaca defensif agar UI tetap benar bila backend menambahkannya. */
function readSnoozeUntil(app: Application): string | null {
  const raw = (app as unknown as { snoozeUntil?: unknown }).snoozeUntil;
  return typeof raw === "string" ? raw : null;
}

/* --------------------- Jawaban Formulir (Form Builder, Task 30) --------------------- */

/** Jawaban dianggap kosong bila null, string kosong, atau daftar kosong. */
function isEmptyFormAnswer(value: FormAnswerValue | undefined): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Satu nilai jawaban formulir terformat: teks, daftar, angka, atau berkas. */
function FormAnswerValueView({ value }: { value: FormAnswerValue | undefined }) {
  if (
    value == null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return (
      <p className="mt-0.5 text-sm italic text-zinc-500 dark:text-zinc-400">Tidak dijawab</p>
    );
  }
  if (typeof value === "string") {
    return <p className="mt-0.5 text-sm whitespace-pre-wrap">{value}</p>;
  }
  if (typeof value === "number") {
    return <p className="mt-0.5 text-sm tabular-nums">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    return <p className="mt-0.5 text-sm whitespace-pre-wrap">{value.join("; ")}</p>;
  }
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
      <span className="break-all">{value.filename || "berkas"}</span>
      <a
        href={`/api/files/${value.fileId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Unduh
      </a>
    </p>
  );
}

// Riwayat aktivitas kandidat (timeline vertikal).
// Dipasang dengan key={applicationId} agar state reset saat kandidat berganti.
function ActivityTimeline({ applicationId }: { applicationId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<LogEntry[]>(
      `/api/admin/logs?applicationId=${encodeURIComponent(applicationId)}&limit=30`
    )
      .then((data) => {
        if (!cancelled) {
          setLogs(data);
          setLoading(false);
        }
      })
      .catch(() => {
        // Timeline bersifat pelengkap; abaikan kegagalan fetch.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Memuat riwayat...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">Belum ada aktivitas.</p>
    );
  }

  return (
    <div className="relative flex max-h-48 flex-col gap-3 overflow-y-auto pl-4 nice-scrollbar">
      <span
        className="absolute top-1.5 left-[4px] h-[calc(100%-12px)] w-px bg-border"
        aria-hidden="true"
      />
      {logs.map((log) => (
        <div key={log.id} className="relative">
          <span
            className="absolute top-1.5 -left-4 size-2 rounded-full bg-rose-500 ring-4 ring-background"
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
              {formatShortDateTime(log.createdAt)}
            </span>
            <Badge
              variant="outline"
              className={`px-1.5 py-0 text-[10px] ${actorBadgeClass(log.actor)}`}
            >
              {log.actor}
            </Badge>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {actionLabel(log.action)}
            </Badge>
          </div>
          {log.detail ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{log.detail}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Baris kecil sumber/UTM dengan ikon.
function SourceRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Share2;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="shrink-0 font-medium text-muted-foreground">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

/* ------------------------------ Diskusi tim (Task 20-a) ------------------------------ */

export type TeamComment = {
  id: string;
  authorName: string;
  authorRole: string;
  body: string;
  mentions: string[];
  createdAt: string;
};

// Render isi komentar: @nama ditampilkan tebal rose-600.
function CommentBody({ body }: { body: string }) {
  const parts = body.split(/(@[\p{L}\p{N}_.-]{2,30})/gu);
  return (
    <p className="text-sm whitespace-pre-wrap">
      {parts.map((part, i) =>
        part.startsWith("@") ? (
          <strong key={i} className="font-semibold text-rose-600 dark:text-rose-400">
            {part}
          </strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

// Diskusi internal antar admin pada satu kandidat. Dipasang dengan key={applicationId}
// agar state reset & data di-refetch saat kandidat berganti / dialog dibuka.
function TeamDiscussion({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [comments, setComments] = useState<TeamComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");

  const loadComments = useCallback(async () => {
    try {
      const rows = await apiGet<TeamComment[]>(
        `/api/admin/applications/${applicationId}/comments`,
      );
      setComments(rows);
    } catch {
      // Diskusi bersifat pelengkap; biarkan data lama / kosong saat gagal.
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Realtime ringan: refetch saat dialog dibuka (mount) — dan setelah kirim.
  useEffect(() => {
    setLoading(true);
    void loadComments();
  }, [loadComments]);

  async function handleSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await apiPost<TeamComment>(
        `/api/admin/applications/${applicationId}/comments`,
        { body: text },
      );
      setDraft("");
      toast.success("Komentar terkirim");
      await loadComments();
    } catch (err) {
      reportError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Users className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Diskusi Tim</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {comments.length}
        </span>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat diskusi...
        </p>
      ) : comments.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          Belum ada diskusi. Gunakan @nama untuk menyebut rekan tim.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1 nice-scrollbar">
          {comments.map((c) => (
            <div key={c.id} className="rounded-lg bg-muted/50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold">{c.authorName}</span>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  {ROLE_LABELS[(c.authorRole as Role) ?? "HR"] ?? c.authorRole}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {formatShortDateTime(c.createdAt)}
                </span>
              </div>
              <div className="mt-1">
                <CommentBody body={c.body} />
              </div>
            </div>
          ))}
        </div>
      )}
      {canMutate ? (
        <form onSubmit={handleSend} className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Tulis komentar untuk tim... gunakan @nama untuk mention"
            rows={2}
            maxLength={2000}
            disabled={sending}
            aria-label="Tulis komentar diskusi tim"
          />
          <Button
            type="submit"
            size="sm"
            className="h-9 w-fit active:scale-[0.99]"
            disabled={sending || !draft.trim()}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Kirim Komentar
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Hanya OWNER/HR yang dapat menulis komentar.</p>
      )}
    </div>
  );
}

/* ------------------- Pertanyaan pelamar (NR-15, idea 10) ------------------- */

type CandidateQuestion = {
  id: string;
  question: string;
  answer: string | null;
  askedBy: string;
  answeredBy: string | null;
  answeredAt: string | null;
  createdAt: string;
};

// Thread tanya-jawab pelamar dari halaman Cek Status. Dipasang dengan key={applicationId}
// agar data di-refetch saat kandidat berganti / dialog dibuka ulang.
function CandidateQuestions({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const [questions, setQuestions] = useState<CandidateQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);

  const loadQuestions = useCallback(async () => {
    try {
      const res = await apiGet<{ ok: boolean; questions: CandidateQuestion[] }>(
        `/api/admin/applications/${applicationId}/questions`,
      );
      setQuestions(res.questions ?? []);
    } catch {
      // Panel pelengkap; biarkan kosong tanpa toast saat gagal.
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Muat sekali saat dialog dibuka / kandidat berganti.
  useEffect(() => {
    setLoading(true);
    void loadQuestions();
  }, [loadQuestions]);

  async function handleAnswer(q: CandidateQuestion) {
    const answer = (drafts[q.id] ?? "").trim();
    if (!answer || sendingId) return;
    setSendingId(q.id);
    try {
      await apiPost(`/api/admin/questions/${q.id}/answer`, { answer });
      toast.success("Jawaban terkirim");
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[q.id];
        return next;
      });
      await loadQuestions();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error("Hanya Owner/HR dapat menjawab");
      } else {
        toast.error(err instanceof Error ? err.message : "Gagal mengirim jawaban. Coba lagi.");
      }
    } finally {
      setSendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Pertanyaan Pelamar</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {questions.length}
        </span>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat pertanyaan...
        </p>
      ) : questions.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          Belum ada pertanyaan dari pelamar.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1 nice-scrollbar">
          {questions.map((q) => {
            const sending = sendingId === q.id;
            return (
              <div key={q.id} className="flex flex-col gap-2 rounded-lg bg-muted/50 p-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold">{q.askedBy}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatShortDateTime(q.createdAt)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{q.question}</p>
                </div>
                {q.answer ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-2.5 dark:border-emerald-900 dark:bg-emerald-950/20">
                    <div className="flex flex-wrap items-center gap-2">
                      <CheckCircle2
                        className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                        aria-hidden="true"
                      />
                      <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {q.answeredBy ?? "Admin"}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {q.answeredAt ? formatShortDateTime(q.answeredAt) : ""}
                      </span>
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{q.answer}</p>
                  </div>
                ) : (
                  <Badge
                    variant="outline"
                    className="w-fit border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                  >
                    <Clock className="size-3" aria-hidden="true" />
                    Menunggu jawaban
                  </Badge>
                )}
                {canMutate && !q.answer ? (
                  <div className="flex flex-col gap-1.5">
                    <Textarea
                      value={drafts[q.id] ?? ""}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                      placeholder="Tulis jawaban untuk pelamar..."
                      rows={2}
                      maxLength={1500}
                      disabled={sending}
                      aria-label={`Jawab pertanyaan dari ${q.askedBy}`}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 w-fit active:scale-[0.99]"
                      onClick={() => void handleAnswer(q)}
                      disabled={sending || !(drafts[q.id] ?? "").trim()}
                    >
                      {sending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="size-4" aria-hidden="true" />
                      )}
                      Kirim Jawaban
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {!canMutate && questions.some((q) => !q.answer) ? (
        <p className="text-xs text-muted-foreground">
          Hanya Owner/HR yang dapat menjawab pertanyaan pelamar.
        </p>
      ) : null}
    </div>
  );
}


/* ------------------ NR-24-b — Kotak Masuk Terpadu (ide 10) ------------------ */

const INBOX_KIND_META: Record<InboxItem["kind"], { icon: typeof Mail; label: string }> = {
  EMAIL: { icon: Mail, label: "Email" },
  QUESTION: { icon: HelpCircle, label: "Pertanyaan" },
  CALL: { icon: Phone, label: "Panggilan" },
};

// Thread gabungan (email, pertanyaan pelamar, panggilan) untuk satu pelamar.
// key={applicationId} dari pemanggil agar reset saat kandidat berganti.
function UnifiedInboxSection({
  applicationId,
  onGotoQuestions,
}: {
  applicationId: string;
  onGotoQuestions?: () => void;
}) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unanswered, setUnanswered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string[]>([]);

  const loadInbox = useCallback(async () => {
    try {
      const res = await apiGet<{ items: InboxItem[]; unanswered: number }>(
        `/api/admin/applications/${applicationId}/inbox`
      );
      setItems(res.items ?? []);
      setUnanswered(res.unanswered ?? 0);
    } catch {
      // Panel pelengkap; biarkan kosong tanpa toast saat gagal.
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Muat sekali saat dialog dibuka / kandidat berganti.
  useEffect(() => {
    setLoading(true);
    void loadInbox();
  }, [loadInbox]);

  function toggleExpanded(key: string) {
    setExpanded((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Inbox className="size-4 text-violet-600 dark:text-violet-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Kotak Masuk Terpadu</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {items.length}
        </span>
      </div>
      {unanswered > 0 && onGotoQuestions ? (
        <button
          type="button"
          onClick={onGotoQuestions}
          className="flex w-fit items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 outline-none transition-colors hover:bg-amber-100 focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950"
        >
          <HelpCircle className="size-3.5" aria-hidden="true" />
          {unanswered} pertanyaan belum dijawab — buka panel Pertanyaan Pelamar
        </button>
      ) : unanswered > 0 ? (
        <Badge
          variant="outline"
          className="w-fit border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
        >
          <HelpCircle className="size-3" aria-hidden="true" />
          {unanswered} pertanyaan belum dijawab
        </Badge>
      ) : null}
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat kotak masuk...
        </p>
      ) : items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">
          Belum ada email, pertanyaan, atau catatan panggilan.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
          {items.map((item, i) => {
            const meta = INBOX_KIND_META[item.kind] ?? INBOX_KIND_META.EMAIL;
            const Icon = meta.icon;
            const key = `${item.at}-${i}`;
            const isOpen = expanded.includes(key);
            return (
              <div key={key} className="flex flex-col gap-1 rounded-lg bg-muted/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-xs font-semibold">{item.from}</span>
                  <span className="text-xs text-muted-foreground">· {meta.label}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatShortDateTime(item.at)}
                  </span>
                </div>
                {item.title ? <p className="text-sm font-medium">{item.title}</p> : null}
                {item.body ? (
                  <>
                    <p className={cn("text-sm whitespace-pre-wrap", !isOpen && "line-clamp-3")}>
                      {item.body}
                    </p>
                    {item.body.length > 180 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(key)}
                        className="w-fit text-xs font-medium text-rose-600 outline-none underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring/50 dark:text-rose-400"
                      >
                        {isOpen ? "Sembunyikan" : "Selengkapnya"}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------ NR-24-b — Riwayat Melamar (ide 7) ------------------ */

// Kartu riwayat lamaran pelamar yang sama; tidak dirender bila kosong.
function ApplicationHistoryCard({
  applicationId,
  onNavigate,
}: {
  applicationId: string;
  onNavigate?: (id: string) => void;
}) {
  const [history, setHistory] = useState<ApplicationHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const res = await apiGet<{ history: ApplicationHistoryItem[] }>(
        `/api/admin/applications/${applicationId}/history`
      );
      setHistory(res.history ?? []);
    } catch {
      // Kartu pelengkap; biarkan kosong tanpa toast saat gagal.
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Muat sekali saat dialog dibuka / kandidat berganti.
  useEffect(() => {
    setLoading(true);
    void loadHistory();
  }, [loadHistory]);

  if (loading) return null;
  if (history.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <History className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Riwayat Melamar</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Pelamar ini pernah melamar {history.length} kali lainnya di Lumina.
      </p>
      <div className="flex flex-col gap-1.5">
        {history.map((h) => (
          <div
            key={h.id}
            className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
          >
            <span className="font-medium">{h.positionTitle ?? "-"}</span>
            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
              {historyStatusLabel(h.status)}
            </Badge>
            <span className="text-xs text-muted-foreground">{formatDate(h.createdAt)}</span>
            {onNavigate ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-8"
                onClick={() => onNavigate(h.id)}
              >
                Buka
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ApplicationDetailDialog({
  application,
  onOpenChange,
  onSaved,
  onDeleted,
  list,
  onNavigate,
  onListRefresh,
}: {
  application: Application | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (app: Application) => void;
  onDeleted: (id: string) => void;
  /** NR-24 fitur 1 — daftar terurut untuk navigasi prev/next & keyboard (opsional). */
  list?: Application[];
  /** NR-24 — navigasi ke lamaran lain (dipakai prev/next & riwayat melamar). */
  onNavigate?: (app: Application) => void;
  /** NR-24 — segarkan daftar di parent setelah merge/undo-reject/do-not-hire. */
  onListRefresh?: () => void;
}) {
  const { session, canMutate, reportError } = useAdminSession();
  const { tagDefs, colorClassOf } = useTagDefs();
  const [editStatus, setEditStatus] = useState<StageKey>("NEW");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Editor tags & rating.
  const [tagInput, setTagInput] = useState("");
  const [tagsSaving, setTagsSaving] = useState(false);
  const [ratingSaving, setRatingSaving] = useState(false);

  // Evaluasi v3: posisi terkait (rubrik/checklist/template) + state lokal.
  const [position, setPosition] = useState<Position | null>(null);
  const [rubricValues, setRubricValues] = useState<Record<string, number>>({});
  const [rubricSaving, setRubricSaving] = useState(false);
  const [checkedItems, setCheckedItems] = useState<string[]>([]);
  const [checklistSaving, setChecklistSaving] = useState(false);

  // Sesi wawancara milik pelamar (GET /api/admin/interviews, filter applicationId).
  const [sessions, setSessions] = useState<Interview[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionDetail, setSessionDetail] = useState<Interview | null>(null);
  const [sessionCreateOpen, setSessionCreateOpen] = useState(false);
  const [createNonce, setCreateNonce] = useState(0);

  // Deteksi duplikat (fitur Task 20-a): id lamaran yang ditandai ganda.
  const [duplicateIds, setDuplicateIds] = useState<Set<string>>(new Set());

  // Panel Tolak Lamaran.
  const [rejectReason, setRejectReason] = useState<RejectionReason | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  // Panel Email Pelamar — compose manual via /api/admin/applications/[id]/email.
  const [emailPanelOpen, setEmailPanelOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  // Email pengingat offer PENDING (NR-15, idea 6).
  const [remindSending, setRemindSending] = useState(false);
  // Anonimisasi data pelamar (NR-19, ide 7 — hak hapus data).
  const [anonymizeConfirmOpen, setAnonymizeConfirmOpen] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);

  // Panel Penawaran (form & edit inline memakai state yang sama).
  const [offerForm, setOfferForm] = useState<{
    salary: string;
    type: string;
    startDate: string;
    note: string;
    deadlineDays: string;
  }>({
    salary: "",
    type: POSITION_TYPES[0],
    startDate: "",
    note: "",
    deadlineDays: "3",
  });
  const [offerEditing, setOfferEditing] = useState(false);
  const [offerWorking, setOfferWorking] = useState(false);
  const [offerCancelOpen, setOfferCancelOpen] = useState(false);
  const [offerMessage, setOfferMessage] = useState<string | null>(null);

  // Panel Onboarding.
  const [onboardingSaving, setOnboardingSaving] = useState(false);
  const [docInput, setDocInput] = useState("");

  // Panel Catatan Video (Task 27-e): catatan bertimestamp pada video/audio intro.
  const [videoNoteSec, setVideoNoteSec] = useState("");
  const [videoNoteText, setVideoNoteText] = useState("");
  const [videoNotesSaving, setVideoNotesSaving] = useState(false);

  // NR-24 — bintang personal (fitur 2).
  const [starBusy, setStarBusy] = useState(false);

  // NR-24 — ekspektasi gaji (fitur 6).
  const [salaryInput, setSalaryInput] = useState("");
  const [salarySaving, setSalarySaving] = useState(false);

  // NR-24 — tindak lanjut / snooze (fitur 4).
  const [followUpInput, setFollowUpInput] = useState("");
  const [followUpSaving, setFollowUpSaving] = useState(false);

  // NR-24 — HOLD (fitur 8).
  const [holdPanelOpen, setHoldPanelOpen] = useState(false);
  const [holdReason, setHoldReason] = useState<HoldReason | "">("");
  const [holdNote, setHoldNote] = useState("");
  const [holdReview, setHoldReview] = useState("");
  const [holdSaving, setHoldSaving] = useState(false);

  // NR-24 — undo reject berkunci (fitur 14).
  const [undoUnlock, setUndoUnlock] = useState(false);
  const [undoReason, setUndoReason] = useState("");
  const [undoSaving, setUndoSaving] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  // NR-24 — bendera do-not-hire (fitur 15).
  const [dnhPanelOpen, setDnhPanelOpen] = useState(false);
  const [dnhReason, setDnhReason] = useState("");
  const [dnhRemoveOpen, setDnhRemoveOpen] = useState(false);
  const [dnhRemoveReason, setDnhRemoveReason] = useState("");
  const [dnhSaving, setDnhSaving] = useState(false);

  // Reset form hanya saat berganti pelamar (bukan tiap update objek) agar
  // pesan penolakan/penawaran yang baru dibuat tidak ikut terhapus.
  const lastAppIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!application || lastAppIdRef.current === application.id) return;
    lastAppIdRef.current = application.id;
    setEditStatus(application.status);
    setEditNotes(application.adminNotes ?? "");
    setTagInput("");
    setSaving(false);
    setDeleting(false);
    setConfirmOpen(false);
    setRubricValues(application.rubricScores ?? {});
    setCheckedItems(application.checklistState ?? []);
    setSessions([]);
    setSessionDetail(null);
    setSessionCreateOpen(false);
    setRejectReason("");
    setRejectNote("");
    setRejectFeedback(false);
    setRejectConfirmOpen(false);
    setRejecting(false);
    setRejectMessage(null);
    setOfferForm({ salary: "", type: POSITION_TYPES[0], startDate: "", note: "", deadlineDays: "3" });
    setOfferEditing(false);
    setOfferWorking(false);
    setOfferCancelOpen(false);
    setOfferMessage(null);
    setRemindSending(false);
    setAnonymizeConfirmOpen(false);
    setAnonymizing(false);
    setOnboardingSaving(false);
    setDocInput("");
    setVideoNoteSec("");
    setVideoNoteText("");
    setVideoNotesSaving(false);
    setStarBusy(false);
    setSalaryInput(application.salaryExpectation != null ? String(application.salaryExpectation) : "");
    setSalarySaving(false);
    setFollowUpInput(application.followUpAt ? isoToLocalInput(application.followUpAt) : "");
    setFollowUpSaving(false);
    setHoldPanelOpen(false);
    setHoldReason("");
    setHoldNote("");
    setHoldReview("");
    setHoldSaving(false);
    setUndoUnlock(false);
    setUndoReason("");
    setUndoSaving(false);
    setUndoError(null);
    setDnhPanelOpen(false);
    setDnhReason("");
    setDnhRemoveOpen(false);
    setDnhRemoveReason("");
    setDnhSaving(false);
  }, [application]);

  // NR-24 fitur 1 — navigasi keyboard ArrowLeft/ArrowRight antar lamaran.
  // Handler memakai ref aplikasi & daftar terkini agar tidak stale closure.
  const appRef = useRef<Application | null>(application);
  useEffect(() => {
    appRef.current = application;
  }, [application]);
  const navCtxRef = useRef<{ list?: Application[]; onNavigate?: (app: Application) => void }>({
    list,
    onNavigate,
  });
  useEffect(() => {
    navCtxRef.current = { list, onNavigate };
  });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      // Jangan navigasi saat dialog konfirmasi lain atau popup (Select/Popover) terbuka.
      if (document.querySelector('[role="alert-dialog"], [role="alertdialog"]')) return;
      // Wrapper popper Radix juga dipakai Tooltip (boleh lewat) — blokir hanya
      // popup interaktif: Select (listbox), Menu, Popover/Dialog.
      const blockingPopup = [
        ...document.querySelectorAll("[data-radix-popper-content-wrapper] > *"),
      ].some((el) =>
        ["listbox", "menu", "dialog", "alertdialog", "grid"].includes(
          el.getAttribute("role") ?? ""
        )
      );
      if (blockingPopup) return;
      const { list: navList, onNavigate: nav } = navCtxRef.current;
      const current = appRef.current;
      if (!navList || !nav || !current) return;
      const idx = navList.findIndex((a) => a.id === current.id);
      const next = navList[idx + (e.key === "ArrowLeft" ? -1 : 1)];
      if (next) nav(next);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const applicationId = application?.id ?? null;
  const positionId = application?.positionId ?? null;

  // Muat posisi terkait untuk rubrik/checklist/pertanyaan screening/template.
  useEffect(() => {
    if (!positionId) {
      setPosition(null);
      return;
    }
    let cancelled = false;
    apiGet<Position[]>("/api/admin/positions")
      .then((rows) => {
        if (!cancelled) {
          setPosition(rows.find((p) => p.id === positionId) ?? null);
        }
      })
      .catch(() => {
        // Bagian berbasis posisi bersifat pelengkap; abaikan kegagalan.
        if (!cancelled) setPosition(null);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId, positionId]);

  // Sesi wawancara pelamar: muat sekali + segarkan senyap saat ada event realtime.
  const loadSessions = useCallback(
    async (silent = false) => {
      if (!applicationId) return;
      if (!silent) setSessionsLoading(true);
      try {
        const rows = await apiGet<Interview[]>("/api/admin/interviews");
        setSessions(rows.filter((r) => r.applicationId === applicationId));
      } catch {
        // Daftar sesi bersifat pelengkap; biarkan data lama saat gagal senyap.
      } finally {
        if (!silent) setSessionsLoading(false);
      }
    },
    [applicationId]
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  // Muat daftar id duplikat setiap dialog dibuka / kandidat berganti.
  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    apiGet<{ ids: string[] }>("/api/admin/duplicates")
      .then((data) => {
        if (!cancelled) setDuplicateIds(new Set(data.ids));
      })
      .catch(() => {
        // Badge duplikat bersifat pelengkap; abaikan kegagalan fetch.
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  useLiveRefresh("interviews:changed", () => {
    void loadSessions(true);
  });

  // NR-24 fitur 1 — navigasi prev/next: urutan id diturunkan dari daftar
  // terurut `list` yang dikirim parent; navIndex = posisi lamaran aktif.
  const navIds = useMemo(() => (list ?? []).map((a) => a.id), [list]);
  const navIndex = application ? navIds.indexOf(application.id) : -1;

  // Navigasi aktif bila daftar punya >1 entri & lamaran aktif ada di dalamnya.
  const navActive =
    Array.isArray(navIds) &&
    navIds.length > 1 &&
    typeof navIndex === "number" &&
    navIndex >= 0 &&
    navIndex < navIds.length &&
    typeof onNavigate === "function";

  // Keyboard ArrowLeft/ArrowRight untuk pindah antar lamaran (saat dialog terbuka).
  // Diabaikan bila sedang mengetik di input/textarea/select/contenteditable atau
  // bila dialog/alert lain (wawancara, konfirmasi) sedang terbuka.
  useEffect(() => {
    if (!navActive || !application) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const t = e.target;
      if (t instanceof HTMLElement) {
        if (t.isContentEditable) return;
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      if (document.querySelector('[role="alertdialog"]')) return;
      if (sessionDetail || sessionCreateOpen) return;
      const next = e.key === "ArrowRight" ? navIndex + 1 : navIndex - 1;
      const nextApp = next >= 0 && next < navIds.length ? list?.[next] : undefined;
      if (!nextApp || typeof onNavigate !== "function") return;
      onNavigate(nextApp);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navActive, application, list, navIds, navIndex, onNavigate, sessionDetail, sessionCreateOpen]);

  if (!application) return null;

  const app = application;
  const pos = position;

  // NR-22 — blok UI yang disembunyikan untuk posisi terkait (Position.hiddenUi).
  const hiddenUi = pos?.hiddenUi ?? [];
  const isHidden = (k: HiddenUiKey) => hiddenUi.includes(k);

  // Opsi tahap mengikuti pipeline posisi terkait; fallback ke 5 bawaan.
  const positionStages = pos ? stagesForPosition(pos.stages) : [...DEFAULT_STAGES];
  const stageChoices =
    editStatus && !positionStages.includes(editStatus)
      ? [editStatus, ...positionStages]
      : positionStages;

  const screeningQuestions = pos?.screeningQuestions ?? [];
  const screeningAnswers = app.screeningAnswers ?? {};
  // NR-22 — blok Jawaban Screening bisa disembunyikan per posisi.
  const showScreening =
    screeningQuestions.length > 0 &&
    app.screeningAnswers != null &&
    !isHidden("screening");

  // Jawaban Formulir (Form Builder): tampil bila posisi memakai skema aktif
  // dan lamaran menyimpan jawaban formulir (Application.formAnswers).
  const formSchema = pos?.formSchema ?? null;
  const formAnswers = app.formAnswers ?? null;
  const formSchemaActive = formSchema != null && isFormSchemaActive({ formSchema });
  // Skema v2: bagian Pengalaman bisa mematikan kedua pertanyaan intinya —
  // bila keduanya mati DAN nilai tersimpan kosong, blok lama disembunyikan
  // agar tidak menampilkan dua tanda "-" tanpa makna.
  const experienceSection = formSchema?.sections.find((s) => s.kind === "experience") ?? null;
  const experienceCoreEnabled =
    formSchemaActive && experienceSection
      ? isExperienceEnabled(experienceSection)
      : true;
  const motivationCoreEnabled =
    formSchemaActive && experienceSection
      ? isMotivationEnabled(experienceSection)
      : true;
  const showExperienceBlock =
    !(
      formSchemaActive &&
      !experienceCoreEnabled &&
      !motivationCoreEnabled &&
      app.experience.trim() === "" &&
      app.motivation.trim() === ""
    ) && !isHidden("experience"); // NR-22 — blok pengalaman bisa disembunyikan per posisi

  // NR-26 — label item inti (email/WA/pengalaman/motivasi) mengikuti
  // kustomisasi bagian di Form Builder; tanpa kustomisasi = teks bawaan.
  const biodataSectionForLabels = formSchemaActive
    ? (formSchema?.sections.find((s) => s.kind === "biodata") ?? null)
    : null;
  const emailCoreLabel = biodataSectionForLabels
    ? coreItemLabel(biodataSectionForLabels, "email")
    : "Email";
  const waCoreLabel = biodataSectionForLabels
    ? coreItemLabel(biodataSectionForLabels, "wa")
    : "WhatsApp";
  const experienceCoreLabel =
    formSchemaActive && experienceSection
      ? coreItemLabel(experienceSection, "experience")
      : "Pengalaman";
  const motivationCoreLabel =
    formSchemaActive && experienceSection
      ? coreItemLabel(experienceSection, "motivation")
      : "Alasan Bergabung";

  const rubricCriteria = pos?.rubricCriteria ?? [];
  const checklistTemplate = pos?.checklistTemplate ?? [];
  const noteTemplates = pos?.noteTemplates ?? [];
  const replyTemplates = pos?.replyTemplates ?? null;

  // Catatan video intro urut berdasarkan detik (Task 27-e).
  const videoNotes = [...(app.videoNotes ?? [])].sort((a, b) => a.t - b.t);

  /* ------------------------- NR-24 — nilai turunan ------------------------- */

  // Fitur 2 — bintang personal milik admin yang sedang login.
  const starred = app.starredBy?.includes(session.id) ?? false;

  // Fitur 1 — posisi lamaran dalam daftar (navigasi prev/next).
  const navTotal = list?.length ?? 0;
  const navPosition = list ? list.findIndex((a) => a.id === app.id) : -1;
  const navAvailable = Boolean(list && onNavigate && navPosition >= 0);

  // Fitur 3 — tagDefs yang belum terpasang (quick-add).
  const availableTagDefs = tagDefs.filter(
    (td) => !app.tags.some((t) => t.toLowerCase() === td.name.toLowerCase())
  );

  // Fitur 6 — ekspektasi gaji efektif (input belum disimpan > nilai tersimpan).
  const salaryParsed = Number(salaryInput);
  const salaryEffective =
    salaryInput.trim() !== "" && Number.isFinite(salaryParsed)
      ? salaryParsed
      : app.salaryExpectation ?? null;
  const posSalaryMin = pos?.salaryMin ?? null;
  const posSalaryMax = pos?.salaryMax ?? null;
  const salaryBadge = (() => {
    if (salaryEffective == null) return null;
    if (posSalaryMin != null && posSalaryMax != null) {
      if (salaryEffective >= posSalaryMin && salaryEffective <= posSalaryMax) {
        return { cls: "emerald", label: "Sesuai rentang" };
      }
      if (salaryEffective > posSalaryMax) return { cls: "amber", label: "Di atas rentang" };
      return { cls: "zinc", label: "Di bawah rentang" };
    }
    return { cls: "zinc", label: `Ekspektasi: ${formatRupiah(salaryEffective)}` };
  })();

  // Fitur 4 — tindak lanjut jatuh tempo (hari ini atau sudah lewat).
  const followUpDue = (() => {
    const d = daysUntil(app.followUpAt);
    return d != null && d <= 0;
  })();

  const rubricScoresCount = rubricCriteria.filter(
    (c) => typeof rubricValues[c] === "number"
  ).length;
  const rubricAverage =
    rubricScoresCount > 0
      ? rubricCriteria.reduce((sum, c) => sum + (rubricValues[c] ?? 0), 0) /
        rubricScoresCount
      : null;

  const utmRows = [
    app.utmSource ? { icon: Globe, label: "UTM Source", value: app.utmSource } : null,
    app.utmMedium ? { icon: Tag, label: "UTM Medium", value: app.utmMedium } : null,
    app.utmCampaign ? { icon: Megaphone, label: "UTM Campaign", value: app.utmCampaign } : null,
  ].filter((r): r is { icon: typeof Globe; label: string; value: string } => r !== null);
  const showSourceBlock = Boolean(app.source) || utmRows.length > 0;

  // Info kehadiran (posisi on-site/hybrid): blok tampil hanya bila pelamar
  // mengisi minimal satu data domisili/komuter/shift/tanggal mulai —
  // lamaran era remote (semua null) tetap tampil tanpa blok ini.
  const attendanceDomisili = app.domisili?.trim() ?? "";
  const attendanceStartDate = app.startDatePref?.trim() ?? "";
  const showAttendanceInfo =
    attendanceDomisili !== "" ||
    app.komuterPlan != null ||
    app.shiftPref != null ||
    attendanceStartDate !== "";

  /* --------------------- NR-24-b — nilai turunan fitur per pelamar --------------------- */

  // Bintang personal: session.id milik admin aktif ada di app.starredBy.
  const isStarred = session ? app.starredBy.includes(session.id) : false;

  // Tindak lanjut yang ditampilkan: prioritas hasil aksi sesi ini, fallback nilai dari app.
  const snoozeUntilDisplay = snoozeLocal ?? readSnoozeUntil(app);

  // Undo penolakan: hanya bila ditolak bukan karena menarik diri dan belum digabung.
  const canUndoReject =
    app.status === "REJECTED" &&
    app.rejectionReason !== "MENARIK_DIRI" &&
    !app.mergedIntoId;

  // Do-not-Hire: match email (lowercase) atau telepon digit-only dengan daftar DNH.
  const phoneDigits = (app.phone ?? "").replace(/[^0-9]/g, "");
  const dnhEntries = dnhData.appId === app.id ? dnhData.entries : [];
  const dnhMatch =
    dnhEntries.find(
      (e) =>
        e.key === app.email.toLowerCase() ||
        (phoneDigits !== "" && e.key === phoneDigits)
    ) ?? null;

  // Panel Tolak Lamaran kini juga tampil untuk lamaran REJECTED yang masih
  // bisa di-undo (agar kontrol Batalkan Penolakan punya rumah).
  const showRejectPanel =
    canMutate && (app.status !== "REJECTED" || Boolean(rejectMessage) || canUndoReject);

  async function patch(
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<Application | null> {
    if (!canMutate) {
      toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return null;
    }
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        body
      );
      toast.success(successMessage);
      onSaved(updated);
      return updated;
    } catch (err) {
      reportError(err);
      return null;
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { status: editStatus, adminNotes: editNotes }
      );
      toast.success("Perubahan disimpan");
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/applications/${app.id}`);
      toast.success("Lamaran dihapus");
      onDeleted(app.id);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  async function addTagNow(tag: string) {
    const clean = tag.trim();
    if (!clean || tagsSaving) return;
    if (app.tags.includes(clean)) {
      toast.error("Tag sudah ada.");
      return;
    }
    setTagsSaving(true);
    const updated = await patch({ tags: [...app.tags, clean] }, "Tag ditambahkan");
    if (updated) setTagInput("");
    setTagsSaving(false);
  }

  async function handleAddTag(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await addTagNow(tagInput);
  }

  // NR-24-b (ide 3): koma langsung menambahkan tag sebelum koma; sisanya tetap di input.
  function handleTagInputChange(value: string) {
    if (value.includes(",")) {
      const first = value.slice(0, value.indexOf(","));
      const rest = value.slice(value.indexOf(",") + 1).trimStart();
      setTagInput(rest);
      void addTagNow(first);
    } else {
      setTagInput(value);
    }
  }

  async function handleRemoveTag(tag: string) {
    if (tagsSaving) return;
    setTagsSaving(true);
    await patch(
      { tags: app.tags.filter((t) => t !== tag) },
      "Tag dihapus"
    );
    setTagsSaving(false);
  }

  async function handleRating(rating: number) {
    if (ratingSaving) return;
    setRatingSaving(true);
    await patch({ rating }, `Rating disimpan (${rating}/5)`);
    setRatingSaving(false);
  }

  async function handleTalentPool(talentPool: boolean) {
    await patch(
      { talentPool },
      talentPool ? "Ditambahkan ke Talent Pool" : "Dikeluarkan dari Talent Pool"
    );
  }


  function scrollToCandidateQuestions() {
    document
      .getElementById("nr24-candidate-questions")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ----------------------------- Sesi wawancara ----------------------------- */

  function handleSessionSaved(updated: Interview, updatedApp?: Application) {
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === updated.id);
      const next = exists
        ? prev.map((s) => (s.id === updated.id ? updated : s))
        : [...prev, updated];
      return next.sort(
        (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()
      );
    });
    setSessionDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
    if (updatedApp) onSaved(updatedApp);
  }

  function handleSessionDeleted(id: string) {
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setSessionDetail(null);
  }

  /* ------------------------------ Tolak lamaran ----------------------------- */

  async function handleReject() {
    if (rejecting) return;
    if (!rejectReason) {
      toast.error("Pilih alasan penolakan terlebih dahulu.");
      return;
    }
    setRejecting(true);
    try {
      const res = await apiPost<{
        application: Application;
        message: string;
        reasonLabel: string;
      }>(`/api/admin/applications/${app.id}/reject`, {
        reason: rejectReason,
        note: rejectNote.trim() || undefined,
        feedback: rejectFeedback,
      });
      toast.success(`Lamaran ditolak — ${res.reasonLabel}`);
      setRejectMessage(res.message);
      setRejectConfirmOpen(false);
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setRejecting(false);
    }
  }

  async function handleCopyMessage(text: string) {
    const ok = await copyText(text);
    if (ok) toast.success("Pesan disalin ke clipboard");
    else toast.error("Gagal menyalin ke clipboard");
  }

  /* -------------------------------- Penawaran ------------------------------- */

  function offerBodyFromForm() {
    const deadline = Number(offerForm.deadlineDays);
    return {
      salary: offerForm.salary.trim() || undefined,
      type: offerForm.type,
      startDate: localInputToIso(offerForm.startDate),
      note: offerForm.note.trim() || undefined,
      deadlineDays: Number.isInteger(deadline) ? deadline : 3,
    };
  }

  async function handleSendOffer() {
    if (offerWorking) return;
    setOfferWorking(true);
    try {
      const res = await apiPost<{ application: Application; message: string }>(
        `/api/admin/applications/${app.id}/offer`,
        offerBodyFromForm()
      );
      toast.success("Penawaran terkirim");
      setOfferMessage(res.message);
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setOfferWorking(false);
    }
  }

  async function handleUpdateOffer() {
    if (offerWorking) return;
    setOfferWorking(true);
    try {
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${app.id}/offer`,
        offerBodyFromForm()
      );
      toast.success("Penawaran diperbarui");
      setOfferEditing(false);
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setOfferWorking(false);
    }
  }

  async function handleResendOffer() {
    if (offerWorking) return;
    setOfferWorking(true);
    try {
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${app.id}/offer`,
        { action: "RESEND" }
      );
      toast.success("Penawaran dikirim ulang");
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setOfferWorking(false);
    }
  }

  async function handleCancelOffer() {
    if (offerWorking) return;
    setOfferWorking(true);
    try {
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${app.id}/offer`,
        { action: "CANCEL" }
      );
      toast.success("Penawaran dibatalkan");
      setOfferCancelOpen(false);
      setOfferEditing(false);
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setOfferWorking(false);
    }
  }

  // Email pengingat untuk offer PENDING yang belum dijawab (sekali klik, server dedupe).
  async function handleRemindOffer() {
    if (remindSending || offerWorking) return;
    setRemindSending(true);
    try {
      await apiPost<{ ok: boolean }>(`/api/admin/applications/${app.id}/remind`);
      toast.success(`Email pengingat dikirim ke ${app.email}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengirim pengingat. Coba lagi.");
    } finally {
      setRemindSending(false);
    }
  }

  // Anonimkan data pelamar (NR-19): hapus PII permanen, statistik tetap.
  async function handleAnonymize() {
    if (anonymizing) return;
    setAnonymizing(true);
    try {
      const res = await apiPost<{ ok: boolean; application: Application }>(
        `/api/admin/applications/${app.id}/anonymize`
      );
      toast.success("Data pelamar dianonimkan");
      setAnonymizeConfirmOpen(false);
      if (res?.application) onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setAnonymizing(false);
    }
  }

  /* -------------------------------- Onboarding ------------------------------ */

  // Prefill form penawaran dari data pelamar untuk edit inline saat PENDING.
  function startOfferEdit() {
    setOfferForm({
      salary: app.offerSalary ?? "",
      type: POSITION_TYPES.includes(app.offerType as (typeof POSITION_TYPES)[number])
        ? (app.offerType as string)
        : POSITION_TYPES[0],
      startDate: app.offerStartDate ? app.offerStartDate.slice(0, 10) : "",
      note: app.offerNote ?? "",
      deadlineDays: "3",
    });
    setOfferEditing(true);
  }

  async function handleToggleDoc(docId: string) {
    if (!canMutate || onboardingSaving) return;
    const docs = (app.onboardingDocs ?? []).map((d) =>
      d.id === docId ? { ...d, done: !d.done } : d
    );
    setOnboardingSaving(true);
    try {
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${app.id}/onboarding`,
        { docs }
      );
      toast.success("Dokumen onboarding diperbarui");
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setOnboardingSaving(false);
    }
  }

  async function handleAddDoc(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canMutate || onboardingSaving) return;
    const label = docInput.trim();
    if (!label) return;
    if ((app.onboardingDocs ?? []).length >= 10) {
      toast.error("Maksimal 10 dokumen onboarding.");
      return;
    }
    const docs = [
      ...(app.onboardingDocs ?? []),
      { id: `doc${Date.now()}`, label, required: false, done: false, fileId: null },
    ];
    setOnboardingSaving(true);
    try {
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${app.id}/onboarding`,
        { docs }
      );
      toast.success("Dokumen ditambahkan");
      setDocInput("");
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setOnboardingSaving(false);
    }
  }

  /* --------------------------- Catatan video intro (Task 27-e) --------------------------- */

  async function handleAddVideoNote(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (videoNotesSaving) return;
    const text = videoNoteText.trim().slice(0, 300);
    if (!text) {
      toast.error("Isi catatan terlebih dahulu.");
      return;
    }
    if ((app.videoNotes ?? []).length >= 100) {
      toast.error("Maksimal 100 catatan video.");
      return;
    }
    // Detik boleh kosong (dianggap 0); nilai negatif/non-angka dijepit ke 0.
    const t = Math.max(0, Math.floor(Number(videoNoteSec) || 0));
    setVideoNotesSaving(true);
    const updated = await patch(
      { videoNotes: [...(app.videoNotes ?? []), { t, note: text }] },
      "Catatan video ditambahkan"
    );
    if (updated) {
      setVideoNoteSec("");
      setVideoNoteText("");
    }
    setVideoNotesSaving(false);
  }

  async function handleRemoveVideoNote(note: VideoNote) {
    if (videoNotesSaving) return;
    setVideoNotesSaving(true);
    // Hapus berdasarkan identitas objek agar aman saat ada catatan dengan detik sama.
    await patch(
      { videoNotes: (app.videoNotes ?? []).filter((n) => n !== note) },
      "Catatan video dihapus"
    );
    setVideoNotesSaving(false);
  }

  /* ------------------------- NR-24 — handler per pelamar ------------------------- */

  // Fitur 1 — klik tombol prev/next di header.
  function navigateBy(delta: number) {
    if (!list || !onNavigate) return;
    const next = list[navPosition + delta];
    if (next) onNavigate(next);
  }

  // Fitur 2 — bintang personal (optimistik, rollback saat gagal).
  async function handleToggleStar() {
    if (starBusy) return;
    const active = app.starredBy?.includes(session.id) ?? false;
    const optimistic: Application = {
      ...app,
      starredBy: active
        ? (app.starredBy ?? []).filter((id) => id !== session.id)
        : [...(app.starredBy ?? []), session.id],
    };
    onSaved(optimistic);
    setStarBusy(true);
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { star: !active }
      );
      onSaved(updated);
    } catch (err) {
      onSaved(app); // rollback ke kondisi pra-optimistik
      reportError(err);
    } finally {
      setStarBusy(false);
    }
  }

  // Fitur 3 — tambah tag langsung dari daftar tagDefs tim.
  async function handleQuickAddTag(tag: string) {
    if (tagsSaving) return;
    if (app.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      toast.error("Tag sudah ada.");
      return;
    }
    setTagsSaving(true);
    await patch({ tags: [...app.tags, tag] }, "Tag ditambahkan");
    setTagsSaving(false);
  }

  // Fitur 4 — simpan / bersihkan tanggal tindak lanjut.
  async function handleFollowUp(iso: string | null, message: string) {
    if (followUpSaving) return;
    setFollowUpSaving(true);
    const updated = await patch({ followUpAt: iso }, message);
    if (updated) {
      setFollowUpInput(updated.followUpAt ? isoToLocalInput(updated.followUpAt) : "");
    }
    setFollowUpSaving(false);
  }

  function quickFollowUp(days: number) {
    const target = new Date(Date.now() + days * 86_400_000);
    setFollowUpInput(isoToLocalInput(target.toISOString()));
    void handleFollowUp(
      target.toISOString(),
      `Tindak lanjut dijadwalkan ${days} hari dari sekarang`
    );
  }

  // Fitur 6 — simpan ekspektasi gaji (null = kosongkan).
  async function handleSaveSalary() {
    if (salarySaving) return;
    const parsed = Number(salaryInput);
    const value =
      salaryInput.trim() === "" || !Number.isFinite(parsed) ? null : Math.round(parsed);
    if (value != null && value < 0) {
      toast.error("Ekspektasi gaji tidak boleh negatif.");
      return;
    }
    setSalarySaving(true);
    const updated = await patch(
      { salaryExpectation: value },
      value != null ? "Ekspektasi gaji disimpan" : "Ekspektasi gaji dikosongkan"
    );
    if (updated) {
      setSalaryInput(updated.salaryExpectation != null ? String(updated.salaryExpectation) : "");
    }
    setSalarySaving(false);
  }

  // Fitur 8 — pasang / lepas HOLD.
  async function handleHoldSave() {
    if (holdSaving) return;
    if (!holdReason) {
      toast.error("Pilih alasan menahan lamaran.");
      return;
    }
    setHoldSaving(true);
    const updated = await patch(
      {
        holdReason,
        holdNote: holdNote.trim() || undefined,
        holdReviewAt: holdReview ? localInputToIso(holdReview) : undefined,
      },
      "Lamaran ditahan (HOLD)"
    );
    if (updated) {
      setHoldPanelOpen(false);
      setHoldReason("");
      setHoldNote("");
      setHoldReview("");
    }
    setHoldSaving(false);
  }

  async function handleHoldClear() {
    if (holdSaving) return;
    setHoldSaving(true);
    const updated = await patch({ holdClear: true }, "Proses dilanjutkan");
    if (updated) setHoldPanelOpen(false);
    setHoldSaving(false);
  }

  // Fitur 14 — batalkan penolakan (berkunci: klik 1 membuka kunci, alasan wajib).
  async function handleUndoReject() {
    if (undoSaving) return;
    const reason = undoReason.trim();
    if (!reason) {
      toast.error("Alasan pembatalan wajib diisi.");
      return;
    }
    setUndoSaving(true);
    setUndoError(null);
    try {
      const res = await apiPost<{ ok: boolean; application: Application }>(
        `/api/admin/applications/${app.id}/undo-reject`,
        { reason }
      );
      toast.success("Penolakan dibatalkan");
      setUndoUnlock(false);
      setUndoReason("");
      onSaved(res.application);
      onListRefresh?.();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 409)) {
        // Pesan validasi dari server ditampilkan inline.
        setUndoError(err.message);
      } else {
        reportError(err);
      }
    } finally {
      setUndoSaving(false);
    }
  }

  // Fitur 15 — pasang bendera do-not-hire.
  async function handleDnhSet() {
    if (dnhSaving) return;
    const reason = dnhReason.trim();
    if (!reason) {
      toast.error("Alasan wajib diisi.");
      return;
    }
    setDnhSaving(true);
    try {
      const res = await apiPost<{ ok: boolean; application: Application }>(
        `/api/admin/applications/${app.id}/do-not-hire`,
        { reason }
      );
      toast.success("Bendera do-not-hire dipasang");
      setDnhPanelOpen(false);
      setDnhReason("");
      onSaved(res.application);
      onListRefresh?.();
    } catch (err) {
      reportError(err);
    } finally {
      setDnhSaving(false);
    }
  }

  // Fitur 15 — lepas bendera do-not-hire (DELETE dengan body {reason}).
  async function handleDnhRemove() {
    if (dnhSaving) return;
    const reason = dnhRemoveReason.trim();
    if (!reason) {
      toast.error("Alasan pencabutan wajib diisi.");
      return;
    }
    setDnhSaving(true);
    try {
      const res = await apiFetch<{ ok: boolean; application: Application }>(
        `/api/admin/applications/${app.id}/do-not-hire`,
        jsonInit("DELETE", { reason })
      );
      toast.success("Bendera do-not-hire dilepas");
      setDnhRemoveOpen(false);
      setDnhRemoveReason("");
      onSaved(res.application);
      onListRefresh?.();
    } catch (err) {
      reportError(err);
    } finally {
      setDnhSaving(false);
    }
  }

  /* ----------------------------- Cetak dokumen (Task 27-e) ----------------------------- */

  // Buka jendela cetak berisi dokumen HTML siap A4, lalu picu dialog print browser.
  function openPrintWindow(html: string) {
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Popup diblokir browser. Izinkan popup untuk mencetak dokumen.");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  function handlePrintProfile() {
    openPrintWindow(buildProfileHtml(app, "Lumina Studio", screeningQuestions));
  }

  function handlePrintOffer() {
    openPrintWindow(buildOfferHtml(app, "Lumina Studio"));
  }

  async function handleSaveRubric() {
    if (rubricSaving) return;
    // Kirim hanya kriteria yang bernilai (int 1..5 disanitasi server).
    const payload: Record<string, number> = {};
    for (const c of rubricCriteria) {
      const v = rubricValues[c];
      if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5) {
        payload[c] = v;
      }
    }
    setRubricSaving(true);
    const updated = await patch(
      { rubricScores: JSON.stringify(payload) },
      rubricScoresCount > 0
        ? `Rubrik disimpan (rata-rata ${rubricAverage?.toFixed(1) ?? "-"})`
        : "Rubrik dikosongkan"
    );
    if (updated) setRubricValues(updated.rubricScores ?? {});
    setRubricSaving(false);
  }

  async function handleToggleChecklist(item: string) {
    if (!canMutate || checklistSaving) return;
    const next = checkedItems.includes(item)
      ? checkedItems.filter((i) => i !== item)
      : [...checkedItems, item];
    setCheckedItems(next);
    setChecklistSaving(true);
    const updated = await patch(
      { checklistState: JSON.stringify(next) },
      `Checklist diperbarui (${next.length}/${checklistTemplate.length})`
    );
    if (!updated) setCheckedItems(app.checklistState ?? []);
    setChecklistSaving(false);
  }

  function appendNoteTemplate(template: string) {
    const text = template.trim();
    if (!text) return;
    setEditNotes((prev) => (prev.trimEnd().length > 0 ? `${prev.trimEnd()}\n${text}` : text));
  }

  async function handleCopyReply(kind: "apply" | "accept" | "reject", label: string) {
    const template = replyTemplates?.[kind];
    if (!template) return;
    const message = fillTemplate(template, {
      nama: app.name,
      posisi: app.positionTitle ?? "-",
      kode: app.trackingCode,
    });
    const ok = await copyText(message);
    if (ok) toast.success(`Pesan ${label} disalin ke clipboard`);
    else toast.error("Gagal menyalin ke clipboard");
  }

  async function handleCopyTracking() {
    const ok = await copyText(app.trackingCode);
    if (ok) toast.success("Kode pelacakan disalin");
    else toast.error("Gagal menyalin ke clipboard");
  }

  /** Kirim email manual ke pelamar — terarsip di Kotak Keluar + activity log. */
  async function handleSendEmail() {
    if (!application) return;
    const subject = emailSubject.trim();
    const body = emailBody.trim();
    if (!subject) {
      toast.error("Subjek email wajib diisi.");
      return;
    }
    if (!body) {
      toast.error("Isi email wajib diisi.");
      return;
    }
    setEmailSending(true);
    try {
      await apiPost(`/api/admin/applications/${application.id}/email`, { subject, body });
      toast.success(`Email terkirim ke ${application.email}`);
      setEmailSubject("");
      setEmailBody("");
      setEmailPanelOpen(false);
    } catch (err) {
      reportError(err);
    } finally {
      setEmailSending(false);
    }
  }

  /** Sisipkan variabel template ke akhir isi email. */
  function appendEmailVariable(variable: string) {
    setEmailBody((prev) => (prev.length > 0 ? `${prev}${variable}` : variable));
  }

  // Form penawaran — dipakai untuk kirim baru & edit inline saat PENDING.
  const offerFormFields = (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="offer-salary">Gaji</Label>
          <Input
            id="offer-salary"
            value={offerForm.salary}
            onChange={(e) => setOfferForm((f) => ({ ...f, salary: e.target.value }))}
            placeholder="mis. Rp 5.000.000/bulan"
            maxLength={80}
            disabled={offerWorking}
            className="h-11 sm:h-10"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Jenis</Label>
          <Select
            value={offerForm.type}
            onValueChange={(v) => setOfferForm((f) => ({ ...f, type: v }))}
            disabled={offerWorking}
          >
            <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Jenis penawaran kerja">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {POSITION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="offer-start">Mulai Kerja</Label>
          <Input
            id="offer-start"
            type="date"
            value={offerForm.startDate}
            onChange={(e) => setOfferForm((f) => ({ ...f, startDate: e.target.value }))}
            disabled={offerWorking}
            className="h-11 sm:h-10"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Batas Jawaban (hari)</Label>
          <Select
            value={offerForm.deadlineDays}
            onValueChange={(v) => setOfferForm((f) => ({ ...f, deadlineDays: v }))}
            disabled={offerWorking}
          >
            <SelectTrigger className="h-11 w-full sm:h-10" aria-label="Batas jawaban penawaran dalam hari">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} hari
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="offer-note">Catatan</Label>
        <Textarea
          id="offer-note"
          value={offerForm.note}
          onChange={(e) => setOfferForm((f) => ({ ...f, note: e.target.value }))}
          placeholder="Opsional — catatan untuk pelamar"
          rows={2}
          maxLength={1000}
          disabled={offerWorking}
        />
      </div>
    </div>
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-lg font-bold">
            {/* NR-24 fitur 2 — bintang personal */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void handleToggleStar()}
                  disabled={!canMutate || starBusy}
                  aria-label="Tandai penting"
                  aria-pressed={starred}
                  className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Star
                    className={cn(
                      "size-5 transition-colors",
                      starred
                        ? "fill-amber-400 text-amber-500"
                        : "text-muted-foreground hover:text-amber-500"
                    )}
                    aria-hidden="true"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>Tandai penting</TooltipContent>
            </Tooltip>
            <span>{app.name}</span>
            {/* NR-24 fitur 1 — navigasi prev/next antar lamaran dalam daftar */}
            {navAvailable ? (
              <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
                <button
                  type="button"
                  onClick={() => navigateBy(-1)}
                  disabled={navPosition <= 0}
                  aria-label="Lamaran sebelumnya"
                  className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </button>
                <span className="whitespace-nowrap tabular-nums">
                  {navPosition + 1} dari {navTotal}
                </span>
                <button
                  type="button"
                  onClick={() => navigateBy(1)}
                  disabled={navPosition >= navTotal - 1}
                  aria-label="Lamaran berikutnya"
                  className="inline-flex size-6 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-40"
                >
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            ) : null}
            <StatusBadge status={app.status} />
            {/* NR-24-b — navigasi antar lamaran (prev/next) bila prop navigasi tersedia */}
            {navActive && navIds && typeof navIndex === "number" ? (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border p-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-9"
                  disabled={navIndex <= 0}
                  onClick={() => {
                    const prevApp = list?.[navIndex - 1];
                    if (prevApp) onNavigate?.(prevApp);
                  }}
                  aria-label="Lamaran sebelumnya"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                </Button>
                <span className="min-w-12 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                  {navIndex + 1} / {navIds.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-9"
                  disabled={navIndex >= navIds.length - 1}
                  onClick={() => {
                    const nextApp = list?.[navIndex + 1];
                    if (nextApp) onNavigate?.(nextApp);
                  }}
                  aria-label="Lamaran berikutnya"
                >
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </span>
            ) : null}
            {/* NR-24-b — bintang personal per admin (klik = toggle via PATCH starred) */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-9"
                  onClick={() => void handleToggleStar()}
                  disabled={starSaving}
                  aria-pressed={isStarred}
                  aria-label={isStarred ? "Lepas tanda penting" : "Tandai lamaran penting"}
                >
                  <Star
                    className={cn(
                      "size-4",
                      isStarred
                        ? "fill-amber-400 text-amber-500"
                        : "text-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isStarred ? "Bintang dilepas" : "Tandai penting (bintang pribadi)"}
              </TooltipContent>
            </Tooltip>
            {duplicateIds.has(app.id) ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className="cursor-help border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                  >
                    <Copy className="size-3" aria-hidden="true" />
                    Duplikat
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Kemungkinan lamaran ganda</TooltipContent>
              </Tooltip>
            ) : null}
            {app.talentPool ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
              >
                Talent Pool
              </Badge>
            ) : null}
            {/* NR-24 — badge HOLD & do-not-hire */}
            {app.holdAt ? (
              <Badge
                variant="outline"
                className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              >
                <CirclePause className="size-3" aria-hidden="true" />
                Ditahan
              </Badge>
            ) : null}
            {app.doNotHire ? (
              <Badge
                variant="outline"
                className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
              >
                <Ban className="size-3" aria-hidden="true" />
                Jangan diterima
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <span className="sr-only">Detail lamaran, catatan admin, ubah status, dan riwayat aktivitas.</span>
            <span className="text-muted-foreground">Kode pelacakan</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {app.trackingCode}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyTracking()}
              aria-label="Salin kode pelacakan"
              className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </button>
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 max-h-[75vh] overflow-y-auto pr-2 nice-scrollbar">
          <div className="flex flex-col gap-4">
            {/* Panel AI — NR-22: disembunyikan bila posisi menyembunyikan blok "ai" */}
            {isHidden("ai") ? null : <AiPanel app={app} onUpdated={onSaved} />}

            {/* Info grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoItem label={emailCoreLabel}>
                <a
                  href={`mailto:${app.email}`}
                  className="hover:text-rose-600 underline-offset-2 hover:underline"
                >
                  {app.email || "-"}
                </a>
              </InfoItem>
              <InfoItem label={waCoreLabel}>
                <a
                  href={waHref(app.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-rose-600 underline-offset-2 hover:underline"
                >
                  {app.phone || "-"}
                </a>
              </InfoItem>
              <InfoItem label="Posisi">{app.positionTitle ?? "-"}</InfoItem>
              <InfoItem label="Tanggal Daftar">
                {formatDateTime(app.createdAt)}
              </InfoItem>
              {/* NR-22 — InfoItem Portofolio & Sosial Media disembunyikan bila posisi menyembunyikan blok "portfolio" */}
              {!isHidden("portfolio") ? (
                <>
                  <InfoItem label="Portofolio">
                    {app.portfolioUrl ? (
                      <a
                        href={normalizeUrl(app.portfolioUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline"
                      >
                        <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{app.portfolioUrl}</span>
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </InfoItem>
                  <InfoItem label="Sosial Media">
                    {app.socialLinks ? (
                      <a
                        href={normalizeUrl(app.socialLinks)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline"
                      >
                        <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{app.socialLinks}</span>
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </InfoItem>
                </>
              ) : null}
            </div>

            {/* NR-24 fitur 7/12/15 — riwayat melamar, duplikat tersangka, peringatan do-not-hire */}
            <RelatedSection
              key={`related-${app.id}`}
              applicationId={app.id}
              list={list}
              onNavigate={onNavigate}
              onSaved={onSaved}
              onListRefresh={onListRefresh}
            />

            {/* NR-15: read receipt — kapan terakhir pelamar membuka halaman status */}
            <div className="flex items-center gap-2 text-xs">
              <Eye className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              {app.candidateSeenAt ? (
                <span className="text-muted-foreground">
                  Dilihat pelamar{" "}
                  <span className="font-medium text-foreground">
                    {formatRelative(app.candidateSeenAt)}
                  </span>
                  {typeof app.candidateSeenCount === "number" && app.candidateSeenCount > 0
                    ? ` (${app.candidateSeenCount}x)`
                    : ""}
                </span>
              ) : (
                <span className="italic text-muted-foreground">
                  Belum pernah dilihat pelamar
                </span>
              )}
            </div>

            {/* Cetak dokumen (Task 27-e): profil pelamar & surat penawaran + anonimisasi (NR-19) */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={handlePrintProfile}
              >
                <FileDown className="size-4" aria-hidden="true" />
                Unduh Profil (PDF)
              </Button>
              <Button
                variant="outline"
                className="h-11 sm:h-9"
                onClick={handlePrintOffer}
                disabled={!app.offerStatus}
              >
                <FileText className="size-4" aria-hidden="true" />
                Surat Penawaran (PDF)
              </Button>
              {canMutate && !app.hiredAt ? (
                <AlertDialog
                  open={anonymizeConfirmOpen}
                  onOpenChange={setAnonymizeConfirmOpen}
                >
                  <Button
                    variant="outline"
                    className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-9 dark:border-rose-900 dark:hover:bg-rose-950"
                    onClick={() => setAnonymizeConfirmOpen(true)}
                    disabled={anonymizing}
                  >
                    <UserX className="size-4" aria-hidden="true" />
                    Anonimkan Data
                  </Button>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Anonimkan data pelamar ini?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Nama, kontak, CV, dan jawaban akan dihapus permanen. Statistik tetap
                        tersimpan. Tindakan tidak dapat dibatalkan.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={anonymizing}>Batal</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(e) => {
                          e.preventDefault();
                          void handleAnonymize();
                        }}
                        className="bg-rose-600 text-white hover:bg-rose-700"
                        disabled={anonymizing}
                      >
                        {anonymizing ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            Menganonimkan...
                          </>
                        ) : (
                          "Ya, Anonimkan"
                        )}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>

            {/* Sumber & atribusi UTM */}
            {showSourceBlock ? (
              <div className="flex flex-col gap-1.5 rounded-lg border p-3">
                <p className="text-sm font-semibold">Sumber Pelamar</p>
                {app.source ? (
                  <SourceRow icon={Share2} label="Sumber" value={app.source} />
                ) : null}
                {utmRows.map((row) => (
                  <SourceRow key={row.label} icon={row.icon} label={row.label} value={row.value} />
                ))}
              </div>
            ) : null}

            {/* Info kehadiran (posisi on-site/hybrid) — hanya bila ada datanya */}
            {showAttendanceInfo ? (
              <div className="flex flex-col gap-1.5 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <MapPin
                    className="size-4 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <p className="text-sm font-semibold">Info Kehadiran</p>
                </div>
                {attendanceDomisili ? (
                  <SourceRow icon={MapPin} label="Domisili" value={attendanceDomisili} />
                ) : null}
                {app.komuterPlan ? (
                  <SourceRow
                    icon={Users}
                    label="Rencana komuter"
                    value={KOMUTER_PLAN_LABELS[app.komuterPlan]}
                  />
                ) : null}
                {app.shiftPref ? (
                  <SourceRow
                    icon={Clock}
                    label="Shift diinginkan"
                    value={SHIFT_PREF_LABELS[app.shiftPref]}
                  />
                ) : null}
                {attendanceStartDate ? (
                  <SourceRow
                    icon={CalendarPlus}
                    label="Bisa mulai"
                    value={attendanceStartDate}
                  />
                ) : null}
              </div>
            ) : null}

            {/* Wawancara: daftar sesi multi-ronde */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Video className="size-4 text-orange-500" aria-hidden="true" />
                <p className="text-sm font-semibold">Wawancara</p>
                {canMutate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-11 sm:h-8"
                    onClick={() => {
                      // Nonce memastikan dialog create termuat dengan form bersih.
                      setCreateNonce((n) => n + 1);
                      setSessionCreateOpen(true);
                    }}
                  >
                    <CalendarPlus className="size-4" aria-hidden="true" />
                    Jadwalkan Wawancara
                  </Button>
                ) : null}
              </div>
              {sessionsLoading && sessions.length === 0 ? (
                <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Memuat sesi wawancara...
                </p>
              ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Belum ada sesi wawancara.</p>
              ) : (
                <div className="flex max-h-64 flex-col gap-2 overflow-y-auto nice-scrollbar">
                  {sessions.map((i) => (
                    <div
                      key={i.id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border p-2.5"
                    >
                      <span className="shrink-0 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                        R{i.round}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        {formatDateTime(i.scheduledAt)}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          · {i.durationMin} menit
                        </span>
                      </span>
                      <InterviewStatusChip status={i.status} />
                      <div className="flex w-full items-center gap-1.5 sm:w-auto">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 sm:h-8"
                          onClick={() => setSessionDetail(i)}
                        >
                          Detail
                        </Button>
                        {i.mode === "ONLINE" && i.meetingLink ? (
                          <Button asChild variant="outline" size="sm" className="h-11 sm:h-8">
                            <a
                              href={i.meetingLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Gabung meeting ronde ${i.round}`}
                            >
                              <Video className="size-4" aria-hidden="true" />
                              Gabung
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Berkas */}
            {app.cvFileId || app.introFileId || app.extraDocs.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm font-semibold">Berkas</p>
                {app.cvFileId ? (
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {app.cvFileName ?? "CV Pelamar"}
                    </span>
                    <a
                      href={`/api/files/${app.cvFileId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Unduh
                    </a>
                  </div>
                ) : null}
                {app.introFileId ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <AudioLines className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {app.introFileName ?? "Video Perkenalan (audio)"}
                      </span>
                    </div>
                    <audio
                      controls
                      preload="none"
                      src={`/api/files/${app.introFileId}`}
                      className="w-full"
                    />
                    {app.transcript ? (
                      <Collapsible>
                        <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                          <ChevronDown
                            className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
                            aria-hidden="true"
                          />
                          Lihat Transkripsi AI
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="mt-2 rounded-lg border bg-background p-3 text-sm whitespace-pre-wrap">
                            {app.transcript}
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Transkripsi sedang diproses...
                      </p>
                    )}
                    {/* Catatan bertimestamp video intro (Task 27-e) */}
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                          <StickyNote
                            className="size-4 text-amber-600 dark:text-amber-400"
                            aria-hidden="true"
                          />
                          Catatan Video
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Tandai momen penting per detik saat meninjau video/audio intro.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        {videoNotes.length > 0 ? (
                          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto nice-scrollbar">
                            {videoNotes.map((note, i) => (
                              <div
                                key={`${note.t}-${i}`}
                                className="flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-1.5"
                              >
                                <span className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                                  {formatTimestamp(note.t)}
                                </span>
                                <span className="min-w-0 flex-1 break-words text-sm">
                                  &mdash; {note.note}
                                </span>
                                {canMutate ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleRemoveVideoNote(note)}
                                    aria-label={`Hapus catatan pada ${formatTimestamp(note.t)}`}
                                    disabled={videoNotesSaving}
                                    className="shrink-0 text-muted-foreground outline-none hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:hover:text-rose-400"
                                  >
                                    <X className="size-3.5" aria-hidden="true" />
                                  </button>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Belum ada catatan video.</p>
                        )}
                        {canMutate ? (
                          <form onSubmit={handleAddVideoNote} className="flex flex-col gap-2">
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Input
                                type="number"
                                min={0}
                                step={1}
                                value={videoNoteSec}
                                onChange={(e) => setVideoNoteSec(e.target.value)}
                                placeholder="Detik"
                                aria-label="Detik ke berapa dalam video"
                                inputMode="numeric"
                                className="h-11 w-full sm:h-9 sm:w-24"
                                disabled={videoNotesSaving}
                              />
                              <Input
                                value={videoNoteText}
                                onChange={(e) => setVideoNoteText(e.target.value)}
                                placeholder="Isi catatan (maks. 300 karakter)"
                                aria-label="Isi catatan video"
                                maxLength={300}
                                className="h-11 w-full sm:h-9 sm:flex-1"
                                disabled={videoNotesSaving}
                              />
                            </div>
                            <Button
                              type="submit"
                              variant="outline"
                              size="sm"
                              className="h-11 w-fit active:scale-[0.99] sm:h-9"
                              disabled={videoNotesSaving || !videoNoteText.trim()}
                            >
                              {videoNotesSaving ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <StickyNote className="size-4" aria-hidden="true" />
                              )}
                              Tambah Catatan
                            </Button>
                          </form>
                        ) : null}
                      </CardContent>
                    </Card>
                  </div>
                ) : null}
                {/* Dokumen wajib tambahan yang diunggah pelamar (customDocs posisi).
                    Masa berlaku dokumen dikelola blok DocExpirySection (NR-24). */}
                {app.extraDocs.map((doc) => {
                  return (
                    <div key={doc.fileId} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1 truncate text-sm">
                          <span className="font-medium">{doc.label}</span>
                          {doc.filename ? (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {doc.filename}
                            </span>
                          ) : null}
                        </span>
                        <a
                          href={`/api/files/${doc.fileId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          Unduh
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* NR-24 fitur 11 + 13 — dokumen internal & masa berlaku dokumen */}
            <InternalDocsSection key={`internal-docs-${app.id}`} applicationId={app.id} canMutate={canMutate} />
            <DocExpirySection key={`doc-expiry-${app.id}`} app={app} canMutate={canMutate} onSaved={onSaved} />

            <Separator />

            {/* Jawaban screening */}
            {showScreening ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Jawaban Screening</p>
                </div>
                <div className="flex flex-col gap-2.5">
                  {screeningQuestions.map((q) => {
                    const answer = screeningAnswers[q.id]?.trim() ?? "";
                    return (
                      <div key={q.id} className="rounded-lg bg-muted/50 p-2.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {q.label}
                          {q.required ? (
                            <span className="ml-1 text-rose-500" aria-hidden="true">
                              *
                            </span>
                          ) : null}
                        </p>
                        {answer ? (
                          <p className="mt-0.5 text-sm whitespace-pre-wrap">{answer}</p>
                        ) : (
                          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
                            Tidak dijawab
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Jawaban Formulir (Form Builder) — di bawah blok Jawaban Screening */}
            {formSchema != null && formAnswers != null ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Jawaban Formulir</p>
                </div>
                <div className="flex flex-col gap-3">
                  {formSchema.sections.map((section) => {
                    const fields = formSchema.fields.filter((f) => f.sectionId === section.id);
                    if (fields.length === 0) return null;
                    return (
                      <div key={section.id} className="flex flex-col gap-2">
                        <p className="text-xs font-semibold text-muted-foreground">
                          {section.title}
                        </p>
                        {fields.map((field) => (
                          <div key={field.id} className="rounded-lg bg-muted/50 p-2.5">
                            <p className="text-xs font-medium text-muted-foreground">
                              {field.label}
                              {field.required ? (
                                <span className="ml-1 text-rose-500" aria-hidden="true">
                                  *
                                </span>
                              ) : null}
                            </p>
                            <FormAnswerValueView value={formAnswers[field.id]} />
                          </div>
                        ))}
                      </div>
                    );
                  })}
                  {formSchema.retiredFields
                    .filter((r) => !isEmptyFormAnswer(formAnswers[r.id]))
                    .map((r) => (
                      <div key={r.id} className="rounded-lg bg-muted/50 p-2.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {r.label} (pertanyaan sudah dihapus)
                        </p>
                        <FormAnswerValueView value={formAnswers[r.id]} />
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            {/* Pengalaman & Alasan — disembunyikan bila bagian Pengalaman
                skema v2 mematikan keduanya dan nilainya kosong */}
            {showExperienceBlock ? (
              <div className="flex flex-col gap-4">
                <div>
                  <h4 className="mb-1 text-sm font-semibold">{experienceCoreLabel}</h4>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {app.experience || "-"}
                  </p>
                </div>
                <div>
                  <h4 className="mb-1 text-sm font-semibold">{motivationCoreLabel}</h4>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {app.motivation || "-"}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Rubrik evaluasi — NR-22: disembunyikan bila posisi menyembunyikan blok "rubric" */}
            {rubricCriteria.length > 0 && !isHidden("rubric") ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ListChecks className="size-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Rubrik Evaluasi</p>
                  <span className="ml-auto text-xs text-muted-foreground">
                    Rata-rata{" "}
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {rubricAverage != null ? rubricAverage.toFixed(1) : "-"}
                    </span>
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  {rubricCriteria.map((criterion) => {
                    const value = rubricValues[criterion];
                    return (
                      <div key={criterion} className="flex flex-col gap-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {criterion}
                        </p>
                        <div
                          className="flex flex-wrap items-center gap-1.5"
                          role="group"
                          aria-label={`Nilai rubrik ${criterion}`}
                        >
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button
                              key={n}
                              type="button"
                              disabled={!canMutate || rubricSaving}
                              onClick={() =>
                                setRubricValues((prev) => ({ ...prev, [criterion]: n }))
                              }
                              aria-label={`${criterion}: nilai ${n} dari 5`}
                              aria-pressed={value === n}
                              className={cn(
                                "flex size-11 items-center justify-center rounded-lg border text-sm font-semibold tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 sm:size-9",
                                value === n
                                  ? "border-rose-600 bg-rose-600 text-white hover:bg-rose-700"
                                  : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                              )}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {canMutate ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-11 w-fit active:scale-[0.99] sm:h-9"
                    onClick={() => void handleSaveRubric()}
                    disabled={rubricSaving}
                  >
                    {rubricSaving ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Simpan Rubrik
                  </Button>
                ) : null}
              </div>
            ) : null}

            {/* NR-24 fitur 5 — tugas uji (NR-22: disembunyikan bila posisi menyembunyikan blok "assessment") */}
            {isHidden("assessment") ? null : (
              <AssessmentSection key={`assess-${app.id}`} applicationId={app.id} canMutate={canMutate} />
            )}

            {/* Checklist evaluasi — NR-22: disembunyikan bila posisi menyembunyikan blok "checklist" */}
            {checklistTemplate.length > 0 && !isHidden("checklist") ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <ClipboardCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Checklist Evaluasi</p>
                  <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
                    {checkedItems.length}/{checklistTemplate.length}
                  </span>
                </div>
                <div className="flex flex-col gap-1">
                  {checklistTemplate.map((item) => {
                    const checked = checkedItems.includes(item);
                    return (
                      <label
                        key={item}
                        className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-sm hover:bg-accent/50"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={!canMutate || checklistSaving}
                          onCheckedChange={() => void handleToggleChecklist(item)}
                          aria-label={`Checklist: ${item}`}
                        />
                        <span className={cn(checked && "text-muted-foreground line-through")}>
                          {item}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <Separator />

            {/* Editor */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Label className="text-sm">Rating</Label>
                <RatingStars
                  value={app.rating}
                  onChange={canMutate ? (n) => void handleRating(n) : undefined}
                  disabled={!canMutate || ratingSaving}
                  ariaLabel={`Rating ${app.name}`}
                />
              </div>

              {/* NR-24 fitur 6 — ekspektasi gaji vs rentang posisi */}
              {/* NR-22 — blok Ekspektasi Gaji disembunyikan bila posisi menyembunyikan blok "salary" */}
              {!isHidden("salary") ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Banknote className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Ekspektasi Gaji</p>
                  {salaryBadge ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        salaryBadge.cls === "emerald" &&
                          "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
                        salaryBadge.cls === "amber" &&
                          "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
                        salaryBadge.cls === "zinc" &&
                          "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
                      )}
                    >
                      {salaryBadge.label}
                    </Badge>
                  ) : null}
                </div>
                {canMutate ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={0}
                        step={100000}
                        value={salaryInput}
                        onChange={(e) => setSalaryInput(e.target.value)}
                        placeholder="mis. 4500000"
                        inputMode="numeric"
                        aria-label="Ekspektasi gaji bulanan dalam rupiah"
                        className="h-11 w-full sm:h-9 sm:w-48"
                        disabled={salarySaving}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => void handleSaveSalary()}
                        disabled={salarySaving}
                      >
                        {salarySaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Simpan
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {salaryEffective != null
                        ? `Terisi: ${formatRupiah(salaryEffective)}`
                        : "Belum diisi"}
                      {posSalaryMin != null || posSalaryMax != null
                        ? ` · Rentang posisi: ${posSalaryMin != null ? formatRupiah(posSalaryMin) : "?"} – ${
                            posSalaryMax != null ? formatRupiah(posSalaryMax) : "?"
                          }`
                        : ""}
                    </p>
                  </div>
                ) : salaryEffective != null ? (
                  <p className="text-sm">{formatRupiah(salaryEffective)}</p>
                ) : null}
              </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor={`tags-${app.id}`} className="text-sm">Tags</Label>
                {app.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {app.tags.map((tag) => (
                      <span
                        key={tag}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
                          colorClassOf(tag)
                        )}
                      >
                        {tag}
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => void handleRemoveTag(tag)}
                            aria-label={`Hapus tag ${tag}`}
                            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            disabled={tagsSaving}
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Belum ada tag.</p>
                )}
                {canMutate ? (
                  <>
                    <form onSubmit={handleAddTag} className="flex items-center gap-2">
                      <Input
                        id={`tags-${app.id}`}
                        value={tagInput}
                        onChange={(e) => setTagInput(e.target.value)}
                        placeholder="Tambah tag lalu tekan Enter"
                        aria-label="Tambah tag baru"
                        list={`tag-defs-${app.id}`}
                        className="h-9 w-full sm:w-64"
                        disabled={tagsSaving}
                      />
                      <datalist id={`tag-defs-${app.id}`}>
                        {tagDefs.map((td) => (
                          <option key={td.name} value={td.name} />
                        ))}
                      </datalist>
                    </form>
                    {/* NR-24 fitur 3 — quick-add dari tagDefs yang belum terpasang */}
                    {availableTagDefs.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">Tag cepat:</span>
                        {availableTagDefs.map((td) => (
                          <button
                            key={td.name}
                            type="button"
                            onClick={() => void handleQuickAddTag(td.name)}
                            disabled={tagsSaving}
                            aria-label={`Tambah tag ${td.name}`}
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-xs font-medium outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50",
                              colorClassOf(td.name)
                            )}
                          >
                            + {td.name}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Talent Pool</p>
                  <p className="text-xs text-muted-foreground">
                    Simpan kandidat untuk rekrutmen berikutnya
                  </p>
                </div>
                <Switch
                  checked={app.talentPool}
                  onCheckedChange={(checked) => void handleTalentPool(checked)}
                  disabled={!canMutate}
                  aria-label="Tandai Talent Pool"
                />
              </div>

              {/* NR-24 fitur 4 — tindak lanjut / snooze */}
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CalendarClock className="size-4 text-orange-500" aria-hidden="true" />
                  <p className="text-sm font-semibold">Tindak Lanjut</p>
                  {followUpDue ? (
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                    >
                      Jatuh tempo
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {app.followUpAt
                    ? `Dijadwalkan: ${formatDateTime(app.followUpAt)}`
                    : "Belum dijadwalkan"}
                </p>
                {canMutate ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <Input
                      type="datetime-local"
                      value={followUpInput}
                      onChange={(e) => setFollowUpInput(e.target.value)}
                      aria-label="Tanggal tindak lanjut"
                      className="h-11 w-full sm:h-9 sm:w-60"
                      disabled={followUpSaving}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => quickFollowUp(3)}
                        disabled={followUpSaving}
                      >
                        3 hari
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => quickFollowUp(7)}
                        disabled={followUpSaving}
                      >
                        7 hari
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() =>
                          void handleFollowUp(
                            localInputToIso(followUpInput),
                            "Tindak lanjut disimpan"
                          )
                        }
                        disabled={followUpSaving || !followUpInput}
                      >
                        Simpan
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => void handleFollowUp(null, "Tindak lanjut dibersihkan")}
                        disabled={followUpSaving || !app.followUpAt}
                      >
                        Bersihkan
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="admin-notes">Catatan Admin</Label>
                {noteTemplates.length > 0 && canMutate ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Template:</span>
                    {noteTemplates.map((tpl, i) => {
                      const text = tpl.trim();
                      if (!text) return null;
                      return (
                        <button
                          key={`${i}-${text.slice(0, 12)}`}
                          type="button"
                          onClick={() => appendNoteTemplate(text)}
                          className="max-w-full truncate rounded-full border px-2.5 py-1 text-xs outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                          title={text}
                          aria-label={`Sisipkan template catatan: ${text}`}
                        >
                          {text}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <Textarea
                  id="admin-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Tulis catatan internal..."
                  rows={3}
                  disabled={!canMutate}
                />
              </div>

              {/* Template balasan */}
              {replyTemplates && (replyTemplates.apply || replyTemplates.accept || replyTemplates.reject) ? (
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="size-4 text-rose-500" aria-hidden="true" />
                    <p className="text-sm font-semibold">Template Balasan</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pesan siap kirim dengan variabel {"{nama}"}, {"{posisi}"}, dan {"{kode}"} yang sudah diisi.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {replyTemplates.apply ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => void handleCopyReply("apply", "Konfirmasi")}
                      >
                        <Copy className="size-4" aria-hidden="true" />
                        Salin pesan Konfirmasi
                      </Button>
                    ) : null}
                    {replyTemplates.accept ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 sm:h-9 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
                        onClick={() => void handleCopyReply("accept", "Diterima")}
                      >
                        <Copy className="size-4" aria-hidden="true" />
                        Salin pesan Diterima
                      </Button>
                    ) : null}
                    {replyTemplates.reject ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 sm:h-9"
                        onClick={() => void handleCopyReply("reject", "Ditolak")}
                      >
                        <Copy className="size-4" aria-hidden="true" />
                        Salin pesan Ditolak
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Email pelamar — compose manual (terarsip di Kotak Keluar). */}
              <Collapsible open={emailPanelOpen} onOpenChange={setEmailPanelOpen}>
                <div className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Send className="size-4 text-rose-500" aria-hidden="true" />
                      <p className="text-sm font-semibold">Email Pelamar</p>
                    </div>
                    <CollapsibleTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9">
                        {emailPanelOpen ? "Tutup" : "Tulis Email"}
                      </Button>
                    </CollapsibleTrigger>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Kirim langsung ke <span className="font-medium">{app.email}</span> — terarsip
                    di Kotak Keluar dan tercatat di aktivitas.
                  </p>
                  <CollapsibleContent className="flex flex-col gap-3 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">Sisipkan:</span>
                      {["{nama}", "{posisi}", "{kode}"].map((variable) => (
                        <button
                          key={variable}
                          type="button"
                          onClick={() => appendEmailVariable(variable)}
                          className="rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors hover:bg-accent"
                          aria-label={`Sisipkan variabel ${variable}`}
                        >
                          {variable}
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email-subject">Subjek</Label>
                      <Input
                        id="email-subject"
                        value={emailSubject}
                        onChange={(e) => setEmailSubject(e.target.value)}
                        maxLength={200}
                        placeholder="Subjek email"
                        disabled={emailSending || !canMutate}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="email-body">Isi email</Label>
                      <Textarea
                        id="email-body"
                        value={emailBody}
                        onChange={(e) => setEmailBody(e.target.value)}
                        maxLength={5000}
                        rows={5}
                        placeholder="Tulis pesan untuk pelamar..."
                        disabled={emailSending || !canMutate}
                      />
                    </div>
                    <Button
                      className="self-start"
                      disabled={emailSending || !canMutate}
                      onClick={() => void handleSendEmail()}
                    >
                      {emailSending ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="size-4" aria-hidden="true" />
                      )}
                      Kirim Email
                    </Button>
                  </CollapsibleContent>
                </div>
              </Collapsible>

              <div className="flex flex-col gap-2">
                <Label>Ubah Tahap</Label>
                <Select
                  value={editStatus}
                  onValueChange={(v) => setEditStatus(v)}
                  disabled={!canMutate}
                >
                  <SelectTrigger className="w-full sm:w-56" aria-label="Ubah tahap lamaran">
                    <SelectValue placeholder="Pilih tahap" />
                  </SelectTrigger>
                  <SelectContent>
                    {stageChoices.map((s) => (
                      <SelectItem key={s} value={s}>
                        {stageLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* NR-24 fitur 8 — tahan proses (HOLD) */}
            {app.holdAt || canMutate ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CirclePause className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Tahan Proses (HOLD)</p>
                </div>

                {app.holdAt ? (
                  <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                    <p className="font-medium text-amber-800 dark:text-amber-300">
                      Ditahan sejak {formatDateTime(app.holdAt)} —{" "}
                      {app.holdReason ? HOLD_REASON_LABELS[app.holdReason] : "Tanpa alasan"}
                    </p>
                    {app.holdNote ? (
                      <p className="text-muted-foreground">Catatan: {app.holdNote}</p>
                    ) : null}
                    {app.holdReviewAt ? (
                      <p className="text-muted-foreground">
                        Review: {formatDateTime(app.holdReviewAt)}
                      </p>
                    ) : null}
                    {canMutate ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 w-fit sm:h-9"
                        onClick={() => void handleHoldClear()}
                        disabled={holdSaving}
                      >
                        {holdSaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Lanjutkan Proses
                      </Button>
                    ) : null}
                  </div>
                ) : canMutate ? (
                  holdPanelOpen ? (
                    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5">
                      <Select
                        value={holdReason || "__pilih__"}
                        onValueChange={(v) => setHoldReason(v as HoldReason)}
                        disabled={holdSaving}
                      >
                        <SelectTrigger
                          className="h-11 w-full sm:h-10"
                          aria-label="Alasan menahan lamaran"
                        >
                          <SelectValue placeholder="Pilih alasan" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__pilih__" disabled>
                            Pilih alasan
                          </SelectItem>
                          {HOLD_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {HOLD_REASON_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Textarea
                        value={holdNote}
                        onChange={(e) => setHoldNote(e.target.value)}
                        placeholder="Catatan (opsional)"
                        rows={2}
                        maxLength={500}
                        disabled={holdSaving}
                        aria-label="Catatan HOLD"
                      />
                      <Input
                        type="datetime-local"
                        value={holdReview}
                        onChange={(e) => setHoldReview(e.target.value)}
                        aria-label="Tanggal review kembali"
                        className="h-11 w-full sm:h-9 sm:w-60"
                        disabled={holdSaving}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          className="h-11 w-fit bg-amber-600 text-white hover:bg-amber-700 sm:h-9"
                          onClick={() => void handleHoldSave()}
                          disabled={holdSaving}
                        >
                          {holdSaving ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Simpan
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 sm:h-9"
                          onClick={() => setHoldPanelOpen(false)}
                          disabled={holdSaving}
                        >
                          Batal
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 w-fit sm:h-9"
                      onClick={() => setHoldPanelOpen(true)}
                    >
                      Tahan Lamaran
                    </Button>
                  )
                ) : null}
              </div>
            ) : null}

            {/* Tolak Lamaran */}
            {canMutate ? (
              <div className="flex flex-col gap-3 rounded-lg border border-rose-200 p-3 dark:border-rose-900">
                <div className="flex items-center gap-2">
                  <XCircle className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Tolak Lamaran</p>
                </div>

                {app.status === "REJECTED" ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Ditolak {formatDate(app.rejectedAt)}
                      {app.rejectionReason
                        ? ` — ${REJECTION_REASON_LABELS[app.rejectionReason]}`
                        : ""}
                      {app.rejectionNote ? ` · ${app.rejectionNote}` : ""}
                    </p>
                    {/* NR-24 fitur 14 — batalkan penolakan (berkunci) */}
                    {!undoUnlock ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 w-fit sm:h-9"
                        onClick={() => setUndoUnlock(true)}
                        disabled={undoSaving}
                      >
                        <Undo2 className="size-4" aria-hidden="true" />
                        Batalkan Penolakan
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                        <p className="text-sm">
                          Batalkan penolakan menandai keputusan ini dipertimbangkan ulang.
                          Jelaskan alasannya (wajib).
                        </p>
                        <Textarea
                          value={undoReason}
                          onChange={(e) => setUndoReason(e.target.value)}
                          placeholder="Alasan pembatalan penolakan"
                          rows={2}
                          maxLength={500}
                          disabled={undoSaving}
                          aria-label="Alasan pembatalan penolakan"
                        />
                        {undoError ? (
                          <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
                            {undoError}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="h-11 w-fit sm:h-9"
                            onClick={() => void handleUndoReject()}
                            disabled={undoSaving || !undoReason.trim()}
                          >
                            {undoSaving ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Undo2 className="size-4" aria-hidden="true" />
                            )}
                            Kirim Pembatalan
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-11 sm:h-9"
                            onClick={() => {
                              setUndoUnlock(false);
                              setUndoError(null);
                            }}
                            disabled={undoSaving}
                          >
                            Batal
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reject-reason">Alasan Penolakan</Label>
                      <Select
                        value={rejectReason || "__pilih__"}
                        onValueChange={(v) => setRejectReason(v as RejectionReason)}
                        disabled={rejecting}
                      >
                        <SelectTrigger
                          id="reject-reason"
                          className="h-11 w-full sm:h-10"
                          aria-label="Alasan penolakan lamaran"
                        >
                          <SelectValue placeholder="Pilih alasan" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__pilih__" disabled>
                            Pilih alasan
                          </SelectItem>
                          {REJECTION_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {REJECTION_REASON_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="reject-note">Catatan</Label>
                      <Textarea
                        id="reject-note"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Opsional — catatan internal / feedback untuk pelamar"
                        rows={2}
                        maxLength={1000}
                        disabled={rejecting}
                      />
                    </div>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                      <Switch
                        checked={rejectFeedback}
                        onCheckedChange={setRejectFeedback}
                        disabled={rejecting}
                        aria-label="Tampilkan feedback ini ke pelamar"
                      />
                      Tampilkan feedback ini ke pelamar
                    </label>
                    <AlertDialog open={rejectConfirmOpen} onOpenChange={setRejectConfirmOpen}>
                      <Button
                        variant="destructive"
                        className="h-11 w-fit active:scale-[0.99] sm:h-9"
                        onClick={() => setRejectConfirmOpen(true)}
                        disabled={rejecting}
                      >
                        Tolak Lamaran
                      </Button>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Tolak lamaran {app.name}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            Status lamaran berubah menjadi Ditolak. Pembatalan tetap
                            dimungkinkan lewat tombol Batalkan Penolakan dengan alasan.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={rejecting}>Batal</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={(e) => {
                              e.preventDefault();
                              void handleReject();
                            }}
                            className="bg-rose-600 text-white hover:bg-rose-700"
                            disabled={rejecting}
                          >
                            {rejecting ? (
                              <>
                                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                Menolak...
                              </>
                            ) : (
                              "Ya, Tolak"
                            )}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}

                {rejectMessage ? (
                  <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
                    <p className="whitespace-pre-wrap text-sm">{rejectMessage}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 w-fit sm:h-9"
                      onClick={() => void handleCopyMessage(rejectMessage)}
                    >
                      <Copy className="size-4" aria-hidden="true" />
                      Salin Pesan
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* NR-24 fitur 15 — bendera do-not-hire */}
            {app.doNotHire || canMutate ? (
              <div className="flex flex-col gap-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3 dark:border-rose-900 dark:bg-rose-950/20">
                <div className="flex items-center gap-2">
                  <Flag className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Bendera Do-not-Hire</p>
                </div>

                {app.doNotHire ? (
                  <>
                    <p className="text-sm text-rose-700 dark:text-rose-400">
                      Ditandai jangan diterima
                      {app.doNotHireReason ? ` — ${app.doNotHireReason}` : ""}
                    </p>
                    {!dnhRemoveOpen ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 w-fit border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-9 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                        onClick={() => setDnhRemoveOpen(true)}
                        disabled={!canMutate || dnhSaving}
                      >
                        Lepas Bendera
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-2 rounded-md border border-rose-200 bg-background p-2.5 dark:border-rose-900">
                        <Textarea
                          value={dnhRemoveReason}
                          onChange={(e) => setDnhRemoveReason(e.target.value)}
                          placeholder="Alasan melepas bendera (wajib)"
                          rows={2}
                          maxLength={500}
                          disabled={dnhSaving}
                          aria-label="Alasan melepas bendera do-not-hire"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            className="h-11 w-fit sm:h-9"
                            onClick={() => void handleDnhRemove()}
                            disabled={dnhSaving || !dnhRemoveReason.trim()}
                          >
                            {dnhSaving ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : null}
                            Kirim Pencabutan
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-11 sm:h-9"
                            onClick={() => {
                              setDnhRemoveOpen(false);
                              setDnhRemoveReason("");
                            }}
                            disabled={dnhSaving}
                          >
                            Batal
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : canMutate ? (
                  !dnhPanelOpen ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 w-fit border-rose-300 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-9 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                      onClick={() => setDnhPanelOpen(true)}
                      disabled={dnhSaving}
                    >
                      <Flag className="size-4" aria-hidden="true" />
                      Bendera Do-not-Hire
                    </Button>
                  ) : (
                    <div className="flex flex-col gap-2 rounded-md border border-rose-200 bg-background p-2.5 dark:border-rose-900">
                      <Textarea
                        value={dnhReason}
                        onChange={(e) => setDnhReason(e.target.value)}
                        placeholder="Alasan menandai jangan diterima (wajib)"
                        rows={2}
                        maxLength={500}
                        disabled={dnhSaving}
                        aria-label="Alasan bendera do-not-hire"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-11 w-fit sm:h-9"
                          onClick={() => void handleDnhSet()}
                          disabled={dnhSaving || !dnhReason.trim()}
                        >
                          {dnhSaving ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Pasang Bendera
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-11 sm:h-9"
                          onClick={() => {
                            setDnhPanelOpen(false);
                            setDnhReason("");
                          }}
                          disabled={dnhSaving}
                        >
                          Batal
                        </Button>
                      </div>
                    </div>
                  )
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Lamaran baru dengan email/WA sama akan diberi peringatan otomatis.
                </p>
              </div>
            ) : null}

            {/* Penawaran (offer) */}
            {canMutate && app.status !== "REJECTED" ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Handshake className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Penawaran</p>
                </div>

                {!app.offerStatus || app.offerStatus === "DECLINED" || app.offerStatus === "EXPIRED" ? (
                  <>
                    {app.offerStatus === "DECLINED" ? (
                      <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400">
                        <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                        <span>
                          Penawaran sebelumnya ditolak pelamar
                          {app.offerDeclineReason ? ` — ${app.offerDeclineReason}` : ""}
                          {app.offerRespondedAt ? ` (${formatDateTime(app.offerRespondedAt)})` : ""}
                          . Kirim penawaran baru bila masih berminat.
                        </span>
                      </div>
                    ) : null}
                    {app.offerStatus === "EXPIRED" ? (
                      <p className="text-xs text-muted-foreground">
                        Penawaran sebelumnya kedaluwarsa tanpa jawaban. Isi ulang untuk mengirim penawaran baru.
                      </p>
                    ) : null}
                    {offerFormFields}
                    <Button
                      className="h-11 w-fit bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99] sm:h-9"
                      onClick={() => void handleSendOffer()}
                      disabled={offerWorking}
                    >
                      {offerWorking ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Handshake className="size-4" aria-hidden="true" />
                      )}
                      Kirim Penawaran
                    </Button>
                    {offerMessage ? (
                      <div className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
                        <p className="whitespace-pre-wrap text-sm">{offerMessage}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 w-fit sm:h-9"
                          onClick={() => void handleCopyMessage(offerMessage)}
                        >
                          <Copy className="size-4" aria-hidden="true" />
                          Salin Pesan
                        </Button>
                      </div>
                    ) : null}
                  </>
                ) : app.offerStatus === "PENDING" ? (
                  <>
                    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                      <p className="font-medium text-amber-800 dark:text-amber-300">
                        Menunggu jawaban pelamar
                      </p>
                      <p className="text-muted-foreground">
                        Gaji: <span className="text-foreground">{app.offerSalary ?? "-"}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Jenis: <span className="text-foreground">{app.offerType ?? "-"}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Mulai: <span className="text-foreground">{formatDate(app.offerStartDate)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Batas jawaban:{" "}
                        <span className="text-foreground">{formatDateTime(app.offerDeadline)}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Terkirim: <span className="text-foreground">{formatDateTime(app.offerSentAt)}</span>
                      </p>
                      {app.offerNote ? (
                        <p className="text-muted-foreground">
                          Catatan: <span className="text-foreground">{app.offerNote}</span>
                        </p>
                      ) : null}
                    </div>
                    {offerEditing ? (
                      <>
                        {offerFormFields}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            className="h-11 w-fit bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99] sm:h-9"
                            onClick={() => void handleUpdateOffer()}
                            disabled={offerWorking}
                          >
                            {offerWorking ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : null}
                            Simpan Perubahan
                          </Button>
                          <Button
                            variant="ghost"
                            className="h-11 sm:h-9"
                            onClick={() => setOfferEditing(false)}
                            disabled={offerWorking}
                          >
                            Batal
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-11 sm:h-9"
                          onClick={() => void handleResendOffer()}
                          disabled={offerWorking}
                        >
                          {offerWorking ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : null}
                          Kirim Ulang
                        </Button>
                        <Button
                          variant="outline"
                          className="h-11 sm:h-9"
                          onClick={startOfferEdit}
                          disabled={offerWorking}
                        >
                          Ubah / Perpanjang
                        </Button>
                        {/* NR-15 idea 6: email pengingat untuk offer yang belum dijawab */}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-9"
                          onClick={() => void handleRemindOffer()}
                          disabled={remindSending || offerWorking}
                        >
                          {remindSending ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <MailPlus className="size-4" aria-hidden="true" />
                          )}
                          Kirim Email Pengingat
                        </Button>
                        <AlertDialog open={offerCancelOpen} onOpenChange={setOfferCancelOpen}>
                          <Button
                            variant="outline"
                            className="h-11 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-9 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                            onClick={() => setOfferCancelOpen(true)}
                            disabled={offerWorking}
                          >
                            Batalkan Penawaran
                          </Button>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Batalkan penawaran ini?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Penawaran akan ditandai kedaluwarsa dan pelamar tidak
                                lagi bisa menjawabnya.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={offerWorking}>Batal</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={(e) => {
                                  e.preventDefault();
                                  void handleCancelOffer();
                                }}
                                className="bg-rose-600 text-white hover:bg-rose-700"
                                disabled={offerWorking}
                              >
                                {offerWorking ? "Membatalkan..." : "Ya, Batalkan"}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </>
                ) : app.offerStatus === "ACCEPTED" ? (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-400">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      Penawaran diterima pelamar
                      {app.offerRespondedAt ? ` pada ${formatDateTime(app.offerRespondedAt)}` : ""}
                      . Langkah onboarding tersedia di bawah.
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Onboarding */}
            {app.hiredAt ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ClipboardList className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Onboarding</p>
                  <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
                    {(app.onboardingDocs ?? []).filter((d) => d.done).length}/
                    {(app.onboardingDocs ?? []).length} dokumen
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <InfoItem label="Mulai Kerja">{formatDateTime(app.hiredAt)}</InfoItem>
                  <InfoItem label="Akhir Masa Percobaan">
                    {app.probationEnd ? formatDateTime(app.probationEnd) : "-"}
                  </InfoItem>
                </div>
                {(app.onboardingDocs ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Belum ada dokumen onboarding.
                  </p>
                ) : (
                  <div className="flex max-h-56 flex-col gap-1 overflow-y-auto nice-scrollbar">
                    {app.onboardingDocs.map((doc) => (
                      <div
                        key={doc.id || doc.label}
                        className="flex min-h-11 items-center gap-2.5 rounded-md px-1 py-1 text-sm"
                      >
                        <Checkbox
                          checked={doc.done}
                          disabled={!canMutate || onboardingSaving}
                          onCheckedChange={() => void handleToggleDoc(doc.id)}
                          aria-label={`Tandai dokumen ${doc.label}`}
                        />
                        <span className={cn("min-w-0 flex-1 truncate", doc.done && "text-muted-foreground line-through")}>
                          {doc.label}
                          {doc.required ? (
                            <span className="ml-1 text-rose-500" aria-hidden="true">
                              *
                            </span>
                          ) : null}
                        </span>
                        {doc.fileId ? (
                          <a
                            href={`/api/files/${doc.fileId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                          >
                            Unduh
                          </a>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
                {canMutate ? (
                  <form onSubmit={handleAddDoc} className="flex flex-col gap-1.5">
                    <Label htmlFor="onboarding-doc-input">Tambah Dokumen</Label>
                    <Input
                      id="onboarding-doc-input"
                      value={docInput}
                      onChange={(e) => setDocInput(e.target.value)}
                      placeholder="mis. Kontrak Kerja — tekan Enter untuk menambah"
                      className="h-11 sm:h-10"
                      maxLength={120}
                      disabled={onboardingSaving}
                    />
                  </form>
                ) : null}
              </div>
            ) : null}

            <Separator />

            {/* Diskusi tim (Task 20-a) */}
            <TeamDiscussion key={app.id} applicationId={app.id} canMutate={canMutate} />

            {/* Pertanyaan pelamar dari halaman Cek Status (NR-15, idea 10).
                Key dibedakan dari TeamDiscussion (sibling) agar React tidak
                menyangka ada dua anak dengan key sama. Anchor #nr24-candidate-questions
                dipakai badge Kotak Masuk Terpadu untuk scroll ke panel ini. */}
            <div id="nr24-candidate-questions" className="scroll-mt-4">
              <CandidateQuestions key={`q-${app.id}`} applicationId={app.id} canMutate={canMutate} />
            </div>

            <Separator />

            {/* NR-24-b (ide 5) — log panggilan telepon */}
            <CallLogSection key={`call-${app.id}`} applicationId={app.id} canMutate={canMutate} />

            {/* NR-24-b (ide 6) — tugas uji / assessment */}
            <AssessmentSection key={`asg-${app.id}`} applicationId={app.id} canMutate={canMutate} />

            {/* NR-24-b (ide 11) — dokumen internal (hanya admin) */}
            <InternalDocsSection key={`idoc-${app.id}`} applicationId={app.id} canMutate={canMutate} />

            {/* NR-24-b (ide 10) — kotak masuk terpadu (email + pertanyaan + panggilan) */}
            <UnifiedInboxSection
              key={`inbox-${app.id}`}
              applicationId={app.id}
              onGotoQuestions={scrollToCandidateQuestions}
            />

            <Separator />

            {/* NR-24 fitur 9 + 10 — riwayat panggilan & inbox terpadu */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <CallLogSection key={`calls-${app.id}`} applicationId={app.id} canMutate={canMutate} />
              <InboxSection key={`inbox-${app.id}`} applicationId={app.id} />
            </div>

            <Separator />

            {/* Timeline */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Riwayat Aktivitas</h4>
              <ActivityTimeline key={app.id} applicationId={app.id} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-4 sm:justify-between">
          {canMutate ? (
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Button
                variant="destructive"
                className="h-11 sm:h-9"
                onClick={() => setConfirmOpen(true)}
                disabled={deleting || saving}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Hapus
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus lamaran ini?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tindakan tidak bisa dibatalkan.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleting}>Batal</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault();
                      void handleDelete();
                    }}
                    className="bg-rose-600 text-white hover:bg-rose-700"
                    disabled={deleting}
                  >
                    {deleting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Menghapus...
                      </>
                    ) : (
                      "Ya, Hapus"
                    )}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <span />
          )}

          {canMutate ? (
            <Button
              onClick={() => void handleSave()}
              disabled={saving || deleting}
              className="h-11 active:scale-[0.99] sm:h-9"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : (
                "Simpan Perubahan"
              )}
            </Button>
          ) : null}
        </DialogFooter>

        {/* Dialog sesi wawancara: mode detail/edit & mode create */}
        <InterviewSessionDialog
          open={!!sessionDetail}
          onOpenChange={(open) => {
            if (!open) setSessionDetail(null);
          }}
          interview={sessionDetail}
          create={null}
          position={pos}
          onSaved={handleSessionSaved}
          onDeleted={handleSessionDeleted}
        />
        <InterviewSessionDialog
          open={sessionCreateOpen}
          onOpenChange={(open) => {
            if (!open) setSessionCreateOpen(false);
          }}
          interview={null}
          create={{
            applicationId: app.id,
            applicationName: app.name,
            positionTitle: app.positionTitle,
            position: pos,
          }}
          position={pos}
          resetKey={createNonce}
          onSaved={handleSessionSaved}
          onDeleted={handleSessionDeleted}
        />
      </DialogContent>
    </Dialog>
  );
}
