"use client";

// Dialog penawaran (offer) ringkas — dipakai tab Pipeline kategori Diterima
// (dan aksi "Kirim Penawaran" dari kategori Wawancara).
// POST  /api/admin/applications/[id]/offer  → kirim penawaran baru
// PATCH /api/admin/applications/[id]/offer  → kirim ulang (RESEND) / batalkan (CANCEL)

import { useEffect, useState, type FormEvent } from "react";
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
import { CalendarClock, FileText, Loader2, MailCheck, Send, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  OFFER_STATUS_LABELS,
  POSITION_TYPES,
  type Application,
} from "@/lib/types";
import { apiPatch, apiPost } from "./api";
import { formatDate } from "./format";
import { useAdminSession } from "./admin-context";
import { TemplatePicker } from "./template-picker";

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
  const { canMutate, reportError } = useAdminSession();
  const [salary, setSalary] = useState("");
  const [type, setType] = useState<string>("Full-time");
  const [startDate, setStartDate] = useState("");
  const [deadlineDays, setDeadlineDays] = useState("3");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [working, setWorking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const hasPendingOffer = application?.offerStatus === "PENDING";
  const canSend =
    application != null &&
    (application.offerStatus === null ||
      application.offerStatus === "DECLINED" ||
      application.offerStatus === "EXPIRED");

  // Prefill dari data offer terakhir (bila ada) setiap kali dialog dibuka.
  useEffect(() => {
    if (open && application) {
      setSalary(application.offerSalary ?? "");
      setType(application.offerType ?? "Full-time");
      setStartDate(application.offerStartDate ? application.offerStartDate.slice(0, 10) : "");
      setNote(application.offerNote ?? "");
      setDeadlineDays("3");
    }
  }, [open, application?.id]);  

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
      const res = await apiPost<{ application: Application }>(
        `/api/admin/applications/${application.id}/offer`,
        {
          salary: salary.trim() || undefined,
          type,
          startDate: startDate || undefined,
          deadlineDays: days,
          note: note.trim() || undefined,
        }
      );
      toast.success(`Penawaran dikirim ke ${application.name}`, {
        description: `Pelamar menjawab lewat halaman status (kode ${application.trackingCode}).`,
      });
      onSaved(res.application);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleAction(action: "RESEND" | "CANCEL") {
    if (!application || working) return;
    if (action === "CANCEL") {
      const okCancel = window.confirm(
        "Batalkan penawaran ini? Pelamar tidak bisa menjawab lagi (ditandai kadaluarsa)."
      );
      if (!okCancel) return;
    }
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
      if (action === "CANCEL") onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setWorking(false);
    }
  }

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
                    onClick={() => void handleAction("CANCEL")}
                    disabled={working}
                    className="h-11 border-rose-200 text-rose-700 hover:bg-rose-50 sm:h-10 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/40"
                  >
                    <XCircle className="size-4" aria-hidden="true" />
                    Batalkan Penawaran
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <form onSubmit={handleSend} className="flex flex-col gap-4">
            {application.offerStatus ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                Penawaran sebelumnya{" "}
                {application.offerStatus === "DECLINED"
                  ? `ditolak pelamar${application.offerDeclineReason ? `: "${application.offerDeclineReason}"` : ""}`
                  : "kadaluarsa"}
                . Kirim penawaran baru di bawah.
              </p>
            ) : null}

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
                />
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

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={saving}
                className="h-11 sm:h-10"
              >
                Batal
              </Button>
              <Button
                type="submit"
                disabled={saving || !canMutate}
                className="h-11 active:scale-[0.99] sm:h-10"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <CalendarClock className="size-4" aria-hidden="true" />
                )}
                Kirim Penawaran
              </Button>
            </DialogFooter>
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
