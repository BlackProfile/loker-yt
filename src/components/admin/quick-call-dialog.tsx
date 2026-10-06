"use client";

// NR38-C fitur 7 — dialog cepat "Catat panggilan" dekat info kontak di tab
// Ringkasan. Hasil panggilan memakai nilai valid CallOutcome yang sudah ada
// (DIANGKAT / TIDAK_DIANGKAT / JADWAL_ULANG) — konsisten dengan data callLogs.
// Opsional: centang "ingatkan tindak lanjut 3 hari" -> PATCH followUpAt = now+3d.
// Submit maksimal 2 klik: buka dialog -> Simpan (pilihan pertama terpilih default).
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Phone } from "lucide-react";
import { toast } from "sonner";
import type { Application, CallOutcome } from "@/lib/types";
import { apiPatch, apiPost } from "./api";
import { useAdminSession } from "./admin-context";

// Tiga pilihan cepat — label ringkas untuk triase; nilai dikirim apa adanya ke
// POST /calls sehingga riwayat panggilan tetap satu bentuk data.
const QUICK_OUTCOMES: { value: CallOutcome; label: string; hint: string }[] = [
  { value: "DIANGKAT", label: "Terhubung", hint: "Panggilan diangkat dan ada percakapan" },
  { value: "TIDAK_DIANGKAT", label: "Tidak aktif", hint: "Nomor tidak aktif / tidak diangkat" },
  { value: "JADWAL_ULANG", label: "Nanti lagi", hint: "Pelamar minta dihubungi di lain waktu" },
];

export function QuickCallDialog({
  applicationId,
  open,
  onOpenChange,
  onSaved,
}: {
  applicationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lamaran terbaru (hasil PATCH followUpAt) diteruskan agar daftar ikut segar. */
  onSaved?: (app: Application) => void;
}) {
  const { reportError } = useAdminSession();
  const [outcome, setOutcome] = useState<CallOutcome>("DIANGKAT");
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState(false);
  const [sending, setSending] = useState(false);

  // Reset setiap kali dialog dibuka — pilihan pertama langsung terpilih agar
  // admin cukup 1 klik "Simpan" bila panggilannya terhubung.
  useEffect(() => {
    if (open) {
      setOutcome("DIANGKAT");
      setNote("");
      setRemind(false);
      setSending(false);
    }
  }, [open]);

  async function handleSubmit() {
    if (sending) return;
    setSending(true);
    try {
      await apiPost(`/api/admin/applications/${applicationId}/calls`, {
        outcome,
        note: note.trim() || undefined,
      });
      if (remind) {
        const target = new Date(Date.now() + 3 * 86_400_000).toISOString();
        try {
          const updated = await apiPatch<Application>(
            `/api/admin/applications/${applicationId}`,
            { followUpAt: target }
          );
          onSaved?.(updated);
        } catch {
          // Panggilan sudah tercatat — jangan gagalkan seluruh aksi hanya
          // karena pengingat gagal dipasang.
          toast.error("Panggilan tercatat, namun pengingat tindak lanjut gagal dipasang.");
        }
      }
      toast.success("Panggilan dicatat");
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Phone className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Catat Panggilan
          </DialogTitle>
          <DialogDescription>
            Hasil panggilan masuk ke riwayat panggilan pelamar ini.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <RadioGroup
            value={outcome}
            onValueChange={(v) => setOutcome(v as CallOutcome)}
            aria-label="Hasil panggilan"
            className="gap-1.5"
          >
            {QUICK_OUTCOMES.map((option) => (
              <label
                key={option.value}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-sm has-[[data-state=checked]]:border-rose-400 has-[[data-state=checked]]:bg-rose-50/60 dark:has-[[data-state=checked]]:bg-rose-950/30"
              >
                <RadioGroupItem value={option.value} disabled={sending} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{option.label}</span>
                  <span className="block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="quick-call-note">Catatan singkat (opsional)</Label>
            <Textarea
              id="quick-call-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. Konfirmasi kesiapan interview pekan depan"
              rows={2}
              maxLength={1000}
              disabled={sending}
            />
          </div>

          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-1 text-sm">
            <Checkbox
              checked={remind}
              onCheckedChange={(v) => setRemind(v === true)}
              disabled={sending}
              aria-label="Ingatkan tindak lanjut 3 hari lagi"
            />
            Ingatkan tindak lanjut 3 hari lagi
          </label>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            variant="ghost"
            className="h-11 sm:h-9"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            Batal
          </Button>
          <Button
            className="h-11 bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-9"
            onClick={() => void handleSubmit()}
            disabled={sending}
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Phone className="size-4" aria-hidden="true" />
            )}
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
