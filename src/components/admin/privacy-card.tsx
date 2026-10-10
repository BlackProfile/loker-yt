"use client";

// Pusat Privasi (Task 4-c CARE) — kartu di tab Data dengan dua bagian:
//   A. "Pratinjau Retensi Data" — dry-run dampak job retensi (POST
//      /api/admin/retention {mode:"preview"}): cutoff, jumlah lamaran yang akan
//      terhapus, dan sampel maks 20 baris. TIDAK menghapus apa pun.
//   B. "Hapus Permanen Data Kandidat" — periksa kode pelacakan (POST
//      /api/admin/privacy {action:"describe"}), dialog konfirmasi dengan
//      ringkasan + verifikasi ketik kode, lalu hapus permanen (action:"erase").
// Seluruh kartu hanya untuk OWNER. Konfirmasi memakai Dialog shadcn + toast
// sonner (tanpa window.confirm/alert). Palet: zinc + rose-600/amber-600.
import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, ScanSearch, ShieldAlert, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "./api";
import { formatDateTime } from "./format";
import { useAdminSession } from "./admin-context";
import { CollapsibleCard } from "./collapsible-card";

/* --------------------------------- Tipe --------------------------------- */

type RetentionSample = {
  id: string;
  name: string;
  trackingCode: string | null;
  positionTitle: string | null;
  status: string;
  ageDays: number;
  archivedAt: string | null;
};

type RetentionPreviewResponse = {
  count: number;
  samples: RetentionSample[];
  cutoffDate: string;
};

type RetentionSettingsResponse = {
  retention: { enabled: boolean; days: number };
  maintenance: { autoArchiveEnabled: boolean; autoArchiveDays: number };
};

type EraseTarget = {
  applicationId: string;
  name: string;
  email: string;
  phone: string;
  trackingCode: string | null;
  candidateId: string | null;
  scope: "CANDIDATE" | "APPLICATION";
  applicationCount: number;
  interviewCount: number;
  fileCount: number;
  cardCount: number;
};

type EraseResult = {
  deletedApplications: number;
  deletedInterviews: number;
  deletedComments: number;
  deletedEmails: number;
  deletedCards: number;
  deletedFiles: number;
  deletedCandidate: boolean;
};

/** Label tahap bawah rentan (status bisa tahap kustom per posisi). */
function statusLabelOf(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

/* --------------------------- A. Pratinjau retensi --------------------------- */

function RetentionPreviewSection() {
  const { reportError } = useAdminSession();
  const [daysInput, setDaysInput] = useState("365");
  const daysTouched = useRef(false);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<RetentionPreviewResponse | null>(null);

  // Default hari dari pengaturan retensi aktif (GET /api/admin/retention).
  useEffect(() => {
    let alive = true;
    apiGet<RetentionSettingsResponse>("/api/admin/retention")
      .then((data) => {
        if (!alive || daysTouched.current) return;
        const days = Number(data?.retention?.days);
        if (Number.isFinite(days) && days > 0) setDaysInput(String(days));
      })
      .catch(() => {
        // Diamkan — default 365 hari tetap dipakai.
      });
    return () => {
      alive = false;
    };
  }, []);

  async function handlePreview() {
    if (previewing) return;
    const days = Number(daysInput);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      toast.error("Jumlah hari harus angka bulat 1 sampai 3650.");
      return;
    }
    setPreviewing(true);
    try {
      const data = await apiPost<RetentionPreviewResponse>("/api/admin/retention", {
        mode: "preview",
        days,
      });
      setPreview(data);
    } catch (err) {
      reportError(err);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border bg-zinc-50/60 p-4 dark:bg-zinc-900/40">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          <ShieldAlert className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Pratinjau Retensi Data</h4>
          <p className="text-xs text-muted-foreground">
            Hitung lamaran yang akan terhapus otomatis oleh retensi (ditolak atau
            terarsip, lebih tua dari batas hari). Pratinjau tidak mengubah data.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="privacy-retention-days">Hapus data lebih tua dari (hari)</Label>
          <Input
            id="privacy-retention-days"
            type="number"
            min={1}
            max={3650}
            inputMode="numeric"
            className="mt-1.5 h-11 sm:h-9"
            value={daysInput}
            onChange={(e) => {
              daysTouched.current = true;
              setDaysInput(e.target.value);
            }}
            disabled={previewing}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 active:scale-[0.99] sm:h-9"
          disabled={previewing}
          onClick={() => void handlePreview()}
        >
          {previewing ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanSearch className="size-4" aria-hidden="true" />
          )}
          Hitung Pratinjau
        </Button>
      </div>

      {preview ? (
        <div className="flex flex-col gap-3" aria-live="polite">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-3xl font-semibold leading-none text-rose-600 dark:text-rose-400">
                {preview.count}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">lamaran akan terhapus</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Batas tanggal:{" "}
              <span className="font-medium text-foreground">
                {formatDateTime(preview.cutoffDate)}
              </span>
            </p>
          </div>

          {preview.count > 0 ? (
            <div className="max-h-72 overflow-y-auto overflow-x-auto rounded-lg border">
              <Table className="text-xs">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-background">Nama</TableHead>
                    <TableHead>Tracking</TableHead>
                    <TableHead>Posisi</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Umur hari</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.samples.map((sample) => (
                    <TableRow key={sample.id}>
                      <TableCell className="sticky left-0 bg-background font-medium">
                        {sample.name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono">
                        {sample.trackingCode ?? "-"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {sample.positionTitle ?? "-"}
                      </TableCell>
                      <TableCell>{statusLabelOf(sample.status)}</TableCell>
                      <TableCell className="text-right tabular-nums">{sample.ageDays}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400">
              Tidak ada lamaran yang memenuhi kriteria retensi untuk batas hari ini.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Menampilkan maksimal 20 sampel lamaran terlama. Pratinjau saja — belum ada
            data yang dihapus.
          </p>
        </div>
      ) : null}
    </section>
  );
}

/* -------------------------- B. Hapus permanen -------------------------- */

function EraseCandidateSection() {
  const { reportError } = useAdminSession();
  const [trackingInput, setTrackingInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [target, setTarget] = useState<EraseTarget | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [erasing, setErasing] = useState(false);

  const confirmMatches =
    target?.trackingCode != null &&
    confirmText.trim().length > 0 &&
    confirmText.trim() === target.trackingCode;

  async function handleDescribe() {
    if (checking) return;
    const trackingCode = trackingInput.trim();
    if (!trackingCode) {
      toast.error("Masukkan kode pelacakan lamaran terlebih dahulu.");
      return;
    }
    setChecking(true);
    try {
      const data = await apiPost<{ target: EraseTarget }>("/api/admin/privacy", {
        action: "describe",
        trackingCode,
      });
      setTarget(data.target);
      setConfirmText("");
      setConfirmOpen(true);
    } catch (err) {
      reportError(err);
    } finally {
      setChecking(false);
    }
  }

  async function handleErase() {
    if (!target || erasing) return;
    if (target.trackingCode == null || confirmText.trim() !== target.trackingCode) return;
    setErasing(true);
    try {
      const data = await apiPost<{
        ok?: true;
        result?: EraseResult;
        approvalRequired?: boolean;
        message?: string;
      }>("/api/admin/privacy", {
        action: "erase",
        applicationId: target.applicationId,
        confirmTrackingCode: target.trackingCode,
      });
      if (data.approvalRequired) {
        // NR46 — 202 empat mata: bukan gagal; permintaan menunggu persetujuan OWNER lain.
        toast.info(
          data.message ??
            "Permintaan penghapusan dikirim — menunggu persetujuan OWNER lain.",
        );
        setConfirmOpen(false);
        setTarget(null);
        setConfirmText("");
        setTrackingInput("");
        return;
      }
      const result = data.result;
      if (!result) {
        toast.error("Respons penghapusan tidak valid. Coba lagi.");
        return;
      }
      const rekap = `${result.deletedApplications} lamaran, ${result.deletedInterviews} wawancara, ${result.deletedFiles} file dihapus permanen`;
      toast.success(
        result.deletedCandidate
          ? `Data kandidat ${target.name} dihapus permanen (${rekap}, profil kandidat ikut terhapus).`
          : `Data ${target.name} dihapus permanen (${rekap}).`,
      );
      setConfirmOpen(false);
      setTarget(null);
      setConfirmText("");
      setTrackingInput("");
    } catch (err) {
      reportError(err);
    } finally {
      setErasing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900 dark:bg-rose-950/20">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
          <Lock className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">Hapus Permanen Data Kandidat</h4>
          <p className="text-xs text-muted-foreground">
            Hapus seluruh data satu kandidat: lamaran, wawancara, komentar, email,
            file unggahan, dan profil kandidat bila sudah tidak memiliki lamaran lain.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Label htmlFor="privacy-erase-tracking">Kode pelacakan lamaran</Label>
          <Input
            id="privacy-erase-tracking"
            type="text"
            placeholder="LM-XXXXXX"
            className="mt-1.5 h-11 font-mono uppercase sm:h-9"
            value={trackingInput}
            onChange={(e) => setTrackingInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleDescribe();
              }
            }}
            disabled={checking || erasing}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 active:scale-[0.99] sm:h-9"
          disabled={checking || erasing}
          onClick={() => void handleDescribe()}
        >
          {checking ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <ScanSearch className="size-4" aria-hidden="true" />
          )}
          Periksa
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!erasing) setConfirmOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlert className="size-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Hapus permanen data kandidat?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-col gap-3 text-left">
                {target ? (
                  <>
                    <div
                      className="rounded-lg border bg-zinc-50/60 p-3 text-xs dark:bg-zinc-900/40"
                      aria-live="polite"
                    >
                      <p className="text-sm font-semibold text-foreground">{target.name}</p>
                      <p className="mt-0.5 text-muted-foreground">{target.email || "-"}</p>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                        <dt className="text-muted-foreground">Lamaran</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {target.applicationCount}
                        </dd>
                        <dt className="text-muted-foreground">Wawancara</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {target.interviewCount}
                        </dd>
                        <dt className="text-muted-foreground">File unggahan</dt>
                        <dd className="text-right font-medium tabular-nums">{target.fileCount}</dd>
                        {target.cardCount > 0 ? (
                          <>
                            <dt className="text-muted-foreground">Kartu karyawan</dt>
                            <dd className="text-right font-medium tabular-nums">
                              {target.cardCount}
                            </dd>
                          </>
                        ) : null}
                      </dl>
                      {target.scope === "CANDIDATE" ? (
                        <p className="mt-2 text-muted-foreground">
                          Lamaran ini tertaut ke profil kandidat — seluruh{" "}
                          {target.applicationCount} lamaran milik kandidat ini ikut dihapus.
                        </p>
                      ) : null}
                    </div>
                    <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      Tindakan permanen, tidak dapat dibatalkan.
                    </p>
                    <div>
                      <Label htmlFor="privacy-erase-confirm">
                        Ketik tracking code untuk konfirmasi
                      </Label>
                      <Input
                        id="privacy-erase-confirm"
                        type="text"
                        placeholder={target.trackingCode ?? "LM-XXXXXX"}
                        className="mt-1.5 h-11 font-mono uppercase sm:h-9"
                        value={confirmText}
                        onChange={(e) => setConfirmText(e.target.value)}
                        autoComplete="off"
                        disabled={erasing || target.trackingCode == null}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={erasing} onClick={() => setConfirmOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              className={cn("active:scale-[0.99]")}
              disabled={erasing || !confirmMatches}
              onClick={() => void handleErase()}
            >
              {erasing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Trash2 className="size-4" aria-hidden="true" />
              )}
              Hapus Permanen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/* --------------------------------- Kartu --------------------------------- */

export function PrivacyCard() {
  const { role } = useAdminSession();
  const isOwner = role === "OWNER";

  return (
    <CollapsibleCard
      id="privacy-center"
      icon={ShieldAlert}
      title="Pusat Privasi"
      description="Pratinjau dampak retensi data dan hapus permanen data kandidat (OWNER)."
    >
      {!isOwner ? (
        <p className="text-sm text-muted-foreground">
          Hanya OWNER yang dapat menggunakan Pusat Privasi.
        </p>
      ) : (
        <>
          <RetentionPreviewSection />
          <EraseCandidateSection />
        </>
      )}
    </CollapsibleCard>
  );
}
