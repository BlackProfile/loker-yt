"use client";

// Tab Posisi — pusat kendali per lowongan: daftar posisi dengan badge status
// publikasi, flag unggulan/urgent/kuota/tes, mini-statistik, share kit (QR +
// salin link), statistik per posisi, dan form lengkap v3.

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  BarChart3,
  Briefcase,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  Flame,
  GripVertical,
  Link2,
  Loader2,
  MapPin,
  Pencil,
  Pin,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Sprout,
  TrendingUp,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Position, PositionStatsRow } from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { copyText, formatDate } from "./format";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { Reveal } from "./motion-primitives";
import { PositionFormDialog } from "./position-form-dialog";
import { PositionStatsDialog } from "./position-stats-dialog";
import { PositionQrDialog } from "./position-qr-dialog";

/* ------------------------------ Status publikasi ------------------------------ */

type PublicationStatus = "tayang" | "terjadwal" | "draft" | "tutup";

const PUBLICATION_BADGE: Record<PublicationStatus, string> = {
  tayang:
    "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  terjadwal:
    "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  draft:
    "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  tutup:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

const PUBLICATION_LABEL: Record<PublicationStatus, string> = {
  tayang: "Tayang",
  terjadwal: "Terjadwal",
  draft: "Draft",
  tutup: "Tutup",
};

function publicationStatus(position: Position): PublicationStatus {
  if (!position.isActive) return "draft";
  const now = Date.now();
  const publishAt = position.publishAt ? new Date(position.publishAt).getTime() : null;
  if (publishAt != null && !Number.isNaN(publishAt) && publishAt > now)
    return "terjadwal";
  const closesAt = position.closesAt ? new Date(position.closesAt).getTime() : null;
  if (closesAt != null && !Number.isNaN(closesAt) && closesAt <= now) return "tutup";
  return "tayang";
}

function isExpired(closesAt: string | null): boolean {
  if (!closesAt) return false;
  const d = new Date(closesAt);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

/* ------------------------- Talent rediscovery & nurture ------------------------- */

type RediscoverResult = {
  id: string;
  name: string;
  skor: number;
  alasan: string;
  appliedAt: string;
  priorTitle: string | null;
};

// Warna badge skor kecocokan (emerald kuat, amber menengah, zinc sisanya).
function skorBadgeClass(skor: number): string {
  if (skor >= 75) {
    return "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400";
  }
  if (skor >= 45) {
    return "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

/* ---------------------------------- Komponen ---------------------------------- */

export function PositionsTab() {
  const { canMutate, reportError } = useAdminSession();
  const [positions, setPositions] = useState<Position[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, PositionStatsRow>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [formSession, setFormSession] = useState(0); // reset state form tiap buka
  const [editing, setEditing] = useState<Position | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [statsTarget, setStatsTarget] = useState<Position | null>(null);
  const [qrTarget, setQrTarget] = useState<Position | null>(null);

  // Talent rediscovery (AI) — dipicu per posisi aktif.
  const [rediscoverTarget, setRediscoverTarget] = useState<Position | null>(null);
  const [rediscoverLoading, setRediscoverLoading] = useState(false);
  const [rediscoverError, setRediscoverError] = useState<string | null>(null);
  const [rediscoverData, setRediscoverData] = useState<{ total: number; results: RediscoverResult[] } | null>(null);

  // Nurture kandidat ditolak — AlertDialog konfirmasi dengan jumlah kandidat.
  const [nurtureTarget, setNurtureTarget] = useState<Position | null>(null);
  const [nurtureCount, setNurtureCount] = useState<number | null>(null);
  const [nurtureLoading, setNurtureLoading] = useState(false);
  const [nurtureSending, setNurtureSending] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const [data, stats] = await Promise.all([
          apiGet<Position[]>("/api/admin/positions"),
          apiGet<{ rows: PositionStatsRow[] }>("/api/admin/position-stats"),
        ]);
        const map: Record<string, PositionStatsRow> = {};
        for (const row of stats.rows) map[row.positionId] = row;
        setPositions(data);
        setStatsMap(map);
      } catch (err) {
        reportError(err);
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: posisi dibuat/diubah/dihapus (admin lain maupun aksi sendiri) →
  // segarkan daftar & statistik di belakang (senyap, mode silent dari tombol
  // Segarkan). Dialog form yang sedang terbuka TIDAK terpengaruh: key dialog
  // tidak berubah sehingga state form pengguna tidak di-reset — daftar di
  // belakang saja yang diperbarui.
  useLiveRefresh("positions:changed", () => {
    void load(true);
  });

  function openCreate() {
    setEditing(null);
    setFormSession((s) => s + 1);
    setFormOpen(true);
  }

  function openEdit(position: Position) {
    setEditing(position);
    setFormSession((s) => s + 1);
    setFormOpen(true);
  }

  async function handleToggle(position: Position, isActive: boolean) {
    // Optimistik: update UI langsung, kembalikan bila gagal.
    setPositions((prev) =>
      prev.map((p) => (p.id === position.id ? { ...p, isActive } : p))
    );
    try {
      const updated = await apiPatch<Position>(
        `/api/admin/positions/${position.id}`,
        { isActive }
      );
      setPositions((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(isActive ? "Posisi diaktifkan" : "Posisi dinonaktifkan");
    } catch (err) {
      setPositions((prev) =>
        prev.map((p) =>
          p.id === position.id ? { ...p, isActive: position.isActive } : p
        )
      );
      reportError(err);
    }
  }

  async function handleDuplicate(position: Position) {
    try {
      await apiPost<Position>(`/api/admin/positions/${position.id}/duplicate`);
      toast.success("Posisi disalin (nonaktif)");
      await load(true);
    } catch (err) {
      reportError(err);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/positions/${deleteTarget.id}`);
      toast.success("Posisi dihapus");
      setPositions((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      setStatsMap((prev) => {
        const next = { ...prev };
        delete next[deleteTarget.id];
        return next;
      });
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  async function handleCopyLink(position: Position) {
    const key = position.slug ?? position.id;
    const link = `${window.location.origin}/?posisi=${encodeURIComponent(key)}`;
    const ok = await copyText(link);
    if (ok) toast.success("Tautan posisi disalin");
    else toast.error("Gagal menyalin tautan");
  }

  /* --------------------------- Talent rediscovery (AI) --------------------------- */

  async function openRediscover(position: Position) {
    setRediscoverTarget(position);
    setRediscoverData(null);
    setRediscoverError(null);
    setRediscoverLoading(true);
    try {
      const data = await apiPost<{ total: number; results: RediscoverResult[] }>(
        `/api/admin/positions/${position.id}/rediscover`
      );
      setRediscoverData(data);
    } catch (err) {
      setRediscoverError(
        err instanceof Error ? err.message : "Gagal mencari talent lama. Coba lagi."
      );
    } finally {
      setRediscoverLoading(false);
    }
  }

  async function retryRediscover() {
    if (rediscoverTarget) await openRediscover(rediscoverTarget);
  }

  /* ----------------------------- Nurture kandidat ----------------------------- */

  async function openNurture(position: Position) {
    setNurtureTarget(position);
    setNurtureCount(null);
    setNurtureLoading(true);
    try {
      const data = await apiGet<{ count: number }>(
        `/api/admin/positions/${position.id}/nurture?preview=1`
      );
      setNurtureCount(data.count);
    } catch (err) {
      setNurtureTarget(null);
      reportError(err);
    } finally {
      setNurtureLoading(false);
    }
  }

  async function handleNurture() {
    if (!nurtureTarget || nurtureSending) return;
    setNurtureSending(true);
    try {
      const data = await apiPost<{ queued: number }>(
        `/api/admin/positions/${nurtureTarget.id}/nurture`
      );
      toast.success(`${data.queued} email disiapkan`, {
        description: `Email nurture untuk posisi ${nurtureTarget.title} masuk kotak keluar.`,
      });
      setNurtureTarget(null);
    } catch (err) {
      reportError(err);
    } finally {
      setNurtureSending(false);
    }
  }

  const totalApplications = useMemo(
    () =>
      Object.values(statsMap).reduce((sum, row) => sum + row.applications, 0),
    [statsMap]
  );

  return (
    <div className="flex flex-col gap-4">
      <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg">Kelola Posisi</CardTitle>
          <CardDescription className="mt-1">
            Pusat kendali per lowongan — status, kuota, pipeline, dan performa.
            {positions.length > 0
              ? ` ${positions.length} posisi · ${totalApplications} lamaran.`
              : ""}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void load(true)}
            disabled={refreshing}
            className="h-11 active:scale-[0.99] sm:h-10"
            aria-label="Segarkan daftar posisi"
          >
            <RefreshCw
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span className="sm:hidden">Segarkan</span>
          </Button>
          <Button
            onClick={openCreate}
            disabled={!canMutate}
            className="h-11 active:scale-[0.99] sm:h-10"
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah Posisi
          </Button>
        </div>
      </Reveal>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : positions.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Briefcase className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada posisi. Tambahkan posisi pertama Anda.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {positions.map((position) => {
            const stats = statsMap[position.id] ?? null;
            const pub = publicationStatus(position);
            const hasQuota = position.maxApplicants != null;
            const hasTest =
              position.assignment.title != null ||
              position.assignment.url != null;
            return (
              <Card
                key={position.id}
                className="gap-0 rounded-2xl p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <CardContent className="flex flex-wrap items-start gap-x-4 gap-y-3 px-0">
                  <GripVertical
                    className="hidden size-5 shrink-0 translate-y-1 text-muted-foreground/40 sm:block"
                    aria-hidden="true"
                  />

                  {/* Identitas + badge */}
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="truncate text-sm font-semibold">{position.title}</p>
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        {position.featured ? (
                          <Pin
                            className="size-3.5 text-amber-600 dark:text-amber-400"
                            aria-label="Posisi unggulan"
                            role="img"
                          />
                        ) : null}
                        {position.urgent ? (
                          <Flame
                            className="size-3.5 text-rose-600 dark:text-rose-400"
                            aria-label="Posisi urgent"
                            role="img"
                          />
                        ) : null}
                        {hasQuota ? (
                          <Users
                            className="size-3.5"
                            aria-label={`Kuota ${position.maxApplicants} pelamar`}
                            role="img"
                          />
                        ) : null}
                        {hasTest ? (
                          <ClipboardList
                            className="size-3.5"
                            aria-label="Memiliki tes seleksi"
                            role="img"
                          />
                        ) : null}
                      </span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {position.department}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={PUBLICATION_BADGE[pub]}
                        title={`Status publikasi: ${PUBLICATION_LABEL[pub]}`}
                      >
                        {PUBLICATION_LABEL[pub]}
                      </Badge>
                      <Badge variant="secondary">{position.type || "-"}</Badge>
                      <Badge variant="secondary" className="gap-1">
                        <MapPin className="size-3" aria-hidden="true" />
                        {position.location || "-"}
                      </Badge>
                      {position.closesAt ? (
                        isExpired(position.closesAt) ? (
                          <Badge
                            variant="outline"
                            className={PUBLICATION_BADGE.tutup}
                          >
                            Kedaluwarsa
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                          >
                            Tutup otomatis{" "}
                            {format(new Date(position.closesAt), "dd MMM", {
                              locale: localeId,
                            })}
                          </Badge>
                        )
                      ) : null}
                      {hasQuota ? (
                        <Badge variant="secondary" className="gap-1">
                          <Users className="size-3" aria-hidden="true" />
                          Kuota {position.maxApplicants}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  {/* Mini-statistik */}
                  <div className="flex items-center gap-3 rounded-lg border bg-zinc-50/60 px-3 py-2 text-xs text-muted-foreground dark:bg-zinc-900/40">
                    <span className="flex items-center gap-1" title="Dilihat">
                      <Eye className="size-3.5" aria-hidden="true" />
                      <span className="tabular-nums">{stats?.views ?? 0}</span>
                    </span>
                    <span className="flex items-center gap-1" title="Lamaran masuk">
                      <FileText className="size-3.5" aria-hidden="true" />
                      <span className="tabular-nums">{stats?.applications ?? 0}</span>
                    </span>
                    <span className="flex items-center gap-1" title="Konversi lamaran per view">
                      <TrendingUp className="size-3.5" aria-hidden="true" />
                      <span className="tabular-nums">
                        {stats?.conversion != null ? `${stats.conversion}%` : "-"}
                      </span>
                    </span>
                  </div>

                  {/* Aksi */}
                  <div className="flex flex-wrap items-center gap-1">
                    <div className="mr-1 flex items-center gap-2">
                      <Switch
                        checked={position.isActive}
                        onCheckedChange={(checked) => {
                          if (!canMutate) return;
                          void handleToggle(position, checked);
                        }}
                        disabled={!canMutate}
                        aria-label={`Aktifkan posisi ${position.title}`}
                      />
                      <span className="hidden text-xs text-muted-foreground lg:block">
                        {position.isActive ? "Aktif" : "Nonaktif"}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => setStatsTarget(position)}
                      aria-label={`Statistik posisi ${position.title}`}
                      title="Statistik"
                    >
                      <BarChart3 className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => setQrTarget(position)}
                      aria-label={`QR posisi ${position.title}`}
                      title="QR Code"
                    >
                      <QrCode className="size-4" aria-hidden="true" />
                    </Button>
                    {position.isActive ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 sm:size-9"
                          onClick={() => void openRediscover(position)}
                          disabled={!canMutate || rediscoverLoading}
                          aria-label={`Cari talent lama untuk posisi ${position.title}`}
                          title="Cari Talent Lama"
                        >
                          <Search className="size-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 sm:size-9"
                          onClick={() => void openNurture(position)}
                          disabled={!canMutate || nurtureSending}
                          aria-label={`Nurture kandidat untuk posisi ${position.title}`}
                          title="Nurture Kandidat"
                        >
                          <Sprout className="size-4" aria-hidden="true" />
                        </Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => void handleCopyLink(position)}
                      aria-label={`Salin tautan posisi ${position.title}`}
                      title="Salin Link"
                    >
                      <Link2 className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => void handleDuplicate(position)}
                      disabled={!canMutate}
                      aria-label={`Duplikat posisi ${position.title}`}
                      title="Duplikat"
                    >
                      <Copy className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 sm:size-9"
                      onClick={() => openEdit(position)}
                      disabled={!canMutate}
                      aria-label={`Edit posisi ${position.title}`}
                      title="Edit"
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
                      onClick={() => setDeleteTarget(position)}
                      disabled={!canMutate}
                      aria-label={`Hapus posisi ${position.title}`}
                      title="Hapus"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog form posisi lengkap (key memaksa state bersih tiap dibuka) */}
      <PositionFormDialog
        key={`${editing?.id ?? "new"}-${formSession}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        statsRow={editing ? statsMap[editing.id] ?? null : null}
        onSaved={() => void load(true)}
      />

      {/* Dialog statistik per posisi */}
      <PositionStatsDialog
        open={!!statsTarget}
        onOpenChange={(open) => {
          if (!open) setStatsTarget(null);
        }}
        position={statsTarget}
        stats={statsTarget ? statsMap[statsTarget.id] ?? null : null}
      />

      {/* Dialog QR deep link */}
      <PositionQrDialog
        open={!!qrTarget}
        onOpenChange={(open) => {
          if (!open) setQrTarget(null);
        }}
        position={qrTarget}
      />

      {/* Konfirmasi hapus posisi */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus posisi ini?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Posisi "${deleteTarget.title}" akan dihapus permanen. Tindakan tidak bisa dibatalkan.`
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
