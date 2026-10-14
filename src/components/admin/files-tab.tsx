"use client";

// NR56 — Tab "Berkas": pusat kelola seluruh media yang diunggah pengguna & admin.
// Satu daftar terpusat untuk semua FileAsset (CV, intro, cover, dokumen, hasil tes,
// PDF offer, draft) lengkap dengan referensi pemakaiannya, statistik penyimpanan,
// deteksi berkas yatim, dan aksi lengkap: lihat, unduh, ganti nama, ganti isi,
// hapus (dengan pengaman referensi), serta aksi massal khusus OWNER.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  Download,
  File as FileIcon,
  FileAudio,
  FileStack,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  Replace,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FILE_ASSET_KINDS, type AdminFileItem } from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "./api";
import { useAdminSession } from "./admin-context";
import { formatBytes, formatDateTime } from "./format";
import { AdminFileViewerDialog } from "./file-viewer-dialog";

// Ambang peringatan penyimpanan (klien): kun bila lewat, merah bila lewat batas keras.
const STORAGE_WARN_BYTES = 200 * 1024 * 1024;
const STORAGE_DANGER_BYTES = 500 * 1024 * 1024;

type SortKey = "newest" | "oldest" | "largest" | "smallest" | "name";
type KindFilter = "ALL" | (typeof FILE_ASSET_KINDS)[number];

const KIND_LABELS: Record<string, string> = {
  CV: "CV",
  INTRO: "Intro",
  COVER: "Cover Posisi",
  DOC: "Dokumen",
  OFFER_PDF: "PDF Offer",
  DRAFT: "Draft",
  OTHER: "Lainnya",
};

const KIND_BADGE_CLASS: Record<string, string> = {
  CV: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-400",
  INTRO: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  COVER: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-400",
  DOC: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-950/40 dark:text-teal-400",
  OFFER_PDF: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/40 dark:bg-orange-950/40 dark:text-orange-400",
  DRAFT: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  OTHER: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function kindLabel(kind: string | null): string {
  if (!kind) return "Lainnya";
  return KIND_LABELS[kind] ?? kind;
}

function kindBadgeClass(kind: string | null): string {
  return KIND_BADGE_CLASS[kind ?? "OTHER"] ?? KIND_BADGE_CLASS.OTHER;
}

/** Ikon berdasarkan ekstensi/MIME — gambar dirender sebagai thumbnail asli. */
function isImageMime(mimeType: string, filename: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif)$/i.test(filename);
}

function FileThumb({ item }: { item: AdminFileItem }) {
  if (isImageMime(item.mimeType, item.filename)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${encodeURIComponent(item.id)}?inline=1`}
        alt={item.filename}
        loading="lazy"
        className="size-10 shrink-0 rounded-lg border object-cover"
      />
    );
  }
  const lower = item.filename.toLowerCase();
  const mime = item.mimeType.toLowerCase();
  const Icon = mime.includes("pdf") || /\.(pdf|docx?|pptx?|xlsx?|txt|md|csv)$/i.test(lower)
    ? FileText
    : mime.startsWith("video/") || /\.(mp4|webm|mov|mkv)$/i.test(lower)
      ? FileVideo
      : mime.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg)$/i.test(lower)
        ? FileAudio
        : /\.(zip|rar|7z)$/i.test(lower)
          ? FileStack
          : FileIcon;
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted/50">
      <Icon className="size-5 text-muted-foreground" aria-hidden="true" />
    </span>
  );
}

/** Ringkasan referensi satu baris: "milik siapa". */
function RefsSummary({ item }: { item: AdminFileItem }) {
  const { refs } = item;
  const parts: string[] = [];
  for (const app of refs.applications.slice(0, 2)) {
    const code = app.trackingCode ? ` (${app.trackingCode})` : "";
    const sources = app.sources.length > 0 ? ` — ${app.sources.join(", ")}` : "";
    parts.push(`Pelamar: ${app.name}${code}${sources}`);
  }
  if (refs.applications.length > 2) parts.push(`+${refs.applications.length - 2} lamaran lain`);
  for (const pos of refs.positions) parts.push(`Cover posisi: ${pos.title}`);
  for (const asmt of refs.assessments.slice(0, 2)) parts.push(`Hasil tugas uji: ${asmt.title}`);
  if (refs.assessments.length > 2) parts.push(`+${refs.assessments.length - 2} tugas uji lain`);
  for (const doc of refs.internalDocs.slice(0, 2)) parts.push(`Dokumen internal: ${doc.label}`);
  if (refs.internalDocs.length > 2) parts.push(`+${refs.internalDocs.length - 2} dokumen internal`);
  for (const draft of refs.drafts.slice(0, 1)) parts.push(`Draft lamaran: ${draft.email}`);
  if (refs.drafts.length > 1) parts.push(`+${refs.drafts.length - 1} draft lain`);
  if (refs.interviews > 0) parts.push(`Rekaman wawancara (${refs.interviews})`);

  if (parts.length === 0) return null;
  return (
    <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={parts.join(" • ")}>
      {parts.join(" • ")}
    </p>
  );
}

export function FilesTab() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";
  const canDownload = role !== "VIEWER";

  const [items, setItems] = useState<AdminFileItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [onlyOrphan, setOnlyOrphan] = useState(false);
  const [sort, setSort] = useState<SortKey>("newest");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const [previewFile, setPreviewFile] = useState<AdminFileItem | null>(null);
  const [renameTarget, setRenameTarget] = useState<AdminFileItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminFileItem | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<AdminFileItem | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [bulkIds, setBulkIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const data = await apiGet<{ items: AdminFileItem[] }>("/api/admin/files");
        setItems(data.items);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          reportError(error);
          return;
        }
        reportError(error);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const all = items ?? [];
    const perKind = new Map<string, { count: number; size: number }>();
    let totalSize = 0;
    let orphanCount = 0;
    let orphanSize = 0;
    for (const item of all) {
      totalSize += item.size;
      const key = item.kind ?? "OTHER";
      const entry = perKind.get(key) ?? { count: 0, size: 0 };
      entry.count += 1;
      entry.size += item.size;
      perKind.set(key, entry);
      if (item.orphan) {
        orphanCount += 1;
        orphanSize += item.size;
      }
    }
    return { total: all.length, totalSize, perKind, orphanCount, orphanSize };
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = (items ?? []).filter((item) => {
      if (kindFilter !== "ALL" && (item.kind ?? "OTHER") !== kindFilter) return false;
      if (onlyOrphan && !item.orphan) return false;
      if (needle && !item.filename.toLowerCase().includes(needle)) return false;
      return true;
    });
    switch (sort) {
      case "oldest":
        list = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        break;
      case "largest":
        list = [...list].sort((a, b) => b.size - a.size);
        break;
      case "smallest":
        list = [...list].sort((a, b) => a.size - b.size);
        break;
      case "name":
        list = [...list].sort((a, b) => a.filename.localeCompare(b.filename));
        break;
      default:
        list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return list;
  }, [items, q, kindFilter, onlyOrphan, sort]);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectedReferenced = useMemo(
    () => (items ?? []).filter((i) => selected.has(i.id) && !i.orphan).length,
    [items, selected],
  );

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = (): void => {
    setSelected(new Set(filtered.map((i) => i.id)));
  };

  const clearSelection = (): void => setSelected(new Set());

  const replaceItem = (item: AdminFileItem): void => {
    setItems((prev) => (prev ? prev.map((row) => (row.id === item.id ? item : row)) : prev));
  };

  const removeItem = (id: string): void => {
    setItems((prev) => (prev ? prev.filter((row) => row.id !== id) : prev));
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // --- Aksi per berkas -------------------------------------------------------

  const confirmRename = async (): Promise<boolean> => {
    if (!renameTarget) return false;
    const name = renameValue.trim();
    if (!name) {
      toast.error("Nama berkas wajib diisi.");
      return false;
    }
    setBusyId(renameTarget.id);
    try {
      const data = await apiPatch<{ item: AdminFileItem }>(
        `/api/admin/files/${encodeURIComponent(renameTarget.id)}`,
        { filename: name },
      );
      replaceItem(data.item);
      toast.success("Nama berkas diperbarui.");
      setRenameTarget(null);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const openReplacePicker = (item: AdminFileItem): void => {
    setReplaceTarget(item);
    // Beri waktu state tersimpan sebelum picker dibuka.
    requestAnimationFrame(() => replaceInputRef.current?.click());
  };

  const onReplacePicked = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !replaceTarget) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Ukuran berkas maksimal 10 MB.");
      return;
    }
    setReplaceTarget({ ...replaceTarget });
    setPendingReplace(file);
  };

  const [pendingReplace, setPendingReplace] = useState<File | null>(null);

  const confirmReplace = async (): Promise<boolean> => {
    if (!replaceTarget || !pendingReplace) return false;
    setReplaceBusy(true);
    try {
      const form = new FormData();
      form.set("file", pendingReplace);
      const res = await fetch(`/api/admin/files/${encodeURIComponent(replaceTarget.id)}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new ApiError(body?.error ?? "Terjadi kesalahan. Coba lagi.", res.status);
      }
      const data = (await res.json()) as { item: AdminFileItem };
      replaceItem(data.item);
      toast.success("Isi berkas berhasil diganti.");
      setReplaceTarget(null);
      setPendingReplace(null);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        reportError(error);
      } else {
        reportError(error);
      }
      return false;
    } finally {
      setReplaceBusy(false);
    }
  };

  const confirmDelete = async (): Promise<boolean> => {
    if (!deleteTarget) return false;
    const referenced = !deleteTarget.orphan;
    setBusyId(deleteTarget.id);
    try {
      const query = referenced ? "?confirm=YA" : "";
      await apiDelete(`/api/admin/files/${encodeURIComponent(deleteTarget.id)}${query}`);
      removeItem(deleteTarget.id);
      toast.success(`Berkas "${deleteTarget.filename}" dihapus.`);
      setDeleteTarget(null);
      return true;
    } catch (error) {
      reportError(error);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  // --- Aksi massal -----------------------------------------------------------

  const runBulkDelete = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const data = await apiPost<{ deleted: number; skipped: { filename: string; reason: string }[] }>(
        "/api/admin/files/bulk",
        { ids, confirm: true },
      );
      const skipped = data.skipped.length;
      if (data.deleted > 0) {
        toast.success(
          skipped > 0
            ? `${data.deleted} berkas dihapus, ${skipped} dilewati.`
            : `${data.deleted} berkas dihapus.`,
        );
      } else if (skipped > 0) {
        toast.error("Tidak ada berkas yang dihapus — semua dilewati.");
      }
      await load(true);
      clearSelection();
    } catch (error) {
      reportError(error);
    } finally {
      setBulkBusy(false);
      setBulkOpen(false);
    }
  };

  const openBulkDelete = (ids: string[]): void => {
    if (ids.length === 0) return;
    setBulkIds(ids);
    setBulkOpen(true);
  };

  const cleanOrphans = (): void => {
    const orphanIds = (items ?? []).filter((i) => i.orphan).map((i) => i.id);
    if (orphanIds.length === 0) {
      toast.info("Tidak ada berkas yatim saat ini.");
      return;
    }
    openBulkDelete(orphanIds);
  };

  const busyBulk = bulkBusy;
  const hasFilter = q.trim() !== "" || kindFilter !== "ALL" || onlyOrphan;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold sm:text-xl">
            <FileStack className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Berkas
          </h1>
          <p className="text-sm text-muted-foreground">
            Kelola semua media yang diunggah pelamar & admin: CV, intro, cover, dokumen, hasil tes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner ? (
            <Button
              variant="outline"
              className="h-11 gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:h-9 dark:border-rose-500/40 dark:text-rose-400 dark:hover:bg-rose-950/40"
              onClick={cleanOrphans}
              disabled={busyBulk || (items?.every((i) => !i.orphan) ?? true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Bersihkan Yatim{stats.orphanCount > 0 ? ` (${stats.orphanCount})` : ""}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 sm:h-9 sm:w-9"
            onClick={() => void load()}
            aria-label="Muat ulang daftar berkas"
            disabled={loading}
          >
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Statistik penyimpanan */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Total Berkas</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{stats.total}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Ukuran Total</p>
              <p
                className={`mt-0.5 flex items-center gap-1.5 text-lg font-bold tabular-nums ${
                  stats.totalSize > STORAGE_DANGER_BYTES
                    ? "text-rose-600 dark:text-rose-400"
                    : stats.totalSize > STORAGE_WARN_BYTES
                      ? "text-amber-600 dark:text-amber-400"
                      : ""
                }`}
              >
                {stats.totalSize > STORAGE_WARN_BYTES ? (
                  <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
                ) : null}
                {formatBytes(stats.totalSize)}
              </p>
              {stats.totalSize > STORAGE_WARN_BYTES ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {stats.totalSize > STORAGE_DANGER_BYTES
                    ? "Penyimpanan besar — pertimbangkan membersihkan berkas yatim."
                    : "Mulai membesar — pantau berkala."}
                </p>
              ) : null}
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Berkas Yatim</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">
                {stats.orphanCount}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  ({formatBytes(stats.orphanSize)})
                </span>
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Tidak dirujuk entri mana pun
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Terpilih</p>
              <p className="mt-0.5 text-lg font-bold tabular-nums">{selected.size}</p>
              {isOwner && selected.size > 0 ? (
                <button
                  type="button"
                  className="mt-0.5 text-[11px] font-medium text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                  onClick={() => openBulkDelete(selectedIds)}
                >
                  Hapus terpilih
                </button>
              ) : null}
            </div>
          </div>

          {/* Filter jenis (chip klik) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setKindFilter("ALL")}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                kindFilter === "ALL"
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                  : "border-zinc-200 text-muted-foreground hover:bg-accent dark:border-zinc-700"
              }`}
            >
              Semua ({stats.total})
            </button>
            {FILE_ASSET_KINDS.filter((kind) => (stats.perKind.get(kind)?.count ?? 0) > 0).map(
              (kind) => {
                const entry = stats.perKind.get(kind)!;
                const active = kindFilter === kind;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKindFilter(active ? "ALL" : kind)}
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      active
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                        : `${kindBadgeClass(kind)} hover:brightness-95`
                    }`}
                  >
                    {kindLabel(kind)} ({entry.count})
                  </button>
                );
              },
            )}
            <button
              type="button"
              onClick={() => setOnlyOrphan((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                onlyOrphan
                  ? "border-rose-600 bg-rose-600 text-white dark:border-rose-400 dark:bg-rose-500 dark:text-white"
                  : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-400"
              }`}
            >
              Hanya Yatim
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari nama berkas..."
            className="h-11 pl-9 sm:h-9"
            aria-label="Cari nama berkas"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="h-11 w-[150px] sm:h-9" aria-label="Urutkan berkas">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Terbaru</SelectItem>
            <SelectItem value="oldest">Terlama</SelectItem>
            <SelectItem value="largest">Terbesar</SelectItem>
            <SelectItem value="smallest">Terkecil</SelectItem>
            <SelectItem value="name">Nama A-Z</SelectItem>
          </SelectContent>
        </Select>
        {isOwner && filtered.length > 0 ? (
          <Button variant="outline" className="h-11 sm:h-9" onClick={selectAllFiltered}>
            Pilih Semua
          </Button>
        ) : null}
        {selected.size > 0 ? (
          <Button variant="outline" className="h-11 sm:h-9" onClick={clearSelection}>
            Kosongkan ({selected.size})
          </Button>
        ) : null}
      </div>

      {/* Daftar berkas */}
      <Card>
        <CardContent className="p-0">
          {items === null ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Memuat daftar berkas...
            </p>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <FileStack className="size-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">
                {items.length === 0
                  ? "Belum ada berkas yang diunggah."
                  : hasFilter
                    ? "Tidak ada berkas yang cocok dengan filter."
                    : "Tidak ada berkas."}
              </p>
              {hasFilter ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setQ("");
                    setKindFilter("ALL");
                    setOnlyOrphan(false);
                  }}
                >
                  Bersihkan Filter
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="max-h-[560px] divide-y overflow-y-auto nice-scrollbar">
              {filtered.map((item) => {
                const busy = busyId === item.id;
                const isSelected = selected.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition-colors ${
                      isSelected ? "bg-rose-50/60 dark:bg-rose-950/20" : ""
                    }`}
                  >
                    {isOwner ? (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(item.id)}
                        aria-label={`Pilih ${item.filename}`}
                        className="shrink-0"
                      />
                    ) : null}

                    <FileThumb item={item} />

                    <div className="min-w-[160px] flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="min-w-0 max-w-full truncate text-sm font-medium" title={item.filename}>
                          {item.filename}
                        </p>
                        <span
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${kindBadgeClass(item.kind)}`}
                        >
                          {kindLabel(item.kind)}
                        </span>
                        {item.orphan ? (
                          <span className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-400">
                            Yatim
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatBytes(item.size)} • {formatDateTime(item.createdAt)}
                      </p>
                      <RefsSummary item={item} />
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-9 sm:h-9"
                        aria-label={`Lihat ${item.filename}`}
                        onClick={() => setPreviewFile(item)}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                      </Button>
                      {canDownload ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-9 sm:h-9"
                          aria-label={`Unduh ${item.filename}`}
                          asChild
                        >
                          <a
                            href={`/api/files/${encodeURIComponent(item.id)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Download className="size-4" aria-hidden="true" />
                          </a>
                        </Button>
                      ) : null}
                      {isOwner ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-9 sm:h-9"
                            aria-label={`Ganti nama ${item.filename}`}
                            disabled={busy}
                            onClick={() => {
                              setRenameTarget(item);
                              setRenameValue(item.filename);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-9 sm:h-9"
                            aria-label={`Ganti isi berkas ${item.filename}`}
                            disabled={busy}
                            onClick={() => openReplacePicker(item)}
                          >
                            <Replace className="size-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-9 dark:text-rose-400 dark:hover:bg-rose-950/40"
                            aria-label={`Hapus ${item.filename}`}
                            disabled={busy}
                            onClick={() => setDeleteTarget(item)}
                          >
                            {busy ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="size-4" aria-hidden="true" />
                            )}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {isOwner && selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/40 dark:bg-rose-950/30">
          <p className="text-sm font-medium text-rose-800 dark:text-rose-300">
            {selected.size} berkas dipilih
            {selectedReferenced > 0
              ? ` — ${selectedReferenced} di antaranya masih dipakai entri lain`
              : ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-11 sm:h-9"
              onClick={clearSelection}
              disabled={busyBulk}
            >
              Kosongkan
            </Button>
            <Button
              className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
              onClick={() => openBulkDelete(selectedIds)}
              disabled={busyBulk}
            >
              {busyBulk ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Hapus Terpilih
            </Button>
          </div>
        </div>
      ) : null}

      {/* Input file tersembunyi untuk ganti isi berkas */}
      <input
        ref={replaceInputRef}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={onReplacePicked}
      />

      {/* Dialog pratinjau */}
      <AdminFileViewerDialog
        open={previewFile !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
        fileId={previewFile?.id ?? ""}
        filename={previewFile?.filename ?? null}
        mimeType={previewFile?.mimeType ?? null}
      />

      {/* Dialog ganti nama */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ganti Nama Berkas</DialogTitle>
            <DialogDescription>
              Nama hanya berubah di aplikasi — isi berkas tidak disentuh.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            maxLength={120}
            aria-label="Nama berkas baru"
            onKeyDown={(e) => {
              if (e.key === "Enter") void confirmRename();
            }}
          />
          <DialogFooter>
            <Button variant="outline" className="h-11 sm:h-9" onClick={() => setRenameTarget(null)}>
              Batal
            </Button>
            <Button
              className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
              disabled={busyId !== null || renameValue.trim() === ""}
              onClick={() => void confirmRename()}
            >
              {busyId !== null ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi ganti isi berkas */}
      <AlertDialog
        open={replaceTarget !== null && pendingReplace !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingReplace(null);
            setReplaceTarget(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ganti isi berkas?</AlertDialogTitle>
            <AlertDialogDescription>
              Berkas &quot;{replaceTarget?.filename}&quot; akan diganti dengan &quot;
              {pendingReplace?.name}&quot; ({formatBytes(pendingReplace?.size ?? 0)}). Isi lama
              tidak bisa dikembalikan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
              disabled={replaceBusy}
              onClick={(e) => {
                e.preventDefault();
                void confirmReplace();
              }}
            >
              {replaceBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Ya, Ganti Berkas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi hapus satu berkas */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus berkas?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <span>
                  &quot;{deleteTarget?.filename}&quot; akan dihapus permanen dari aplikasi dan
                  penyimpanan.
                </span>
                {deleteTarget && !deleteTarget.orphan ? (
                  <span className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                    Berkas ini masih dipakai
                    {deleteTarget.refs.applications.length > 0
                      ? ` oleh ${deleteTarget.refs.applications.length} lamaran`
                      : ""}
                    {deleteTarget.refs.positions.length > 0
                      ? `${deleteTarget.refs.applications.length > 0 ? ", " : " oleh "}${deleteTarget.refs.positions.length} posisi`
                      : ""}
                    . Referensinya akan dilepas otomatis (mis. CV lamaran menjadi kosong).
                  </span>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
              disabled={busyId !== null}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {busyId !== null ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi hapus massal / bersihkan yatim */}
      <AlertDialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus {bulkIds.length} berkas?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                <span>
                  {bulkIds.length === stats.orphanCount &&
                  (items ?? []).filter((i) => i.orphan).every((i) => bulkIds.includes(i.id))
                    ? "Semua berkas yatim akan dihapus permanen dari aplikasi dan penyimpanan."
                    : "Berkas terpilih akan dihapus permanen dari aplikasi dan penyimpanan."}
                </span>
                {selectedReferenced > 0 && bulkIds === selectedIds ? (
                  <span className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/40 dark:text-amber-200">
                    {selectedReferenced} berkas masih dipakai entri lain — referensinya akan dilepas
                    otomatis sebelum dihapus.
                  </span>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9" disabled={busyBulk}>
              Batal
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
              disabled={busyBulk}
              onClick={(e) => {
                e.preventDefault();
                void runBulkDelete(bulkIds);
              }}
            >
              {busyBulk ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Ya, Hapus Semua
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
