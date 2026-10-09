"use client";

// Dialog penawaran (offer) ringkas — dipakai tab Pipeline kategori Diterima
// (dan aksi "Kirim Penawaran" dari kategori Wawancara).
// POST  /api/admin/applications/[id]/offer  → kirim penawaran baru
//         NR44: bila Setting offer_approval aktif & pelaku HR → draft menunggu
//         persetujuan OWNER (respons approvalRequired, tanpa pengiriman).
// PATCH /api/admin/applications/[id]/offer  → kirim ulang (RESEND) / batalkan (CANCEL)
//         / setujui (action "approve") / tolak (action "reject") — OWNER saja.

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CalendarClock,
  Check,
  ClipboardCheck,
  FileText,
  Loader2,
  MailCheck,
  Send,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  OFFER_STATUS_LABELS,
  POSITION_TYPES,
  type Application,
} from "@/lib/types";
import { apiGet, apiPatch, apiPost } from "./api";
import { formatDate, formatDateTime, formatRupiah } from "./format";
import { useAdminSession } from "./admin-context";
import { TemplatePicker } from "./template-picker";
import type { ApplicationRow } from "./applicant-row-types";

// PL-1b — peringatan gaji di dialog offer: bandingkan nominal offer yang diketik
// dengan ekspektasi pelamar dan rentang gaji posisi. Non-blocking.

/**
 * Parsa angka dari teks gaji bebas — buang semua non-digit, mis.
 * "Rp 4.500.000/bulan" -> 4500000. Hasil di bawah 100 ribu dianggap bukan
 * nominal gaji yang disengaja (mis. "15 jt" terbaca 15) dan diabaikan (null).
 */
export function parseSalaryText(text: string): number | null {
  const digits = text.replace(/\D+/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  if (!Number.isFinite(value) || value < 100_000) return null;
  return value;
}

type SalaryWarning = {
  kind: "expectation" | "range";
  tone: "rose" | "amber";
  text: string;
};

export function OfferDialog({
  application,
  open,
  onOpenChange,
  onSaved,
}: {
  application: Application | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (app: Application) => void;
}) {
  const { canMutate, reportError, role } = useAdminSession();
  const [salary, setSalary] = useState("");
  const [type, setType] = useState<string>("Full-time");
  const [startDate, setStartDate] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("3");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // NR44 — alur persetujuan offer dua lapis.
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  // Catatan review OWNER (panel persetujuan) + konfirmasi batal dua langkah.
  const [reviewNote, setReviewNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const isOwner = role === "OWNER";
  // Alur persetujuan aktif untuk pelaku HR (OWNER selalu jalur langsung).
  const isHrApprovalFlow = approvalEnabled && role === "HR";

  const approvalState = application?.offerApprovalState ?? null;
  const pendingApproval = approvalState === "PENDING";
  const rejectedApproval = approvalState === "REJECTED";

  const hasPendingOffer = application?.offerStatus === "PENDING";
  const canSend =
    application != null &&
    (application.offerStatus === null ||
      application.offerStatus === "DECLINED" ||
      application.offerStatus === "EXPIRED");

  // Muat status alur persetujuan setiap dialog dibuka (gagal senyap = jalur lama).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    apiGet<{ enabled: boolean }>("/api/admin/offer-approval")
      .then((res) => {
        if (!cancelled) setApprovalEnabled(Boolean(res.enabled));
      })
      .catch(() => {
        if (!cancelled) setApprovalEnabled(false);
      });
    setConfirmCancel(false);
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Prefill dari data offer terakhir (bila ada) setiap kali dialog dibuka.
  useEffect(() => {
    if (open && application) {
      setSalary(application.offerSalary ?? "");
      setType(application.offerType ?? "Full-time");
      setStartDate(application.offerStartDate ? application.offerStartDate.slice(0, 10) : "");
      setNote(application.offerNote ?? "");
      setDeadlineDays("3");
      setReviewNote("");
      setConfirmCancel(false);
    }
  }, [open, application?.id]);

  // PL-1b — peringatan gaji live saat mengetik (useMemo, non-blocking).
  // Rentang gaji posisi diambil dari payload daftar lamaran (positionSalaryMin/Max)
  // yang sudah diteruskan ke dialog sebagai field tambahan objek application
  // (GET /api/admin/applications memuatnya aditif).
  const salaryWarnings = useMemo<SalaryWarning[]>(() => {
    if (!application) return [];
    const offered = parseSalaryText(salary);
    if (offered == null) return [];
    const row = application as ApplicationRow;
    const warnings: SalaryWarning[] = [];
    const expectation = application.salaryExpectation ?? null;
    if (expectation != null && offered < expectation) {
      warnings.push({
        kind: "expectation",
        tone: "rose",
        text: `Di bawah ekspektasi pelamar (${formatRupiah(expectation)})`,
      });
    }
    const min = row.positionSalaryMin ?? null;
    const max = row.positionSalaryMax ?? null;
    if ((min != null && offered < min) || (max != null && offered > max)) {
      const rangeText =
        min != null && max != null
          ? `${formatRupiah(min)}–${formatRupiah(max)}`
          : min != null
            ? `minimal ${formatRupiah(min)}`
            : `maksimal ${formatRupiah(max)}`;
      warnings.push({
        kind: "range",
        tone: "amber",
        text: `Di luar rentang gaji posisi (${rangeText})`,
      });
    }
    return warnings;
  }, [application, salary]);

  if (!application) return null;

  function daysLeft(deadlineIso: string | null): number | null {
    if (!deadlineIso) return null;
    const diff = new Date(deadlineIso).getTime() - Date.now();
    if (Number.isNaN(diff)) return null;
    return Math.max(0, Math.ceil(diff / 86_400_000));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!application || saving) return;
    const days = Number.parseInt(deadlineDays, 10);
    if (!Number.isInteger(days) || days < 1 || days > 30) {
      toast.error("Batas jawaban harus 1-30 hari.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ application: Application; message?: string; approvalRequired?: boolean }>(
        `/api/admin/applications/${application.id}/offer`,
        {
          salary: salary.trim() || undefined,
          type,
          startDate: startDate || undefined,
          deadlineDays: days,
          note: note.trim() || undefined,
        }
      );
      // NR44 — jalur persetujuan: HR hanya mengajukan, OWNER yang mengirim.
      if (res.approvalRequired) {
        toast.info("Permintaan persetujuan offer dikirim ke OWNER", {
          description: "Penawaran terkirim ke pelamar setelah OWNER menyetujui.",
        });
      } else {
        toast.success(`Penawaran dikirim ke ${application.name}`, {
          description: `Pelamar menjawab lewat halaman status (kode ${application.trackingCode}).`,
        });
      }
      onSaved(res.application);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  // NR44 — OWNER menyetujui permintaan offer: jalur kirim lama dijalankan server.
  async function handleApprove() {
    if (!application || working) return;
    setWorking(true);
    try {
      const res = await apiPatch<{ application: Application; message?: string }>(
        `/api/admin/applications/${application.id}/offer`,
        { action: "approve", note: reviewNote.trim() || undefined }
      );
      toast.success(`Penawaran dikirim ke ${application.name}`, {
        description: `Permintaan disetujui — pelamar menjawab lewat halaman status (kode ${application.trackingCode}).`,
      });
      onSaved(res.application);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setWorking(false);
    }
  }

  // NR44 — OWNER menolak permintaan: catatan WAJIB, draft tetap agar HR revisi.
  async function handleReject() {
    if (!application || working) return;
    if (!reviewNote.trim()) {
      toast.error("Catatan penolakan wajib diisi.");
      return;
    }
    setWorking(true);
    try {
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${application.id}/offer`,
        { action: "reject", note: reviewNote.trim() }
      );
      toast.success("Permintaan offer ditolak", {
        description: "HR dapat merevisi draft dan mengajukan ulang.",
      });
      onSaved(res.application);
    } catch (err) {
      reportError(err);
    } finally {
      setWorking(false);
    }
  }

  async function handleAction(action: "RESEND" | "CANCEL") {
    if (!application || working) return;
    setWorking(true);
    try {
      const body =
        action === "RESEND"
          ? { action, deadlineDays: Number.parseInt(deadlineDays, 10) || 3 }
          : { action };
      const res = await apiPatch<{ application: Application }>(
        `/api/admin/applications/${application.id}/offer`,
        body
      );
      toast.success(
        action === "RESEND" ? "Batas jawaban diperpanjang" : "Penawaran dibatalkan"
      );
      onSaved(res.application);
      if (action === "CANCEL") {
        setConfirmCancel(false);
        onOpenChange(false);
      }
    } catch (err) {
      reportError(err);
    } finally {
      setWorking(false);
    }
  }

  /** Panel permintaan persetujuan (draft offer) — OWNER & HR melihat ringkasan. */
  const approvalPanel = pendingApproval ? (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardCheck className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Permintaan Persetujuan Offer</p>
        <Badge className="ml-auto border-transparent bg-amber-600 text-white">
          Menunggu Persetujuan
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Diajukan oleh{" "}
        <span className="font-medium text-foreground">{application.offerRequestedBy ?? "-"}</span>
        {application.offerRequestedAt ? ` — ${formatDateTime(application.offerRequestedAt)}` : ""}
      </p>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <p className="text-muted-foreground">
          Gaji: <span className="text-foreground">{application.offerSalary ?? "-"}</span>
        </p>
        <p className="text-muted-foreground">
          Jenis: <span className="text-foreground">{application.offerType ?? "-"}</span>
        </p>
        <p className="text-muted-foreground">
          Mulai: <span className="text-foreground">{formatDate(application.offerStartDate)}</span>
        </p>
        <p className="text-muted-foreground">
          Batas jawaban: <span className="text-foreground">{daysLeft(application.offerDeadline) ?? "-"} hari</span>
        </p>
      </div>
      {application.offerNote ? (
        <p className="rounded-lg bg-muted/60 p-2 text-xs whitespace-pre-wrap">
          Catatan HR: {application.offerNote}
        </p>
      ) : null}

      {isOwner ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="offer-review-note">Catatan review (opsional)</Label>
            <Textarea
              id="offer-review-note"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Mis. sesuaikan gaji sesuai rentang posisi..."
              rows={2}
              maxLength={1000}
              disabled={working}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => void handleApprove()}
              disabled={working}
              className="h-11 active:scale-[0.99] sm:h-10"
            >
              {working ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-4" aria-hidden="true" />
              )}
              Setujui &amp; Kirim Penawaran
            </Button>
            <Button
              variant="outline"
              onClick={() => void handleReject()}
              disabled={working}
              className="h-11 border-rose-200 text-rose-700 hover:bg-rose-50 sm:h-10 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
            >
              <XCircle className="size-4" aria-hidden="true" />
              Tolak
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Menyetujui langsung mengirim penawaran ke pelamar. Menolak mewajibkan catatan —
            draft tetap tersimpan agar HR bisa merevisi dan mengajukan ulang.
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Menunggu keputusan OWNER. Penawaran terkirim otomatis setelah disetujui; bila ditolak,
          Anda bisa merevisi draft dan mengajukan ulang.
        </p>
      )}

      {/* Riwayat review terakhir (catatan OWNER sebelumnya). */}
      {application.offerReviewNote || application.offerReviewedBy ? (
        <p className="text-xs text-muted-foreground">
          Review terakhir:{" "}
          <span className="text-foreground">
            {application.offerReviewedBy ?? "-"}
            {application.offerReviewedAt ? ` — ${formatDateTime(application.offerReviewedAt)}` : ""}
          </span>
          {application.offerReviewNote ? ` — "${application.offerReviewNote}"` : ""}
        </p>
      ) : null}
    </div>
  ) : null;

  /** Panel penolakan (REJECTED) — draft tetap, HR bisa revisi & ajukan ulang. */
  const rejectedPanel = rejectedApproval ? (
    <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/20">
      <p className="font-medium text-rose-700 dark:text-rose-400">
        Permintaan offer ditolak OWNER
      </p>
      {application.offerReviewNote ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Catatan: <span className="text-foreground">"{application.offerReviewNote}"</span>
          {application.offerReviewedBy ? (
            <span>
              {" "}
              — {application.offerReviewedBy}
              {application.offerReviewedAt ? `, ${formatDateTime(application.offerReviewedAt)}` : ""}
            </span>
          ) : null}
        </p>
      ) : null}
      <p className="mt-1 text-xs text-muted-foreground">
        Revisi draft di bawah lalu ajukan ulang untuk persetujuan.
      </p>
    </div>
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MailCheck className="size-5 text-emerald-600" aria-hidden="true" />
            Penawaran untuk {application.name}
          </DialogTitle>
          <DialogDescription>
            {application.positionTitle ?? "Posisi umum"} &middot; pelamar menjawab lewat
            halaman status (kode {application.trackingCode}).
          </DialogDescription>
        </DialogHeader>

        {hasPendingOffer ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
              <Badge className="border-transparent bg-emerald-600 text-white">
                {OFFER_STATUS_LABELS.PENDING}
              </Badge>
              <span className="text-emerald-800 dark:text-emerald-300">
                Menunggu jawaban pelamar
                {application.offerDeadline
                  ? ` — batas ${formatDate(application.offerDeadline)}${
                      daysLeft(application.offerDeadline) !== null
                        ? ` (sisa ${daysLeft(application.offerDeadline)} hari)`
                        : ""
                    }`
                  : ""}
              </span>
            </div>
            {canMutate ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="offer-deadline-extend">Perpanjang batas jawaban (hari)</Label>
                  <Input
                    id="offer-deadline-extend"
                    type="number"
                    min={1}
                    max={30}
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(e.target.value)}
                    className="h-10 w-32"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={() => void handleAction("RESEND")}
                    disabled={working}
                    className="h-11 active:scale-[0.99] sm:h-10"
                  >
                    {working ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="size-4" aria-hidden="true" />
                    )}
                    Kirim Ulang
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      // Konfirmasi dua langkah inline (tanpa window.confirm).
                      if (!confirmCancel) {
                        setConfirmCancel(true);
                        return;
                      }
                      void handleAction("CANCEL");
                    }}
                    disabled={working}
                    className="h-11 border-rose-200 text-rose-700 hover:bg-rose-50 sm:h-10 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    {confirmCancel ? "Konfirmasi Batalkan" : "Batalkan Penawaran"}
                  </Button>
                  {confirmCancel ? (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirmCancel(false)}
                      disabled={working}
                      className="h-11 sm:h-10"
                    >
                      Batal
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col gap-4">
            {pendingApproval ? approvalPanel : null}
            {!pendingApproval && rejectedPanel ? rejectedPanel : null}

            {application.offerStatus && !pendingApproval ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                Penawaran sebelumnya{" "}
                {application.offerStatus === "DECLINED"
                  ? `ditolak pelamar${application.offerDeclineReason ? `: "${application.offerDeclineReason}"` : ""}`
                  : "kadaluarsa"}
                . Kirim penawaran baru di bawah.
              </p>
            ) : null}

            {pendingApproval && isOwner ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                Permintaan persetujuan masih menunggu — gunakan panel di atas untuk menyetujui
                atau menolak. Mengirim ulang dari form akan mengganti draft permintaan.
              </p>
            ) : null}

            {pendingApproval && !isOwner ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                Permintaan offer Anda sedang menunggu persetujuan OWNER dan belum bisa diubah.
              </p>
            ) : null}

            {!pendingApproval ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offer-salary">Gaji / kompensasi</Label>
                    <Input
                      id="offer-salary"
                      value={salary}
                      onChange={(e) => setSalary(e.target.value)}
                      placeholder="Rp 4.500.000/bulan"
                      maxLength={120}
                      className="h-10"
                      aria-describedby="offer-salary-warning"
                    />
                    {/* PL-1b — peringatan gaji live: di bawah ekspektasi pelamar /
                        di luar rentang posisi. Hanya peringatan — tidak mencegah kirim. */}
                    {salaryWarnings.length > 0 ? (
                      <div id="offer-salary-warning" role="status" aria-live="polite" className="flex flex-col gap-1.5">
                        {salaryWarnings.map((w) => (
                          <p
                            key={w.kind}
                            className={
                              w.tone === "rose"
                                ? "flex items-start gap-1.5 rounded-xl border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
                                : "flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
                            }
                          >
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            {w.text}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offer-type">Jenis pekerjaan</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger id="offer-type" className="h-10 w-full" aria-label="Jenis pekerjaan">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POSITION_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offer-start">Rencana tanggal mulai</Label>
                    <Input
                      id="offer-start"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="h-10"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="offer-deadline">Batas jawaban (hari)</Label>
                    <Input
                      id="offer-deadline"
                      type="number"
                      min={1}
                      max={30}
                      value={deadlineDays}
                      onChange={(e) => setDeadlineDays(e.target.value)}
                      className="h-10"
                      aria-describedby="offer-deadline-hint"
                    />
                    <p id="offer-deadline-hint" className="text-xs text-muted-foreground">
                      1&ndash;30 hari; lewat batas otomatis kadaluarsa.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="offer-note">Catatan tambahan / benefit</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setPickerOpen(true)}
                    >
                      <FileText className="size-3.5" aria-hidden="true" />
                      Dari template
                    </Button>
                  </div>
                  <Textarea
                    id="offer-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Mis. termasuk BPJS, cuti tahunan, peralatan kerja..."
                    rows={3}
                    maxLength={1000}
                  />
                </div>
              </>
            ) : null}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
                className="h-11 sm:h-10"
              >
                Tutup
              </Button>
              {!pendingApproval ? (
                <Button
                  type="submit"
                  disabled={saving || !canMutate}
                  className="h-11 active:scale-[0.99] sm:h-10"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : isHrApprovalFlow ? (
                    <ClipboardCheck className="size-4" aria-hidden="true" />
                  ) : (
                    <CalendarClock className="size-4" aria-hidden="true" />
                  )}
                  {isHrApprovalFlow ? "Ajukan untuk Persetujuan" : "Kirim Penawaran"}
                </Button>
              ) : null}
            </DialogFooter>

            {isHrApprovalFlow && !pendingApproval ? (
              <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
                Alur persetujuan aktif: penawaran akan diajukan ke OWNER untuk disetujui sebelum
                dikirim ke pelamar.
              </p>
            ) : null}
          </form>
        )}

        {/* Picker template OFFER — mengisi catatan offer dari pustaka template. */}
        <TemplatePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          kind="OFFER"
          onPick={(body) => setNote(body)}
        />
      </DialogContent>
    </Dialog>
  );
}
