"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Link2, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus,
} from "@/lib/types";
import { apiDelete, apiPatch } from "./api";
import { formatDateTime, normalizeUrl, waHref } from "./format";
import { StatusBadge } from "./status-badge";

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-zinc-50/60 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm break-words">{children}</div>
    </div>
  );
}

export function ApplicationDetailDialog({
  application,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  application: Application | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (app: Application) => void;
  onDeleted: (id: string) => void;
}) {
  const [editStatus, setEditStatus] = useState<ApplicationStatus>("NEW");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (application) {
      setEditStatus(application.status);
      setEditNotes(application.adminNotes ?? "");
      setSaving(false);
      setDeleting(false);
      setConfirmOpen(false);
    }
  }, [application]);

  async function handleSave() {
    if (!application || saving) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${application.id}`,
        { status: editStatus, adminNotes: editNotes }
      );
      toast.success("Perubahan disimpan");
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!application || deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(
        `/api/admin/applications/${application.id}`
      );
      toast.success("Lamaran dihapus");
      onDeleted(application.id);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  const open = !!application;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-hidden rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-3 pr-6 text-lg font-bold">
              <span>{application?.name ?? "Detail Pelamar"}</span>
              {application ? <StatusBadge status={application.status} /> : null}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Detail lamaran, catatan admin, dan ubah status.
            </DialogDescription>
          </DialogHeader>

          {application ? (
            <div className="-mr-2 max-h-[70vh] overflow-y-auto pr-2 nice-scrollbar">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoItem label="Email">
                  <a
                    href={`mailto:${application.email}`}
                    className="hover:text-rose-600 underline-offset-2 hover:underline"
                  >
                    {application.email}
                  </a>
                </InfoItem>
                <InfoItem label="WhatsApp">
                  <a
                    href={waHref(application.phone)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-rose-600 underline-offset-2 hover:underline"
                  >
                    {application.phone || "-"}
                  </a>
                </InfoItem>
                <InfoItem label="Posisi">
                  {application.positionTitle ?? "-"}
                </InfoItem>
                <InfoItem label="Tanggal Daftar">
                  {formatDateTime(application.createdAt)}
                </InfoItem>
              </div>

              <Separator className="my-4" />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoItem label="Portofolio">
                  {application.portfolioUrl ? (
                    <a
                      href={normalizeUrl(application.portfolioUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline"
                    >
                      <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">
                        {application.portfolioUrl}
                      </span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </InfoItem>
                <InfoItem label="Sosial Media">
                  {application.socialLinks ? (
                    <a
                      href={normalizeUrl(application.socialLinks)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline"
                    >
                      <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{application.socialLinks}</span>
                    </a>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </InfoItem>
              </div>

              <Separator className="my-4" />

              <div className="flex flex-col gap-4">
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Pengalaman</h4>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {application.experience || "-"}
                  </p>
                </div>
                <div>
                  <h4 className="mb-1 text-sm font-semibold">Alasan Bergabung</h4>
                  <p className="text-sm whitespace-pre-line text-muted-foreground">
                    {application.motivation || "-"}
                  </p>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="admin-notes">Catatan Admin</Label>
                  <Textarea
                    id="admin-notes"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    placeholder="Tulis catatan internal..."
                    rows={3}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Ubah Status</Label>
                  <Select
                    value={editStatus}
                    onValueChange={(v) => setEditStatus(v as ApplicationStatus)}
                  >
                    <SelectTrigger className="w-full sm:w-56" aria-label="Ubah status lamaran">
                      <SelectValue placeholder="Pilih status" />
                    </SelectTrigger>
                    <SelectContent>
                      {APPLICATION_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter className="gap-2 border-t pt-4 sm:justify-between">
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <Button
                variant="destructive"
                onClick={() => setConfirmOpen(true)}
                disabled={deleting || saving}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                Hapus
              </Button>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus lamaran ini?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Tindakan tidak bisa dibatalkan.
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

            <Button onClick={() => void handleSave()} disabled={saving || deleting}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : (
                "Simpan Perubahan"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
