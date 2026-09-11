"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Download,
  Inbox,
  LayoutGrid,
  Loader2,
  RotateCcw,
  Search,
  Table2,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_SOURCES,
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type Application,
  type Position,
  type RejectionReason,
  type StageKey,
} from "@/lib/types";
import {
  DEFAULT_STAGES,
  OTHER_STAGE_KEY,
  isBuiltInStage,
  stageLabel,
  stagesForPosition,
} from "@/lib/stages";
import { apiDelete, apiGet, apiPatch, apiPost, buildQuery } from "./api";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { ApplicationDetailDialog } from "./application-detail-dialog";
import { ApplicationsTable } from "./applications-table";
import { KanbanBoard } from "./kanban-board";
import { ComparisonDialog } from "./comparison-dialog";
import { Reveal } from "./motion-primitives";
import { cn } from "@/lib/utils";

const ALL = "ALL";

const FILTER_TRIGGER_CLASS = "h-10 w-full rounded-xl";

const SORT_OPTIONS = [
  { value: "newest", label: "Terbaru" },
  { value: "oldest", label: "Terlama" },
  { value: "aiScore", label: "Skor AI" },
] as const;

type ViewMode = "table" | "kanban";

export function ApplicationsTab() {
  const { canMutate, reportError } = useAdminSession();

  const [applications, setApplications] = useState<Application[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [positionFilter, setPositionFilter] = useState<string>(ALL);
  const [sourceFilter, setSourceFilter] = useState<string>(ALL);
  const [sort, setSort] = useState<string>("newest");
  const [ratingMin, setRatingMin] = useState<string>("");
  const [tag, setTag] = useState<string>(ALL);
  const [talentPool, setTalentPool] = useState(false);
  const [hasInterview, setHasInterview] = useState(false);

  const [allTags, setAllTags] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("table");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<string>("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkRejectReason, setBulkRejectReason] = useState<RejectionReason | "">("");
  const [bulkRejectNote, setBulkRejectNote] = useState("");

  const [detail, setDetail] = useState<Application | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);

  // Posisi terpilih menentukan opsi tahap (pipeline kustom vs bawaan).
  const selectedPosition = useMemo(
    () =>
      positionFilter !== ALL
        ? positions.find((p) => p.id === positionFilter) ?? null
        : null,
    [positions, positionFilter]
  );

  // Opsi filter tahap: dengan posisi -> tahap milik posisi;
  // tanpa posisi -> 5 bawaan + "Lainnya" (tahap kustom, disaring client-side).
  const stageOptions = useMemo<StageKey[]>(
    () =>
      selectedPosition
        ? stagesForPosition(selectedPosition.stages)
        : [...DEFAULT_STAGES, OTHER_STAGE_KEY],
    [selectedPosition]
  );

  // Tahap nyata untuk bulk change (tanpa opsi "Lainnya").
  const bulkStageOptions = useMemo<StageKey[]>(
    () =>
      selectedPosition ? stagesForPosition(selectedPosition.stages) : [...DEFAULT_STAGES],
    [selectedPosition]
  );

  const isOtherStageFilter = statusFilter === OTHER_STAGE_KEY;

  const activeQuery = useMemo(() => {
    return buildQuery({
      q: q || undefined,
      // "Lainnya" tidak dikirim ke server: fetch tanpa filter status,
      // lalu disaring client-side (status bukan 5 bawaan).
      status:
        statusFilter !== ALL && !isOtherStageFilter ? statusFilter : undefined,
      positionId: positionFilter !== ALL ? positionFilter : undefined,
      source: sourceFilter !== ALL ? sourceFilter : undefined,
      sort: sort !== "newest" ? sort : undefined,
      ratingMin: ratingMin !== "" ? ratingMin : undefined,
      tag: tag !== ALL ? tag : undefined,
      talentPool: talentPool ? "1" : undefined,
      hasInterview: hasInterview ? "1" : undefined,
    });
  }, [
    q,
    statusFilter,
    isOtherStageFilter,
    positionFilter,
    sourceFilter,
    sort,
    ratingMin,
    tag,
    talentPool,
    hasInterview,
  ]);

  const hasActiveFilter =
    q !== "" ||
    statusFilter !== ALL ||
    positionFilter !== ALL ||
    sourceFilter !== ALL ||
    sort !== "newest" ||
    ratingMin !== "" ||
    tag !== ALL ||
    talentPool ||
    hasInterview;

  const loadPositions = useCallback(async () => {
    try {
      const data = await apiGet<Position[]>("/api/admin/positions");
      setPositions(data);
    } catch {
      // Filter posisi opsional; abaikan error fetch daftar posisi.
    }
  }, []);

  // silent: refresh senyap (dipakai event realtime) — daftar lama tetap tampil
  // sampai data baru siap, tanpa skeleton ulang dan tanpa flash kosong.
  const loadApplications = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await apiGet<Application[]>(
          `/api/admin/applications${activeQuery}`
        );
        setApplications(data);
        // Kumpulkan tag unik untuk pilihan filter.
        setAllTags((prev) => {
          const set = new Set(prev);
          for (const app of data) for (const t of app.tags) set.add(t);
          return Array.from(set).sort((a, b) => a.localeCompare(b, "id"));
        });
      } catch (err) {
        reportError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [activeQuery, reportError]
  );

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  // Realtime: lamaran baru/perubahan status/skor AI → segarkan daftar senyap.
  useLiveRefresh("applications:changed", () => {
    void loadApplications(true);
  });
  // Posisi baru/diubah/hapus → opsi filter posisi tetap segar (senyap).
  useLiveRefresh("positions:changed", () => {
    void loadPositions();
  });

  function applySearch() {
    setQ(searchInput.trim());
  }

  // Saat konteks posisi berubah, buang filter tahap yang tak berlaku lagi
  // (mis. tahap kustom posisi lain atau opsi "Lainnya").
  function changePositionFilter(value: string) {
    setPositionFilter(value);
    if (value === ALL) {
      // Kembali ke semua posisi: hanya tahap bawaan yang tetap berlaku.
      if (statusFilter !== ALL && !isBuiltInStage(statusFilter)) {
        setStatusFilter(ALL);
      }
      return;
    }
    const position = positions.find((p) => p.id === value);
    const options = position ? stagesForPosition(position.stages) : [];
    if (statusFilter !== ALL && !options.includes(statusFilter)) {
      setStatusFilter(ALL);
    }
  }

  function resetFilters() {
    setSearchInput("");
    setQ("");
    setStatusFilter(ALL);
    setPositionFilter(ALL);
    setSourceFilter(ALL);
    setSort("newest");
    setRatingMin("");
    setTag(ALL);
    setTalentPool(false);
    setHasInterview(false);
  }

  function toggleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  // Lamaran tampil: dengan filter "Lainnya", sisakan yang tahapnya di luar 5 bawaan.
  const displayedApplications = useMemo(() => {
    if (!isOtherStageFilter) return applications;
    return applications.filter((a) => !isBuiltInStage(a.status));
  }, [applications, isOtherStageFilter]);

  function toggleSelectAll(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        for (const app of displayedApplications) next.add(app.id);
      } else {
        for (const app of displayedApplications) next.delete(app.id);
      }
      return next;
    });
  }

  function toggleCompare(app: Application) {
    setCompareIds((prev) => {
      if (prev.includes(app.id)) {
        return prev.filter((id) => id !== app.id);
      }
      if (prev.length >= 3) {
        toast.info("Maksimal 3 kandidat — kandidat pertama diganti.");
        return [...prev.slice(1), app.id];
      }
      return [...prev, app.id];
    });
  }

  function updateAppInList(updated: Application) {
    setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    setDetail((prev) => (prev && prev.id === updated.id ? updated : prev));
  }

  async function handleRate(app: Application, rating: number) {
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { rating }
      );
      toast.success(`Rating disimpan (${rating}/5)`);
      updateAppInList(updated);
    } catch (err) {
      reportError(err);
    }
  }

  // Pindah kolom kanban: optimistik + PATCH, revert bila gagal.
  function handleKanbanMove(id: string, status: StageKey) {
    const previous = applications;
    const target = stageLabel(status);
    setApplications((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status } : a))
    );
    apiPatch<Application>(`/api/admin/applications/${id}`, { status })
      .then((updated) => {
        toast.success(`Status diubah ke ${target}`);
        updateAppInList(updated);
      })
      .catch((err) => {
        setApplications(previous);
        reportError(err);
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
      setBulkStatus("");
      await loadApplications();
    } catch (err) {
      reportError(err);
    } finally {
      setBulkWorking(false);
      setBulkDeleteOpen(false);
    }
  }

  // Tolak massal dengan alasan terstruktur (POST /api/admin/applications/bulk).
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

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(
        `/api/admin/applications/${deleteTarget.id}`
      );
      toast.success("Lamaran dihapus");
      setApplications((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      setDetail(null);
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  const comparedApps = useMemo(
    () =>
      compareIds
        .map((id) => displayedApplications.find((a) => a.id === id))
        .filter((a): a is Application => Boolean(a)),
    [compareIds, displayedApplications]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar filter */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applySearch();
              }}
              onBlur={applySearch}
              placeholder="Cari nama atau email..."
              aria-label="Cari nama atau email pelamar"
              className="h-10 rounded-xl pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Toggle tampilan */}
            <div className="flex items-center gap-1 rounded-xl border p-1">
              <Button
                variant={view === "table" ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-8", view === "table" && "shadow-xs")}
                onClick={() => setView("table")}
                aria-pressed={view === "table"}
              >
                <Table2 className="size-4" aria-hidden="true" />
                Tabel
              </Button>
              <Button
                variant={view === "kanban" ? "secondary" : "ghost"}
                size="sm"
                className={cn("h-8", view === "kanban" && "shadow-xs")}
                onClick={() => setView("kanban")}
                aria-pressed={view === "kanban"}
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
                Kanban
              </Button>
            </div>
            {/* Export CSV */}
            <a
              href={`/api/admin/applications/export${activeQuery}`}
              download
              className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-xl")}
              aria-label="Ekspor daftar lamaran ke CSV"
            >
              <Download className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Export CSV</span>
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter tahap">
              <SelectValue placeholder="Semua Tahap" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Tahap</SelectItem>
              {stageOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === OTHER_STAGE_KEY ? "Lainnya (tahap kustom)" : stageLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={positionFilter}
            onValueChange={changePositionFilter}
          >
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter posisi">
              <SelectValue placeholder="Semua Posisi" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Posisi</SelectItem>
              {positions.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter sumber pelamar">
              <SelectValue placeholder="Semua Sumber" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Sumber</SelectItem>
              {APPLICATION_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Urutkan">
              <SelectValue placeholder="Urutkan" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={ratingMin} onValueChange={setRatingMin}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter rating minimum">
              <SelectValue placeholder="Semua Rating" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-rating">Semua Rating</SelectItem>
              {[1, 2, 3, 4, 5].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Rating &#8805; {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={tag === ALL ? "all-tag" : tag}
            onValueChange={(v) => setTag(v === "all-tag" ? ALL : v)}
          >
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter tag">
              <SelectValue placeholder="Semua Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all-tag">Semua Tag</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch
              checked={talentPool}
              onCheckedChange={setTalentPool}
              aria-label="Filter Talent Pool"
            />
            Talent Pool
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch
              checked={hasInterview}
              onCheckedChange={setHasInterview}
              aria-label="Filter ada jadwal wawancara"
            />
            Ada Jadwal Wawancara
          </label>
          {hasActiveFilter ? (
            <Button
              variant="outline"
              onClick={resetFilters}
              className="h-9 rounded-xl"
              aria-label="Reset filter"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Reset Filter
            </Button>
          ) : null}
          <p className="ml-auto text-xs text-muted-foreground">
            {loading
              ? "Memuat..."
              : `${displayedApplications.length} lamaran ditampilkan`}
          </p>
        </div>
      </div>

      {/* Loading — skeleton hanya saat pemuatan pertama (belum ada data); saat
          refresh (filter/event realtime) daftar lama tetap tampil. */}
      {loading && applications.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : applications.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Inbox className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada lamaran yang cocok dengan filter.
            </p>
          </CardContent>
        </Card>
      ) : view === "table" ? (
        <ApplicationsTable
          applications={displayedApplications}
          canMutate={canMutate}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          compareIds={compareIds}
          onToggleCompare={toggleCompare}
          onOpenDetail={setDetail}
          onDeleteRequest={setDeleteTarget}
          onRate={(app, rating) => void handleRate(app, rating)}
        />
      ) : (
        <KanbanBoard
          apps={displayedApplications}
          canMutate={canMutate}
          stages={selectedPosition?.stages}
          hasPositionFilter={positionFilter !== ALL}
          onMove={handleKanbanMove}
          onOpenDetail={setDetail}
        />
      )}

      {/* Bulk bar */}
      {canMutate && selectedIds.size > 0 ? (
        <Reveal
          slideY={8}
          duration={0.2}
          className="sticky bottom-4 z-20"
        >
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-rose-200 bg-rose-50/95 p-3 backdrop-blur dark:border-rose-900 dark:bg-rose-950/90">
          <span className="text-sm font-semibold">
            {selectedIds.size} dipilih
          </span>
          <Select value={bulkStatus || "bulk-empty"} onValueChange={setBulkStatus}>
            <SelectTrigger
              className="h-9 w-full rounded-lg bg-background sm:w-48"
              aria-label="Ubah tahap terpilih"
            >
              <SelectValue placeholder="Ubah tahap ke..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bulk-empty" disabled>
                Ubah tahap ke...
              </SelectItem>
              {bulkStageOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {stageLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="h-9 active:scale-[0.99]"
            disabled={!bulkStatus || bulkWorking}
            onClick={() =>
              void runBulk(
                { ids: Array.from(selectedIds), action: "status", status: bulkStatus },
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
            Talent Pool
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 border-rose-200 bg-background text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
            disabled={bulkWorking}
            onClick={() => setBulkRejectOpen(true)}
          >
            <XCircle className="size-4" aria-hidden="true" />
            Tolak
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="h-9"
            disabled={bulkWorking}
            onClick={() => setBulkDeleteOpen(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            Hapus
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-9"
            onClick={() => setSelectedIds(new Set())}
            disabled={bulkWorking}
          >
            Bersihkan pilihan
          </Button>
          </div>
        </Reveal>
      ) : null}

      {/* Bar perbandingan melayang */}
      {comparedApps.length > 0 && !compareOpen ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <Reveal
            slideY={10}
            duration={0.25}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="pointer-events-auto"
          >
            <Button
              className="h-11 rounded-full px-5 shadow-lg"
              onClick={() => setCompareOpen(true)}
              aria-label={`Bandingkan ${comparedApps.length} kandidat`}
            >
              Bandingkan ({comparedApps.length})
            </Button>
          </Reveal>
        </div>
      ) : null}

      <ComparisonDialog
        apps={compareOpen ? comparedApps : []}
        onOpenChange={setCompareOpen}
      />

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={updateAppInList}
        onDeleted={(id) =>
          setApplications((prev) => prev.filter((a) => a.id !== id))
        }
      />

      {/* Konfirmasi hapus dari baris */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus lamaran ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Lamaran ${deleteTarget.name} akan dihapus permanen. Tindakan tidak bisa dibatalkan.`
                : "Tindakan tidak bisa dibatalkan."}
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
              {deleting ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi hapus massal */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {selectedIds.size} lamaran?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua lamaran terpilih akan dihapus permanen. Tindakan tidak bisa
              dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkWorking}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void runBulk(
                  { ids: Array.from(selectedIds), action: "delete" },
                  "{n} lamaran dihapus"
                );
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={bulkWorking}
            >
              {bulkWorking ? "Menghapus..." : "Ya, Hapus Semua"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog tolak massal */}
      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tolak {selectedIds.size} lamaran?</DialogTitle>
            <DialogDescription>
              Semua lamaran terpilih akan berstatus Ditolak dengan alasan yang sama.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bulk-reject-reason">Alasan Penolakan</Label>
              <Select
                value={bulkRejectReason || "__pilih__"}
                onValueChange={(v) => setBulkRejectReason(v as RejectionReason)}
                disabled={bulkWorking}
              >
                <SelectTrigger
                  id="bulk-reject-reason"
                  className="h-11 w-full sm:h-10"
                  aria-label="Alasan penolakan massal"
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
              <Label htmlFor="bulk-reject-note">Catatan (opsional)</Label>
              <Textarea
                id="bulk-reject-note"
                value={bulkRejectNote}
                onChange={(e) => setBulkRejectNote(e.target.value)}
                placeholder="Catatan internal untuk seluruh lamaran terpilih"
                rows={3}
                maxLength={1000}
                disabled={bulkWorking}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkRejectOpen(false)}
              disabled={bulkWorking}
              className="h-11 sm:h-9"
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleBulkReject()}
              disabled={bulkWorking || !bulkRejectReason}
              className="h-11 active:scale-[0.99] sm:h-9"
            >
              {bulkWorking ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menolak...
                </>
              ) : (
                `Tolak ${selectedIds.size} Lamaran`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
