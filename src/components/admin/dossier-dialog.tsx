"use client";

// NR38-C fitur 6 — Dossier pelamar ganda: daftar lamaran lain dari orang yang
// sama (email / nomor WA / NIK cocok). Read-only + tombol "Buka" yang memakai
// mekanisme navigasi antar lamaran yang sudah ada di dialog detail (onNavigate:
// ambil data penuh via GET detail, lalu parent mengganti lamaran aktif).
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, FolderSearch, Loader2 } from "lucide-react";
import type { Application, StageKey } from "@/lib/types";
import { apiGet } from "./api";
import { formatDate } from "./format";
import { RatingStars } from "./rating-stars";
import { AiScoreBadge, StatusBadge } from "./status-badge";
import { useAdminSession } from "./admin-context";

/** Satu baris dossier dari GET /api/admin/applications/[id]/dossier. */
export type DossierItem = {
  id: string;
  trackingCode: string;
  name: string;
  positionTitle: string | null;
  status: string;
  createdAt: string;
  rating: number | null;
  aiScore: number | null;
  talentPool: boolean;
  isDuplicate: boolean;
  rejectionReason: string | null;
};

export function DossierDialog({
  applicationId,
  open,
  onOpenChange,
  onNavigate,
}: {
  applicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Navigasi antar lamaran yang sudah ada (NR-24) — opsional; tanpa ini dialog read-only. */
  onNavigate?: (app: Application) => void;
}) {
  const { reportError } = useAdminSession();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<DossierItem[] | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Muat dossier setiap kali dialog dibuka (data bisa berubah antar buka).
  useEffect(() => {
    if (!open || !applicationId) return;
    let cancelled = false;
    setLoading(true);
    setItems(null);
    apiGet<{ items: DossierItem[] }>(
      `/api/admin/applications/${applicationId}/dossier`
    )
      .then((res) => {
        if (!cancelled) setItems(Array.isArray(res?.items) ? res.items : []);
      })
      .catch((err) => {
        if (!cancelled) reportError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, open]);

  // Buka lamaran lain di dialog detail: GET detail memberi objek Application
  // penuh, lalu onNavigate (pemanggil) mengganti lamaran aktif.
  async function handleOpen(row: DossierItem) {
    if (!onNavigate || openingId) return;
    setOpeningId(row.id);
    try {
      const full = await apiGet<Application>(`/api/admin/applications/${row.id}`);
      onNavigate(full);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <FolderSearch className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Dossier Pelamar
          </DialogTitle>
          <DialogDescription>
            Lamaran lain dari orang yang sama (email, nomor WA, atau NIK cocok).
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat dossier...
          </p>
        ) : items && items.length > 0 ? (
          <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
            {items.map((row) => (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{row.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.positionTitle ?? "Posisi tidak diketahui"} · {formatDate(row.createdAt)}
                    {row.trackingCode ? ` · ${row.trackingCode}` : ""}
                  </p>
                </div>
                <StatusBadge status={row.status as StageKey} />
                {row.aiScore != null ? <AiScoreBadge score={row.aiScore} /> : null}
                {row.rating ? (
                  <RatingStars
                    value={row.rating}
                    ariaLabel={`Rating ${row.name} dari data lamaran lain`}
                    size="size-3.5"
                  />
                ) : null}
                {onNavigate ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 shrink-0 px-2.5 sm:h-9"
                    onClick={() => void handleOpen(row)}
                    disabled={openingId != null}
                  >
                    {openingId === row.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    )}
                    Buka
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Belum ada lamaran lain dari orang ini.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
