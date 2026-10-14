"use client";

// Pusat Tugas (Task 20-a): satu halaman yang mengelompokkan semua hal yang butuh
// tindakan admin, dengan hitungan per kategori dan aksi cepat "Buka Detail".
// Sumber data: GET /api/admin/action-items (termasuk field perluasan
// staleNewApplications, duplicateApplications, followUpsDue, holdReviewsDue,
// assessmentsDue) + daftar lamaran untuk membuka detail kandidat.
// Auto-refresh via useLiveRefresh (event realtime).

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  ClipboardCheck,
  Clock,
  Copy,
  Eye,
  Gauge,
  Handshake,
  Inbox,
  Loader2,
  PauseCircle,
  PhoneCall,
  Timer,
} from "lucide-react";
import { toast } from "sonner";
import {
  HOLD_REASON_LABELS,
  type ActionItemsResponse,
  type Application,
  type HoldReason,
  type Interview,
} from "@/lib/types";
import { daysUntil, formatDate, formatDateTime, formatRelative, formatShortDateTime } from "./format";
import { apiGet, apiPatch } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { ApplicationDetailDialog } from "./application-detail-dialog";
// NR38-B — tipe baris diperkaya (snoozeUntil & adminSeenAt dari payload list).
import type { ApplicationRow } from "./applicant-row-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SimpleAppItem = {
  applicationId: string;
  name: string;
  positionTitle: string | null;
  createdAt: string;
};

// Respons action-items dengan perluasan Pusat Tugas (field opsional agar aman
// terhadap respons lama yang belum menyertakan field baru).
type ExtendedActionItems = ActionItemsResponse & {
  staleNewApplications?: SimpleAppItem[];
  duplicateApplications?: SimpleAppItem[];
};

// NR-19 — item tahap melebihi batas kapasitas (wipOver dari ActionItemsResponse).
type WipOverItem = NonNullable<ActionItemsResponse["wipOver"]>[number];

// NR-24 — tindak lanjut (snooze) jatuh tempo.
type FollowUpItem = NonNullable<ActionItemsResponse["followUpsDue"]>[number];
// NR-24 — review lamaran HOLD jatuh tempo.
type HoldReviewItem = NonNullable<ActionItemsResponse["holdReviewsDue"]>[number];
// NR-24 — tugas uji mendekati/lewat tenggat.
type AssessmentDueItem = NonNullable<ActionItemsResponse["assessmentsDue"]>[number];

/* --------------------- NR38-B fitur 7 — Perlu dihubungi hari ini --------------------- */

// Jenis tugas "perlu dihubungi": follow-up manual, snooze bot, review HOLD,
// dan penawaran yang mendekati/lewat batas jawaban (offerStatus PENDING —
// padanan "SENT" pada skema aplikasi ini; status SENT tidak ada di OfferStatus).
type ContactKind = "followup" | "snooze" | "hold" | "offer";

const CONTACT_KIND_META: Record<ContactKind, { label: string; chipClass: string }> = {
  followup: {
    label: "Follow-up",
    chipClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  snooze: {
    label: "Snooze",
    chipClass: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  hold: {
    label: "Review HOLD",
    chipClass: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400",
  },
  offer: {
    label: "Penawaran",
    chipClass: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400",
  },
};

type ContactTask = {
  key: string;
  app: ApplicationRow;
  kind: ContactKind;
  dueAt: string;
};

const THREE_DAYS_MS = 3 * 86_400_000;

// Label alasan HOLD yang aman terhadap nilai tak dikenal/null.
function holdReasonLabel(reason: string | null): string {
  if (reason && reason in HOLD_REASON_LABELS) {
    return HOLD_REASON_LABELS[reason as HoldReason];
  }
  return "Alasan lain";
}

// Tenggat dianggap mendesak bila hari ini, lewat, atau tersisa <= 2 hari.
function dueIsUrgent(value: string): boolean {
  const days = daysUntil(value);
  return days !== null && days <= 2;
}

function offerUrgency(deadline: string | null): { label: string; urgent: boolean } | null {
  if (!deadline) return null;
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms < 0) return { label: "Lewat batas jawaban", urgent: true };
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 2) return { label: `Sisa ${days} hari`, urgent: true };
  return { label: `Batas ${formatDate(deadline)}`, urgent: false };
}

/**
 * Chip tanggal jatuh tempo (NR-24): merah bila sudah lewat, amber bila ≤ 3
 * hari lagi, zinc outline bila masih jauh. Tanpa tanggal tampil "-".
 */
function DueChip({ date, label }: { date: string | null; label?: string }) {
  if (!date) {
    return <span className="shrink-0 text-xs text-muted-foreground">-</span>;
  }
  const ms = new Date(date).getTime() - Date.now();
  const valid = !Number.isNaN(ms);
  const overdue = valid && ms < 0;
  const soon = valid && ms >= 0 && ms <= 3 * 86_400_000;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        overdue
          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
          : soon
            ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            : "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      )}
    >
      {label ? `${label} ` : ""}
      {formatDate(date)}
    </span>
  );
}

function TaskGroup({
  icon: Icon,
  title,
  description,
  count,
  tone,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  count: number;
  tone: "rose" | "amber";
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 overflow-hidden rounded-2xl">
      <CardContent className="flex flex-col gap-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              tone === "rose"
                ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-muted-foreground">{description}</p>
          </div>
          {count > 0 ? (
            <Badge
              variant="outline"
              className={cn(
                "rounded-full tabular-nums",
                tone === "rose"
                  ? "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                  : "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              )}
              aria-label={`${count} item ${title}`}
            >
              {count}
            </Badge>
          ) : (
            <Badge variant="secondary" className="rounded-full tabular-nums">
              0
            </Badge>
          )}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

export function TasksTab() {
  const { canMutate, reportError } = useAdminSession();

  const [items, setItems] = useState<ExtendedActionItems | null>(null);
  const [applications, setApplications] = useState<ApplicationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Application | null>(null);
  // NR38-B — kunci tugas yang sedang dipatch (anti dobel klik).
  const [workingTasks, setWorkingTasks] = useState<Set<string>>(new Set<string>());

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [actionItems, apps] = await Promise.all([
          apiGet<ExtendedActionItems>("/api/admin/action-items"),
          apiGet<ApplicationRow[]>("/api/admin/applications"),
        ]);
        setItems(actionItems);
        setApplications(apps);
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

  // Auto-refresh realtime senyap (anti-flicker) saat lamaran/wawancara berubah.
  useLiveRefresh("applications:changed", () => void loadAll(true));
  useLiveRefresh("interviews:changed", () => void loadAll(true));

  function openDetail(applicationId: string, name: string) {
    const app = applications.find((a) => a.id === applicationId);
    if (app) {
      setDetail(app);
    } else {
      toast.info(`Detail ${name} tidak tersedia — muat ulang halaman atau sesuaikan filter.`);
    }
  }

  // NR38-B fitur 7 — gabungan tugas "perlu dihubungi": followUpAt ≤ sekarang,
  // snoozeUntil ≤ sekarang, holdReviewAt ≤ sekarang (lamaran aktif di-HOLD),
  // dan offerStatus PENDING dengan offerDeadline ≤ 3 hari ke depan.
  const contactToday = useMemo<ContactTask[]>(() => {
    const nowMs = Date.now();
    const tasks: ContactTask[] = [];
    for (const app of applications) {
      if (app.deletedAt || app.mergedIntoId) continue;
      if (app.followUpAt && new Date(app.followUpAt).getTime() <= nowMs) {
        tasks.push({ key: `${app.id}:followup`, app, kind: "followup", dueAt: app.followUpAt });
      }
      if (app.snoozeUntil && new Date(app.snoozeUntil).getTime() <= nowMs) {
        tasks.push({ key: `${app.id}:snooze`, app, kind: "snooze", dueAt: app.snoozeUntil });
      }
      if (
        app.holdReviewAt &&
        app.holdAt &&
        new Date(app.holdReviewAt).getTime() <= nowMs
      ) {
        tasks.push({ key: `${app.id}:hold`, app, kind: "hold", dueAt: app.holdReviewAt });
      }
      if (
        app.offerStatus === "PENDING" &&
        app.offerDeadline &&
        new Date(app.offerDeadline).getTime() <= nowMs + THREE_DAYS_MS
      ) {
        tasks.push({ key: `${app.id}:offer`, app, kind: "offer", dueAt: app.offerDeadline });
      }
    }
    tasks.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    return tasks;
  }, [applications]);

  /**
   * NR55-C — inti aksi cepat follow-up/HOLD, dipakai bersama oleh panel
   * "Perlu Dihubungi Hari Ini" dan grup duplikat dari action-items
   * (followUpsDue / holdReviewsDue). PATCH hanya memakai field yang DIDUKUNG
   * whitelist endpoint [id]: followUpAt (null/ISO) dan holdClear /
   * holdReason+holdReviewAt. Optimistik + rollback + toast; mengembalikan
   * true bila PATCH sukses (pemanggil bisa memicu refresh daftar tindakan).
   */
  async function patchApplicationFollowUp(params: {
    key: string;
    applicationId: string;
    name: string;
    kind: "followup" | "hold";
    action: "done" | "snooze3";
    holdReason?: string | null;
  }): Promise<boolean> {
    const { key, applicationId, name, kind, action } = params;
    if (workingTasks.has(key)) return false;
    const in3Days = new Date(Date.now() + THREE_DAYS_MS).toISOString();
    let body: Record<string, unknown>;
    let optimistic: Partial<ApplicationRow>;
    let message: string;
    if (kind === "followup") {
      if (action === "done") {
        body = { followUpAt: null };
        optimistic = { followUpAt: null };
        message = `Follow-up ${name} ditandai selesai`;
      } else {
        body = { followUpAt: in3Days };
        optimistic = { followUpAt: in3Days };
        message = `Follow-up ${name} ditunda 3 hari`;
      }
    } else if (action === "done") {
      // "Selesai" review HOLD = lepas tahanan — satu-satunya jalur resmi
      // endpoint untuk mengosongkan holdReviewAt (holdClear).
      body = { holdClear: true };
      optimistic = { holdAt: null, holdReason: null, holdNote: null, holdReviewAt: null };
      message = `HOLD ${name} dilepas`;
    } else {
      if (!params.holdReason) return false; // PATCH ulang menuntut alasan hold yang valid
      body = { holdReason: params.holdReason, holdReviewAt: in3Days };
      optimistic = { holdReviewAt: in3Days };
      message = `Review HOLD ${name} ditunda 3 hari`;
    }
    setWorkingTasks((prev) => new Set(prev).add(key));
    const previous = applications;
    setApplications((prev) =>
      prev.map((a) => (a.id === applicationId ? { ...a, ...optimistic } : a))
    );
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${applicationId}`,
        body
      );
      // Merge agar field tambahan payload list tidak hilang.
      setApplications((prev) =>
        prev.map((a) =>
          a.id === updated.id ? ({ ...a, ...updated } as ApplicationRow) : a
        )
      );
      toast.success(message);
      return true;
    } catch (err) {
      setApplications(previous);
      reportError(err);
      return false;
    } finally {
      setWorkingTasks((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  /**
   * Aksi cepat panel (optimistik + toast). Baris jenis snooze/offer tidak
   * menyediakan PATCH — hanya "Buka Detail" (lihat catatan panel).
   */
  async function runContactAction(task: ContactTask, action: "done" | "snooze3") {
    if (task.kind !== "followup" && task.kind !== "hold") {
      return; // snooze / offer: tidak ada PATCH yang didukung
    }
    await patchApplicationFollowUp({
      key: task.key,
      applicationId: task.app.id,
      name: task.app.name,
      kind: task.kind,
      action,
      holdReason: task.app.holdReason,
    });
  }

  // NR55-C — aksi cepat grup duplikat "Tindak Lanjut Jatuh Tempo" (followUpsDue).
  async function runFollowUpRowAction(row: FollowUpItem, action: "done" | "snooze3") {
    const ok = await patchApplicationFollowUp({
      key: `actionItem:followup:${row.applicationId}`,
      applicationId: row.applicationId,
      name: row.name,
      kind: "followup",
      action,
    });
    // Segarkan daftar tindakan agar baris hilang sesuai data server.
    if (ok) void loadAll(true);
  }

  // NR55-C — aksi cepat grup duplikat "Review Lamaran Ditahan" (holdReviewsDue).
  async function runHoldReviewRowAction(row: HoldReviewItem, action: "done" | "snooze3") {
    const ok = await patchApplicationFollowUp({
      key: `actionItem:hold:${row.applicationId}`,
      applicationId: row.applicationId,
      name: row.name,
      kind: "hold",
      action,
      holdReason: row.holdReason,
    });
    if (ok) void loadAll(true);
  }

  // NR55-C — aksi cepat "Permintaan Ubah Jadwal": setujui (pakai jadwal usulan)
  // atau tolak (kembali ke jadwal awal). Semantik persis interview-tab:
  // PATCH /api/admin/interviews/{id} {scheduledAt} / {dismissReschedule:true}.
  async function runRescheduleAction(
    row: ActionItemsResponse["rescheduleRequests"][number],
    action: "approve" | "reject"
  ) {
    const key = `reschedule:${row.interviewId}`;
    if (workingTasks.has(key)) return;
    if (!canMutate) {
      toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return;
    }
    if (action === "approve" && !row.proposedAt) return; // butuh jadwal usulan pelamar
    setWorkingTasks((prev) => new Set(prev).add(key));
    try {
      await apiPatch<{ interview: Interview }>(
        `/api/admin/interviews/${row.interviewId}`,
        action === "approve" ? { scheduledAt: row.proposedAt } : { dismissReschedule: true }
      );
      toast.success(action === "approve" ? "Usulan jadwal disetujui" : "Usulan jadwal ditolak");
      // Usulan sudah diproses — segarkan daftar tindakan (baris hilang).
      void loadAll(true);
    } catch (err) {
      reportError(err);
    } finally {
      setWorkingTasks((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  const staleNew = items?.staleNewApplications ?? [];
  const duplicates = items?.duplicateApplications ?? [];
  const offers = items?.offersAwaiting ?? [];
  const reschedules = items?.rescheduleRequests ?? [];
  const unscored = items?.unscoredInterviews ?? [];
  const wipOver = items?.wipOver ?? [];
  const followUps = items?.followUpsDue ?? [];
  const holdReviews = items?.holdReviewsDue ?? [];
  const assessmentsDue = items?.assessmentsDue ?? [];

  const totalCount =
    staleNew.length +
    duplicates.length +
    offers.length +
    reschedules.length +
    unscored.length +
    wipOver.length +
    followUps.length +
    holdReviews.length +
    assessmentsDue.length;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-base font-bold sm:text-lg">
            Pusat Tugas
            {totalCount > 0 ? (
              <Badge className="rounded-full border-transparent bg-rose-600 text-white tabular-nums">
                {totalCount}
              </Badge>
            ) : null}
          </h2>
          <p className="text-sm text-muted-foreground">
            Semua hal yang menunggu keputusan atau tindakan admin, dikelompokkan per kategori.
          </p>
        </div>
        {loading ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            Memuat...
          </span>
        ) : null}
      </div>

      {loading && !items ? (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* NR38-B fitur 7 — panel gabungan "Perlu dihubungi hari ini". */}
          {contactToday.length > 0 ? (
            <TaskGroup
              icon={PhoneCall}
              title="Perlu Dihubungi Hari Ini"
              description="Follow-up, snooze, review HOLD, dan penawaran yang jatuh tempo — lengkap dengan aksi cepat."
              count={contactToday.length}
              tone="rose"
            >
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {contactToday.map((task) => {
                  const meta = CONTACT_KIND_META[task.kind];
                  const working = workingTasks.has(task.key);
                  return (
                    <div
                      key={task.key}
                      className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.app.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {task.app.positionTitle ?? "Tanpa posisi"} &middot; jatuh tempo{" "}
                          {formatShortDateTime(task.dueAt)}
                        </p>
                      </div>
                      <Badge
                        className={cn(
                          "shrink-0 rounded-full border-transparent",
                          meta.chipClass
                        )}
                      >
                        {meta.label}
                      </Badge>
                      {/* Aksi cepat hanya utk jenis yang didukung endpoint PATCH. */}
                      {task.kind === "followup" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={working}
                            onClick={() => void runContactAction(task, "done")}
                          >
                            Selesai
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={working}
                            title="Geser tindak lanjut 3 hari ke depan"
                            onClick={() => void runContactAction(task, "snooze3")}
                          >
                            Tunda 3 hari
                          </Button>
                        </>
                      ) : null}
                      {task.kind === "hold" ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8"
                            disabled={working || !task.app.holdReason}
                            title="Geser jadwal review HOLD 3 hari ke depan"
                            onClick={() => void runContactAction(task, "snooze3")}
                          >
                            Tunda 3 hari
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                            disabled={working}
                            title="Lepas tahanan & kosongkan jadwal review HOLD"
                            onClick={() => void runContactAction(task, "done")}
                          >
                            Lepas HOLD
                          </Button>
                        </>
                      ) : null}
                      {task.kind === "snooze" ? (
                        <span
                          className="text-[11px] text-muted-foreground"
                          title="snoozeUntil dikelola bot dan tidak didukung endpoint PATCH — selesaikan dari dialog detail"
                        >
                          Selesaikan dari detail
                        </span>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => openDetail(task.app.id, task.app.name)}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                        Buka Detail
                      </Button>
                    </div>
                  );
                })}
              </div>
            </TaskGroup>
          ) : null}

          {totalCount === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm font-medium">Semua beres!</p>
            <p className="text-sm text-muted-foreground">
              Tidak ada tugas yang menunggu tindakan saat ini.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-2">
          {/* Lamaran belum ditinjau > 3 hari */}
          <TaskGroup
            icon={AlertCircle}
            title="Lamaran Belum Ditinjau"
            description="Lamaran baru tanpa perubahan lebih dari 3 hari."
            count={staleNew.length}
            tone="rose"
          >
            {staleNew.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {staleNew.map((row) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; masuk{" "}
                        {formatShortDateTime(row.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* NR-24 — tindak lanjut snooze jatuh tempo (snoozeUntil ≤ 3 hari / lewat) */}
          <TaskGroup
            icon={Clock}
            title="Tindak Lanjut Jatuh Tempo"
            description="Lamaran yang di-snooze sudah waktunya dihubungi kembali."
            count={followUps.length}
            tone="amber"
          >
            {followUps.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {followUps.map((row) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"}
                      </p>
                    </div>
                    <DueChip date={row.dueAt} label="Jatuh tempo" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* NR-24 — review ulang lamaran HOLD yang jatuh tempo */}
          <TaskGroup
            icon={PauseCircle}
            title="Review HOLD"
            description="Proses lamaran ditahan — saatnya ditinjau ulang."
            count={holdReviews.length}
            tone="amber"
          >
            {holdReviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {holdReviews.map((row) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 p-2.5 dark:border-amber-900"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"}
                        {row.holdReason ? ` · alasan: ${row.holdReason}` : ""}
                      </p>
                    </div>
                    <DueChip date={row.reviewAt} label="Review" />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* Offer menunggu jawaban (mendekati / lewat deadline) */}
          <TaskGroup
            icon={Handshake}
            title="Penawaran Menunggu Jawaban"
            description="Offer PENDING — perhatikan yang mendekati atau lewat batas."
            count={offers.length}
            tone="amber"
          >
            {offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {offers.map((row) => {
                  const urgency = offerUrgency(row.deadline);
                  return (
                    <div
                      key={row.applicationId}
                      className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.positionTitle ?? "Tanpa posisi"}
                          {row.salary ? ` &middot; ${row.salary}` : ""}
                          {urgency ? (
                            <>
                              {" "}
                              &middot;{" "}
                              <span
                                className={cn(
                                  "font-medium",
                                  urgency.urgent
                                    ? "text-amber-600 dark:text-amber-400"
                                    : "text-muted-foreground"
                                )}
                              >
                                {urgency.label}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => openDetail(row.applicationId, row.name)}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                        Buka Detail
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </TaskGroup>

          {/* Permintaan ubah jadwal wawancara */}
          <TaskGroup
            icon={CalendarClock}
            title="Permintaan Ubah Jadwal"
            description="Wawancara RESCHEDULE_REQUESTED menunggu keputusan Anda."
            count={reschedules.length}
            tone="rose"
          >
            {reschedules.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {reschedules.map((row) => {
                  const working = workingTasks.has(`reschedule:${row.interviewId}`);
                  return (
                    <div
                      key={row.interviewId}
                      className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.positionTitle ?? "Tanpa posisi"} &middot; jadwal{" "}
                          {formatShortDateTime(row.scheduledAt)}
                          {row.proposedAt
                            ? ` &middot; usulan ${formatShortDateTime(row.proposedAt)}`
                            : ""}
                          {row.reason ? ` &middot; alasan: ${row.reason}` : ""}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={working || !row.proposedAt}
                        title="Terima jadwal sesuai usulan pelamar"
                        onClick={() => void runRescheduleAction(row, "approve")}
                        aria-label={`Setujui usulan ubah jadwal ${row.name}`}
                      >
                        <CalendarCheck className="size-3.5" aria-hidden="true" />
                        Setujui
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        disabled={working}
                        title="Kembali ke jadwal awal & abaikan usulan"
                        onClick={() => void runRescheduleAction(row, "reject")}
                        aria-label={`Tolak usulan ubah jadwal ${row.name}`}
                      >
                        <CalendarX2 className="size-3.5" aria-hidden="true" />
                        Tolak
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => openDetail(row.applicationId, row.name)}
                      >
                        <Eye className="size-3.5" aria-hidden="true" />
                        Buka Detail
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </TaskGroup>

          {/* Wawancara selesai tanpa skor */}
          <TaskGroup
            icon={ClipboardCheck}
            title="Wawancara Belum Dinilai"
            description="Selesai lebih dari 3 hari tanpa scorecard."
            count={unscored.length}
            tone="amber"
          >
            {unscored.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {unscored.map((row) => (
                  <div
                    key={row.interviewId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"}
                        {row.completedAt
                          ? ` &middot; selesai ${formatShortDateTime(row.completedAt)}`
                          : ""}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* Lamaran duplikat perlu dicek */}
          <TaskGroup
            icon={Copy}
            title="Lamaran Duplikat"
            description="Kemungkinan lamaran ganda (email/telepon sama pada posisi yang sama)."
            count={duplicates.length}
            tone="amber"
          >
            {duplicates.length === 0 ? (
              <p className="text-sm text-muted-foreground">Tidak ada.</p>
            ) : (
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {duplicates.map((row) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 p-2.5 dark:border-amber-900"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; masuk{" "}
                        {formatShortDateTime(row.createdAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </TaskGroup>

          {/* NR-19 — tahap pipeline melebihi batas kapasitas (WIP limit) */}
          {wipOver.length > 0 ? (
            <TaskGroup
              icon={Gauge}
              title="Kapasitas Tahap Melebihi Batas"
              description="Jumlah kandidat aktif pada satu tahap melewati batas kapasitas posisi."
              count={wipOver.length}
              tone="amber"
            >
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {wipOver.map((row: WipOverItem) => (
                  <div
                    key={`${row.positionId}-${row.stage}`}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 p-2.5 dark:border-amber-900"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {row.positionTitle ?? "Tanpa posisi"} &mdash; tahap {row.stage}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.count} kandidat (batas {row.limit})
                      </p>
                    </div>
                    <Badge
                      variant="destructive"
                      className="shrink-0 tabular-nums"
                      aria-label={`${row.stage} melebihi batas: ${row.count} dari ${row.limit}`}
                    >
                      {row.count}/{row.limit}
                    </Badge>
                  </div>
                ))}
              </div>
            </TaskGroup>
          ) : null}

          {/* NR-24 — tindak lanjut (snooze) jatuh tempo */}
          {followUps.length > 0 ? (
            <TaskGroup
              icon={Bell}
              title="Tindak Lanjut Jatuh Tempo"
              description="Pengingat tindak lanjut yang jatuh tempo — hubungi kembali kandidat."
              count={followUps.length}
              tone="amber"
            >
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {followUps.map((row: FollowUpItem) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; jatuh tempo{" "}
                        <span
                          className={cn(
                            dueIsUrgent(row.dueAt) && "font-medium text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {formatDateTime(row.dueAt)} ({formatRelative(row.dueAt)})
                        </span>
                      </p>
                    </div>
                    <Badge className="shrink-0 rounded-full border-transparent bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                      Tindak lanjut
                    </Badge>
                    {/* NR55-C — aksi cepat sama dengan panel Perlu Dihubungi Hari Ini. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={workingTasks.has(`actionItem:followup:${row.applicationId}`)}
                      onClick={() => void runFollowUpRowAction(row, "done")}
                    >
                      Selesai
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={workingTasks.has(`actionItem:followup:${row.applicationId}`)}
                      title="Geser tindak lanjut 3 hari ke depan"
                      onClick={() => void runFollowUpRowAction(row, "snooze3")}
                    >
                      Tunda 3 hari
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            </TaskGroup>
          ) : null}

          {/* NR-24 — review lamaran HOLD jatuh tempo */}
          {holdReviews.length > 0 ? (
            <TaskGroup
              icon={PauseCircle}
              title="Review Lamaran Ditahan"
              description="Lamaran HOLD yang saatnya ditinjau kembali sesuai jadwal review."
              count={holdReviews.length}
              tone="amber"
            >
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {holdReviews.map((row: HoldReviewItem) => (
                  <div
                    key={row.applicationId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.positionTitle ?? "Tanpa posisi"} &middot; {holdReasonLabel(row.holdReason)}{" "}
                        &middot; Review:{" "}
                        <span
                          className={cn(
                            dueIsUrgent(row.reviewAt) && "font-medium text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {formatDateTime(row.reviewAt)} ({formatRelative(row.reviewAt)})
                        </span>
                      </p>
                    </div>
                    <Badge className="shrink-0 rounded-full border-transparent bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                      HOLD
                    </Badge>
                    {/* NR55-C — aksi cepat sama dengan panel Perlu Dihubungi Hari Ini. */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={
                        workingTasks.has(`actionItem:hold:${row.applicationId}`) ||
                        !row.holdReason
                      }
                      title="Geser jadwal review HOLD 3 hari ke depan"
                      onClick={() => void runHoldReviewRowAction(row, "snooze3")}
                    >
                      Tunda 3 hari
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                      disabled={workingTasks.has(`actionItem:hold:${row.applicationId}`)}
                      title="Lepas tahanan & kosongkan jadwal review HOLD"
                      onClick={() => void runHoldReviewRowAction(row, "done")}
                    >
                      Lepas HOLD
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            </TaskGroup>
          ) : null}

          {/* NR-24 — tugas uji mendekati/lewat tenggat */}
          {assessmentsDue.length > 0 ? (
            <TaskGroup
              icon={Timer}
              title="Tugas Uji Mendekati Tenggat"
              description="Tugas uji yang belum dikumpul dan tenggatnya dekat atau sudah lewat."
              count={assessmentsDue.length}
              tone="amber"
            >
              <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
                {assessmentsDue.map((row: AssessmentDueItem) => (
                  <div
                    key={row.assessmentId}
                    className="flex flex-wrap items-center gap-2 rounded-xl border p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{row.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {row.name} &middot; {row.positionTitle ?? "Tanpa posisi"} &middot; tenggat{" "}
                        <span
                          className={cn(
                            dueIsUrgent(row.dueAt) && "font-medium text-amber-600 dark:text-amber-400"
                          )}
                        >
                          {formatDateTime(row.dueAt)} ({formatRelative(row.dueAt)})
                        </span>
                      </p>
                    </div>
                    <Badge className="shrink-0 rounded-full border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      Tugas uji
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => openDetail(row.applicationId, row.name)}
                    >
                      <Eye className="size-3.5" aria-hidden="true" />
                      Buka Detail
                    </Button>
                  </div>
                ))}
              </div>
            </TaskGroup>
          ) : null}
        </div>
        )}
        </>
      )}

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={(updated) => {
          setApplications((prev) =>
            prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
          );
          setDetail((prev) => (prev && prev.id === updated.id ? { ...prev, ...updated } : prev));
        }}
        onDeleted={(id) => {
          setApplications((prev) => prev.filter((a) => a.id !== id));
          setDetail(null);
          void loadAll(true);
        }}
      />
    </div>
  );
}
