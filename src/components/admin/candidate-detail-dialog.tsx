"use client";

// NR-41 G9 — Dialog detail profil kandidat terpusat (OWNER/HR).
// Data dari GET /api/admin/candidates/[id] → CandidateDetailResponse.
// Isi: header identitas (+ badge Do-not-hire), ringkasan statistik, daftar
// lamaran (scroll), editor catatan (PATCH notes), dan seksi Do-not-hire
// (Switch + alasan wajib saat menyalakan, PATCH doNotHire/doNotHireReason).
// Kandidat tanpa profil (candidateId null) → pesan penjelasan.
// Dialog dipasang di admin-app (selalu mounted) sehingga bisa dibuka dari tab
// mana pun via event global "lumina-open-candidate".

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Ban,
  CalendarPlus,
  FileText,
  Loader2,
  Mail,
  Phone,
  Save,
  ShieldAlert,
  Sparkles,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import type { CandidateDetailResponse, CandidateSummary } from "@/lib/types";
import type { StageKey } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { apiGet, apiPatch } from "./api";
import { useAdminSession } from "./admin-context";
import { formatDate } from "./format";
import { StatusBadge, AiScoreBadge } from "./status-badge";
import { cn } from "@/lib/utils";

/** Buka dialog kandidat dari komponen mana pun (candidateId null = tanpa profil). */
export function openCandidateDialog(candidateId: string | null): void {
  window.dispatchEvent(
    new CustomEvent("lumina-open-candidate", { detail: { candidateId } })
  );
}

/** Sel statistik ringkas di bawah header. */
function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-zinc-50/60 px-3 py-2 dark:bg-zinc-900/40">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold tabular-nums" title={value}>
        {value}
      </p>
    </div>
  );
}

export function CandidateDetailDialog({
  open,
  candidateId,
  onOpenChange,
}: {
  open: boolean;
  /** null = lamaran belum terhubung profil kandidat → tampil pesan penjelasan. */
  candidateId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { canMutate, reportError } = useAdminSession();

  const [loading, setLoading] = useState(false);
  const [candidate, setCandidate] = useState<CandidateSummary | null>(null);
  const [applications, setApplications] = useState<
    CandidateDetailResponse["applications"]
  >([]);

  // Form catatan & do-not-hire (diisi ulang tiap detail termuat).
  const [notes, setNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [dnh, setDnh] = useState(false);
  const [dnhReason, setDnhReason] = useState("");
  const [dnhReasonTouched, setDnhReasonTouched] = useState(false);
  const [savingDnh, setSavingDnh] = useState(false);

  const load = useCallback(
    async (id: string) => {
      setLoading(true);
      setCandidate(null);
      setApplications([]);
      try {
        const data = await apiGet<CandidateDetailResponse>(
          `/api/admin/candidates/${encodeURIComponent(id)}`
        );
        setCandidate(data.candidate);
        setApplications(data.applications ?? []);
        setNotes(data.candidate.notes ?? "");
        setDnh(data.candidate.doNotHire);
        setDnhReason(data.candidate.doNotHireReason ?? "");
        setDnhReasonTouched(false);
      } catch (err) {
        reportError(err);
        onOpenChange(false);
      } finally {
        setLoading(false);
      }
    },
    [reportError, onOpenChange]
  );

  useEffect(() => {
    if (!open || !candidateId) return;
    void load(candidateId);
  }, [open, candidateId, load]);

  async function handleSaveNotes() {
    if (!candidate || savingNotes) return;
    setSavingNotes(true);
    try {
      const res = await apiPatch<{ ok: true; candidate: CandidateSummary }>(
        `/api/admin/candidates/${encodeURIComponent(candidate.id)}`,
        { notes }
      );
      setCandidate(res.candidate);
      toast.success("Catatan kandidat disimpan");
    } catch (err) {
      reportError(err);
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleSaveDnh(nextEnabled: boolean) {
    if (!candidate || savingDnh) return;
    if (nextEnabled && !dnhReason.trim()) {
      toast.error("Tulis alasan do-not-hire terlebih dahulu.");
      return;
    }
    setSavingDnh(true);
    try {
      const res = await apiPatch<{ ok: true; candidate: CandidateSummary }>(
        `/api/admin/candidates/${encodeURIComponent(candidate.id)}`,
        {
          doNotHire: nextEnabled,
          doNotHireReason: nextEnabled ? dnhReason.trim() : null,
        }
      );
      setCandidate(res.candidate);
      setDnh(res.candidate.doNotHire);
      setDnhReason(res.candidate.doNotHireReason ?? "");
      setDnhReasonTouched(false);
      toast.success(
        res.candidate.doNotHire
          ? "Kandidat ditandai do-not-hire (berlaku di semua lamarannya)"
          : "Tanda do-not-hire dilepas"
      );
    } catch (err) {
      reportError(err);
    } finally {
      setSavingDnh(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-2xl">
        {!candidateId ? (
          // Lamaran belum punya profil kandidat (data lama / tanpa email).
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <UserRound className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                Profil Kandidat
              </DialogTitle>
              <DialogDescription>
                Belum memiliki profil kandidat.
              </DialogDescription>
            </DialogHeader>
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Profil kandidat terpusat terbentuk otomatis dari email lamaran.
              Lamaran ini belum terhubung ke profil mana pun — profil akan
              dibuat saat lamaran berikutnya dengan email yang sama masuk.
            </p>
          </>
        ) : loading ? (
          <>
            <DialogHeader>
              <DialogTitle>Memuat profil kandidat...</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3" aria-live="polite">
              <Skeleton className="h-12 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          </>
        ) : candidate ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                <UserRound className="size-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                <span className="min-w-0 truncate">{candidate.name || candidate.email}</span>
                {candidate.doNotHire ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400"
                    title={
                      candidate.doNotHireReason?.trim()
                        ? `Do-not-hire: ${candidate.doNotHireReason.trim()}`
                        : "Kandidat ditandai do-not-hire"
                    }
                  >
                    <Ban className="size-3" aria-hidden="true" />
                    Do-not-hire
                  </span>
                ) : null}
              </DialogTitle>
              <DialogDescription className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{candidate.email}</span>
                </span>
                {candidate.phone ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="size-3.5 shrink-0" aria-hidden="true" />
                    {candidate.phone}
                  </span>
                ) : null}
              </DialogDescription>
            </DialogHeader>

            {/* Ringkasan statistik */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatCell label="Jumlah lamaran" value={String(candidate.applicationCount)} />
              <StatCell
                label="Posisi unik"
                value={
                  candidate.positions.length > 0
                    ? String(candidate.positions.length)
                    : "-"
                }
              />
              <StatCell
                label="Skor AI terbaik"
                value={candidate.bestAiScore == null ? "-" : String(candidate.bestAiScore)}
              />
              <StatCell label="Pertama melamar" value={formatDate(candidate.firstSeenAt)} />
              <StatCell
                label="Terakhir melamar"
                value={candidate.lastAppliedAt ? formatDate(candidate.lastAppliedAt) : "-"}
              />
              <StatCell
                label="Posisi"
                value={candidate.positions.slice(0, 2).join(", ") || "-"}
              />
            </div>

            {/* Daftar lamaran milik kandidat */}
            <section aria-label="Daftar lamaran kandidat" className="flex flex-col gap-2">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="size-3.5" aria-hidden="true" />
                Lamaran ({applications.length})
              </p>
              {applications.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                  Belum ada lamaran pada profil ini.
                </p>
              ) : (
                <ul className="nice-scrollbar flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
                  {applications.map((app) => (
                    <li
                      key={app.id}
                      className="flex flex-col gap-1.5 rounded-xl border p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                          {app.positionTitle ?? "Posisi telah dihapus"}
                        </span>
                        <StatusBadge status={app.status as StageKey} />
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <CalendarPlus className="size-3 shrink-0" aria-hidden="true" />
                          Daftar {formatDate(app.createdAt)}
                        </span>
                        {app.trackingCode ? (
                          <span className="font-mono" title="Kode pelacakan lamaran">
                            {app.trackingCode}
                          </span>
                        ) : null}
                        {app.talentPool ? (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                            <Sparkles className="size-3 shrink-0" aria-hidden="true" />
                            Talent pool
                          </span>
                        ) : null}
                        <span className="ml-auto">
                          <AiScoreBadge score={app.aiScore} />
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {canMutate ? (
              <>
                <Separator />
                {/* Catatan internal kandidat */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="candidate-notes">Catatan kandidat</Label>
                  <Textarea
                    id="candidate-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ringkasan pengalaman, hasil wawancara, atau catatan lintas posisi..."
                    rows={3}
                    maxLength={2000}
                  />
                  <Button
                    variant="outline"
                    className="h-11 w-fit sm:h-9"
                    onClick={() => void handleSaveNotes()}
                    disabled={savingNotes}
                  >
                    {savingNotes ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="size-4" aria-hidden="true" />
                    )}
                    Simpan Catatan
                  </Button>
                </div>

                {/* Seksi do-not-hire global */}
                <div
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border p-3",
                    dnh
                      ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30"
                      : "border-zinc-200 dark:border-zinc-800"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <ShieldAlert
                          className={cn(
                            "size-4 shrink-0",
                            dnh ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                          )}
                          aria-hidden="true"
                        />
                        Tandai do-not-hire
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Bendera global — berlaku di semua lamaran milik kandidat ini.
                      </p>
                    </div>
                    <Switch
                      checked={dnh}
                      onCheckedChange={(checked) => {
                        setDnh(checked);
                        setDnhReasonTouched(true);
                        if (!checked) {
                          // Matikan langsung (alasan ikut dikosongkan di server).
                          void handleSaveDnh(false);
                        }
                      }}
                      aria-label="Tandai kandidat do-not-hire"
                      disabled={savingDnh}
                    />
                  </div>
                  {dnh ? (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="candidate-dnh-reason">Alasan (wajib)</Label>
                      <Input
                        id="candidate-dnh-reason"
                        value={dnhReason}
                        onChange={(e) => setDnhReason(e.target.value)}
                        placeholder="Mis. perilaku tidak jujur pada dokumen"
                        maxLength={200}
                      />
                      <Button
                        className="h-11 w-fit bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99] sm:h-9"
                        onClick={() => void handleSaveDnh(true)}
                        disabled={savingDnh || !dnhReason.trim()}
                      >
                        {savingDnh ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <BadgeCheck className="size-4" aria-hidden="true" />
                        )}
                        Simpan Do-not-hire
                      </Button>
                      {dnhReasonTouched && !dnhReason.trim() ? (
                        <p className="text-xs text-rose-600 dark:text-rose-400" role="alert">
                          Alasan wajib diisi untuk menandai do-not-hire.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
