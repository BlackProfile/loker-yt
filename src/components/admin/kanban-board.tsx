"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarClock,
  Copy,
  GripVertical,
  Hourglass,
  Loader2,
  PauseCircle,
  RotateCcw,
  Sparkles,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  INTERVIEW_MODE_LABELS,
  INTERVIEW_MODES,
  INTERVIEW_PLATFORM_LABELS,
  INTERVIEW_PLATFORMS,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type Application,
  type InterviewMode,
  type InterviewPlatform,
  type RejectionReason,
  type StageKey,
} from "@/lib/types";
import {
  DEFAULT_STAGES,
  OTHER_STAGE_KEY,
  kanbanColumns,
  stageMeta,
} from "@/lib/stages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiGet, apiPatch, apiPost } from "./api";
import { avatarToneOf, formatRelative, initialsOf, localInputToIso } from "./format";
import { useAdminSession } from "./admin-context";
import { AiScoreBadge, DomisiliChip } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { useLiveRefresh } from "./use-live-refresh";
import { cn } from "@/lib/utils";

const COLUMN_ID_PREFIX = "col-";

// Set kosong bersama agar prop duplicateIds opsional tidak membuat Set baru tiap render.
const EMPTY_SET: Set<string> = new Set();

// ------------------ NR-19: batas kapasitas tahap (WIP limit) ------------------

// Baris posisi minimal untuk memuat limits + ambang aging (API mengembalikan
// stageWipLimits terparse dan agingWarnDays).
type PositionLimitsRow = {
  id: string;
  stageWipLimits?: Record<string, number> | null;
  agingWarnDays?: number | null;
};

// Cache modul: limits & ambang aging per posisi dimuat sekali per sesi panel
// (segarkan saat event positions:changed) — dipakai bila parent tidak
// memberikan prop stageWipLimits.
let wipLimitsCache: Record<string, Record<string, number>> | null = null;
let agingWarnCache: Record<string, number> | null = null;

/* ------------------- NR-40: umur tahap, median & bottleneck ------------------- */

const DAY_MS = 86_400_000;
const DEFAULT_AGING_WARN_DAYS = 7;

/**
 * Umur (hari penuh) lamaran di tahap sekarang: dari stageUpdatedAt, fallback
 * createdAt bila kosong (kontrak NR40-0).
 */
function daysInStage(app: Application, nowMs: number): number {
  const iso = app.stageUpdatedAt ?? app.createdAt;
  if (!iso) return 0;
  const anchor = new Date(iso).getTime();
  if (Number.isNaN(anchor)) return 0;
  return Math.max(0, Math.floor((nowMs - anchor) / DAY_MS));
}

/** Median daftar hari (pembulatan ke bawah untuk genap); null bila kosong. */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Warna umur tahap: hijau <= 3 hari, kuning <= ambang, rose > ambang. */
function agingToneClass(days: number, warnDays: number): { dot: string; text: string } {
  if (days <= 3) {
    return { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" };
  }
  if (days <= warnDays) {
    return { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" };
  }
  return { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-400" };
}

/** Chip kecil umur tahap: dot warna + "n h" (n hari di tahap ini). */
function AgingChip({
  app,
  warnDays,
  nowMs,
}: {
  app: Application;
  warnDays: number;
  nowMs: number;
}) {
  const days = daysInStage(app, nowMs);
  const tone = agingToneClass(days, warnDays);
  return (
    <span
      className={cn(
        "inline-flex cursor-help items-center gap-1 text-[10px] font-medium tabular-nums",
        tone.text
      )}
      title={`Umur di tahap ini: ${days} hari (ambang mengendap ${warnDays} hari)`}
    >
      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden="true" />
      {days} h
    </span>
  );
}

/**
 * Hitung pelampauan batas kapasitas satu kolom kanban: kelompokkan kartu kolom
 * per posisi, lalu cek jumlah kartu terhadap limits tiap posisi terkait.
 */
function columnOverLimit(
  column: StageKey,
  columnApps: Application[],
  limitsByPosition: Record<string, Record<string, number>>
): { count: number; limit: number } | null {
  const perPosition = new Map<string, number>();
  for (const app of columnApps) {
    if (!app.positionId) continue;
    perPosition.set(app.positionId, (perPosition.get(app.positionId) ?? 0) + 1);
  }
  for (const [positionId, count] of perPosition) {
    const limit = limitsByPosition[positionId]?.[column];
    if (typeof limit === "number" && count > limit) {
      return { count, limit };
    }
  }
  return null;
}

/** Meta tampilan kolom; kolom "Lainnya" (tahap kustom agregat) memakai tampilan zinc khusus. */
function columnMeta(column: StageKey): { label: string; dot: string; soft: string } {
  if (column === OTHER_STAGE_KEY) {
    return {
      label: "Lainnya",
      dot: "bg-zinc-400",
      soft: "bg-zinc-50 dark:bg-zinc-900/60",
    };
  }
  const meta = stageMeta(column);
  return { label: meta.label, dot: meta.palette.dot, soft: meta.palette.soft };
}

function columnOf(status: StageKey, columns: StageKey[]): StageKey | null {
  if (columns.includes(status)) return status;
  // Tahap di luar daftar kolom (mis. tahap kustom tanpa filter posisi) masuk "Lainnya".
  return columns.includes(OTHER_STAGE_KEY) ? OTHER_STAGE_KEY : null;
}

function buildOrder(apps: Application[], columns: StageKey[]): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const col of columns) order[col] = [];
  for (const app of apps) {
    const col = columnOf(app.status, columns);
    if (col) order[col].push(app.id);
  }
  return order;
}

function KanbanCard({
  app,
  canMutate,
  duplicate,
  warnDays,
  nowMs,
  selected,
  onToggleSelect,
  onOpenDetail,
  onUpdated,
}: {
  app: Application;
  canMutate: boolean;
  duplicate: boolean;
  /** NR-40 — ambang hari "mengendap" untuk kartu ini (dari posisi / default 7). */
  warnDays: number;
  /** Snapshot waktu render (ms) agar umur tahap konsisten antar kartu. */
  nowMs: number;
  /** NR-40 — status pilihan aksi massal kanban. */
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  onOpenDetail: (app: Application) => void;
  onUpdated?: (app: Application) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: app.id,
      disabled: !canMutate,
    });
  const { session, reportError } = useAdminSession();

  // Ringkasan AI: dibuat on-demand dari kartu (fitur Task 20-a).
  const [aiWorking, setAiWorking] = useState(false);

  // NR-40 — batalkan auto-shortlist AI (kontrak PATCH {action:"undo-auto-shortlist"},
  // endpoint dibuat agent PL-1b; kegagalan ditangani gracefully).
  const [undoingAuto, setUndoingAuto] = useState(false);

  async function handleUndoAuto() {
    if (undoingAuto || !canMutate) return;
    setUndoingAuto(true);
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { action: "undo-auto-shortlist" }
      );
      toast.success(`${app.name} dikembalikan dari auto-shortlist`);
      onUpdated?.(updated);
    } catch (err) {
      reportError(err);
      toast.error("Gagal membatalkan auto-shortlist.");
    } finally {
      setUndoingAuto(false);
    }
  }

  // NR-24 fitur 2 — bintang penting personal per admin (tampilkan & toggle dari kartu).
  const starred = Boolean(session && app.starredBy?.includes(session.id));

  async function handleToggleStar() {
    if (!session || !canMutate) return;
    const next = starred
      ? app.starredBy?.filter((id) => id !== session.id) ?? []
      : [...(app.starredBy ?? []), session.id];
    onUpdated?.({ ...app, starredBy: next }); // optimistik
    try {
      const updated = await apiPatch<Application>(`/api/admin/applications/${app.id}`, {
        star: !starred,
      });
      onUpdated?.(updated);
    } catch (err) {
      onUpdated?.(app); // revert
      reportError(err);
      toast.error("Gagal mengubah tanda bintang.");
    }
  }

  async function handleSummarize() {
    if (aiWorking || app.aiSummary) return;
    if (!canMutate) {
      toast.error("Hanya OWNER/HR yang bisa membuat ringkasan AI.");
      return;
    }
    setAiWorking(true);
    toast.loading("Membuat ringkasan AI...", { id: `ai-summary-${app.id}` });
    try {
      const res = await apiPost<{ aiSummary: string; aiAnalyzedAt: string }>(
        `/api/admin/applications/${app.id}/ai-summary`,
      );
      toast.success("Ringkasan AI dibuat", { id: `ai-summary-${app.id}` });
      onUpdated?.({ ...app, aiSummary: res.aiSummary, aiAnalyzedAt: res.aiAnalyzedAt });
    } catch {
      toast.error("Ringkasan AI gagal dibuat, coba lagi.", { id: `ai-summary-${app.id}` });
    } finally {
      setAiWorking(false);
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => {
        onOpenDetail(app);
      }}
      onKeyDown={(e) => {
        // Buka detail dengan keyboard (Enter/Space).
        if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          onOpenDetail(app);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Detail lamaran ${app.name}`}
      className={cn(
        "cursor-grab touch-none rounded-xl border bg-card p-3 shadow-xs outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/50 hover:shadow-md",
        isDragging && "opacity-50 shadow-md"
      )}
    >
      <div className="flex items-start gap-2">
        {/* NR-40 — pilihan aksi massal kanban (tidak memicu drag / detail). */}
        {canMutate ? (
          <span
            className="mt-0.5 shrink-0"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={(v) => onToggleSelect(v === true)}
              aria-label={`Pilih ${app.name} untuk aksi massal`}
            />
          </span>
        ) : null}
        {/* NR-28 (item 7): warna avatar deterministik dari nama. */}
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
            avatarToneOf(app.name)
          )}
        >
          {initialsOf(app.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{app.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {app.positionTitle ?? "Tanpa posisi"}
          </p>
        </div>
        {canMutate && session ? (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              void handleToggleStar();
            }}
            aria-pressed={starred}
            aria-label={starred ? `Hapus tanda bintang dari ${app.name}` : `Tandai ${app.name} penting`}
            title={starred ? "Hapus tanda bintang" : "Tandai penting"}
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-amber-50 focus-visible:ring-2 focus-visible:ring-ring/50 dark:hover:bg-amber-950/40",
              starred ? "text-amber-500" : "text-muted-foreground/50 hover:text-amber-500"
            )}
          >
            <Star className={cn("size-4", starred && "fill-amber-400 text-amber-400")} aria-hidden="true" />
          </button>
        ) : null}
        {canMutate ? (
          <GripVertical
            className="size-4 shrink-0 text-muted-foreground/40"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AiScoreBadge score={app.aiScore} />
        <DomisiliChip domisili={app.domisili} komuterPlan={app.komuterPlan} />
        {/* NR-40 — tag "Auto" untuk lamaran hasil auto-shortlist AI + tombol undo. */}
        {app.autoShortlistedAt ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  title="Dipindah otomatis oleh auto-shortlist AI"
                  className="cursor-help border-amber-300 bg-amber-50 px-1.5 py-0 text-[10px] font-medium text-amber-700 dark:border-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                >
                  <Sparkles className="size-3" aria-hidden="true" />
                  Auto
                </Badge>
              </TooltipTrigger>
              <TooltipContent>Dipindah otomatis oleh auto-shortlist AI</TooltipContent>
            </Tooltip>
            {canMutate ? (
              <button
                type="button"
                disabled={undoingAuto}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleUndoAuto();
                }}
                title="Batalkan auto"
                aria-label={`Batalkan auto-shortlist untuk ${app.name}`}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-amber-50 hover:text-amber-700 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-amber-950/40 dark:hover:text-amber-400"
              >
                {undoingAuto ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="size-3" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </>
        ) : null}
        {app.holdAt ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="cursor-help border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              >
                <PauseCircle className="size-3" aria-hidden="true" />
                Ditahan
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Alur lamaran ditahan sementara</TooltipContent>
          </Tooltip>
        ) : null}
        {duplicate ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="cursor-help border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
              >
                <Copy className="size-3" aria-hidden="true" />
                Duplikat
              </Badge>
            </TooltipTrigger>
            <TooltipContent>Kemungkinan lamaran ganda</TooltipContent>
          </Tooltip>
        ) : null}
        <RatingStars value={app.rating} size="size-3" disabled />
        {/* NR-40 — umur di tahap: dot warna + "n h". */}
        <AgingChip app={app} warnDays={warnDays} nowMs={nowMs} />
      </div>
      {app.aiSummary ? (
        <p className="mt-2 line-clamp-2 rounded-md bg-zinc-50 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground dark:bg-zinc-900/60">
          {app.aiSummary}
        </p>
      ) : (
        <button
          type="button"
          disabled={aiWorking || !canMutate}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void handleSummarize();
          }}
          title={canMutate ? "Buat ringkasan AI" : "Hanya OWNER/HR dapat membuat ringkasan AI"}
          aria-label={`Buat ringkasan AI untuk ${app.name}`}
          className="mt-2 inline-flex h-7 items-center gap-1 rounded-md border border-dashed px-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
        >
          {aiWorking ? (
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-3" aria-hidden="true" />
          )}
          {aiWorking ? "Menganalisis..." : "Buat ringkasan AI"}
        </button>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {formatRelative(app.createdAt)}
      </p>
    </div>
  );
}

function KanbanColumn({
  column,
  isOther,
  apps,
  canMutate,
  duplicateIds,
  overLimit,
  medianDays,
  isBottleneck,
  warnDaysFor,
  nowMs,
  selectedIds,
  onToggleSelect,
  onOpenDetail,
  onUpdated,
}: {
  column: StageKey;
  isOther: boolean;
  apps: Application[];
  canMutate: boolean;
  duplicateIds: Set<string>;
  overLimit?: { count: number; limit: number } | null;
  /** NR-40 — median umur kartu di kolom ini (null bila kosong). */
  medianDays: number | null;
  /** NR-40 — kolom dengan median terbesar (count > 0) mendapat badge bottleneck. */
  isBottleneck: boolean;
  /** NR-40 — ambang hari "mengendap" per lamaran (dari posisinya). */
  warnDaysFor: (app: Application) => number;
  /** Snapshot waktu render (ms). */
  nowMs: number;
  /** NR-40 — pilihan aksi massal kanban. */
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onOpenDetail: (app: Application) => void;
  onUpdated?: (app: Application) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_ID_PREFIX}${column}` });
  const meta = columnMeta(column);

  return (
    <div
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-xl border transition-colors duration-150",
        isOther && "border-dashed",
        isOver ? "border-primary/50 bg-muted/70" : meta.soft
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span className={cn("size-2 rounded-full", meta.dot)} aria-hidden="true" />
        <p className="truncate text-sm font-semibold">{meta.label}</p>
        {/* NR-40 — kolom paling lambat (median umur terbesar) ditandai bottleneck. */}
        {isBottleneck ? (
          <Badge
            className="shrink-0 border-amber-200 bg-amber-100 px-1.5 py-0 text-[10px] font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
            aria-label={`Tahap ${meta.label} menjadi bottleneck: median hari terlama`}
          >
            Bottleneck
          </Badge>
        ) : null}
        {overLimit ? (
          <Badge
            className="shrink-0 border-rose-200 bg-rose-100 px-1.5 py-0 text-[10px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
            aria-label={`Tahap ${meta.label} melebihi batas kapasitas: ${overLimit.count} dari ${overLimit.limit}`}
          >
            Melebihi batas ({overLimit.count}/{overLimit.limit})
          </Badge>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* NR-40 — median hari kandidat berada di tahap ini. */}
          {medianDays !== null ? (
            <span
              className="text-[10px] tabular-nums text-muted-foreground"
              title={`Median hari kandidat berada di tahap ${meta.label}`}
            >
              median {medianDays} h
            </span>
          ) : null}
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
            {apps.length}
          </span>
        </span>
      </div>
      <SortableContext
        items={apps.map((a) => a.id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={cn(
            "flex max-h-[70vh] min-h-24 flex-col gap-2 overflow-y-auto rounded-b-xl p-2 transition-colors duration-150 nice-scrollbar",
            isOver && "bg-accent/60"
          )}
          aria-label={`Kolom ${meta.label}`}
        >
          {apps.length === 0 ? (
            <div
              className={cn(
                "flex min-h-20 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground transition-colors duration-150",
                isOver && "border-primary/50 bg-background/70 text-foreground"
              )}
            >
              Kosong
            </div>
          ) : (
            apps.map((app) => (
              <KanbanCard
                key={app.id}
                app={app}
                canMutate={canMutate}
                duplicate={duplicateIds.has(app.id)}
                warnDays={warnDaysFor(app)}
                nowMs={nowMs}
                selected={selectedIds.has(app.id)}
                onToggleSelect={(checked) => onToggleSelect(app.id, checked)}
                onOpenDetail={(a) => {
                  onOpenDetail(a);
                }}
                onUpdated={onUpdated}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// Papan Kanban pipeline dengan drag & drop (dnd-kit).
// Kolom mengikuti konteks: satu posisi dipilih -> tahap milik posisi;
// tanpa filter posisi -> 5 tahap bawaan + kolom "Lainnya" (tahap kustom).
export function KanbanBoard({
  apps,
  canMutate,
  stages,
  hasPositionFilter,
  duplicateIds,
  stageWipLimits,
  onMove,
  onOpenDetail,
  onUpdated,
}: {
  apps: Application[];
  canMutate: boolean;
  stages: string[] | null | undefined;
  hasPositionFilter: boolean;
  duplicateIds?: Set<string>;
  /** NR-19 — limits posisi terpilih dari parent (opsional). Tanpa prop ini,
   *  limits dimuat sendiri dari /api/admin/positions (cache modul). */
  stageWipLimits?: Record<string, number> | null;
  onMove: (id: string, status: StageKey) => void;
  onOpenDetail: (app: Application) => void;
  onUpdated?: (app: Application) => void;
}) {
  const { reportError } = useAdminSession();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Kolom nyata + kolom "Lainnya".
  const columns = useMemo<StageKey[]>(() => {
    const base = kanbanColumns(stages, hasPositionFilter);
    if (!hasPositionFilter) return [...base, OTHER_STAGE_KEY];
    // Jaga-jaga: ada lamaran dengan tahap di luar daftar tahap posisi.
    const hasOutside = apps.some((a) => !base.includes(a.status));
    return hasOutside ? [...base, OTHER_STAGE_KEY] : base;
  }, [stages, hasPositionFilter, apps]);

  const appsKey = useMemo(
    () => apps.map((a) => `${a.id}:${a.status}`).join("|"),
    [apps]
  );

  const columnsKey = useMemo(() => columns.join("|"), [columns]);

  const baseOrder = useMemo(() => buildOrder(apps, columns), [apps, columns]);

  const appMap = useMemo(() => {
    const map = new Map<string, Application>();
    for (const app of apps) map.set(app.id, app);
    return map;
  }, [apps]);

  // Override urutan lokal (reorder dalam kolom yang sama, tidak dipersist).
  const [overrides, setOverrides] = useState<Record<string, string[]>>({});
  // Reset override saat data dari server atau kolom berubah (pola resmi React:
  // menyesuaikan state saat props berubah, tanpa efek samping).
  const [prevKey, setPrevKey] = useState(`${columnsKey}#${appsKey}`);
  const stateKey = `${columnsKey}#${appsKey}`;
  if (prevKey !== stateKey) {
    setPrevKey(stateKey);
    setOverrides({});
  }

  const justDraggedRef = useRef(false);

  // NR-19 — sumber limits: props (posisi terpilih) atau muat sendiri + cache modul.
  const [fetchedLimits, setFetchedLimits] = useState<Record<string, Record<string, number>>>(
    () => wipLimitsCache ?? {}
  );
  // NR-40 — ambang hari "mengendap" per posisi (dari cache/response positions).
  const [fetchedAging, setFetchedAging] = useState<Record<string, number>>(
    () => agingWarnCache ?? {}
  );

  const loadLimits = useCallback(() => {
    if (stageWipLimits !== undefined) return; // parent sudah memberi limits
    apiGet<PositionLimitsRow[]>("/api/admin/positions")
      .then((rows) => {
        const map: Record<string, Record<string, number>> = {};
        const aging: Record<string, number> = {};
        for (const row of rows) {
          if (row.stageWipLimits) map[row.id] = row.stageWipLimits;
          if (typeof row.agingWarnDays === "number") aging[row.id] = row.agingWarnDays;
        }
        wipLimitsCache = map;
        agingWarnCache = aging;
        setFetchedLimits(map);
        setFetchedAging(aging);
      })
      .catch(() => {
        // Badge kapasitas & ambang aging pelengkap — biarkan data lama/kosong saat gagal.
      });
  }, [stageWipLimits]);

  useEffect(() => {
    loadLimits();
  }, [loadLimits]);

  // Posisi berubah (editor batas kapasitas disimpan) -> segarkan limits.
  useLiveRefresh("positions:changed", loadLimits);

  const limitsByPosition: Record<string, Record<string, number>> = useMemo(() => {
    if (stageWipLimits !== undefined) {
      // Prop berlaku untuk seluruh kolom (konteks satu posisi terpilih) — petakan
      // berdasarkan positionId lamaran yang tampil di papan; null = tanpa batas.
      const map: Record<string, Record<string, number>> = {};
      if (stageWipLimits) {
        for (const app of apps) {
          if (app.positionId) map[app.positionId] = stageWipLimits;
        }
      }
      return map;
    }
    return fetchedLimits;
  }, [stageWipLimits, apps, fetchedLimits]);

  /* ------------------- NR-40 — kesehatan papan & aksi massal ------------------- */

  // Pilihan massal & bar aksi (status/tolak/jadwalkan wawancara).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkStage, setBulkStage] = useState("");
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<RejectionReason | "">("");
  const [bulkRejectNote, setBulkRejectNote] = useState("");
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Filter "Hanya mengendap": tampilkan kartu dengan umur tahap > ambang posisinya.
  const [stalledOnly, setStalledOnly] = useState(false);

  /** Ambang hari mengendap untuk satu lamaran: Position.agingWarnDays ?? 7. */
  const warnDaysFor = useCallback(
    (app: Application): number => {
      if (!app.positionId) return DEFAULT_AGING_WARN_DAYS;
      const value = fetchedAging[app.positionId];
      return typeof value === "number" ? value : DEFAULT_AGING_WARN_DAYS;
    },
    [fetchedAging]
  );

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function runBulk(body: Record<string, unknown>, successMessage: string) {
    if (bulkWorking) return;
    const ids = Array.from(selectedIds).filter((id) => appMap.has(id));
    if (ids.length === 0) {
      setSelectedIds(new Set());
      return;
    }
    setBulkWorking(true);
    try {
      const res = await apiPost<{ ok: boolean; affected: number }>(
        "/api/admin/applications/bulk",
        { ...body, ids }
      );
      toast.success(successMessage.replace("{n}", String(res.affected)));
      setSelectedIds(new Set());
      setBulkStage("");
      // Data lamaran & jadwal diperbarui otomatis: bulk route memancarkan
      // event realtime "applications:changed" (dan "interviews:changed") yang
      // di-respon parent dengan refresh senyap (pola useLiveRefresh).
    } catch (err) {
      reportError(err);
    } finally {
      setBulkWorking(false);
    }
  }

  function handleDragStart(_event: DragStartEvent) {
    justDraggedRef.current = true;
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    // Reset sedikit terlambat agar klik pascadrag tidak membuka detail.
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 80);

    if (!overId) return;

    const activeApp = appMap.get(activeId);
    if (!activeApp) return;
    const sourceColumn = columnOf(activeApp.status, columns);

    let targetColumn: StageKey | null = null;
    if (overId.startsWith(COLUMN_ID_PREFIX)) {
      targetColumn = overId.slice(COLUMN_ID_PREFIX.length);
    } else {
      const overApp = appMap.get(overId);
      targetColumn = overApp ? columnOf(overApp.status, columns) : null;
    }

    if (!sourceColumn || !targetColumn) return;

    // Drop ke kolom "Lainnya" tidak diizinkan: tahap kustom hanya berasal
    // dari pipeline posisi, bukan tujuan pemindahan manual.
    if (targetColumn === OTHER_STAGE_KEY && sourceColumn !== OTHER_STAGE_KEY) {
      toast.info("Tahap kustom tidak bisa dituju — pindahkan ke tahap pipeline yang tersedia.");
      return;
    }

    if (targetColumn !== sourceColumn) {
      // Pindah kolom: parent melakukan update optimistik + PATCH.
      if (targetColumn === OTHER_STAGE_KEY) return;
      onMove(activeId, targetColumn);
    } else {
      // Reorder dalam kolom yang sama (visual saja).
      const current = overrides[sourceColumn] ?? baseOrder[sourceColumn] ?? [];
      const from = current.indexOf(activeId);
      const to = current.indexOf(overId);
      if (from < 0 || to < 0) return;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, activeId);
      setOverrides((prev) => ({ ...prev, [sourceColumn]: next }));
    }
  }

  function handleDragCancel() {
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 80);
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 overflow-x-auto pb-2 nice-scrollbar">
        {columns.map((column) => {
          const ids = overrides[column] ?? baseOrder[column] ?? [];
          const columnApps: Application[] = [];
          for (const id of ids) {
            const app = appMap.get(id);
            if (app) columnApps.push(app);
          }
          // Jaga-jaga: app yang belum tercatat di urutan lokal.
          for (const app of apps) {
            if (columnOf(app.status, columns) === column && !ids.includes(app.id)) {
              columnApps.push(app);
            }
          }
          return (
            <KanbanColumn
              key={column}
              column={column}
              isOther={column === OTHER_STAGE_KEY}
              apps={columnApps}
              canMutate={canMutate}
              duplicateIds={duplicateIds ?? EMPTY_SET}
              overLimit={columnOverLimit(column, columnApps, limitsByPosition)}
              onOpenDetail={(app) => {
                if (justDraggedRef.current) return;
                onOpenDetail(app);
              }}
              onUpdated={onUpdated}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
