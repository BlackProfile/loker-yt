"use client";

// NR39-B — Dialog kelola Kartu Karyawan (kartu ID digital) di panel admin.
// Pratinjau kartu depan/belakang, ekspor PNG, cetak ukuran nyata 85,6x54 mm,
// checklist verifikasi identitas (gerbang aktivasi), aksi siklus kartu,
// terbitkan ulang, pesan siap-kirim untuk karyawan, dan audit verifikasi.

import { useState } from "react";
import { toPng } from "html-to-image";
import {
  Ban,
  BadgeCheck,
  Coffee,
  Copy,
  Download,
  History,
  IdCard,
  Loader2,
  MessageCircle,
  Printer,
  QrCode,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmployeeIdCardBack, EmployeeIdCardFront } from "@/components/employee-id-card";
import {
  EMPLOYEE_CARD_STATUS_LABELS,
  IDENTITY_CHECK_ITEMS,
  type EmployeeCardDto,
  type EmployeeCardStatus,
  type IdentityChecks,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAdminSession } from "./admin-context";
import { apiPatch, apiPost } from "./api";
import { copyText, formatDate } from "./format";

const SITE_NAME = "Lumina Studio";

/* ------------------------------ Badge & helper ------------------------------ */

// Warna badge status kartu: PENDING amber, PROBATION amber, ACTIVE emerald,
// LEAVE zinc, SUSPENDED rose, REVOKED rose.
const STATUS_BADGE_CLASS: Record<EmployeeCardStatus, string> = {
  PENDING:
    "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  PROBATION:
    "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  ACTIVE:
    "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  LEAVE:
    "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  SUSPENDED:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
  REVOKED:
    "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400",
};

const BADGE_AMBER =
  "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

/** Badge status kartu karyawan (dipakai dialog & daftar di tab Karyawan). */
export function CardStatusBadge({
  status,
  className,
}: {
  status: EmployeeCardStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn(STATUS_BADGE_CLASS[status], className)}>
      {EMPLOYEE_CARD_STATUS_LABELS[status]}
    </Badge>
  );
}

/** URL verifikasi publik dari token kartu ("" bila kartu tidak punya token). */
export function cardVerifyUrl(card: Pick<EmployeeCardDto, "verifyToken">): string {
  if (!card.verifyToken || typeof window === "undefined") return "";
  return `${window.location.origin}/#verifikasi?t=${card.verifyToken}`;
}

// Pola cetak (lihat profile-print-dialog): seluruh halaman disembunyikan,
// hanya .print-card yang tampil, dipaksa ukuran kartu ID nyata 85,6x54 mm.
const CARD_PRINT_STYLE = `
@media print {
  html, body { height: auto !important; overflow: visible !important; }
  body * { visibility: hidden; }
  .print-card, .print-card * { visibility: visible; }
  .print-cards-area {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: block !important;
    background: #ffffff;
  }
  [data-slot="dialog-overlay"],
  [data-slot="dialog-content"] {
    position: static !important;
    transform: none !important;
    width: auto !important;
    max-width: none !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    padding: 0 !important;
    margin: 0 !important;
    border: none !important;
    box-shadow: none !important;
    background: transparent !important;
    animation: none !important;
  }
  .print-card {
    width: 85.6mm;
    height: 54mm;
    overflow: hidden;
    break-inside: avoid;
    margin-bottom: 6mm;
  }
  @page { margin: 12mm; }
}
`;

type CardAction =
  | "activate"
  | "suspend"
  | "reactivate"
  | "leave"
  | "back-from-leave"
  | "revoke";

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function buildEmployeeMessage(card: EmployeeCardDto, verifyUrl: string): string {
  const linkPart = verifyUrl ? ` atau lewat tautan: ${verifyUrl}` : "";
  return `Selamat ${card.name}! Kartu karyawan Anda (${card.cardNumber}) telah terbit${
    card.status === "ACTIVE" ? " dan AKTIF" : ""
  }. Kartu bisa dilihat dari halaman Cek Status Anda (kode ${card.trackingCode ?? "-"})${linkPart}. Kartu dipakai untuk verifikasi keaslian karyawan ${SITE_NAME}.`;
}

/* ------------------------------- Isi dialog ------------------------------- */

function CardManageBody({
  card,
  onUpdated,
}: {
  card: EmployeeCardDto;
  onUpdated: (c: EmployeeCardDto) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [acting, setActing] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");
  const [reissueOpen, setReissueOpen] = useState(false);

  const verifyUrl = cardVerifyUrl(card);
  const message = buildEmployeeMessage(card, verifyUrl);
  const doneCount = IDENTITY_CHECK_ITEMS.filter(
    (item) => card.identityChecks[item.key]
  ).length;

  const previewProps = {
    cardNumber: card.cardNumber,
    name: card.name,
    positionTitle: card.positionTitle,
    status: card.status,
    issuedAt: card.issuedAt,
    probationUntil: card.probationUntil,
    nikMasked: card.nikMasked,
    verifyUrl,
    siteName: SITE_NAME,
  };

  /* ------------------------------ Aksi data ------------------------------ */

  // Checklist identitas: optimistik + rollback bila PATCH gagal.
  async function toggleCheck(key: keyof IdentityChecks, checked: boolean | "indeterminate") {
    if (!card || !canMutate || acting) return;
    const prev = card;
    const nextChecks: IdentityChecks = { ...card.identityChecks, [key]: checked === true };
    onUpdated({ ...card, identityChecks: nextChecks });
    setActing(`check-${key}`);
    try {
      const updated = await apiPatch<EmployeeCardDto>(`/api/admin/cards/${card.id}`, {
        identityChecks: nextChecks,
      });
      onUpdated(updated);
    } catch (err) {
      onUpdated(prev); // rollback ke nilai server terakhir
      reportError(err);
    } finally {
      setActing(null);
    }
  }

  async function runAction(action: CardAction, opts?: { reason?: string; success?: string }) {
    if (!card || acting) return;
    setActing(action);
    try {
      const updated = await apiPatch<EmployeeCardDto>(`/api/admin/cards/${card.id}`, {
        action,
        ...(opts?.reason ? { reason: opts.reason } : {}),
      });
      onUpdated(updated);
      toast.success(opts?.success ?? "Status kartu diperbarui");
    } catch (err) {
      reportError(err);
    } finally {
      setActing(null);
    }
  }

  async function handleReissue() {
    if (!card || acting) return;
    setActing("reissue");
    try {
      const created = await apiPost<EmployeeCardDto>(`/api/admin/cards/${card.id}/reissue`);
      onUpdated(created);
      toast.success(`Kartu baru ${created.cardNumber} terbit — kartu lama otomatis tidak berlaku`);
    } catch (err) {
      reportError(err);
    } finally {
      setActing(null);
    }
  }

  async function savePng() {
    if (!card || exporting) return;
    setExporting(true);
    try {
      const front = document.getElementById("ecard-front");
      const back = document.getElementById("ecard-back");
      if (!front || !back) {
        toast.error("Pratinjau kartu tidak ditemukan.");
        return;
      }
      const opts = { pixelRatio: 3, backgroundColor: "#ffffff" } as const;
      const frontUrl = await toPng(front, opts);
      downloadDataUrl(frontUrl, `kartu-${card.cardNumber}-depan.png`);
      const backUrl = await toPng(back, opts);
      downloadDataUrl(backUrl, `kartu-${card.cardNumber}-belakang.png`);
      toast.success("Kartu disimpan sebagai PNG (depan & belakang)");
    } catch {
      toast.error("Gagal membuat PNG kartu. Coba lagi.");
    } finally {
      setExporting(false);
    }
  }

  async function copyLink() {
    if (!verifyUrl) return;
    const ok = await copyText(verifyUrl);
    if (ok) toast.success("Tautan verifikasi disalin");
    else toast.error("Gagal menyalin tautan");
  }

  async function copyMessage() {
    const ok = await copyText(message);
    if (ok) toast.success("Pesan untuk karyawan disalin");
    else toast.error("Gagal menyalin pesan");
  }

  /* ------------------------------ Turunan UI ------------------------------ */

  const activateBlocked =
    doneCount < 3 || card.status === "ACTIVE" || card.status === "PROBATION";
  const activateTitle = (() => {
    if (card.status === "ACTIVE") return "Kartu sudah aktif.";
    if (card.status === "PROBATION") return "Kartu sudah aktif (masa percobaan).";
    if (doneCount < 3) return "Lengkapi 3 pemeriksaan identitas sebelum mengaktifkan kartu.";
    return "Aktifkan kartu agar dapat diverifikasi pihak ketiga.";
  })();

  const actionBtnClass = "h-11 justify-start sm:h-9";

  return (
    <div className="flex flex-col gap-4">
      {/* 1. Header identitas kartu */}
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
          <IdCard className="size-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <span className="truncate">{card.name}</span>
          <CardStatusBadge status={card.status} />
          {card.permanentAt ? (
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
            >
              <BadgeCheck className="size-3" aria-hidden="true" />
              Karyawan Tetap
            </Badge>
          ) : null}
          {card.exitAt ? (
            <Badge
              variant="outline"
              className="border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
            >
              Alumni
            </Badge>
          ) : null}
          {!card.isCurrent ? <Badge variant="secondary">Riwayat</Badge> : null}
        </DialogTitle>
        <DialogDescription className="flex flex-wrap items-center gap-x-2">
          <span>{card.positionTitle ?? "Tanpa posisi"}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono">{card.cardNumber}</span>
        </DialogDescription>
      </DialogHeader>

      {/* 2. Pratinjau kartu (sekaligus area cetak) */}
      <div
        className="print-cards-area grid gap-3 sm:grid-cols-2"
        aria-label="Pratinjau kartu karyawan"
      >
        <div className="print-card">
          <EmployeeIdCardFront withIds {...previewProps} />
        </div>
        <div className="print-card">
          <EmployeeIdCardBack withIds {...previewProps} />
        </div>
      </div>

      {/* 3. Aksi keluaran */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          onClick={() => void savePng()}
          disabled={exporting}
          className="h-11 flex-1 sm:h-9"
        >
          {exporting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-4" aria-hidden="true" />
          )}
          Simpan PNG
        </Button>
        <Button
          variant="outline"
          onClick={() => window.print()}
          disabled={exporting}
          className="h-11 flex-1 sm:h-9"
          aria-label="Cetak kartu ukuran nyata"
        >
          <Printer className="size-4" aria-hidden="true" />
          Cetak
        </Button>
        <Button
          variant="outline"
          onClick={() => void copyLink()}
          disabled={!card.verifyToken}
          title={
            card.verifyToken
              ? "Salin URL verifikasi keaslian kartu"
              : "Tautan verifikasi hanya tersedia pada kartu terbaru"
          }
          className="h-11 flex-1 sm:h-9"
        >
          <Copy className="size-4" aria-hidden="true" />
          Salin Tautan Verifikasi
        </Button>
      </div>

      {/* 4. Checklist verifikasi identitas (hanya kartu current) */}
      {card.isCurrent ? (
        <section className="rounded-xl border p-3" aria-label="Checklist verifikasi identitas">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <ShieldCheck
                className="size-4 text-rose-600 dark:text-rose-400"
                aria-hidden="true"
              />
              Verifikasi Identitas
            </p>
            <Badge variant="outline" className={cn(doneCount === 3 && BADGE_AMBER)}>
              {doneCount}/3 lengkap
            </Badge>
          </div>

          {!card.nikMasked ? (
            <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              NIK pelamar belum diisi — lengkapi di detail lamaran sebelum centang NIK cocok.
            </p>
          ) : null}

          <ul className="mt-2 flex flex-col gap-1.5">
            {IDENTITY_CHECK_ITEMS.map((item) => (
              <li
                key={item.key}
                className="flex items-start gap-2.5 rounded-lg border px-2.5 py-2"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={card.identityChecks[item.key]}
                  onCheckedChange={(checked) => void toggleCheck(item.key, checked)}
                  disabled={!canMutate || acting !== null}
                  aria-label={item.label}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-snug">{item.label}</p>
                  <p className="text-xs leading-snug text-muted-foreground">{item.hint}</p>
                </div>
              </li>
            ))}
          </ul>

          {canMutate && card.status !== "REVOKED" ? (
            <Button
              onClick={() => void runAction("activate", { success: "Kartu diaktifkan" })}
              disabled={activateBlocked || acting !== null}
              title={activateTitle}
              className="mt-3 h-11 w-full bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-9"
            >
              {acting === "activate" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Aktifkan Kartu
            </Button>
          ) : null}
        </section>
      ) : (
        <p className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          <History className="size-4 shrink-0" aria-hidden="true" />
          Kartu riwayat — sudah tidak berlaku dan tidak punya tautan verifikasi aktif.
        </p>
      )}

      {/* Kartu dicabut (masih current): alasan + terbitkan ulang saja */}
      {card.isCurrent && card.status === "REVOKED" ? (
        <section
          className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 dark:border-rose-900 dark:bg-rose-950/20"
          aria-label="Informasi pencabutan kartu"
        >
          <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-800 dark:text-rose-300">
            <Ban className="size-4" aria-hidden="true" />
            Kartu Dicabut
          </p>
          <p className="mt-1 text-xs leading-snug text-rose-700 dark:text-rose-400">
            Dicabut {formatDate(card.revokedAt)}
            {card.revokedReason ? ` — ${card.revokedReason}` : ""}
          </p>
          {canMutate ? (
            <Button
              onClick={() => setReissueOpen(true)}
              disabled={acting !== null}
              className="mt-2 h-11 bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-9"
            >
              <RefreshCcw className="size-4" aria-hidden="true" />
              Terbitkan Ulang
            </Button>
          ) : null}
        </section>
      ) : null}

      {/* 5. Aksi siklus kartu (hanya kartu current, bisa mutasi) */}
      {card.isCurrent && card.status !== "REVOKED" && canMutate ? (
        <section className="rounded-xl border p-3" aria-label="Aksi siklus kartu">
          <p className="text-sm font-semibold">Aksi Kartu</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {card.status === "LEAVE" ? (
              <Button
                variant="outline"
                onClick={() =>
                  void runAction("back-from-leave", { success: "Karyawan kembali dari cuti" })
                }
                disabled={acting !== null}
                className={actionBtnClass}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Kembali dari Cuti
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => void runAction("leave", { success: "Kartu ditandai cuti" })}
                disabled={acting !== null}
                className={actionBtnClass}
              >
                <Coffee className="size-4" aria-hidden="true" />
                Cuti
              </Button>
            )}

            {card.status === "SUSPENDED" ? (
              <Button
                variant="outline"
                onClick={() =>
                  void runAction("reactivate", { success: "Kartu diaktifkan kembali" })
                }
                disabled={acting !== null}
                className={actionBtnClass}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Aktifkan Kembali
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => void runAction("suspend", { success: "Kartu dinonaktifkan" })}
                disabled={acting !== null}
                className={actionBtnClass}
              >
                <Ban className="size-4" aria-hidden="true" />
                Nonaktifkan
              </Button>
            )}

            {/* Cabut kartu — 2 langkah: input alasan inline, lalu konfirmasi */}
            {revokeOpen ? (
              <div className="flex flex-col gap-2 rounded-lg border border-rose-300 bg-rose-50/60 p-2.5 sm:col-span-2 dark:border-rose-900 dark:bg-rose-950/20">
                <Label
                  htmlFor="ecard-revoke-reason"
                  className="text-xs font-medium text-rose-800 dark:text-rose-300"
                >
                  Alasan pencabutan (opsional)
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="ecard-revoke-reason"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    placeholder="Misal: melanggar kesepakatan kerja"
                    maxLength={200}
                    disabled={acting === "revoke"}
                    className="h-11 flex-1 sm:h-9"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setRevokeOpen(false);
                        setRevokeReason("");
                      }}
                      disabled={acting === "revoke"}
                      className="h-11 flex-1 sm:h-9 sm:flex-none"
                    >
                      Batal
                    </Button>
                    <Button
                      onClick={() =>
                        void runAction("revoke", {
                          reason: revokeReason.trim() || undefined,
                          success: "Kartu dicabut",
                        })
                      }
                      disabled={acting === "revoke"}
                      className="h-11 flex-1 bg-rose-600 text-white hover:bg-rose-700 sm:h-9 sm:flex-none"
                    >
                      {acting === "revoke" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <UserX className="size-4" aria-hidden="true" />
                      )}
                      Konfirmasi Cabut
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setRevokeOpen(true)}
                disabled={acting !== null}
                className={cn(
                  actionBtnClass,
                  "border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                )}
              >
                <UserX className="size-4" aria-hidden="true" />
                Cabut Kartu
              </Button>
            )}

            <Button
              variant="outline"
              onClick={() => setReissueOpen(true)}
              disabled={acting !== null}
              className={actionBtnClass}
            >
              <RefreshCcw className="size-4" aria-hidden="true" />
              Terbitkan Ulang
            </Button>
          </div>
        </section>
      ) : null}

      {/* 6. Pesan siap-kirim untuk karyawan */}
      {card.isCurrent ? (
        <section className="rounded-xl border p-3" aria-label="Pesan untuk karyawan">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <MessageCircle
              className="size-4 text-rose-600 dark:text-rose-400"
              aria-hidden="true"
            />
            Pesan untuk Karyawan
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-2.5 text-xs leading-relaxed text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-300">
            {message}
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Button
              variant="outline"
              onClick={() => void copyMessage()}
              className="h-11 flex-1 sm:h-9"
            >
              <Copy className="size-4" aria-hidden="true" />
              Salin Pesan
            </Button>
            <Button variant="outline" asChild className="h-11 flex-1 sm:h-9">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MessageCircle className="size-4" aria-hidden="true" />
                Buka WhatsApp
              </a>
            </Button>
          </div>
        </section>
      ) : null}

      {/* 7. Audit verifikasi */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <QrCode className="size-3.5" aria-hidden="true" />
        <span>
          Diverifikasi {card.verifyCount}× · terakhir{" "}
          {card.lastVerifiedAt ? formatDate(card.lastVerifiedAt) : "belum pernah"}
        </span>
        {card.verifyCount >= 20 ? (
          <Badge variant="outline" className={BADGE_AMBER}>
            Sering dipindai
          </Badge>
        ) : null}
        <span aria-hidden="true">·</span>
        <span>Terbit {formatDate(card.issuedAt)}</span>
      </p>

      {/* Konfirmasi terbitkan ulang */}
      <AlertDialog open={reissueOpen} onOpenChange={setReissueOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terbitkan ulang kartu?</AlertDialogTitle>
            <AlertDialogDescription>
              Kartu {card.cardNumber} milik {card.name} akan dicabut dan digantikan kartu
              baru dengan nomor serta QR baru. Kartu lama otomatis tidak berlaku.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={acting === "reissue"}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleReissue()}
              disabled={acting === "reissue"}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {acting === "reissue" ? "Menerbitkan..." : "Ya, Terbitkan Ulang"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ------------------------------- Dialog utama ------------------------------- */

export function EmployeeCardDialog({
  card,
  open,
  onOpenChange,
  onUpdated,
}: {
  card: EmployeeCardDto | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onUpdated: (c: EmployeeCardDto) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <style>{CARD_PRINT_STYLE}</style>
        {open && card ? (
          <CardManageBody key={card.id} card={card} onUpdated={onUpdated} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
