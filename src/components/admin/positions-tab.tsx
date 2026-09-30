"use client";

// Tab Posisi — daftar posisi dengan badge status publikasi, flag
// unggulan/urgent/kuota/tes, mini-statistik, switch aktif & buka/tutup formulir,
// tombol Kelola (hub "Satu Pintu Kelola Posisi"), dan menu aksi lain
// (salin link, halaman publik, duplikat, hapus). Halaman kelola per posisi
// (konten, formulir, penerimaan, seleksi, wawancara, pesan, statistik)
// dirender oleh PositionManagePage dengan deep-link #admin/posisi/<id>[/suffix].

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  ClipboardList,
  Copy,
  EllipsisVertical,
  ExternalLink,
  Eye,
  FileText,
  Flame,
  GripVertical,
  Link2,
  Loader2,
  MapPin,
  Pin,
  Plus,
  RefreshCw,
  Settings2,
  TrendingUp,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Position, PositionStatsRow } from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost } from "./api";
import { copyText } from "./format";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { Reveal } from "./motion-primitives";
import { PositionFormPage } from "./position-form-page";
import { PositionManagePage, type ManageMode } from "./position-manage-page";

/**
 * Baca id + mode dari deep-link #admin/posisi/<id>[/suffix].
 * Suffix: /konten, /formulir, /penerimaan, /seleksi, /wawancara, /pesan,
 * /statistik — plus alias lama /edit (→ konten). Tanpa suffix = "view"
 * (ringkasan hub). Semuanya halaman penuh, bukan popup.
 */
const MANAGE_MODE_BY_SUFFIX: Record<string, ManageMode> = {
  edit: "konten", // alias suffix lama
  konten: "konten",
  formulir: "formulir",
  penerimaan: "penerimaan",
  seleksi: "seleksi",
  wawancara: "wawancara",
  pesan: "pesan",
  statistik: "statistik",
};

function readManageHash(): { id: string | null; mode: ManageMode } {
  if (typeof window === "undefined") return { id: null, mode: "view" };
  const match = window.location.hash.match(
    /^#admin\/posisi\/([A-Za-z0-9_-]{1,40})(?:\/(konten|edit|formulir|penerimaan|seleksi|wawancara|pesan|statistik))?$/
  );
  if (!match) return { id: null, mode: "view" };
  return {
    id: match[1],
    mode: match[2] ? MANAGE_MODE_BY_SUFFIX[match[2]] ?? "view" : "view",
  };
}

function manageHashFor(id: string, mode: ManageMode): string {
  if (mode === "view") return `#admin/posisi/${id}`;
  return `#admin/posisi/${id}/${mode}`;
}

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

/* ---------------------------------- Komponen ---------------------------------- */

export function PositionsTab() {
  const { canMutate, reportError } = useAdminSession();
  const [positions, setPositions] = useState<Position[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, PositionStatsRow>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Mode "tambah posisi" sebagai halaman penuh (bukan popup).
  const [creating, setCreating] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Position | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Halaman khusus per posisi — mendukung deep-link #admin/posisi/<id> plus
  // suffix /konten, /formulir, /penerimaan, /seleksi, /wawancara, /pesan,
  // /statistik, dan alias lama /edit.
  const initialManage = readManageHash();
  const [manageId, setManageId] = useState<string | null>(() => initialManage.id);
  const [manageMode, setManageMode] = useState<ManageMode>(
    () => initialManage.mode
  );
  const managing = manageId ? positions.find((p) => p.id === manageId) ?? null : null;

  function openManage(position: Position, mode: ManageMode = "view") {
    setManageId(position.id);
    setManageMode(mode);
    // pushState (bukan replace) agar tombol Back browser kembali ke tampilan
    // sebelumnya; listener hashchange di bawah menyinkronkan UI saat
    // Back/Forward.
    history.pushState(null, "", manageHashFor(position.id, mode));
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  // Ganti mode di dalam hub (dari sub-navigasi/tombol halaman) — "view"
  // memakai replaceState agar tombol Back dari hub tetap menuju daftar posisi,
  // mode lain memakai pushState agar Back kembali ke ringkasan hub.
  function changeManageMode(mode: ManageMode) {
    if (!manageId) return;
    setManageMode(mode);
    const target = manageHashFor(manageId, mode);
    if (mode === "view") {
      if (window.location.hash !== target) history.replaceState(null, "", target);
    } else if (window.location.hash !== target) {
      history.pushState(null, "", target);
    }
  }

  function closeManage() {
    setManageId(null);
    setManageMode("view");
    if (window.location.hash.startsWith("#admin/posisi/")) {
      history.replaceState(null, "", "#admin");
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }

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

  // Sinkronkan tombol back/forward browser & perubahan hash saat tab ini
  // terbuka: #admin/posisi/<id> membuka hub kelola, suffix membuka mode
  // terkait, hash lain menutup semuanya.
  useEffect(() => {
    const onHash = () => {
      const h = readManageHash();
      // Deep-link ke posisi tertentu menutup mode "Tambah Posisi" agar hub
      // kelola benar-benar tampil (deep-link selalu menang).
      if (h.id) setCreating(false);
      setManageId((prev) => (prev === h.id ? prev : h.id));
      setManageMode((prev) => (prev === h.mode ? prev : h.mode));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Realtime: posisi dibuat/diubah/dihapus (admin lain maupun aksi sendiri) →
  // segarkan daftar & statistik di belakang (senyap, mode silent dari tombol
  // Segarkan). Halaman form yang sedang terbuka TIDAK terpengaruh: key halaman
  // tidak berubah sehingga state form pengguna tidak di-reset — daftar di
  // belakang saja yang diperbarui.
  useLiveRefresh("positions:changed", () => {
    void load(true);
  });

  function openCreate() {
    setCreating(true);
    window.scrollTo({ top: 0, behavior: "auto" });
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

  async function handleToggleApply(position: Position, applyOpen: boolean) {
    // Buka/tutup formulir lamaran per posisi — optimistik seperti handleToggle.
    setPositions((prev) =>
      prev.map((p) => (p.id === position.id ? { ...p, applyOpen } : p))
    );
    try {
      const updated = await apiPatch<Position>(
        `/api/admin/positions/${position.id}`,
        { applyOpen }
      );
      setPositions((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      toast.success(
        applyOpen
          ? `Formulir lamaran "${position.title}" dibuka`
          : `Formulir lamaran "${position.title}" ditutup`
      );
    } catch (err) {
      setPositions((prev) =>
        prev.map((p) =>
          p.id === position.id ? { ...p, applyOpen: position.applyOpen !== false } : p
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

  const totalApplications = useMemo(
    () =>
      Object.values(statsMap).reduce((sum, row) => sum + row.applications, 0),
    [statsMap]
  );

  return (
    <div className="flex flex-col gap-4">
      {creating ? (
        <PositionFormPage
          editing={null}
          onCancel={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false);
            void load(true);
            openManage(created);
          }}
        />
      ) : managing ? (
        <PositionManagePage
          key={`${managing.id}-${manageMode}`}
          position={managing}
          stats={statsMap[managing.id] ?? null}
          mode={manageMode}
          onModeChange={changeManageMode}
          onBack={closeManage}
          onUpdated={(p) =>
            setPositions((prev) => prev.map((x) => (x.id === p.id ? p : x)))
          }
        />
      ) : (
      <>
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
                      <button
                        type="button"
                        onClick={() => openManage(position)}
                        className="truncate text-sm font-semibold transition-colors hover:text-rose-700 hover:underline dark:hover:text-rose-400"
                        title="Buka halaman kelola posisi"
                      >
                        {position.title}
                      </button>
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
                      {position.applyOpen === false ? (
                        <Badge
                          variant="outline"
                          className={PUBLICATION_BADGE.tutup}
                          title="Formulir lamaran posisi ini ditutup — posisi tetap tayang"
                        >
                          Form Ditutup
                        </Badge>
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
                    {/* Toggle buka/tutup formulir lamaran per posisi */}
                    <div
                      className="mr-1 flex items-center gap-2"
                      title="Buka/tutup formulir lamaran posisi ini"
                    >
                      <Switch
                        checked={position.applyOpen !== false}
                        onCheckedChange={(checked) => {
                          if (!canMutate) return;
                          void handleToggleApply(position, checked);
                        }}
                        disabled={!canMutate}
                        aria-label={`Buka/tutup formulir lamaran posisi ${position.title}`}
                      />
                      <span
                        className={cn(
                          "hidden text-xs lg:block",
                          position.applyOpen !== false
                            ? "text-muted-foreground"
                            : "font-medium text-rose-600 dark:text-rose-400"
                        )}
                      >
                        {position.applyOpen !== false ? "Form Buka" : "Form Tutup"}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 sm:h-9"
                      onClick={() => openManage(position)}
                    >
                      <Settings2 className="size-4" aria-hidden="true" />
                      Kelola
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-11 sm:size-9"
                          aria-label={`Menu lain untuk posisi ${position.title}`}
                        >
                          <EllipsisVertical className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => void handleCopyLink(position)}>
                          <Link2 className="size-4" aria-hidden="true" />
                          Salin Link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            window.open(
                              position.slug
                                ? `/?posisi=${encodeURIComponent(position.slug)}`
                                : "/",
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          <ExternalLink className="size-4" aria-hidden="true" />
                          Lihat Halaman Publik
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => void handleDuplicate(position)}
                          disabled={!canMutate}
                        >
                          <Copy className="size-4" aria-hidden="true" />
                          Duplikat
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(position)}
                          disabled={!canMutate}
                          className="text-rose-600"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                          Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      </>
      )}

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
