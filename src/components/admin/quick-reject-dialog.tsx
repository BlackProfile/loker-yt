"use client";

// Dialog tolak cepat — dipakai tab Pipeline (kategori Ditinjau/Wawancara/Diterima)
// untuk menolak satu lamaran dengan alasan terstruktur + umpan balik opsional.
// Memakai API yang sama dengan panel penolakan di dialog detail:
// POST /api/admin/applications/[id]/reject → { application, message, reasonLabel }.

import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FileText, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  REJECTION_REASONS,
  REJECTION_REASON_LABELS,
  type Application,
  type RejectionReason,
} from "@/lib/types";
import { apiPost } from "./api";
import { useAdminSession } from "./admin-context";
import { TemplatePicker } from "./template-picker";

export function QuickRejectDialog({
  application,
  open,
  onOpenChange,
  onRejected,
}: {
  application: Application | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRejected: (app: Application) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [reason, setReason] = useState<RejectionReason | "">("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Reset form setiap kali target berubah / dialog dibuka agar tidak membawa
  // nilai lamaran sebelumnya.
  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
      setFeedback(true);
    }
  }, [open, application?.id]);

  if (!application) return null;

  async function handleSubmit() {
    if (!application || saving) return;
    if (!reason) {
      toast.error("Pilih alasan penolakan terlebih dahulu.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiPost<{ application: Application; message: string }>(
        `/api/admin/applications/${application.id}/reject`,
        { reason, note: note.trim() || undefined, feedback }
      );
      toast.success(`${application.name} ditolak`, {
        description: `Alasan: ${REJECTION_REASON_LABELS[reason]}`,
      });
      onRejected(res.application);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="size-5 text-rose-600" aria-hidden="true" />
            Tolak Lamaran
          </DialogTitle>
          <DialogDescription>
            {application.name} &middot; {application.positionTitle ?? "Posisi umum"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="quick-reject-reason">Alasan penolakan</Label>
            <Select value={reason || undefined} onValueChange={(v) => setReason(v as RejectionReason)}>
              <SelectTrigger id="quick-reject-reason" className="h-10 w-full" aria-label="Pilih alasan penolakan">
                <SelectValue placeholder="Pilih alasan..." />
              </SelectTrigger>
              <SelectContent>
                {REJECTION_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {REJECTION_REASON_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="quick-reject-note">
                Catatan internal / umpan balik{" "}
                <span className="font-normal text-muted-foreground">(opsional)</span>
              </Label>
              <Button
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
              id="quick-reject-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Mis. portofolio belum sesuai arahan visual studio..."
              rows={3}
              maxLength={1000}
            />
          </div>

          <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <span className="flex flex-col">
              <span className="text-sm font-medium">Kirim umpan balik ke pelamar</span>
              <span className="text-xs text-muted-foreground">
                Catatan di atas ikut tampil di halaman status pelamar.
              </span>
            </span>
            <Switch
              checked={feedback}
              onCheckedChange={setFeedback}
              aria-label="Kirim umpan balik ke pelamar"
            />
          </label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="h-11 sm:h-10"
          >
            Batal
          </Button>
          <Button
            variant="destructive"
            onClick={() => void handleSubmit()}
            disabled={saving || !canMutate}
            className="h-11 active:scale-[0.99] sm:h-10"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <XCircle className="size-4" aria-hidden="true" />
            )}
            Tolak Lamaran
          </Button>
        </DialogFooter>

        {/* Picker template REJECT — mengisi textarea catatan dari pustaka template. */}
        <TemplatePicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          kind="REJECT"
          onPick={(body) => setNote(body)}
        />
      </DialogContent>
    </Dialog>
  );
}
