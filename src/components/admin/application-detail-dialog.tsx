"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  AudioLines,
  CalendarClock,
  ChevronDown,
  Copy,
  FileText,
  Link2,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus,
  type LogEntry,
} from "@/lib/types";
import { apiDelete, apiGet, apiPatch } from "./api";
import {
  actionLabel,
  actorBadgeClass,
  copyText,
  formatDateTime,
  formatShortDateTime,
  isoToLocalInput,
  localInputToIso,
  normalizeUrl,
  waHref,
} from "./format";
import { StatusBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { AiPanel } from "./ai-panel";
import { useAdminSession } from "./admin-context";

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-sm break-words">{children}</div>
    </div>
  );
}

// Riwayat aktivitas kandidat (timeline vertikal).
// Dipasang dengan key={applicationId} agar state reset saat kandidat berganti.
function ActivityTimeline({ applicationId }: { applicationId: string }) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<LogEntry[]>(
      `/api/admin/logs?applicationId=${encodeURIComponent(applicationId)}&limit=30`
    )
      .then((data) => {
        if (!cancelled) {
          setLogs(data);
          setLoading(false);
        }
      })
      .catch(() => {
        // Timeline bersifat pelengkap; abaikan kegagalan fetch.
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Memuat riwayat...
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">Belum ada aktivitas.</p>
    );
  }

  return (
    <div className="relative flex max-h-48 flex-col gap-3 overflow-y-auto pl-4 nice-scrollbar">
      <span
        className="absolute top-1.5 left-[4px] h-[calc(100%-12px)] w-px bg-border"
        aria-hidden="true"
      />
      {logs.map((log) => (
        <div key={log.id} className="relative">
          <span
            className="absolute top-1.5 -left-4 size-2 rounded-full bg-rose-500 ring-4 ring-background"
            aria-hidden="true"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium whitespace-nowrap text-muted-foreground">
              {formatShortDateTime(log.createdAt)}
            </span>
            <Badge
              variant="outline"
              className={`px-1.5 py-0 text-[10px] ${actorBadgeClass(log.actor)}`}
            >
              {log.actor}
            </Badge>
            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
              {actionLabel(log.action)}
            </Badge>
          </div>
          {log.detail ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{log.detail}</p>
          ) : null}
        </div>
      ))}
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
  const { canMutate, reportError } = useAdminSession();
  const [editStatus, setEditStatus] = useState<ApplicationStatus>("NEW");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Editor jadwal, tags, rating.
  const [interviewInput, setInterviewInput] = useState("");
  const [savingInterview, setSavingInterview] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagsSaving, setTagsSaving] = useState(false);
  const [ratingSaving, setRatingSaving] = useState(false);

  useEffect(() => {
    if (application) {
      setEditStatus(application.status);
      setEditNotes(application.adminNotes ?? "");
      setInterviewInput(isoToLocalInput(application.interviewAt));
      setTagInput("");
      setSaving(false);
      setDeleting(false);
      setConfirmOpen(false);
    }
  }, [application]);

  if (!application) return null;

  const app = application;

  async function patch(
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<Application | null> {
    if (!canMutate) {
      toast.error("Anda tidak memiliki akses untuk aksi ini.");
      return null;
    }
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        body
      );
      toast.success(successMessage);
      onSaved(updated);
      return updated;
    } catch (err) {
      reportError(err);
      return null;
    }
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { status: editStatus, adminNotes: editNotes }
      );
      toast.success("Perubahan disimpan");
      onSaved(updated);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await apiDelete<{ ok: boolean }>(`/api/admin/applications/${app.id}`);
      toast.success("Lamaran dihapus");
      onDeleted(app.id);
      onOpenChange(false);
    } catch (err) {
      reportError(err);
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  async function handleSaveInterview() {
    if (savingInterview) return;
    if (!interviewInput) {
      toast.error("Pilih tanggal dan jam terlebih dahulu.");
      return;
    }
    const iso = localInputToIso(interviewInput);
    if (!iso) {
      toast.error("Tanggal tidak valid.");
      return;
    }
    setSavingInterview(true);
    await patch({ interviewAt: iso }, "Jadwal wawancara disimpan");
    setSavingInterview(false);
  }

  async function handleClearInterview() {
    if (savingInterview) return;
    setSavingInterview(true);
    await patch({ interviewAt: null }, "Jadwal wawancara dihapus");
    setSavingInterview(false);
  }

  async function handleAddTag(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const tag = tagInput.trim();
    if (!tag || tagsSaving) return;
    if (app.tags.includes(tag)) {
      toast.error("Tag sudah ada.");
      return;
    }
    setTagsSaving(true);
    const updated = await patch({ tags: [...app.tags, tag] }, "Tag ditambahkan");
    if (updated) setTagInput("");
    setTagsSaving(false);
  }

  async function handleRemoveTag(tag: string) {
    if (tagsSaving) return;
    setTagsSaving(true);
    await patch(
      { tags: app.tags.filter((t) => t !== tag) },
      "Tag dihapus"
    );
    setTagsSaving(false);
  }

  async function handleRating(rating: number) {
    if (ratingSaving) return;
    setRatingSaving(true);
    await patch({ rating }, `Rating disimpan (${rating}/5)`);
    setRatingSaving(false);
  }

  async function handleTalentPool(talentPool: boolean) {
    await patch(
      { talentPool },
      talentPool ? "Ditambahkan ke Talent Pool" : "Dikeluarkan dari Talent Pool"
    );
  }

  async function handleCopyTracking() {
    const ok = await copyText(app.trackingCode);
    if (ok) toast.success("Kode pelacakan disalin");
    else toast.error("Gagal menyalin ke clipboard");
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6 text-lg font-bold">
            <span>{app.name}</span>
            <StatusBadge status={app.status} />
            {app.talentPool ? (
              <Badge
                variant="outline"
                className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
              >
                Talent Pool
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1.5">
            <span className="sr-only">Detail lamaran, catatan admin, ubah status, dan riwayat aktivitas.</span>
            <span className="text-muted-foreground">Kode pelacakan</span>
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {app.trackingCode}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyTracking()}
              aria-label="Salin kode pelacakan"
              className="text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </button>
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 max-h-[75vh] overflow-y-auto pr-2 nice-scrollbar">
          <div className="flex flex-col gap-4">
            {/* Panel AI */}
            <AiPanel app={app} onUpdated={onSaved} />

            {/* Info grid */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <InfoItem label="Email">
                <a
                  href={`mailto:${app.email}`}
                  className="hover:text-rose-600 underline-offset-2 hover:underline"
                >
                  {app.email}
                </a>
              </InfoItem>
              <InfoItem label="WhatsApp">
                <a
                  href={waHref(app.phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-rose-600 underline-offset-2 hover:underline"
                >
                  {app.phone || "-"}
                </a>
              </InfoItem>
              <InfoItem label="Posisi">{app.positionTitle ?? "-"}</InfoItem>
              <InfoItem label="Tanggal Daftar">
                {formatDateTime(app.createdAt)}
              </InfoItem>
              <InfoItem label="Portofolio">
                {app.portfolioUrl ? (
                  <a
                    href={normalizeUrl(app.portfolioUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline"
                  >
                    <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{app.portfolioUrl}</span>
                  </a>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </InfoItem>
              <InfoItem label="Sosial Media">
                {app.socialLinks ? (
                  <a
                    href={normalizeUrl(app.socialLinks)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-rose-600 underline-offset-2 hover:underline"
                  >
                    <Link2 className="size-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{app.socialLinks}</span>
                  </a>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </InfoItem>
            </div>

            {/* Jadwal wawancara */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <CalendarClock className="size-4 text-orange-500" aria-hidden="true" />
                <p className="text-sm font-semibold">Jadwal Wawancara</p>
              </div>
              {app.interviewAt ? (
                <p className="mb-2 text-sm text-muted-foreground">
                  Terjadwal:{" "}
                  <span className="font-medium text-foreground">
                    {formatDateTime(app.interviewAt)}
                  </span>
                </p>
              ) : (
                <p className="mb-2 text-sm text-muted-foreground">
                  Belum ada jadwal.
                </p>
              )}
              {canMutate ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="datetime-local"
                    value={interviewInput}
                    onChange={(e) => setInterviewInput(e.target.value)}
                    aria-label="Atur tanggal dan jam wawancara"
                    className="h-9 w-fit"
                  />
                  <Button
                    size="sm"
                    className="h-9"
                    onClick={() => void handleSaveInterview()}
                    disabled={savingInterview}
                  >
                    {savingInterview ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Simpan Jadwal
                  </Button>
                  {app.interviewAt ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9"
                      onClick={() => void handleClearInterview()}
                      disabled={savingInterview}
                      aria-label="Hapus jadwal wawancara"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Berkas */}
            {app.cvFileId || app.introFileId ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                <p className="text-sm font-semibold">Berkas</p>
                {app.cvFileId ? (
                  <div className="flex items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {app.cvFileName ?? "CV Pelamar"}
                    </span>
                    <a
                      href={`/api/files/${app.cvFileId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Unduh
                    </a>
                  </div>
                ) : null}
                {app.introFileId ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <AudioLines className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {app.introFileName ?? "Video Perkenalan (audio)"}
                      </span>
                    </div>
                    <audio
                      controls
                      preload="none"
                      src={`/api/files/${app.introFileId}`}
                      className="w-full"
                    />
                    {app.transcript ? (
                      <Collapsible>
                        <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                          <ChevronDown
                            className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
                            aria-hidden="true"
                          />
                          Lihat Transkripsi AI
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="mt-2 rounded-lg border bg-background p-3 text-sm whitespace-pre-wrap">
                            {app.transcript}
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Transkripsi sedang diproses...
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            <Separator />

            {/* Pengalaman & Alasan */}
            <div className="flex flex-col gap-4">
              <div>
                <h4 className="mb-1 text-sm font-semibold">Pengalaman</h4>
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {app.experience || "-"}
                </p>
              </div>
              <div>
                <h4 className="mb-1 text-sm font-semibold">Alasan Bergabung</h4>
                <p className="text-sm whitespace-pre-line text-muted-foreground">
                  {app.motivation || "-"}
                </p>
              </div>
            </div>

            <Separator />

            {/* Editor */}
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Label className="text-sm">Rating</Label>
                <RatingStars
                  value={app.rating}
                  onChange={canMutate ? (n) => void handleRating(n) : undefined}
                  disabled={!canMutate || ratingSaving}
                  ariaLabel={`Rating ${app.name}`}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor={`tags-${app.id}`} className="text-sm">Tags</Label>
                {app.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {app.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                      >
                        {tag}
                        {canMutate ? (
                          <button
                            type="button"
                            onClick={() => void handleRemoveTag(tag)}
                            aria-label={`Hapus tag ${tag}`}
                            className="outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            disabled={tagsSaving}
                          >
                            <X className="size-3" aria-hidden="true" />
                          </button>
                        ) : null}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Belum ada tag.</p>
                )}
                {canMutate ? (
                  <form onSubmit={handleAddTag} className="flex items-center gap-2">
                    <Input
                      id={`tags-${app.id}`}
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      placeholder="Tambah tag lalu tekan Enter"
                      aria-label="Tambah tag baru"
                      className="h-9 w-full sm:w-64"
                      disabled={tagsSaving}
                    />
                  </form>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Talent Pool</p>
                  <p className="text-xs text-muted-foreground">
                    Simpan kandidat untuk rekrutmen berikutnya
                  </p>
                </div>
                <Switch
                  checked={app.talentPool}
                  onCheckedChange={(checked) => void handleTalentPool(checked)}
                  disabled={!canMutate}
                  aria-label="Tandai Talent Pool"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="admin-notes">Catatan Admin</Label>
                <Textarea
                  id="admin-notes"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Tulis catatan internal..."
                  rows={3}
                  disabled={!canMutate}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Ubah Status</Label>
                <Select
                  value={editStatus}
                  onValueChange={(v) => setEditStatus(v as ApplicationStatus)}
                  disabled={!canMutate}
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

            <Separator />

            {/* Timeline */}
            <div>
              <h4 className="mb-2 text-sm font-semibold">Riwayat Aktivitas</h4>
              <ActivityTimeline key={app.id} applicationId={app.id} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t pt-4 sm:justify-between">
          {canMutate ? (
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
          ) : (
            <span />
          )}

          {canMutate ? (
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
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
