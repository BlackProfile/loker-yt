"use client";

// Tab Pipeline — fitur admin dikelompokkan PER KATEGORI & PER LOWONGAN:
//   Ditinjau → seleksi lamaran (CV, AI, rating, catatan, pindah tahap, tolak)
//   Wawancara → jadwal Zoom/Meet/onsite multi-ronde, scorecard, reminder
//   Diterima → penawaran (offer), jawaban pelamar, onboarding & masa percobaan
//   Ditolak → alasan terstruktur, talent pool, cooldown lamar ulang, pulihkan
// Setiap kategori punya daftar fitur ("Fitur tahap ini") dan kartu kandidat
// dengan aksi cepat yang relevan — supaya alur kerja HR jadi jelas & mudah.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FileText,
  Inbox,
  Lightbulb,
  Loader2,
  MapPin,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Star,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_RECOMMENDATION_LABELS,
  OFFER_STATUS_LABELS,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type Application,
  type Interview,
  type OfferStatus,
  type Position,
  type RejectionReason,
  type StageCategory,
  type StageKey,
} from "@/lib/types";
import {
  categoryForStage,
  stageLabel,
  stagesForCategory,
  stagesForPosition,
} from "@/lib/stages";
import { apiGet, apiPatch, apiPost } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, initialsOf } from "./format";
import { Reveal } from "./motion-primitives";
import { StatusBadge, AiScoreBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApplicationDetailDialog } from "./application-detail-dialog";
import {
  InterviewSessionDialog,
  InterviewStatusChip,
  type InterviewCreateContext,
} from "./interview-session-dialog";
import { QuickRejectDialog } from "./quick-reject-dialog";
import { OfferDialog } from "./offer-dialog";

/* ------------------------------- Konstanta UI ------------------------------- */

type CategoryMeta = {
  icon: LucideIcon;
  label: string;
  desc: string;
  activeBorder: string;
  activeBg: string;
  activeText: string;
  chip: string;
  features: string[];
};

const CATEGORY_META: Record<StageCategory, CategoryMeta> = {
  REVIEW: {
    icon: Eye,
    label: "Ditinjau",
    desc: "Seleksi kandidat dari lamaran masuk sebelum diwawancarai.",
    activeBorder: "border-amber-300 dark:border-amber-700",
    activeBg: "bg-amber-50 dark:bg-amber-950/40",
    activeText: "text-amber-700 dark:text-amber-400",
    chip: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
    features: [
      "Pratinjau CV, portofolio & jawaban screening (di detail)",
      "Screening AI: skor, ringkasan & rekomendasi",
      "Rating bintang & tag kandidat",
      "Catatan, checklist & rubrik evaluasi (di detail)",
      "Pindah tahap manual & aksi massal",
      "Tolak dengan alasan terstruktur",
    ],
  },
  INTERVIEW: {
    icon: Video,
    label: "Wawancara",
    desc: "Jadwalkan, jalankan, dan nilai wawancara multi-ronde.",
    activeBorder: "border-orange-300 dark:border-orange-700",
    activeBg: "bg-orange-50 dark:bg-orange-950/40",
    activeText: "text-orange-700 dark:text-orange-400",
    chip: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400",
    features: [
      "Jadwalkan multi-ronde: Google Meet / Zoom / Teams / onsite",
      "Link meeting + pesan undangan siap kirim",
      "Konfirmasi kehadiran & permintaan ubah jadwal pelamar",
      "Kalender wawancara & reminder otomatis",
      "Scorecard: nilai per kriteria + rekomendasi",
      "Tandai selesai / tidak hadir",
      "Lolos? Kirim penawaran langsung dari sini",
    ],
  },
  ACCEPTED: {
    icon: BadgeCheck,
    label: "Diterima",
    desc: "Penawaran, jawaban pelamar, onboarding & masa percobaan.",
    activeBorder: "border-emerald-300 dark:border-emerald-700",
    activeBg: "bg-emerald-50 dark:bg-emerald-950/40",
    activeText: "text-emerald-700 dark:text-emerald-400",
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400",
    features: [
      "Kirim penawaran: gaji, jenis, tanggal mulai & batas jawaban",
      "Pantau jawaban: menunggu / diterima / ditolak / kadaluarsa",
      "Kirim ulang (perpanjang batas) atau batalkan penawaran",
      "Checklist dokumen onboarding + unggahan pelamar",
      "Masa percobaan & surat sambutan otomatis",
    ],
  },
  REJECTED: {
    icon: XCircle,
    label: "Ditolak",
    desc: "Arsip penolakan, talent pool, dan kesempatan lamar ulang.",
    activeBorder: "border-rose-300 dark:border-rose-700",
    activeBg: "bg-rose-50 dark:bg-rose-950/40",
    activeText: "text-rose-700 dark:text-rose-400",
    chip: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400",
    features: [
      "8 kategori alasan penolakan + umpan balik opsional",
      "Pesan penolakan otomatis dari template lowongan",
      "Tandai Talent Pool untuk kandidat menjanjikan",
      "Jeda lamar ulang (cooldown) diatur per lowongan",
      "Pulihkan lamaran ke tahap tinjau bila keliru",
    ],
  },
};

const STAGE_CATEGORY_ORDER: StageCategory[] = ["REVIEW", "INTERVIEW", "ACCEPTED", "REJECTED"];

const OFFER_BADGE_CLASS: Record<OfferStatus, string> = {
  PENDING:
    "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  ACCEPTED:
    "border-transparent bg-emerald-600 text-white dark:bg-emerald-600",
  DECLINED:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  EXPIRED:
    "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
};

type ReviewSort = "newest" | "aiScore" | "rating";

/* ------------------------------- Komponen utama ------------------------------ */

type SessionTarget =
  | { mode: "create"; ctx: InterviewCreateContext }
  | { mode: "edit"; interview: Interview };

export function PipelineTab({ onNavigate }: { onNavigate?: (tab: string) => void }) {
  const { canMutate, reportError } = useAdminSession();

  const [positions, setPositions] = useState<Position[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);

  const [positionId, setPositionId] = useState<string>("");
  const [category, setCategory] = useState<StageCategory>("REVIEW");

  const [search, setSearch] = useState("");
  const [reviewSort, setReviewSort] = useState<ReviewSort>("newest");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStage, setBulkStage] = useState<string>("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<RejectionReason | "">("");
  const [bulkRejectNote, setBulkRejectNote] = useState("");

  const [detail, setDetail] = useState<Application | null>(null);
  const [sessionTarget, setSessionTarget] = useState<SessionTarget | null>(null);
  const [sessionReset, setSessionReset] = useState(0);
  const [rejectTarget, setRejectTarget] = useState<Application | null>(null);
  const [offerTarget, setOfferTarget] = useState<Application | null>(null);

  /* ------------------------------ Pemuatan data ------------------------------ */

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [pos, apps, ivs] = await Promise.all([
          apiGet<Position[]>("/api/admin/positions"),
          apiGet<Application[]>("/api/admin/applications"),
          apiGet<Interview[]>("/api/admin/interviews"),
        ]);
        setPositions(pos);
        setApplications(apps);
        setInterviews(ivs);
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Realtime: lamaran, sesi wawancara, atau posisi berubah → segarkan senyap
  // (daftar lama tetap tampil sampai data baru siap — anti-flicker).
  useLiveRefresh("applications:changed", () => void loadAll(true));
  useLiveRefresh("interviews:changed", () => void loadAll(true));
  useLiveRefresh("positions:changed", () => void loadAll(true));

  // Pilihan lowongan bertahan antar kunjungan (localStorage).
  useEffect(() => {
    if (positions.length === 0 || positionId !== "") return;
    const saved = window.localStorage.getItem("lumina.pipeline.position");
    if (saved && positions.some((p) => p.id === saved)) {
      setPositionId(saved);
    } else {
      setPositionId(positions[0].id);
    }
  }, [positions, positionId]);

  function selectPosition(id: string) {
    setPositionId(id);
    setSelectedIds(new Set());
    window.localStorage.setItem("lumina.pipeline.position", id);
  }

  const position = useMemo(
    () => positions.find((p) => p.id === positionId) ?? null,
    [positions, positionId]
  );

  /* --------------------------- Bucket per kategori --------------------------- */

  // Kandidat masuk kategori berdasar tahapnya; yang sedang menunggu/menerima
  // penawaran ikut kategori Diterima agar aksi offer & onboarding terpusat.
  const bucketOf = useCallback(
    (a: Application): StageCategory => {
      const cat = categoryForStage(a.status, position?.stageCategories);
      if (cat === "REJECTED") return "REJECTED";
      if (cat === "ACCEPTED") return "ACCEPTED";
      if (a.offerStatus === "PENDING" || a.offerStatus === "ACCEPTED") return "ACCEPTED";
      return cat;
    },
    [position]
  );

  const positionApps = useMemo(
    () => applications.filter((a) => a.positionId === positionId),
    [applications, positionId]
  );

  const buckets = useMemo(() => {
    const result: Record<StageCategory, Application[]> = {
      REVIEW: [],
      INTERVIEW: [],
      ACCEPTED: [],
      REJECTED: [],
    };
    for (const a of positionApps) result[bucketOf(a)].push(a);
    return result;
  }, [positionApps, bucketOf]);

  const stagesByCategory = useMemo(() => {
    const map: Record<StageCategory, StageKey[]> = {
      REVIEW: [],
      INTERVIEW: [],
      ACCEPTED: [],
      REJECTED: [],
    };
    if (!position) return map;
    for (const cat of STAGE_CATEGORY_ORDER) {
      map[cat] = stagesForCategory(position.stages, position.stageCategories, cat);
    }
    return map;
  }, [position]);

  const positionStages = useMemo(
    () => (position ? stagesForPosition(position.stages) : []),
    [position]
  );

  // Tahap tujuan "naik ke wawancara": tahap pertama kategori Wawancara, atau INTERVIEW.
  const interviewStageTarget: StageKey = stagesByCategory.INTERVIEW[0] ?? "INTERVIEW";
  // Tahap tujuan "pulihkan": tahap terakhir kategori Ditinjau, atau REVIEWED.
  const reviewStageTarget: StageKey =
    stagesByCategory.REVIEW[stagesByCategory.REVIEW.length - 1] ?? "REVIEWED";

  /* ---------------------------- Helper sesi & aksi --------------------------- */

  function sessionsOf(appId: string): Interview[] {
    return interviews
      .filter((i) => i.applicationId === appId)
      .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  }

  function nextSessionOf(appId: string): Interview | null {
    const active = sessionsOf(appId)
      .filter((i) => ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"].includes(i.status))
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return active[0] ?? null;
  }

  function lastSessionOf(appId: string): Interview | null {
    const all = sessionsOf(appId);
    return all[0] ?? null;
  }

  function updateApp(updated: Application) {
    setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  function openCreateSession(app: Application) {
    if (!position) return;
    setSessionReset((n) => n + 1);
    setSessionTarget({
      mode: "create",
      ctx: {
        applicationId: app.id,
        applicationName: app.name,
        positionTitle: app.positionTitle,
        position,
      },
    });
  }

  async function handleInterviewSaved(interview: Interview, application?: Application) {
    setInterviews((prev) => {
      const exists = prev.some((i) => i.id === interview.id);
      return exists
        ? prev.map((i) => (i.id === interview.id ? { ...i, ...interview } : i))
        : [...prev, interview];
    });
    if (application) updateApp(application);

    const ctx = sessionTarget?.mode === "create" ? sessionTarget.ctx : null;
    setSessionTarget(null);

    // Sesi dibuat dari kategori Ditinjau → naikkan tahap ke kategori Wawancara.
    if (ctx) {
      const app =
        application ?? applications.find((a) => a.id === ctx.applicationId) ?? null;
      if (
        app &&
        canMutate &&
        categoryForStage(app.status, position?.stageCategories) === "REVIEW" &&
        app.status !== interviewStageTarget
      ) {
        try {
          const updated = await apiPatch<Application>(
            `/api/admin/applications/${app.id}`,
            { status: interviewStageTarget }
          );
          updateApp(updated);
          toast.success(`${app.name} naik ke tahap "${stageLabel(interviewStageTarget)}"`);
        } catch (err) {
          reportError(err);
        }
      }
    }
  }

  function handleInterviewDeleted(id: string) {
    setInterviews((prev) => prev.filter((i) => i.id !== id));
    setSessionTarget(null);
    toast.success("Sesi wawancara dihapus");
  }

  async function handleStageChange(app: Application, stage: StageKey) {
    if (stage === app.status) return;
    const previous = applications;
    setApplications((prev) =>
      prev.map((a) => (a.id === app.id ? { ...a, status: stage } : a))
    );
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { status: stage }
      );
      updateApp(updated);
      toast.success(`${app.name} pindah ke tahap "${stageLabel(stage)}"`);
    } catch (err) {
      setApplications(previous);
      reportError(err);
    }
  }

  async function handleRate(app: Application, rating: number) {
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { rating }
      );
      updateApp(updated);
      toast.success(`Rating ${app.name}: ${rating}/5`);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleTalentPool(app: Application, value: boolean) {
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { talentPool: value }
      );
      updateApp(updated);
      toast.success(
        value ? `${app.name} masuk Talent Pool` : `${app.name} dikeluarkan dari Talent Pool`
      );
    } catch (err) {
      reportError(err);
    }
  }

  async function handleRestore(app: Application) {
    await handleStageChange(app, reviewStageTarget);
  }

  /* ------------------------------- Aksi massal ------------------------------- */

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const visible = filteredReview;
      if (checked) for (const a of visible) next.add(a.id);
      else for (const a of visible) next.delete(a.id);
      return next;
    });
  }

  async function runBulk(body: Record<string, unknown>, successMessage: string) {
    if (bulkWorking) return;
    setBulkWorking(true);
    try {
      const res = await apiPost<{ ok: boolean; affected: number }>(
        "/api/admin/applications/bulk",
        body
      );
      toast.success(successMessage.replace("{n}", String(res.affected)));
      setSelectedIds(new Set());
      setBulkStage("");
      await loadAll(true);
    } catch (err) {
      reportError(err);
    } finally {
      setBulkWorking(false);
    }
  }

  async function handleBulkReject() {
    if (!bulkRejectReason) {
      toast.error("Pilih alasan penolakan terlebih dahulu.");
      return;
    }
    await runBulk(
      {
        ids: Array.from(selectedIds),
        action: "reject",
        reason: bulkRejectReason,
        note: bulkRejectNote.trim() || undefined,
      },
      "{n} lamaran ditolak"
    );
    setBulkRejectOpen(false);
    setBulkRejectReason("");
    setBulkRejectNote("");
  }

  /* -------------------------------- Filterasi -------------------------------- */

  const searchLower = search.trim().toLowerCase();

  function matchesSearch(a: Application): boolean {
    if (!searchLower) return true;
    return (
      a.name.toLowerCase().includes(searchLower) ||
      a.email.toLowerCase().includes(searchLower) ||
      a.trackingCode.toLowerCase().includes(searchLower)
    );
  }

  const filteredReview = useMemo(() => {
    const list = buckets.REVIEW.filter(matchesSearch);
    const sorted = [...list];
    if (reviewSort === "aiScore") {
      sorted.sort((a, b) => (b.aiScore ?? -1) - (a.aiScore ?? -1));
    } else if (reviewSort === "rating") {
      sorted.sort((a, b) => b.rating - a.rating);
    } else {
      sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return sorted;
     
  }, [buckets.REVIEW, searchLower, reviewSort]);

  const filteredInterview = useMemo(
    () =>
      buckets.INTERVIEW
        .filter(matchesSearch)
        .sort((a, b) => {
          const na = nextSessionOf(a.id);
          const nb = nextSessionOf(b.id);
          if (na && nb) return na.scheduledAt.localeCompare(nb.scheduledAt);
          if (na) return -1;
          if (nb) return 1;
          return b.createdAt.localeCompare(a.createdAt);
        }),
     
    [buckets.INTERVIEW, searchLower, interviews]
  );

  const filteredAccepted = useMemo(
    () =>
      buckets.ACCEPTED.filter(matchesSearch).sort((a, b) => {
        const ka = a.hiredAt ?? a.offerSentAt ?? a.createdAt;
        const kb = b.hiredAt ?? b.offerSentAt ?? b.createdAt;
        return kb.localeCompare(ka);
      }),
     
    [buckets.ACCEPTED, searchLower]
  );

  const filteredRejected = useMemo(
    () =>
      buckets.REJECTED.filter(matchesSearch).sort((a, b) =>
        (b.rejectedAt ?? b.createdAt).localeCompare(a.rejectedAt ?? a.createdAt)
      ),
     
    [buckets.REJECTED, searchLower]
  );

  const currentList: Application[] =
    category === "REVIEW"
      ? filteredReview
      : category === "INTERVIEW"
        ? filteredInterview
        : category === "ACCEPTED"
          ? filteredAccepted
          : filteredRejected;

  /* ---------------------------------- Render --------------------------------- */

  return (
    <div className="flex flex-col gap-4">
      {/* Pemilih lowongan */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="size-4 text-rose-600" aria-hidden="true" />
            Lowongan
          </h2>
          <p className="text-xs text-muted-foreground">
            Fitur pipeline dikelompokkan per kategori untuk tiap lowongan.
          </p>
        </div>
        {loading && positions.length === 0 ? (
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-40 rounded-full" />
            ))}
          </div>
        ) : positions.length === 0 ? (
          <Card className="rounded-2xl">
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Belum ada lowongan. Buat lowongan di tab Posisi terlebih dahulu.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div
            className="flex gap-2 overflow-x-auto pb-1 nice-scrollbar"
            role="tablist"
            aria-label="Pilih lowongan"
          >
            {positions.map((p) => {
              const count = applications.filter((a) => a.positionId === p.id).length;
              const active = p.id === positionId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectPosition(p.id)}
                  className={cn(
                    "flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-all active:scale-[0.98]",
                    active
                      ? "border-transparent bg-rose-600 text-white shadow-sm"
                      : "border-zinc-200 bg-background text-zinc-700 hover:border-rose-200 hover:bg-rose-50 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-rose-950/30"
                  )}
                >
                  <span className="max-w-48 truncate">{p.title}</span>
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                      active ? "bg-white/20 text-white" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {position ? (
        <>
          {/* Info posisi ringkas */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold">{position.title}</h3>
            <Badge variant="outline" className="rounded-full">
              {position.department}
            </Badge>
            <Badge variant="outline" className="rounded-full">
              {position.type}
            </Badge>
            {position.isActive ? (
              <Badge className="rounded-full border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                Aktif
              </Badge>
            ) : (
              <Badge variant="secondary" className="rounded-full">
                Nonaktif
              </Badge>
            )}
            {position.maxApplicants != null ? (
              <Badge variant="outline" className="rounded-full">
                Kuota {positionApps.length}/{position.maxApplicants}
              </Badge>
            ) : null}
          </div>

          {/* Tab kategori */}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="tablist" aria-label="Kategori tahap">
            {STAGE_CATEGORY_ORDER.map((cat) => {
              const meta = CATEGORY_META[cat];
              const Icon = meta.icon;
              const active = category === cat;
              const count = buckets[cat].length;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => {
                    setCategory(cat);
                    setSelectedIds(new Set());
                  }}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl border p-3 text-left transition-all active:scale-[0.99] sm:p-4",
                    active
                      ? cn(meta.activeBorder, meta.activeBg, "shadow-sm")
                      : "border-zinc-200 bg-background hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl sm:size-10",
                      active ? meta.chip : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                    )}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-sm font-semibold", active ? meta.activeText : "")}>
                      {meta.label}
                    </span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {count} kandidat
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Kartu fitur tahap ini */}
          <FeatureCard
            category={category}
            stages={stagesByCategory[category]}
            extra={
              category === "INTERVIEW" ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => onNavigate?.("interview")}
                >
                  <CalendarDays className="size-4" aria-hidden="true" />
                  Buka Kalender Wawancara
                </Button>
              ) : null
            }
          />

          {/* Pencarian + pilih semua + urutan (kategori Ditinjau) */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Cari kandidat di kategori ${CATEGORY_META[category].label.toLowerCase()}...`}
                aria-label={`Cari kandidat di kategori ${CATEGORY_META[category].label}`}
                className="h-10 rounded-xl pl-9"
              />
            </div>
            {category === "REVIEW" ? (
              <div className="flex items-center gap-2">
                {canMutate && filteredReview.length > 0 ? (
                  <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-xs font-medium">
                    <Checkbox
                      checked={
                        filteredReview.length > 0 &&
                        filteredReview.every((a) => selectedIds.has(a.id))
                      }
                      onCheckedChange={(v) => toggleSelectAll(v === true)}
                      aria-label="Pilih semua kandidat di kategori ini"
                    />
                    Pilih semua
                  </label>
                ) : null}
                <Select value={reviewSort} onValueChange={(v) => setReviewSort(v as ReviewSort)}>
                  <SelectTrigger
                    className="h-10 w-fit rounded-xl text-xs"
                    aria-label="Urutkan kandidat"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Terbaru</SelectItem>
                    <SelectItem value="aiScore">Skor AI</SelectItem>
                    <SelectItem value="rating">Rating</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          {/* Daftar kandidat per kategori */}
          {loading && applications.length === 0 ? (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : currentList.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Tidak ada kandidat di kategori {CATEGORY_META[category].label.toLowerCase()}.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {currentList.map((app) => (
                <Reveal key={app.id} slideY={8} duration={0.2}>
                  {category === "REVIEW" ? (
                    <ReviewCard
                      app={app}
                      canMutate={canMutate}
                      positionStages={positionStages}
                      selected={selectedIds.has(app.id)}
                      onToggle={(c) => toggleSelect(app.id, c)}
                      onStageChange={(s) => void handleStageChange(app, s)}
                      onRate={(r) => void handleRate(app, r)}
                      onSchedule={() => openCreateSession(app)}
                      onReject={() => setRejectTarget(app)}
                      onDetail={() => setDetail(app)}
                    />
                  ) : category === "INTERVIEW" ? (
                    <InterviewCard
                      app={app}
                      canMutate={canMutate}
                      nextSession={nextSessionOf(app.id)}
                      lastSession={lastSessionOf(app.id)}
                      onSchedule={() => openCreateSession(app)}
                      onOpenSession={(i) => {
                        setSessionReset((n) => n + 1);
                        setSessionTarget({ mode: "edit", interview: i });
                      }}
                      onOffer={() => setOfferTarget(app)}
                      onReject={() => setRejectTarget(app)}
                      onDetail={() => setDetail(app)}
                    />
                  ) : category === "ACCEPTED" ? (
                    <AcceptedCard
                      app={app}
                      canMutate={canMutate}
                      onOffer={() => setOfferTarget(app)}
                      onReject={() => setRejectTarget(app)}
                      onDetail={() => setDetail(app)}
                    />
                  ) : (
                    <RejectedCard
                      app={app}
                      canMutate={canMutate}
                      cooldownDays={position.reapplyCooldownDays}
                      onTalentPool={(v) => void handleTalentPool(app, v)}
                      onRestore={() => void handleRestore(app)}
                      onDetail={() => setDetail(app)}
                    />
                  )}
                </Reveal>
              ))}
            </div>
          )}

          {/* Aksi massal (kategori Ditinjau) */}
          {canMutate && category === "REVIEW" && selectedIds.size > 0 ? (
            <Reveal slideY={8} duration={0.2} className="sticky bottom-4 z-20">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/95 p-3 backdrop-blur dark:border-rose-900 dark:bg-rose-950/90">
                <span className="text-sm font-semibold">{selectedIds.size} dipilih</span>
                <Select value={bulkStage || "bulk-empty"} onValueChange={setBulkStage}>
                  <SelectTrigger
                    className="h-9 w-full rounded-lg bg-background sm:w-48"
                    aria-label="Pindah tahap terpilih"
                  >
                    <SelectValue placeholder="Pindah ke tahap..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bulk-empty" disabled>
                      Pindah ke tahap...
                    </SelectItem>
                    {positionStages.map((s) => (
                      <SelectItem key={s} value={s}>
                        {stageLabel(s)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-9 active:scale-[0.99]"
                  disabled={!bulkStage || bulkWorking}
                  onClick={() =>
                    void runBulk(
                      { ids: Array.from(selectedIds), action: "status", status: bulkStage },
                      "{n} lamaran diperbarui"
                    )
                  }
                >
                  {bulkWorking ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : null}
                  Terapkan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 bg-background"
                  disabled={bulkWorking}
                  onClick={() =>
                    void runBulk(
                      { ids: Array.from(selectedIds), action: "talentPool", talentPool: true },
                      "{n} lamaran masuk Talent Pool"
                    )
                  }
                >
                  <Sparkles className="size-4" aria-hidden="true" />
                  Talent Pool
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 border-rose-300 bg-background text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:text-rose-400 dark:hover:bg-rose-950/60"
                  disabled={bulkWorking}
                  onClick={() => setBulkRejectOpen(true)}
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  Tolak Massal
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Bersihkan
                </Button>
              </div>
            </Reveal>
          ) : null}
        </>
      ) : !loading ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Pilih lowongan untuk melihat pipelinenya.</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Dialog bersama */}
      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={updateApp}
        onDeleted={(id) => {
          setApplications((prev) => prev.filter((a) => a.id !== id));
          setDetail(null);
          toast.success("Lamaran dihapus");
        }}
      />

      <InterviewSessionDialog
        open={sessionTarget !== null}
        onOpenChange={(open) => {
          if (!open) setSessionTarget(null);
        }}
        create={sessionTarget?.mode === "create" ? sessionTarget.ctx : null}
        interview={sessionTarget?.mode === "edit" ? sessionTarget.interview : null}
        position={position}
        resetKey={sessionReset}
        onSaved={handleInterviewSaved}
        onDeleted={handleInterviewDeleted}
      />

      <QuickRejectDialog
        application={rejectTarget}
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRejectTarget(null);
        }}
        onRejected={(app) => {
          updateApp(app);
          setRejectTarget(null);
          void loadAll(true);
        }}
      />

      <OfferDialog
        application={offerTarget}
        open={offerTarget !== null}
        onOpenChange={(open) => {
          if (!open) setOfferTarget(null);
        }}
        onSaved={(app) => {
          updateApp(app);
          setOfferTarget(null);
          void loadAll(true);
        }}
      />

      {/* Dialog tolak massal */}
      <BulkRejectDialog
        open={bulkRejectOpen}
        onOpenChange={setBulkRejectOpen}
        count={selectedIds.size}
        reason={bulkRejectReason}
        onReasonChange={setBulkRejectReason}
        note={bulkRejectNote}
        onNoteChange={setBulkRejectNote}
        working={bulkWorking}
        onSubmit={() => void handleBulkReject()}
      />
    </div>
  );
}

/* ------------------------------ Kartu fitur tahap ----------------------------- */

function FeatureCard({
  category,
  stages,
  extra,
}: {
  category: StageCategory;
  stages: StageKey[];
  extra?: ReactNode;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-2xl border transition-colors",
          open ? meta.activeBorder : "border-zinc-200 dark:border-zinc-800"
        )}
      >
        <CollapsibleTrigger
          className={cn(
            "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60",
            open ? meta.activeBg : "bg-background"
          )}
          aria-expanded={open}
        >
          <span className={cn("flex size-8 items-center justify-center rounded-lg", meta.chip)}>
            <Lightbulb className="size-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Fitur tahap {meta.label}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{meta.desc}</span>
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 border-t px-4 py-3">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {meta.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                  <Check className={cn("mt-0.5 size-3.5 shrink-0", meta.activeText)} aria-hidden="true" />
                  {f}
                </li>
              ))}
            </ul>
            {stages.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Tahap dalam kategori ini:</span>
                {stages.map((s) => (
                  <StatusBadge key={s} status={s} />
                ))}
              </div>
            ) : null}
            {extra}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ------------------------------ Shell kartu kandidat -------------------------- */

function CandidateCardShell({
  children,
  footer,
  checkbox,
}: {
  children: ReactNode;
  footer: ReactNode;
  checkbox?: ReactNode;
}) {
  return (
    <Card className="h-full rounded-2xl transition-shadow hover:shadow-md">
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          {checkbox}
          {children}
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">{footer}</div>
      </CardContent>
    </Card>
  );
}

function CandidateHead({ app }: { app: Application }) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <span
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-600 to-amber-500 text-xs font-bold text-white"
        aria-hidden="true"
      >
        {initialsOf(app.name)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{app.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {app.trackingCode} &middot; daftar {formatDate(app.createdAt)}
        </p>
      </div>
      <StatusBadge status={app.status} />
    </div>
  );
}

/* -------------------------------- Kartu Ditinjau ------------------------------ */

function ReviewCard({
  app,
  canMutate,
  positionStages,
  selected,
  onToggle,
  onStageChange,
  onRate,
  onSchedule,
  onReject,
  onDetail,
}: {
  app: Application;
  canMutate: boolean;
  positionStages: StageKey[];
  selected: boolean;
  onToggle: (checked: boolean) => void;
  onStageChange: (stage: StageKey) => void;
  onRate: (rating: number) => void;
  onSchedule: () => void;
  onReject: () => void;
  onDetail: () => void;
}) {
  return (
    <CandidateCardShell
      checkbox={
        canMutate ? (
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onToggle(v === true)}
            aria-label={`Pilih ${app.name}`}
            className="mt-2.5"
          />
        ) : null
      }
      footer={
        <>
          {canMutate ? (
            <Select value={app.status} onValueChange={onStageChange}>
              <SelectTrigger
                className="h-8 w-fit gap-1 rounded-lg text-xs"
                aria-label={`Pindah tahap untuk ${app.name}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {positionStages.map((s) => (
                  <SelectItem key={s} value={s}>
                    {stageLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {canMutate ? (
            <Button size="sm" className="h-8 active:scale-[0.99]" onClick={onSchedule}>
              <Video className="size-3.5" aria-hidden="true" />
              Jadwalkan Wawancara
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8" onClick={onDetail}>
            <Eye className="size-3.5" aria-hidden="true" />
            Detail
          </Button>
          {canMutate ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
              onClick={onReject}
            >
              <XCircle className="size-3.5" aria-hidden="true" />
              Tolak
            </Button>
          ) : null}
        </>
      }
    >
      <div className="min-w-0 flex-1">
        <CandidateHead app={app} />
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            AI <AiScoreBadge score={app.aiScore} />
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Star className="size-3.5 text-amber-500" aria-hidden="true" />
            <RatingStars
              value={app.rating}
              onChange={canMutate ? onRate : undefined}
              disabled={!canMutate}
              size="size-3.5"
              ariaLabel={`Rating ${app.name}`}
            />
          </span>
          {app.cvFileId ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="size-3.5" aria-hidden="true" />
              CV
            </span>
          ) : null}
          {app.talentPool ? (
            <Badge variant="outline" className="rounded-full text-[11px]">
              Talent Pool
            </Badge>
          ) : null}
        </div>
        {app.aiSummary ? (
          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{app.aiSummary}</p>
        ) : null}
      </div>
    </CandidateCardShell>
  );
}

/* ------------------------------ Kartu Wawancara ------------------------------- */

function InterviewCard({
  app,
  canMutate,
  nextSession,
  lastSession,
  onSchedule,
  onOpenSession,
  onOffer,
  onReject,
  onDetail,
}: {
  app: Application;
  canMutate: boolean;
  nextSession: Interview | null;
  lastSession: Interview | null;
  onSchedule: () => void;
  onOpenSession: (interview: Interview) => void;
  onOffer: () => void;
  onReject: () => void;
  onDetail: () => void;
}) {
  return (
    <CandidateCardShell
      footer={
        <>
          {canMutate ? (
            <Button size="sm" className="h-8 active:scale-[0.99]" onClick={onSchedule}>
              <Video className="size-3.5" aria-hidden="true" />
              {nextSession ? "+ Ronde" : "Jadwalkan"}
            </Button>
          ) : null}
          {lastSession && canMutate ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => onOpenSession(lastSession)}>
              <ClipboardCheck className="size-3.5" aria-hidden="true" />
              Skor
            </Button>
          ) : null}
          {canMutate ? (
            <Button variant="outline" size="sm" className="h-8 border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950/40" onClick={onOffer}>
              <Send className="size-3.5" aria-hidden="true" />
              Penawaran
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8" onClick={onDetail}>
            <Eye className="size-3.5" aria-hidden="true" />
            Detail
          </Button>
          {canMutate ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
              onClick={onReject}
            >
              <XCircle className="size-3.5" aria-hidden="true" />
              Tolak
            </Button>
          ) : null}
        </>
      }
    >
      <div className="min-w-0 flex-1">
        <CandidateHead app={app} />
        {nextSession ? (
          <button
            type="button"
            onClick={() => onOpenSession(nextSession)}
            className="mt-2 flex w-full flex-col gap-1 rounded-xl border p-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
            aria-label={`Buka sesi ronde ${nextSession.round} untuk ${app.name}`}
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="rounded-full text-[11px]">
                Ronde {nextSession.round}
              </Badge>
              <InterviewStatusChip status={nextSession.status} />
              {nextSession.rescheduleReason ? (
                <span className="text-[11px] font-medium text-orange-600 dark:text-orange-400">
                  Pelamar minta ubah jadwal
                </span>
              ) : null}
            </span>
            <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <CalendarDays className="size-3.5" aria-hidden="true" />
                {formatDateTime(nextSession.scheduledAt)} WIB
              </span>
              <span className="flex items-center gap-1">
                {nextSession.mode === "ONSITE" ? (
                  <MapPin className="size-3.5" aria-hidden="true" />
                ) : (
                  <Video className="size-3.5" aria-hidden="true" />
                )}
                {nextSession.mode === "ONSITE"
                  ? nextSession.address ?? "Onsite"
                  : INTERVIEW_PLATFORM_LABELS[nextSession.platform]}
              </span>
            </span>
          </button>
        ) : lastSession ? (
          <button
            type="button"
            onClick={() => onOpenSession(lastSession)}
            className="mt-2 flex w-full flex-col gap-1 rounded-xl border border-dashed p-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
            aria-label={`Buka hasil ronde ${lastSession.round} untuk ${app.name}`}
          >
            <span className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="rounded-full text-[11px]">
                Ronde {lastSession.round} &middot; selesai
              </Badge>
              {lastSession.recommendation ? (
                <Badge variant="outline" className="rounded-full text-[11px]">
                  {INTERVIEW_RECOMMENDATION_LABELS[lastSession.recommendation]}
                </Badge>
              ) : (
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  Belum diberi skor
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(lastSession.scheduledAt)} &middot; klik untuk isi scorecard
            </span>
          </button>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Belum ada jadwal wawancara.</p>
        )}
      </div>
    </CandidateCardShell>
  );
}

/* ------------------------------- Kartu Diterima ------------------------------- */

function AcceptedCard({
  app,
  canMutate,
  onOffer,
  onReject,
  onDetail,
}: {
  app: Application;
  canMutate: boolean;
  onOffer: () => void;
  onReject: () => void;
  onDetail: () => void;
}) {
  const docs = app.onboardingDocs;
  const doneDocs = docs.filter((d) => d.done).length;
  const totalDocs = docs.length;
  const pct = totalDocs > 0 ? Math.round((doneDocs / totalDocs) * 100) : 0;
  const daysLeft = app.offerDeadline
    ? Math.max(0, Math.ceil((new Date(app.offerDeadline).getTime() - Date.now()) / 86_400_000))
    : null;
  const canSendOffer =
    canMutate &&
    (app.offerStatus === null ||
      app.offerStatus === "DECLINED" ||
      app.offerStatus === "EXPIRED");

  return (
    <CandidateCardShell
      footer={
        <>
          {canSendOffer ? (
            <Button size="sm" className="h-8 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]" onClick={onOffer}>
              <Send className="size-3.5" aria-hidden="true" />
              Kirim Penawaran
            </Button>
          ) : null}
          <Button variant="outline" size="sm" className="h-8" onClick={onDetail}>
            <Eye className="size-3.5" aria-hidden="true" />
            Detail
          </Button>
          {canMutate && app.offerStatus === "DECLINED" ? (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-8 border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
              onClick={onReject}
            >
              <XCircle className="size-3.5" aria-hidden="true" />
              Tolak
            </Button>
          ) : null}
        </>
      }
    >
      <div className="min-w-0 flex-1">
        <CandidateHead app={app} />

        <div className="mt-2 flex flex-col gap-2">
          {app.offerStatus ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-2.5 text-xs">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 font-medium whitespace-nowrap",
                  OFFER_BADGE_CLASS[app.offerStatus]
                )}
              >
                {OFFER_STATUS_LABELS[app.offerStatus]}
              </span>
              {app.offerSalary ? (
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{app.offerSalary}</span>
              ) : null}
              {app.offerType ? (
                <span className="text-muted-foreground">{app.offerType}</span>
              ) : null}
              {app.offerStatus === "PENDING" && app.offerDeadline ? (
                <span className="text-muted-foreground">
                  batas {formatDate(app.offerDeadline)}
                  {daysLeft !== null ? ` (sisa ${daysLeft} hari)` : ""}
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Belum ada penawaran.</p>
          )}

          {app.offerStatus === "ACCEPTED" || app.hiredAt ? (
            <div className="flex flex-col gap-1.5 rounded-xl border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Onboarding {totalDocs > 0 ? `${doneDocs}/${totalDocs} dokumen` : ""}
                </span>
                {app.probationEnd ? (
                  <span className="text-muted-foreground">
                    Masa percobaan s.d. {formatDate(app.probationEnd)}
                  </span>
                ) : null}
              </div>
              {totalDocs > 0 ? <Progress value={pct} className="h-1.5" aria-label={`Progres onboarding ${pct}%`} /> : null}
            </div>
          ) : null}
        </div>
      </div>
    </CandidateCardShell>
  );
}

/* ------------------------------- Kartu Ditolak -------------------------------- */

function RejectedCard({
  app,
  canMutate,
  cooldownDays,
  onTalentPool,
  onRestore,
  onDetail,
}: {
  app: Application;
  canMutate: boolean;
  cooldownDays: number;
  onTalentPool: (value: boolean) => void;
  onRestore: () => void;
  onDetail: () => void;
}) {
  return (
    <CandidateCardShell
      footer={
        <>
          <Button variant="outline" size="sm" className="h-8" onClick={onDetail}>
            <Eye className="size-3.5" aria-hidden="true" />
            Detail
          </Button>
          {canMutate ? (
            <Button variant="outline" size="sm" className="h-8" onClick={onRestore}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              Pulihkan
            </Button>
          ) : null}
          {canMutate ? (
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs font-medium">
              <Switch
                checked={app.talentPool}
                onCheckedChange={onTalentPool}
                aria-label={`Talent Pool untuk ${app.name}`}
              />
              Talent Pool
            </label>
          ) : null}
        </>
      }
    >
      <div className="min-w-0 flex-1">
        <CandidateHead app={app} />
        <div className="mt-2 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {app.rejectionReason ? (
              <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-medium text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
                {REJECTION_REASON_LABELS[app.rejectionReason]}
              </span>
            ) : (
              <span className="text-muted-foreground">Tanpa alasan tercatat</span>
            )}
            {app.rejectedAt ? (
              <span className="text-muted-foreground">ditolak {formatDate(app.rejectedAt)}</span>
            ) : null}
            {cooldownDays > 0 ? (
              <span className="text-muted-foreground">
                &middot; boleh lamar ulang setelah {cooldownDays} hari
              </span>
            ) : null}
          </div>
          {app.rejectionNote ? (
            <p className="line-clamp-2 rounded-lg bg-zinc-50 p-2 text-xs text-muted-foreground dark:bg-zinc-900/60">
              &ldquo;{app.rejectionNote}&rdquo;
            </p>
          ) : null}
        </div>
      </div>
    </CandidateCardShell>
  );
}

/* ------------------------------ Dialog tolak massal --------------------------- */

function BulkRejectDialog({
  open,
  onOpenChange,
  count,
  reason,
  onReasonChange,
  note,
  onNoteChange,
  working,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  reason: RejectionReason | "";
  onReasonChange: (reason: RejectionReason | "") => void;
  note: string;
  onNoteChange: (note: string) => void;
  working: boolean;
  onSubmit: () => void;
}) {
  // Reset pilihan setiap kali dialog ditutup.
  useEffect(() => {
    if (!open) {
      onReasonChange("");
      onNoteChange("");
    }
     
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-rose-600" aria-hidden="true" />
            Tolak {count} Lamaran
          </DialogTitle>
          <DialogDescription>
            Semua lamaran terpilih akan ditolak dengan alasan yang sama.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-reject-reason">Alasan penolakan</Label>
            <Select value={reason || undefined} onValueChange={(v) => onReasonChange(v as RejectionReason)}>
              <SelectTrigger id="bulk-reject-reason" className="h-10 w-full" aria-label="Pilih alasan penolakan massal">
                <SelectValue placeholder="Pilih alasan..." />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REJECTION_REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="bulk-reject-note">Catatan / umpan balik (opsional)</Label>
            <Textarea
              id="bulk-reject-note"
              value={note}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={3}
              maxLength={1000}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working} className="h-11 sm:h-10">
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={onSubmit}
            disabled={working || !reason}
            className="h-11 active:scale-[0.99] sm:h-10"
          >
            {working ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
            Tolak Semua
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
