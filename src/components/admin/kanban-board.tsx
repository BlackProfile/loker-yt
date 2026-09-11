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
import { GripVertical } from "lucide-react";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus,
} from "@/lib/types";
import { formatRelative, initialsOf } from "./format";
import { STATUS_DOT_COLORS, AiScoreBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { cn } from "@/lib/utils";

const COLUMN_ID_PREFIX = "col-";

function emptyOrder(): Record<ApplicationStatus, string[]> {
  return { NEW: [], REVIEWED: [], INTERVIEW: [], ACCEPTED: [], REJECTED: [] };
}

function buildOrder(apps: Application[]): Record<ApplicationStatus, string[]> {
  const order = emptyOrder();
  for (const app of apps) {
    if (order[app.status]) order[app.status].push(app.id);
  }
  return order;
}

function KanbanCard({
  app,
  canMutate,
  onOpenDetail,
}: {
  app: Application;
  canMutate: boolean;
  onOpenDetail: (app: Application) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: app.id,
      disabled: !canMutate,
    });

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
        <RatingStars value={app.rating} size="size-3" disabled />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {formatRelative(app.createdAt)}
      </p>
    </div>
  );
}

function KanbanColumn({
  status,
  apps,
  canMutate,
  onOpenDetail,
}: {
  status: ApplicationStatus;
  apps: Application[];
  canMutate: boolean;
  onOpenDetail: (app: Application) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${COLUMN_ID_PREFIX}${status}` });

  return (
    <div
      className={cn(
        "flex w-[280px] shrink-0 flex-col rounded-xl border transition-colors duration-150",
        isOver ? "border-primary/40 bg-muted/70" : "bg-muted/40"
      )}
    >
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <span
          className={`size-2 rounded-full ${STATUS_DOT_COLORS[status]}`}
          aria-hidden="true"
        />
        <p className="text-sm font-semibold">{STATUS_LABELS[status]}</p>
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
          aria-label={`Kolom ${STATUS_LABELS[status]}`}
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
                onOpenDetail={(a) => {
                  onOpenDetail(a);
                }}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

// Papan Kanban pipeline dengan drag & drop (dnd-kit).
export function KanbanBoard({
  apps,
  canMutate,
  onMove,
  onOpenDetail,
}: {
  apps: Application[];
  canMutate: boolean;
  onMove: (id: string, status: ApplicationStatus) => void;
  onOpenDetail: (app: Application) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const appsKey = useMemo(
    () => apps.map((a) => `${a.id}:${a.status}`).join("|"),
    [apps]
  );

  const baseOrder = useMemo(() => buildOrder(apps), [apps]);

  const appMap = useMemo(() => {
    const map = new Map<string, Application>();
    for (const app of apps) map.set(app.id, app);
    return map;
  }, [apps]);

  // Override urutan lokal (reorder dalam kolom yang sama, tidak dipersist).
  const [overrides, setOverrides] = useState<
    Partial<Record<ApplicationStatus, string[]>>
  >({});
  // Reset override saat data dari server berubah (pola resmi React:
  // menyesuaikan state saat props berubah, tanpa efek samping).
  const [prevAppsKey, setPrevAppsKey] = useState(appsKey);
  if (prevAppsKey !== appsKey) {
    setPrevAppsKey(appsKey);
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

    const sourceStatus = appMap.get(activeId)?.status;
    let targetStatus: ApplicationStatus | null = null;
    if (overId.startsWith(COLUMN_ID_PREFIX)) {
      targetStatus = overId.slice(COLUMN_ID_PREFIX.length) as ApplicationStatus;
    } else {
      targetStatus = appMap.get(overId)?.status ?? null;
    }

    if (!sourceStatus || !targetStatus) return;

    if (targetStatus !== sourceStatus) {
      // Pindah kolom: parent melakukan update optimistik + PATCH.
      onMove(activeId, targetStatus);
    } else {
      // Reorder dalam kolom yang sama (visual saja).
      const current = overrides[sourceStatus] ?? baseOrder[sourceStatus];
      const from = current.indexOf(activeId);
      const to = current.indexOf(overId);
      if (from < 0 || to < 0) return;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, activeId);
      setOverrides((prev) => ({ ...prev, [sourceStatus]: next }));
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
        {APPLICATION_STATUSES.map((status) => {
          const ids = overrides[status] ?? baseOrder[status];
          const columnApps: Application[] = [];
          for (const id of ids) {
            const app = appMap.get(id);
            if (app) columnApps.push(app);
          }
          // Jaga-jaga: app yang belum tercatat di urutan lokal.
          for (const app of apps) {
            if (app.status === status && !ids.includes(app.id)) {
              columnApps.push(app);
            }
          }
          return (
            <KanbanColumn
              key={status}
              status={status}
              apps={columnApps}
              canMutate={canMutate}
              onOpenDetail={(app) => {
                if (justDraggedRef.current) return;
                onOpenDetail(app);
              }}
            />
          );
        })}
      </div>
    </DndContext>
  );
}
