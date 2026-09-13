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
  ClipboardCheck,
  ClipboardList,
  Copy,
  FileText,
  Globe,
  Handshake,
  Link2,
  ListChecks,
  Loader2,
  MapPin,
  Megaphone,
  MessageSquareText,
  Send,
  Share2,
  Tag,
  Trash2,
  Users,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  POSITION_TYPES,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  ROLE_LABELS,
  type Application,
  type Interview,
  type Position,
  type RejectionReason,
  type Role,
  type StageKey,
  type LogEntry,
} from "@/lib/types";
import { DEFAULT_STAGES, stageLabel, stagesForPosition } from "@/lib/stages";
import { fillTemplate } from "@/components/landing/landing-utils";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import {
  actionLabel,
  actorBadgeClass,
  copyText,
  formatDate,
  formatDateTime,
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

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm break-words">{children}</div>
    </div>
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

export function ApplicationDetailDialog({
  application,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  application: Application | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (app: Application) => void;
  onDeleted: (id: string) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
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
    setOnboardingSaving(false);
    setDocInput("");
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

  const rubricCriteria = pos?.rubricCriteria ?? [];
  const checklistTemplate = pos?.checklistTemplate ?? [];
  const noteTemplates = pos?.noteTemplates ?? [];
  const replyTemplates = pos?.replyTemplates ?? null;

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

  async function handleAddTag(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const tag = tagInput.trim();
    if (!tag || tagsSaving) return;
    if (app.tags.includes(tag)) {
      toast.error("Tag sudah ada.");
      return;
    }
    setTagsSaving(true);
    const updated = await patch({ tags: [...app.tags, tag] }, "Tag ditambahkan");
    if (updated) setTagInput("");
    setTagsSaving(false);
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
                  </div>
                ) : null}
                {/* Dokumen wajib tambahan yang diunggah pelamar (customDocs posisi) */}
                {app.extraDocs.map((doc) => (
                  <div key={doc.fileId} className="flex items-center gap-2">
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
                ))}
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

            {/* Pengalaman & Alasan */}
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
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="Tambah tag lalu tekan Enter"
                      aria-label="Tambah tag baru"
                      className="h-9 w-full sm:w-64"
                      disabled={tagsSaving}
                    />
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

            {/* Tolak Lamaran */}
            {canMutate && (app.status !== "REJECTED" || rejectMessage) ? (
              <div className="flex flex-col gap-3 rounded-lg border border-rose-200 p-3 dark:border-rose-900">
                <div className="flex items-center gap-2">
                  <XCircle className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  <p className="text-sm font-semibold">Tolak Lamaran</p>
                </div>

                {app.status === "REJECTED" ? (
                  <p className="text-sm text-muted-foreground">
                    Ditolak {formatDate(app.rejectedAt)}
                    {app.rejectionReason
                      ? ` — ${REJECTION_REASON_LABELS[app.rejectionReason]}`
                      : ""}
                    {app.rejectionNote ? ` · ${app.rejectionNote}` : ""}
                  </p>
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
