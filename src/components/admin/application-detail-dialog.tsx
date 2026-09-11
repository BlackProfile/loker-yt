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
  Share2,
  Tag,
  Trash2,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  POSITION_TYPES,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type Application,
  type Interview,
  type Position,
  type RejectionReason,
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

  // Panel Tolak Lamaran.
  const [rejectReason, setRejectReason] = useState<RejectionReason | "">("");
  const [rejectNote, setRejectNote] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState(false);
  const [rejectConfirmOpen, setRejectConfirmOpen] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectMessage, setRejectMessage] = useState<string | null>(null);

  // Panel Penawaran (form & edit inline memakai state yang sama).
  const [offerForm, setOfferForm] = useState({
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

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-lg font-bold">
            <span>{app.name}</span>
            <StatusBadge status={app.status} />
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

            {/* Jadwal wawancara */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <CalendarClock className="size-4 text-orange-500" aria-hidden="true" />
                <p className="text-sm font-semibold">Jadwal Wawancara</p>
              </div>
              {app.interviewAt ? (
                <p className="mb-2 text-sm text-muted-foreground">
                  Terjadwal:{" "}
                  <span className="font-medium text-foreground">
                    {formatDateTime(app.interviewAt)}
                  </span>
                </p>
              ) : (
                <p className="mb-2 text-sm text-muted-foreground">
                  Belum ada jadwal.
                </p>
              )}
              {canMutate ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={interviewInput}
                    onChange={(e) => setInterviewInput(e.target.value)}
                    aria-label="Atur tanggal dan jam wawancara"
                    className="h-9 w-fit"
                  />
                  <Button
                    size="sm"
                    className="h-11 sm:h-9"
                    onClick={() => void handleSaveInterview()}
                    disabled={savingInterview}
                  >
                    {savingInterview ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Simpan Jadwal
                  </Button>
                  {app.interviewAt ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => void handleClearInterview()}
                      disabled={savingInterview}
                      aria-label="Hapus jadwal wawancara"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Berkas */}
            {app.cvFileId || app.introFileId ? (
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
      </DialogContent>
    </Dialog>
  );
}
