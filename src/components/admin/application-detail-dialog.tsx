"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileDown,
  FileText,
  FolderLock,
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
  ShieldAlert,
  Star,
  StickyNote,
  Tag,
  Trash2,
  Upload,
  UserX,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
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
  type InboxItem,
  type InternalDoc,
  type Interview,
  type Position,
  type RejectionReason,
  type Role,
  type StageKey,
  type LogEntry,
  type VideoNote,
} from "@/lib/types";
import {
  isExperienceEnabled,
  isFormSchemaActive,
  isMotivationEnabled,
  type FormAnswerValue,
} from "@/lib/form-schema";
import { DEFAULT_STAGES, stageLabel, stagesForPosition } from "@/lib/stages";
import { fillTemplate } from "@/components/landing/landing-utils";
import { ApiError, apiDelete, apiFetch, apiGet, apiPatch, apiPost, apiPut } from "./api";
import {
  actionLabel,
  actorBadgeClass,
  copyText,
  formatDate,
  formatDateTime,
  formatRelative,
  formatShortDateTime,
  localInputToIso,
  normalizeUrl,
  waHref,
} from "./format";
import { StatusBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { AiPanel } from "./ai-panel";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
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

const rupiahFmt = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/** Format angka rupiah tanpa desimal, mis. 3500000 -> "Rp 3.500.000". */
function formatRupiah(value: number): string {
  return rupiahFmt.format(value);
}

/** Konversi nilai <input type="date"> "YYYY-MM-DD" -> ISO akhir hari Jakarta (UTC+7). */
function dateToEndOfDayIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T23:59:59+07:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Konversi ISO -> "YYYY-MM-DD" zona lokal (untuk nilai <input type="date">). */
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Selisih hari (integer) dari hari ini ke "YYYY-MM-DD"; negatif berarti sudah lewat. */
function daysUntil(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  return Number.isNaN(diff) ? null : diff;
}

const CALL_RESULT_LABELS: Record<CallLog["result"], string> = {
  DIANGGAT: "Dianggat",
  TIDAK_DIANGGAT: "Tidak Dianggat",
  SALAH_SAMBUNGAN: "Salah Sambungan",
};

/** Warna chip hasil panggilan: DIANGGAT emerald, TIDAK_DIANGGAT rose, SALAH_SAMBUNGAN zinc. */
function callResultChipClass(result: CallLog["result"]): string {
  switch (result) {
    case "DIANGGAT":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400";
    case "TIDAK_DIANGGAT":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400";
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300";
  }
}

const ASSESSMENT_STATUS_META: Record<
  Assessment["status"],
  { label: string; cls: string }
> = {
  SENT: {
    label: "Dikirim",
    cls: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300",
  },
  SUBMITTED: {
    label: "Dikumpul",
    cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400",
  },
  LATE: {
    label: "Terlambat",
    cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
  },
};

/** Label status riwayat lamaran untuk kartu riwayat (fallback teks mentah). */
function historyStatusLabel(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
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

/* ------------------ NR-24-b — Log Panggilan (ide 5) ------------------ */

// Riwayat panggilan telepon ke pelamar. key={applicationId} dari pemanggil
// agar state reset & data di-refetch saat kandidat berganti.
function CallLogSection({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<CallLog["result"]>("DIANGGAT");
  const [summary, setSummary] = useState("");
  const [sending, setSending] = useState(false);

  const loadCalls = useCallback(async () => {
    try {
      const res = await apiGet<{ calls: CallLog[] }>(
        `/api/admin/applications/${applicationId}/calls`
      );
      setCalls(res.calls ?? []);
    } catch {
      // Panel pelengkap; biarkan kosong tanpa toast saat gagal.
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    setLoading(true);
    void loadCalls();
  }, [loadCalls]);

  async function handleAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const text = summary.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await apiPost<{ call: CallLog }>(
        `/api/admin/applications/${applicationId}/calls`,
        { result, summary: text }
      );
      toast.success("Panggilan dicatat");
      setSummary("");
      setResult("DIANGGAT");
      await loadCalls();
    } catch (err) {
      reportError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Phone className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Log Panggilan</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {calls.length}
        </span>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat log panggilan...
        </p>
      ) : calls.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Belum ada catatan panggilan.</p>
      ) : (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
          {calls.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 rounded-lg bg-muted/50 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", callResultChipClass(c.result))}>
                  {CALL_RESULT_LABELS[c.result] ?? c.result}
                </Badge>
                <span className="text-xs font-semibold">{c.actor}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatShortDateTime(c.createdAt)}
                </span>
              </div>
              {c.summary ? (
                <p className="text-sm whitespace-pre-wrap">{c.summary}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {canMutate ? (
        <form onSubmit={handleAdd} className="flex flex-col gap-2 border-t pt-2">
          <Select
            value={result}
            onValueChange={(v) => setResult(v as CallLog["result"])}
            disabled={sending}
          >
            <SelectTrigger className="h-11 w-full sm:h-9 sm:w-48" aria-label="Hasil panggilan">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CALL_RESULT_LABELS) as CallLog["result"][]).map((r) => (
                <SelectItem key={r} value={r}>
                  {CALL_RESULT_LABELS[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Ringkasan hasil panggilan..."
            rows={2}
            maxLength={500}
            disabled={sending}
            aria-label="Ringkasan hasil panggilan"
          />
          <Button
            type="submit"
            size="sm"
            className="h-9 w-fit active:scale-[0.99]"
            disabled={sending || !summary.trim()}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Phone className="size-4" aria-hidden="true" />
            )}
            Catat Panggilan
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Hanya Owner/HR yang dapat mencatat panggilan.</p>
      )}
    </div>
  );
}

/* ------------------ NR-24-b — Tugas Uji / Assessment (ide 6) ------------------ */

type AssessmentDraft = {
  status: Assessment["status"];
  score: string;
  feedback: string;
};

// Daftar tes/asesmen untuk pelamar + penilaian per item. key={applicationId} dari pemanggil.
function AssessmentSection({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [items, setItems] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, AssessmentDraft>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [sending, setSending] = useState(false);

  const loadAssessments = useCallback(async () => {
    try {
      const res = await apiGet<{ assessments: Assessment[] }>(
        `/api/admin/applications/${applicationId}/assessments`
      );
      const rows = res.assessments ?? [];
      setItems(rows);
      setDrafts(
        Object.fromEntries(
          rows.map((a) => [
            a.id,
            { status: a.status, score: a.score != null ? String(a.score) : "", feedback: a.feedback ?? "" },
          ])
        )
      );
    } catch {
      // Panel pelengkap; biarkan kosong tanpa toast saat gagal.
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    setLoading(true);
    void loadAssessments();
  }, [loadAssessments]);

  function updateDraft(id: string, patchDraft: Partial<AssessmentDraft>) {
    setDrafts((prev) => ({
      ...prev,
      [id]: { status: "SENT", score: "", feedback: "", ...prev[id], ...patchDraft },
    }));
  }

  async function handleUpdate(a: Assessment) {
    const d = drafts[a.id];
    if (!d || savingId) return;
    const scoreRaw = d.score.trim();
    let score: number | null = null;
    if (scoreRaw !== "") {
      score = Number(scoreRaw);
      if (!Number.isInteger(score) || score < 0 || score > 100) {
        toast.error("Skor harus angka bulat 0–100.");
        return;
      }
    }
    setSavingId(a.id);
    try {
      await apiPatch<{ assessment: Assessment }>(`/api/admin/assessments/${a.id}`, {
        status: d.status,
        score,
        feedback: d.feedback.trim() || null,
      });
      toast.success("Tugas uji diperbarui");
      await loadAssessments();
    } catch (err) {
      reportError(err);
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const t = title.trim();
    if (!t || sending) return;
    if (t.length > 120) {
      toast.error("Judul tugas maksimal 120 karakter.");
      return;
    }
    const dueIso = dueAt ? dateToEndOfDayIso(dueAt) : null;
    if (dueAt && !dueIso) {
      toast.error("Tanggal tenggat tidak valid.");
      return;
    }
    setSending(true);
    try {
      await apiPost<{ assessment: Assessment }>(
        `/api/admin/applications/${applicationId}/assessments`,
        {
          title: t,
          link: link.trim() || undefined,
          dueAt: dueIso ?? undefined,
        }
      );
      toast.success("Tugas uji terkirim");
      setTitle("");
      setLink("");
      setDueAt("");
      await loadAssessments();
    } catch (err) {
      reportError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Tugas Uji</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {items.length}
        </span>
      </div>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat tugas uji...
        </p>
      ) : items.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Belum ada tugas uji untuk pelamar ini.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((a) => {
            const meta = ASSESSMENT_STATUS_META[a.status];
            const d = drafts[a.id];
            const saving = savingId === a.id;
            return (
              <div key={a.id} className="flex flex-col gap-2 rounded-lg bg-muted/50 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{a.title}</span>
                  <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", meta.cls)}>
                    {meta.label}
                  </Badge>
                  {a.dueAt ? (
                    <span className="text-[11px] text-muted-foreground">
                      Tenggat: {formatDate(a.dueAt)}
                    </span>
                  ) : null}
                  {a.link ? (
                    <a
                      href={normalizeUrl(a.link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                    >
                      <ExternalLink className="size-3" aria-hidden="true" />
                      Buka tautan
                    </a>
                  ) : null}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {formatShortDateTime(a.createdAt)}
                  </span>
                </div>
                {a.score != null ? (
                  <p className="text-sm tabular-nums">
                    Skor: <span className="font-semibold">{a.score}</span>
                  </p>
                ) : null}
                {a.feedback ? (
                  <p className="text-sm whitespace-pre-wrap text-muted-foreground">{a.feedback}</p>
                ) : null}
                {a.submittedAt ? (
                  <p className="text-[11px] text-muted-foreground">
                    Dikumpul {formatShortDateTime(a.submittedAt)}
                  </p>
                ) : null}
                {canMutate && d ? (
                  <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
                    <Select
                      value={d.status}
                      onValueChange={(v) => updateDraft(a.id, { status: v as Assessment["status"] })}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-11 w-36 sm:h-9" aria-label={`Status tugas ${a.title}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(ASSESSMENT_STATUS_META) as Assessment["status"][]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {ASSESSMENT_STATUS_META[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      inputMode="numeric"
                      value={d.score}
                      onChange={(e) => updateDraft(a.id, { score: e.target.value })}
                      placeholder="Skor"
                      aria-label={`Skor tugas ${a.title}`}
                      className="h-11 w-20 sm:h-9"
                      disabled={saving}
                    />
                    <Input
                      value={d.feedback}
                      onChange={(e) => updateDraft(a.id, { feedback: e.target.value })}
                      placeholder="Feedback (opsional)"
                      aria-label={`Feedback tugas ${a.title}`}
                      maxLength={500}
                      className="h-11 min-w-40 flex-1 sm:h-9"
                      disabled={saving}
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-11 sm:h-9"
                      onClick={() => void handleUpdate(a)}
                      disabled={saving}
                    >
                      {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                      Simpan
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {canMutate ? (
        <form onSubmit={handleCreate} className="flex flex-col gap-2 border-t pt-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Judul tugas (mis. Tes Desain 2 jam)"
              aria-label="Judul tugas uji"
              maxLength={120}
              className="h-11 w-full sm:h-9 sm:flex-1"
              disabled={sending}
            />
            <Input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Link tugas (opsional)"
              aria-label="Link tugas uji"
              className="h-11 w-full sm:h-9 sm:flex-1"
              disabled={sending}
            />
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              aria-label="Tanggal tenggat tugas uji"
              className="h-11 w-full sm:h-9 sm:w-40"
              disabled={sending}
            />
          </div>
          <Button
            type="submit"
            size="sm"
            className="h-9 w-fit active:scale-[0.99]"
            disabled={sending || !title.trim()}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Kirim Tugas Uji
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted-foreground">Hanya Owner/HR yang dapat mengelola tugas uji.</p>
      )}
    </div>
  );
}

/* ------------------ NR-24-b — Dokumen Internal (ide 11) ------------------ */

// Dokumen internal lamaran — tidak pernah tampil di halaman status pelamar.
// key={applicationId} dari pemanggil agar reset saat kandidat berganti.
function InternalDocsSection({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [docs, setDocs] = useState<InternalDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InternalDoc | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    try {
      const res = await apiGet<{ docs: InternalDoc[] }>(
        `/api/admin/applications/${applicationId}/internal-docs`
      );
      setDocs(res.docs ?? []);
    } catch {
      // Panel pelengkap; biarkan kosong tanpa toast saat gagal.
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    setLoading(true);
    void loadDocs();
  }, [loadDocs]);

  async function handleUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || uploading) return;
    setUploading(true);
    try {
      // Multipart: JANGAN set Content-Type manual — biarkan browser isi boundary.
      const fd = new FormData();
      fd.set("file", file);
      fd.set("name", file.name);
      await apiFetch<{ doc: InternalDoc }>(
        `/api/admin/applications/${applicationId}/internal-docs`,
        { method: "POST", body: fd }
      );
      toast.success("Dokumen internal diunggah");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadDocs();
    } catch (err) {
      reportError(err);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/internal-docs/${deleteTarget.id}`);
      toast.success("Dokumen internal dihapus");
      setDeleteTarget(null);
      await loadDocs();
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FolderLock className="size-4 text-zinc-600 dark:text-zinc-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Dokumen Internal</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {docs.length}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Hanya tampil untuk admin — tidak pernah tampil di halaman status pelamar.
      </p>
      {loading ? (
        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat dokumen internal...
        </p>
      ) : docs.length === 0 ? (
        <p className="py-1 text-sm text-muted-foreground">Belum ada dokumen internal.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {docs.map((doc) => (
            <div key={doc.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 p-2.5">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{doc.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {doc.uploadedBy} · {formatShortDateTime(doc.createdAt)}
                </p>
              </div>
              <a
                href={`/api/files/${doc.fileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Unduh
              </a>
              {canMutate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950"
                  onClick={() => setDeleteTarget(doc)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  Hapus
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {canMutate ? (
        <form onSubmit={handleUpload} className="flex flex-col gap-2 border-t pt-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              ref={fileInputRef}
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              aria-label="Pilih berkas dokumen internal"
              className="h-11 w-full sm:h-9 sm:flex-1"
              disabled={uploading}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="h-11 w-fit sm:h-9"
              disabled={uploading || !file}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-4" aria-hidden="true" />
              )}
              Unggah
            </Button>
          </div>
        </form>
      ) : null}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus dokumen internal &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Dokumen dihapus permanen dan tidak bisa dikembalikan.
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ items: InboxItem[]; unanswered: number }>(
      `/api/admin/applications/${applicationId}/inbox`
    )
      .then((res) => {
        if (!cancelled) {
          setItems(res.items ?? []);
          setUnanswered(res.unanswered ?? 0);
        }
      })
      .catch(() => {
        // Panel pelengkap; biarkan kosong tanpa toast saat gagal.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ history: ApplicationHistoryItem[] }>(
      `/api/admin/applications/${applicationId}/history`
    )
      .then((res) => {
        if (!cancelled) setHistory(res.history ?? []);
      })
      .catch(() => {
        // Kartu pelengkap; biarkan kosong tanpa toast saat gagal.
        if (!cancelled) setHistory([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

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
  // NR-24-b — navigasi prev/next antar lamaran (opsional; tidak memecahkan pemakai lain).
  navIds,
  navIndex,
  onNavigate,
}: {
  application: Application | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (app: Application) => void;
  onDeleted: (id: string) => void;
  navIds?: string[];
  navIndex?: number;
  onNavigate?: (id: string) => void;
}) {
  const { session, role, canMutate, reportError } = useAdminSession();
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

  // NR-24-b — bintang personal, tindak lanjut, tahan proses, gaji, dokumen kedaluwarsa.
  const [starSaving, setStarSaving] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeDate, setSnoozeDate] = useState("");
  const [snoozeSaving, setSnoozeSaving] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReasonInput, setHoldReasonInput] = useState("");
  const [holdReviewInput, setHoldReviewInput] = useState("");
  const [holdSaving, setHoldSaving] = useState(false);
  const [salaryEditing, setSalaryEditing] = useState(false);
  const [salaryInput, setSalaryInput] = useState("");
  const [salarySaving, setSalarySaving] = useState(false);
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([]);
  const [docExpiryBusy, setDocExpiryBusy] = useState<string | null>(null);

  // NR-24-b — undo penolakan (pola kunci ala NR-23).
  const [undoUnlocked, setUndoUnlocked] = useState(false);
  const [undoConfirmOpen, setUndoConfirmOpen] = useState(false);
  const [undoReason, setUndoReason] = useState("");
  const [undoSaving, setUndoSaving] = useState(false);

  // NR-24-b — Do-not-Hire (match email/telepon) + penggabungan duplikat.
  const [dnhEntries, setDnhEntries] = useState<DoNotHireEntry[]>([]);
  const [dnhUnlock, setDnhUnlock] = useState(false);
  const [dnhRemoveOpen, setDnhRemoveOpen] = useState(false);
  const [dnhSaving, setDnhSaving] = useState(false);
  const [dnhAddOpen, setDnhAddOpen] = useState(false);
  const [dnhReasonInput, setDnhReasonInput] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeCandidates, setMergeCandidates] = useState<Application[]>([]);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [mergeSaving, setMergeSaving] = useState(false);
  const tagsFetchedRef = useRef(false);

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
    // NR-24-b — reset state fitur per pelamar saat berganti kandidat.
    setStarSaving(false);
    setSnoozeOpen(false);
    setSnoozeDate("");
    setSnoozeSaving(false);
    setHoldOpen(false);
    setHoldReasonInput("");
    setHoldReviewInput("");
    setHoldSaving(false);
    setSalaryEditing(false);
    setSalaryInput("");
    setSalarySaving(false);
    setDocExpiryBusy(null);
    setUndoUnlocked(false);
    setUndoConfirmOpen(false);
    setUndoReason("");
    setUndoSaving(false);
    setDnhUnlock(false);
    setDnhRemoveOpen(false);
    setDnhSaving(false);
    setDnhAddOpen(false);
    setDnhReasonInput("");
    setMergeOpen(false);
    setMergeCandidates([]);
    setMergeLoading(false);
    setMergeTargetId("");
    setMergeConfirmOpen(false);
    setMergeSaving(false);
  }, [application]);

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

  // NR-24-b — navigasi prev/next aktif hanya bila ketiga prop terisi & daftar > 1.
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
      if (!navIds || typeof navIndex !== "number" || typeof onNavigate !== "function") return;
      const next = e.key === "ArrowRight" ? navIndex + 1 : navIndex - 1;
      if (next < 0 || next >= navIds.length) return;
      onNavigate(navIds[next]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navActive, application, navIds, navIndex, onNavigate, sessionDetail, sessionCreateOpen]);

  // NR-24-b — suggesi tag: cache sekali per mount dialog.
  useEffect(() => {
    if (tagsFetchedRef.current) return;
    tagsFetchedRef.current = true;
    apiGet<{ tags: string[] }>("/api/admin/tags")
      .then((res) => {
        setTagSuggestions(Array.isArray(res.tags) ? res.tags : []);
      })
      .catch(() => {
        // Suggesi bersifat pelengkap; abaikan kegagalan.
      });
  }, []);

  // NR-24-b — daftar Do-not-Hire: muat saat dialog terbuka / kandidat berganti.
  useEffect(() => {
    if (!applicationId) return;
    let cancelled = false;
    apiGet<{ entries: DoNotHireEntry[] }>("/api/admin/donothire")
      .then((res) => {
        if (!cancelled) setDnhEntries(res.entries ?? []);
      })
      .catch(() => {
        if (!cancelled) setDnhEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (!application) return null;

  const app = application;
  const pos = position;

  // Opsi tahap mengikuti pipeline posisi terkait; fallback ke 5 bawaan.
  const positionStages = pos ? stagesForPosition(pos.stages) : [...DEFAULT_STAGES];
  const stageChoices =
    editStatus && !positionStages.includes(editStatus)
      ? [editStatus, ...positionStages]
      : positionStages;

  const screeningQuestions = pos?.screeningQuestions ?? [];
  const screeningAnswers = app.screeningAnswers ?? {};
  const showScreening = screeningQuestions.length > 0 && app.screeningAnswers != null;

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
  const showExperienceBlock = !(
    formSchemaActive &&
    !experienceCoreEnabled &&
    !motivationCoreEnabled &&
    app.experience.trim() === "" &&
    app.motivation.trim() === ""
  );

  const rubricCriteria = pos?.rubricCriteria ?? [];
  const checklistTemplate = pos?.checklistTemplate ?? [];
  const noteTemplates = pos?.noteTemplates ?? [];
  const replyTemplates = pos?.replyTemplates ?? null;

  // Catatan video intro urut berdasarkan detik (Task 27-e).
  const videoNotes = [...(app.videoNotes ?? [])].sort((a, b) => a.t - b.t);

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

  // Ekspektasi gaji vs rentang gaji posisi (salaryMin/salaryMax).
  const expectedSalary = app.expectedSalary;
  const salaryMin = pos?.salaryMin ?? null;
  const salaryMax = pos?.salaryMax ?? null;
  const salaryBadge =
    expectedSalary != null && (salaryMin != null || salaryMax != null)
      ? salaryMax != null && expectedSalary > salaryMax
        ? {
            label: "Di atas rentang",
            cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400",
          }
        : salaryMin != null && expectedSalary < salaryMin
          ? {
              label: "Di bawah rentang",
              cls: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300",
            }
          : {
              label: "Sesuai rentang",
              cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400",
            }
      : null;

  // Undo penolakan: hanya bila ditolak bukan karena menarik diri dan belum digabung.
  const canUndoReject =
    app.status === "REJECTED" &&
    app.rejectionReason !== "MENARIK_DIRI" &&
    !app.mergedIntoId;

  // Do-not-Hire: match email (lowercase) atau telepon digit-only dengan daftar DNH.
  const phoneDigits = (app.phone ?? "").replace(/[^0-9]/g, "");
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

  /* ----------------------- NR-24-b — aksi fitur per pelamar ----------------------- */

  // Bintang personal (ide 2): toggle lewat PATCH {starred} (server pakai session).
  async function handleToggleStar() {
    if (starSaving) return;
    setStarSaving(true);
    await patch({ starred: !isStarred }, isStarred ? "Bintang dilepas" : "Ditandai penting");
    setStarSaving(false);
  }

  // Tindak lanjut (ide 4): snoozeUntil ISO akhir hari Jakarta.
  function snoozePlusDays(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const pad = (n: number) => String(n).padStart(2, "0");
    setSnoozeDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
  }

  async function handleSaveSnooze() {
    const iso = dateToEndOfDayIso(snoozeDate);
    if (!iso) {
      toast.error("Tanggal tindak lanjut tidak valid.");
      return;
    }
    setSnoozeSaving(true);
    const updated = await patch({ snoozeUntil: iso }, "Tindak lanjut diatur");
    if (updated) {
      setSnoozeOpen(false);
      setSnoozeDate("");
    }
    setSnoozeSaving(false);
  }

  async function handleClearSnooze() {
    setSnoozeSaving(true);
    await patch({ snoozeUntil: null }, "Tindak lanjut dihapus");
    setSnoozeSaving(false);
  }

  // Tahan proses (ide 8): holdReason ≤300 + tanggal review opsional.
  async function handleSetHold() {
    const reason = holdReasonInput.trim();
    if (!reason) {
      toast.error("Isi alasan menahan proses.");
      return;
    }
    if (reason.length > 300) {
      toast.error("Alasan maksimal 300 karakter.");
      return;
    }
    const reviewIso = holdReviewInput ? dateToEndOfDayIso(holdReviewInput) : null;
    if (holdReviewInput && !reviewIso) {
      toast.error("Tanggal review tidak valid.");
      return;
    }
    setHoldSaving(true);
    const updated = await patch(
      { holdReason: reason, holdReviewAt: reviewIso },
      "Proses ditahan (HOLD)"
    );
    if (updated) {
      setHoldOpen(false);
      setHoldReasonInput("");
      setHoldReviewInput("");
    }
    setHoldSaving(false);
  }

  async function handleReleaseHold() {
    setHoldSaving(true);
    await patch({ holdReason: null, holdReviewAt: null }, "Tahanan proses dilepas");
    setHoldSaving(false);
  }

  // Ekspektasi gaji (ide 6): kosong = null.
  async function handleSaveSalary() {
    const raw = salaryInput.trim().replace(/[^0-9]/g, "");
    const value = raw === "" ? null : Number(raw);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      toast.error("Angka gaji tidak valid.");
      return;
    }
    setSalarySaving(true);
    const updated = await patch(
      { expectedSalary: value },
      value != null ? "Ekspektasi gaji disimpan" : "Ekspektasi gaji dikosongkan"
    );
    if (updated) setSalaryEditing(false);
    setSalarySaving(false);
  }

  // Masa berlaku dokumen (ide 13): patch merge per fileId (null = hapus).
  async function handleDocExpiry(fileId: string, value: string) {
    setDocExpiryBusy(fileId);
    await patch(
      { docExpiries: { [fileId]: value === "" ? null : value } },
      value ? "Masa berlaku dokumen disimpan" : "Masa berlaku dokumen dihapus"
    );
    setDocExpiryBusy(null);
  }

  // Undo penolakan (ide 14): POST undo-reject {reason ≤300 wajib}.
  async function handleUndoReject() {
    const reason = undoReason.trim();
    if (!reason) {
      toast.error("Isi alasan pembatalan penolakan.");
      return;
    }
    if (reason.length > 300) {
      toast.error("Alasan maksimal 300 karakter.");
      return;
    }
    setUndoSaving(true);
    try {
      const updated = await apiPost<Application>(
        `/api/admin/applications/${app.id}/undo-reject`,
        { reason }
      );
      toast.success("Penolakan dibatalkan");
      setUndoConfirmOpen(false);
      setUndoReason("");
      setUndoUnlocked(false); // kunci kembali terpasang setelah aksi
      onSaved(updated);
    } catch (err) {
      reportError(err);
    } finally {
      setUndoSaving(false);
    }
  }

  // Do-not-Hire: lepas (OWNER, pola kunci) & tandai baru (PUT {key, reason}).
  async function handleDnhRemove() {
    if (!dnhMatch || dnhSaving) return;
    setDnhSaving(true);
    try {
      await apiDelete(
        `/api/admin/donothire?key=${encodeURIComponent(dnhMatch.key)}&confirm=YA`
      );
      toast.success("Do-not-Hire dilepas");
      setDnhRemoveOpen(false);
      setDnhUnlock(false);
      setDnhEntries((prev) => prev.filter((e) => e.key !== dnhMatch.key));
    } catch (err) {
      reportError(err);
    } finally {
      setDnhSaving(false);
    }
  }

  async function handleDnhAdd(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = dnhReasonInput.trim();
    if (!reason) {
      toast.error("Isi alasan Do-not-Hire.");
      return;
    }
    if (reason.length > 300) {
      toast.error("Alasan maksimal 300 karakter.");
      return;
    }
    const key = app.email ? app.email.toLowerCase() : phoneDigits;
    if (!key) return;
    setDnhSaving(true);
    try {
      await apiPut("/api/admin/donothire", { key, reason });
      toast.success("Pelamar ditandai Do-not-Hire");
      setDnhAddOpen(false);
      setDnhReasonInput("");
      setDnhEntries((prev) => [
        ...prev.filter((e) => e.key !== key),
        { key, reason, by: session?.name ?? "-", at: new Date().toISOString() },
      ]);
    } catch (err) {
      reportError(err);
    } finally {
      setDnhSaving(false);
    }
  }

  // Gabungkan duplikat (ide 12): target = [id] di URL, sumber = lamaran ini.
  async function openMergePanel() {
    const next = !mergeOpen;
    setMergeOpen(next);
    if (!next) return;
    setMergeTargetId("");
    setMergeLoading(true);
    try {
      const rows = await apiGet<Application[]>("/api/admin/applications");
      const email = app.email.toLowerCase();
      setMergeCandidates(
        rows.filter(
          (r) =>
            r.id !== app.id &&
            (r.email ?? "").toLowerCase() === email &&
            !r.mergedIntoId &&
            !r.deletedAt &&
            r.status !== "ACCEPTED" &&
            r.status !== "COMPLETED"
        )
      );
    } catch (err) {
      reportError(err);
    } finally {
      setMergeLoading(false);
    }
  }

  async function handleMerge() {
    if (!mergeTargetId || mergeSaving) return;
    setMergeSaving(true);
    try {
      const res = await apiPost<{ ok: boolean; target: Application }>(
        `/api/admin/applications/${mergeTargetId}/merge`,
        { sourceId: app.id }
      );
      toast.success("Lamaran digabungkan");
      setMergeConfirmOpen(false);
      setMergeOpen(false);
      onSaved(res.target);
      if (onNavigate && res.target.id !== app.id) onNavigate(res.target.id);
    } catch (err) {
      reportError(err);
    } finally {
      setMergeSaving(false);
    }
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
            <span>{app.name}</span>
            <StatusBadge status={app.status} />
            {/* NR-24-b — navigasi antar lamaran (prev/next) bila prop navigasi tersedia */}
            {navActive && navIds && typeof navIndex === "number" ? (
              <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border p-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-9"
                  disabled={navIndex <= 0}
                  onClick={() => onNavigate?.(navIds[navIndex - 1])}
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
                  onClick={() => onNavigate?.(navIds[navIndex + 1])}
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
            {/* NR-24-b — banner lamaran digabung (ide 12) */}
            {app.mergedIntoId ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                <Copy className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                <span className="text-amber-800 dark:text-amber-300">
                  Lamaran ini sudah digabung ke lamaran lain.
                </span>
                {onNavigate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-11 border-amber-300 text-amber-800 hover:bg-amber-100 sm:h-8 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950"
                    onClick={() => onNavigate(app.mergedIntoId as string)}
                  >
                    Buka Lamaran Utama
                  </Button>
                ) : null}
              </div>
            ) : null}
            {/* NR-24-b — banner duplikat + panel gabung ke lamaran utama (ide 12) */}
            {!app.mergedIntoId && app.isDuplicate ? (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                <div className="flex flex-wrap items-center gap-2">
                  <Copy className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <span className="text-sm text-amber-800 dark:text-amber-300">
                    Terdeteksi kemungkinan duplikat.
                  </span>
                  {canMutate ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto h-11 border-amber-300 text-amber-800 hover:bg-amber-100 sm:h-8 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950"
                      onClick={() => void openMergePanel()}
                    >
                      {mergeOpen ? "Tutup" : "Gabungkan ke..."}
                    </Button>
                  ) : null}
                </div>
                {canMutate && mergeOpen ? (
                  <div className="flex flex-col gap-2 rounded-lg border bg-background p-2.5">
                    {mergeLoading ? (
                      <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Memuat lamaran lain...
                      </p>
                    ) : mergeCandidates.length === 0 ? (
                      <p className="py-1 text-xs text-muted-foreground">
                        Tidak ada lamaran lain dengan email yang sama yang bisa digabung.
                      </p>
                    ) : (
                      <Select
                        value={mergeTargetId || "__pilih__"}
                        onValueChange={setMergeTargetId}
                        disabled={mergeSaving}
                      >
                        <SelectTrigger className="h-11 w-full sm:h-9" aria-label="Pilih lamaran utama">
                          <SelectValue placeholder="Pilih lamaran utama" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__pilih__" disabled>
                            Pilih lamaran utama
                          </SelectItem>
                          {mergeCandidates.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.name} — {r.trackingCode} — {r.positionTitle ?? "-"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {mergeCandidates.length > 0 ? (
                      <AlertDialog open={mergeConfirmOpen} onOpenChange={setMergeConfirmOpen}>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-11 w-fit sm:h-9"
                          disabled={!mergeTargetId || mergeSaving}
                          onClick={() => setMergeConfirmOpen(true)}
                        >
                          Gabungkan
                        </Button>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Gabungkan lamaran ini ke lamaran utama?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Timeline, berkas, dan diskusi akan dipindah ke lamaran utama.
                              Lamaran ini berubah menjadi Ditolak (Lamaran ganda).
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel disabled={mergeSaving}>Batal</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => {
                                e.preventDefault();
                                void handleMerge();
                              }}
                              className="bg-rose-600 text-white hover:bg-rose-700"
                              disabled={mergeSaving}
                            >
                              {mergeSaving ? (
                                <>
                                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                  Menggabungkan...
                                </>
                              ) : (
                                "Ya, Gabungkan"
                              )}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Panel AI */}
            <AiPanel app={app} onUpdated={onSaved} />

            {/* Info grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoItem label="Email">
                <a
                  href={`mailto:${app.email}`}
                  className="hover:text-rose-600 underline-offset-2 hover:underline"
                >
                  {app.email}
                </a>
              </InfoItem>
              <InfoItem label="WhatsApp">
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
              {/* NR-24-b (ide 6) — ekspektasi gaji + perbandingan rentang posisi */}
              {app.expectedSalary != null || salaryEditing ? (
                <div className="rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Ekspektasi Gaji</p>
                    {canMutate && !salaryEditing ? (
                      <button
                        type="button"
                        className="ml-auto rounded-md p-1 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => {
                          setSalaryInput(app.expectedSalary != null ? String(app.expectedSalary) : "");
                          setSalaryEditing(true);
                        }}
                        aria-label="Ubah ekspektasi gaji"
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                  {salaryEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveSalary();
                      }}
                      className="mt-1.5 flex flex-wrap items-center gap-1.5"
                    >
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={salaryInput}
                        onChange={(e) => setSalaryInput(e.target.value)}
                        placeholder="mis. 3500000"
                        aria-label="Ekspektasi gaji dalam rupiah (kosongkan untuk menghapus)"
                        className="h-9 w-40"
                        disabled={salarySaving}
                        autoFocus
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        className="h-9"
                        disabled={salarySaving}
                      >
                        {salarySaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Simpan
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9"
                        onClick={() => setSalaryEditing(false)}
                        disabled={salarySaving}
                      >
                        Batal
                      </Button>
                    </form>
                  ) : (
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm">
                      <span className="tabular-nums">
                        {app.expectedSalary != null ? formatRupiah(app.expectedSalary) : "-"}
                      </span>
                      {salaryBadge ? (
                        <Badge variant="outline" className={cn("px-1.5 py-0 text-[10px]", salaryBadge.cls)}>
                          {salaryBadge.label}
                        </Badge>
                      ) : null}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* NR-24-b (ide 7) — riwayat melamar pelamar yang sama di Lumina */}
            <ApplicationHistoryCard
              key={`history-${app.id}`}
              applicationId={app.id}
              onNavigate={onNavigate}
            />

            {/* NR-24-b (ide 4 & 8) — tindak lanjut + tahan proses, jauh dari tombol status utama */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Clock className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Tindak Lanjut</p>
                </div>
                {app.snoozeUntil ? (
                  <Badge
                    variant="outline"
                    className="w-fit border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                  >
                    <Clock className="size-3" aria-hidden="true" />
                    Tindak lanjut: {formatDate(app.snoozeUntil)}
                    {canMutate ? (
                      <button
                        type="button"
                        onClick={() => void handleClearSnooze()}
                        aria-label="Hapus jadwal tindak lanjut"
                        disabled={snoozeSaving}
                        className="ml-0.5 outline-none hover:text-amber-900 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:hover:text-amber-300"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </Badge>
                ) : (
                  <p className="text-xs text-muted-foreground">Belum ada jadwal tindak lanjut.</p>
                )}
                {canMutate && !snoozeOpen ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-fit"
                    onClick={() => {
                      setSnoozeDate(app.snoozeUntil ? isoToDateInput(app.snoozeUntil) : "");
                      setSnoozeOpen(true);
                    }}
                  >
                    <CalendarPlus className="size-4" aria-hidden="true" />
                    Atur Tindak Lanjut
                  </Button>
                ) : null}
                {canMutate && snoozeOpen ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveSnooze();
                    }}
                    className="flex flex-col gap-1.5"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input
                        type="date"
                        value={snoozeDate}
                        onChange={(e) => setSnoozeDate(e.target.value)}
                        aria-label="Tanggal tindak lanjut"
                        className="h-9 min-w-36 flex-1"
                        disabled={snoozeSaving}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="h-9"
                        disabled={snoozeSaving || !snoozeDate}
                      >
                        {snoozeSaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Simpan
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9"
                        onClick={() => setSnoozeOpen(false)}
                        disabled={snoozeSaving}
                      >
                        Batal
                      </Button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => snoozePlusDays(3)}
                        disabled={snoozeSaving}
                      >
                        +3 hari
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => snoozePlusDays(7)}
                        disabled={snoozeSaving}
                      >
                        +7 hari
                      </Button>
                    </div>
                  </form>
                ) : null}
              </div>
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <PauseCircle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Tahan Proses</p>
                </div>
                {app.holdReason ? (
                  <>
                    <Badge
                      variant="outline"
                      className="w-fit border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                    >
                      <PauseCircle className="size-3" aria-hidden="true" />
                      Ditahan: {app.holdReason}
                    </Badge>
                    {app.holdReviewAt ? (
                      <p className="text-xs text-muted-foreground">
                        Review {formatDate(app.holdReviewAt)}
                      </p>
                    ) : null}
                    {canMutate ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 w-fit"
                        onClick={() => void handleReleaseHold()}
                        disabled={holdSaving}
                      >
                        {holdSaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Lepas Tahanan
                      </Button>
                    ) : null}
                  </>
                ) : canMutate && !holdOpen ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 w-fit"
                    onClick={() => {
                      setHoldReasonInput("");
                      setHoldReviewInput("");
                      setHoldOpen(true);
                    }}
                  >
                    <PauseCircle className="size-4" aria-hidden="true" />
                    Tahan Proses
                  </Button>
                ) : canMutate ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSetHold();
                    }}
                    className="flex flex-col gap-1.5"
                  >
                    <Textarea
                      value={holdReasonInput}
                      onChange={(e) => setHoldReasonInput(e.target.value)}
                      placeholder="Alasan menahan proses (maks. 300)"
                      aria-label="Alasan menahan proses"
                      rows={2}
                      maxLength={300}
                      disabled={holdSaving}
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Input
                        type="date"
                        value={holdReviewInput}
                        onChange={(e) => setHoldReviewInput(e.target.value)}
                        aria-label="Tanggal review ulang (opsional)"
                        className="h-9 min-w-36 flex-1"
                        disabled={holdSaving}
                      />
                      <Button
                        type="submit"
                        size="sm"
                        className="h-9"
                        disabled={holdSaving || !holdReasonInput.trim()}
                      >
                        {holdSaving ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : null}
                        Tahan
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-9"
                        onClick={() => setHoldOpen(false)}
                        disabled={holdSaving}
                      >
                        Batal
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="text-xs text-muted-foreground">Proses tidak ditahan.</p>
                )}
              </div>
            </div>

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
                    NR-24-b (ide 13): masa berlaku dokumen per fileId (docExpiries). */}
                {app.extraDocs.map((doc) => {
                  const expiry = app.docExpiries?.[doc.fileId] ?? "";
                  const expiryDays = expiry ? daysUntil(expiry) : null;
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
                      <div className="flex flex-wrap items-center gap-2 pl-6">
                        <span className="text-xs text-muted-foreground">Masa berlaku:</span>
                        {canMutate ? (
                          <Input
                            type="date"
                            value={expiry}
                            onChange={(e) => void handleDocExpiry(doc.fileId, e.target.value)}
                            disabled={docExpiryBusy === doc.fileId}
                            aria-label={`Masa berlaku dokumen ${doc.label}`}
                            className="h-8 w-40"
                          />
                        ) : expiry ? (
                          <span className="text-xs tabular-nums">{formatDate(expiry)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                        {expiryDays != null && expiryDays < 0 ? (
                          <Badge
                            variant="outline"
                            className="px-1.5 py-0 text-[10px] border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
                          >
                            Kedaluwarsa
                          </Badge>
                        ) : expiryDays != null && expiryDays <= 30 ? (
                          <Badge
                            variant="outline"
                            className="px-1.5 py-0 text-[10px] border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                          >
                            Segera habis
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

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
                  <h4 className="mb-1 text-sm font-semibold">Pengalaman</h4>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {app.experience || "-"}
                  </p>
                </div>
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Alasan Bergabung</h4>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {app.motivation || "-"}
                  </p>
                </div>
              </div>
            ) : null}

            {/* Rubrik evaluasi */}
            {rubricCriteria.length > 0 ? (
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

            {/* Checklist evaluasi */}
            {checklistTemplate.length > 0 ? (
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

              <div className="flex flex-col gap-2">
                <Label htmlFor={`tags-${app.id}`} className="text-sm">Tags</Label>
                {app.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {app.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
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
                  <form onSubmit={handleAddTag} className="flex items-center gap-2">
                    <Input
                      id={`tags-${app.id}`}
                      value={tagInput}
                      onChange={(e) => handleTagInputChange(e.target.value)}
                      list={`tag-suggestions-${app.id}`}
                      placeholder="Tambah tag — Enter atau koma"
                      aria-label="Tambah tag baru"
                      className="h-9 w-full sm:w-64"
                      disabled={tagsSaving}
                    />
                    {/* NR-24-b (ide 3): datalist suggesi tag dari GET /api/admin/tags */}
                    <datalist id={`tag-suggestions-${app.id}`}>
                      {tagSuggestions
                        .filter((s) => !app.tags.includes(s))
                        .map((s) => (
                          <option key={s} value={s} />
                        ))}
                    </datalist>
                  </form>
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

            {/* Tolak Lamaran — NR-24-b: panel juga tampil utk REJECTED yang masih bisa di-undo */}
            {showRejectPanel ? (
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
                    {/* NR-24-b (ide 14) — undo penolakan dengan pola KUNCI ala NR-23:
                        terkunci default -> buka kunci -> AlertDialog konfirmasi. */}
                    {canUndoReject ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setUndoUnlocked((v) => !v)}
                              aria-label={
                                undoUnlocked
                                  ? "Kunci kembali"
                                  : "Buka kunci untuk membatalkan penolakan"
                              }
                              className={cn(
                                "flex size-8 items-center justify-center rounded-md border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                                undoUnlocked
                                  ? "border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400 dark:hover:bg-amber-950"
                                  : "text-muted-foreground hover:bg-accent"
                              )}
                            >
                              {undoUnlocked ? (
                                <LockOpen className="size-3.5" aria-hidden="true" />
                              ) : (
                                <Lock className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {undoUnlocked
                              ? "Kunci kembali"
                              : "Buka kunci dulu untuk membatalkan penolakan"}
                          </TooltipContent>
                        </Tooltip>
                        <AlertDialog
                          open={undoConfirmOpen}
                          onOpenChange={setUndoConfirmOpen}
                        >
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                            disabled={!undoUnlocked || undoSaving}
                            onClick={() => setUndoConfirmOpen(true)}
                          >
                            Batalkan Penolakan
                          </Button>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Batalkan penolakan {app.name}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Status akan kembali ke tahap sebelum penolakan dan pelamar
                                menerima email pembaruan.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <div className="flex flex-col gap-1.5">
                              <Label htmlFor="undo-reject-reason">
                                Alasan pembatalan (wajib)
                              </Label>
                              <Textarea
                                id="undo-reject-reason"
                                value={undoReason}
                                onChange={(e) => setUndoReason(e.target.value)}
                                placeholder="mis. Pelamar melanjutkan proses setelah konfirmasi"
                                rows={2}
                                maxLength={300}
                                disabled={undoSaving}
                              />
                            </div>
                            <AlertDialogFooter>
                              <AlertDialogCancel disabled={undoSaving}>
                                Batal
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={(e) => {
                                  e.preventDefault();
                                  void handleUndoReject();
                                }}
                                className="bg-rose-600 text-white hover:bg-rose-700"
                                disabled={undoSaving || !undoReason.trim()}
                              >
                                {undoSaving ? (
                                  <>
                                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                                    Membatalkan...
                                  </>
                                ) : (
                                  "Ya, Batalkan Penolakan"
                                )}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    ) : null}
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
                            Status lamaran berubah menjadi Ditolak dan tidak bisa
                            dikembalikan ke tahap sebelumnya.
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
                menyangka ada dua anak dengan key sama. */}
            <CandidateQuestions key={`q-${app.id}`} applicationId={app.id} canMutate={canMutate} />

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
