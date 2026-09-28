"use client";

import { useMemo, useRef, useState } from "react";
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
import { Copy, GripVertical, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Application, StageKey } from "@/lib/types";
import {
  DEFAULT_STAGES,
  OTHER_STAGE_KEY,
  kanbanColumns,
  stageMeta,
} from "@/lib/stages";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { apiPost } from "./api";
import { formatRelative, initialsOf } from "./format";
import { AiScoreBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { cn } from "@/lib/utils";

const COLUMN_ID_PREFIX = "col-";

// Set kosong bersama agar prop duplicateIds opsional tidak membuat Set baru tiap render.
const EMPTY_SET: Set<string> = new Set();

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
  onOpenDetail,
  onUpdated,
}: {
  app: Application;
  canMutate: boolean;
  duplicate: boolean;
  onOpenDetail: (app: Application) => void;
  onUpdated?: (app: Application) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: app.id,
      disabled: !canMutate,
    });

  // Ringkasan AI: dibuat on-demand dari kartu (fitur Task 20-a).
  const [aiWorking, setAiWorking] = useState(false);

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
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-[10px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
          {initialsOf(app.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{app.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {app.positionTitle ?? "Tanpa posisi"}
          </p>
        </div>
        {canMutate ? (
          <GripVertical
            className="size-4 shrink-0 text-muted-foreground/40"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AiScoreBadge score={app.aiScore} />
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
  onOpenDetail,
  onUpdated,
}: {
  column: StageKey;
  isOther: boolean;
  apps: Application[];
  canMutate: boolean;
  duplicateIds: Set<string>;
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
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {apps.length}
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
  onMove,
  onOpenDetail,
  onUpdated,
}: {
  apps: Application[];
  canMutate: boolean;
  stages: string[] | null | undefined;
  hasPositionFilter: boolean;
  duplicateIds?: Set<string>;
  onMove: (id: string, status: StageKey) => void;
  onOpenDetail: (app: Application) => void;
  onUpdated?: (app: Application) => void;
}) {
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
