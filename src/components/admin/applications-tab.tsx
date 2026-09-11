"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Eye,
  Inbox,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus,
  type Position,
} from "@/lib/types";
import { apiDelete, apiGet, buildQuery } from "./api";
import { formatDate, initialsOf } from "./format";
import { StatusBadge } from "./status-badge";
import { ApplicationDetailDialog } from "./application-detail-dialog";

const ALL = "ALL";

const FILTER_TRIGGER_CLASS = "h-10 w-full rounded-xl sm:w-44";

export function ApplicationsTab() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [positionFilter, setPositionFilter] = useState<string>(ALL);

  const [detail, setDetail] = useState<Application | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState(false);

  const hasActiveFilter = q !== "" || statusFilter !== ALL || positionFilter !== ALL;

  const loadPositions = useCallback(async () => {
    try {
      const data = await apiGet<Position[]>("/api/admin/positions");
      setPositions(data);
    } catch {
      // Filter posisi opsional; abaikan error fetch daftar posisi.
    }
  }, []);

  const loadApplications = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildQuery({
        q: q || undefined,
        status: statusFilter !== ALL ? statusFilter : undefined,
        positionId: positionFilter !== ALL ? positionFilter : undefined,
      });
      const data = await apiGet<Application[]>(`/api/admin/applications${query}`);
      setApplications(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [q, statusFilter, positionFilter]);

  useEffect(() => {
    void loadPositions();
  }, [loadPositions]);

  useEffect(() => {
    void loadApplications();
  }, [loadApplications]);

  function applySearch() {
    setQ(searchInput.trim());
  }

  function resetFilters() {
    setSearchInput("");
    setQ("");
    setStatusFilter(ALL);
    setPositionFilter(ALL);
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
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Bar filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={FILTER_TRIGGER_CLASS} aria-label="Filter status">
              <SelectValue placeholder="Semua Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua Status</SelectItem>
              {APPLICATION_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={positionFilter} onValueChange={setPositionFilter}>
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
          {hasActiveFilter ? (
            <Button
              variant="outline"
              onClick={resetFilters}
              className="h-10 col-span-2 rounded-xl"
              aria-label="Reset filter"
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              Reset Filter
            </Button>
          ) : null}
        </div>
      </div>

      {/* Loading */}
      {loading ? (
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
      ) : (
        <>
          {/* Desktop: table */}
          <Card className="hidden gap-0 overflow-hidden rounded-2xl py-0 md:block">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="px-4 py-3">Pelamar</TableHead>
                  <TableHead className="px-4 py-3">Posisi</TableHead>
                  <TableHead className="px-4 py-3">Tanggal</TableHead>
                  <TableHead className="px-4 py-3">Status</TableHead>
                  <TableHead className="px-4 py-3 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="max-w-64 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700">
                          {initialsOf(app.name)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {app.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {app.email}
                            {app.phone ? ` · ${app.phone}` : ""}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm">
                      {app.positionTitle ?? "-"}
                    </TableCell>
                    <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                      {formatDate(app.createdAt)}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <StatusBadge status={app.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9"
                          onClick={() => setDetail(app)}
                          aria-label={`Lihat detail lamaran ${app.name}`}
                        >
                          <Eye className="size-4" aria-hidden="true" />
                          Detail
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                          onClick={() => setDeleteTarget(app)}
                          aria-label={`Hapus lamaran ${app.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile: daftar card */}
          <div className="flex flex-col gap-3 md:hidden">
            {applications.map((app) => (
              <Card key={app.id} className="gap-0 rounded-2xl p-4">
                <CardContent className="px-0">
                  <div className="flex items-start gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700">
                      {initialsOf(app.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{app.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {app.email}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {app.positionTitle ?? "-"} · {formatDate(app.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={app.status} />
                  </div>
                  <div className="mt-3 flex items-center gap-2 border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 flex-1"
                      onClick={() => setDetail(app)}
                    >
                      <Eye className="size-4" aria-hidden="true" />
                      Detail
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10 flex-1 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      onClick={() => setDeleteTarget(app)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Hapus
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        {loading ? "Memuat..." : `${applications.length} lamaran ditampilkan`}
      </p>

      <ApplicationDetailDialog
        application={detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        onSaved={() => void loadApplications()}
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
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
