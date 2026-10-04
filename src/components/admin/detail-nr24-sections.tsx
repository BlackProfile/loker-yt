"use client";

// NR-24 — Section per-pelamar untuk dialog detail lamaran.
// Semua komponen di sini mandiri: fetch data sendiri dan dipasang dengan
// key={applicationId} dari pemanggil agar state otomatis reset saat
// kandidat berganti. Palet warna: zinc/rose/amber/emerald/orange/teal.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock,
  FileUp,
  Flag,
  GitMerge,
  History,
  Inbox,
  Loader2,
  MailPlus,
  MessageCircle,
  Phone,
  PhoneCall,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_LABELS,
  type Application,
  type Assessment,
  type CallLog,
  type CallOutcome,
  type InboxItem,
  type InternalDoc,
  type RelatedApplicationsResponse,
} from "@/lib/types";
import { apiFetch, apiGet, apiPatch, apiPost, jsonInit } from "./api";
import { daysUntil, formatDate, formatDateTime, formatRelative } from "./format";
import { StatusBadge } from "./status-badge";
import { useAdminSession } from "./admin-context";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Fitur 7, 12, 15 — Riwayat melamar, duplikat tersangka, peringatan  */
/* ------------------------------------------------------------------ */

export function RelatedSection({
  applicationId,
  list,
  onNavigate,
  onSaved,
  onListRefresh,
}: {
  applicationId: string;
  /** Daftar lamaran aktif — dipakai agar baris riwayat bisa dinavigasi bila ada di daftar. */
  list?: Application[];
  onNavigate?: (app: Application) => void;
  onSaved?: (app: Application) => void;
  onListRefresh?: () => void;
}) {
  const { reportError } = useAdminSession();
  const [data, setData] = useState<RelatedApplicationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const loadRelated = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiGet<RelatedApplicationsResponse>(
        `/api/admin/applications/${applicationId}/related`
      );
      setData(res);
    } catch {
      // Panel riwayat bersifat pelengkap; biarkan kosong saat gagal.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void loadRelated();
  }, [loadRelated]);

  async function handleMerge(duplicateId: string, code: string) {
    if (mergingId) return;
    setMergingId(duplicateId);
    try {
      const res = await apiPost<{ ok: boolean; application: Application }>(
        `/api/admin/applications/${applicationId}/merge`,
        { duplicateId }
      );
      toast.success(`Lamaran ${code} digabungkan ke sini`);
      setMergeTarget(null);
      onSaved?.(res.application);
      onListRefresh?.();
      void loadRelated(true);
    } catch (err) {
      reportError(err);
    } finally {
      setMergingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Memuat riwayat pelamar...
      </div>
    );
  }

  if (!data) return null;

  const hasContent =
    data.doNotHireWarning != null ||
    data.duplicateSuspects.length > 0 ||
    data.previous.length > 0;
  if (!hasContent) return null;

  return (
    <div className="flex flex-col gap-3">
      {/* Peringatan do-not-hire dari lamaran lain */}
      {data.doNotHireWarning ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-900 dark:bg-rose-950/30">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <div className="flex flex-col gap-0.5">
            <p className="font-semibold text-rose-700 dark:text-rose-400">
              Pelamar ini ditandai do-not-hire pada lamaran lain
            </p>
            <p className="text-rose-700/90 dark:text-rose-400/90">
              {data.doNotHireWarning.reason || "Tanpa alasan"} ·{" "}
              {formatDate(data.doNotHireWarning.createdAt)}
            </p>
          </div>
        </div>
      ) : null}

      {/* Duplikat tersangka — tawarkan penggabungan */}
      {data.duplicateSuspects.map((suspect) => (
        <div
          key={suspect.id}
          className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/25"
        >
          <div className="flex flex-wrap items-center gap-2">
            <GitMerge className="size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
            <span className="font-medium text-amber-800 dark:text-amber-300">
              Kemungkinan duplikat: {suspect.name} · {suspect.trackingCode}
              {suspect.positionTitle ? ` · ${suspect.positionTitle}` : ""}
            </span>
            {mergeTarget === suspect.id ? null : (
              <button
                type="button"
                onClick={() => setMergeTarget(suspect.id)}
                className="ml-auto inline-flex h-9 items-center rounded-md border border-amber-300 bg-background px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-amber-800"
              >
                Gabungkan ke sini
              </button>
            )}
          </div>
          {mergeTarget === suspect.id ? (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-background p-2.5 dark:border-amber-800">
              <p className="text-xs text-amber-800 dark:text-amber-300">
                Timeline, berkas, dan diskusi dari {suspect.trackingCode} akan dipindah ke
                lamaran ini. Lamaran lama diarsipkan.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={mergingId === suspect.id}
                  onClick={() => void handleMerge(suspect.id, suspect.trackingCode)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white outline-none hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
                >
                  {mergingId === suspect.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <GitMerge className="size-3.5" aria-hidden="true" />
                  )}
                  Ya, Gabungkan
                </button>
                <button
                  type="button"
                  disabled={mergingId === suspect.id}
                  onClick={() => setMergeTarget(null)}
                  className="inline-flex h-9 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Batal
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ))}

      {/* Riwayat melamar sebelumnya */}
      {data.previous.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <History className="size-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <p className="text-sm font-semibold">Riwayat Melamar</p>
            <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
              {data.previous.length}
            </span>
          </div>
          <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto nice-scrollbar">
            {data.previous.map((row) => {
              const listApp = list?.find((a) => a.id === row.id);
              const clickable = Boolean(onNavigate && listApp);
              return (
                <button
                  key={row.id}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (listApp) onNavigate?.(listApp);
                  }}
                  title={clickable ? "Buka lamaran ini" : "Tidak ada di daftar aktif"}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm",
                    clickable
                      ? "outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50"
                      : "cursor-default opacity-80"
                  )}
                >
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                    {row.trackingCode}
                  </code>
                  <span className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</span>
                  <span className="min-w-0 flex-1 truncate">{row.positionTitle ?? "-"}</span>
                  <StatusBadge status={row.status as Application["status"]} />
                  {row.doNotHire ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400">
                      <Ban className="size-3" aria-hidden="true" />
                      Jangan diterima
                    </span>
                  ) : null}
                  {row.mergedIntoId ? (
                    <span className="text-[11px] italic text-muted-foreground">(digabungkan)</span>
                  ) : null}
                  {clickable ? (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fitur 5 — Tugas Uji (assessment)                                    */
/* ------------------------------------------------------------------ */

const ASSESSMENT_STATUS_STYLES: Record<Assessment["status"], string> = {
  DIKIRIM:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  DIKUMPUL:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  TERLAMBAT:
    "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950 dark:text-orange-400 dark:border-orange-900",
};

export function AssessmentSection({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [items, setItems] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [score, setScore] = useState("");
  const [resultNote, setResultNote] = useState("");
  const [savingGrade, setSavingGrade] = useState(false);

  const loadItems = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; assessments: Assessment[] }>(
        `/api/admin/applications/${applicationId}/assessments`
      );
      setItems(Array.isArray(res?.assessments) ? res.assessments : []);
    } catch {
      // Panel pelengkap; biarkan kosong saat gagal.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function handleCreate() {
    if (sending) return;
    if (!title.trim()) {
      toast.error("Judul tugas uji wajib diisi.");
      return;
    }
    const dueIso = dueAt ? new Date(dueAt) : null;
    if (!dueIso || Number.isNaN(dueIso.getTime())) {
      toast.error("Tenggat wajib diisi.");
      return;
    }
    setSending(true);
    try {
      const res = await apiPost<{ ok: boolean; assessments: Assessment[] }>(
        `/api/admin/applications/${applicationId}/assessments`,
        {
          title: title.trim(),
          dueAt: dueIso.toISOString(),
          note: note.trim() || undefined,
        }
      );
      toast.success("Tugas uji dikirim ke pelamar");
      setTitle("");
      setDueAt("");
      setNote("");
      setFormOpen(false);
      setItems(Array.isArray(res?.assessments) ? res.assessments : []);
    } catch (err) {
      reportError(err);
    } finally {
      setSending(false);
    }
  }

  function startGrading(item: Assessment) {
    setGradingId(item.id);
    setScore(item.resultScore != null ? String(item.resultScore) : "");
    setResultNote(item.resultNote ?? "");
  }

  async function handleSaveGrade() {
    if (!gradingId || savingGrade) return;
    const parsed = Number(score);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
      toast.error("Skor harus angka 0-100.");
      return;
    }
    setSavingGrade(true);
    try {
      const res = await apiPatch<{ ok: boolean; assessments: Assessment[] }>(
        `/api/admin/applications/${applicationId}/assessments`,
        {
          id: gradingId,
          resultScore: Math.round(parsed),
          resultNote: resultNote.trim() || undefined,
        }
      );
      toast.success("Nilai tugas uji disimpan");
      setGradingId(null);
      setItems(Array.isArray(res?.assessments) ? res.assessments : []);
    } catch (err) {
      reportError(err);
    } finally {
      setSavingGrade(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ClipboardList className="size-4 text-orange-500" aria-hidden="true" />
        <p className="text-sm font-semibold">Tugas Uji</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {items.length}
        </span>
        {canMutate ? (
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Send className="size-3.5" aria-hidden="true" />
            {formOpen ? "Tutup" : "Kirim Tugas Uji"}
          </button>
        ) : null}
      </div>

      {formOpen && canMutate ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Judul tugas, mis. Uji Editing 30 Detik"
            maxLength={150}
            disabled={sending}
            aria-label="Judul tugas uji"
            className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={sending}
              aria-label="Tenggat pengumpulan tugas uji"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:w-64"
            />
            <button
              type="button"
              disabled={sending || !title.trim() || !dueAt}
              onClick={() => void handleCreate()}
              className="inline-flex h-11 w-fit items-center gap-1.5 rounded-md bg-orange-600 px-3 text-xs font-semibold text-white outline-none hover:bg-orange-700 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:h-9"
            >
              {sending ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-3.5" aria-hidden="true" />
              )}
              Kirim
            </button>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Catatan / instruksi tambahan (opsional)"
            rows={2}
            maxLength={1000}
            disabled={sending}
            aria-label="Catatan tugas uji"
            className="w-full rounded-md border bg-background p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat tugas uji...
        </p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada tugas uji untuk pelamar ini.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
          {items.map((item) => {
            const overdue = item.status === "TERLAMBAT";
            const graded = item.resultScore != null;
            return (
              <div key={item.id} className="flex flex-col gap-1.5 rounded-md border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      ASSESSMENT_STATUS_STYLES[item.status]
                    )}
                  >
                    {item.status}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" aria-hidden="true" />
                    Tenggat: {formatDateTime(item.dueAt)}
                  </span>
                  {graded ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-semibold text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-400">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      Nilai: {item.resultScore}
                    </span>
                  ) : null}
                </div>
                {item.note ? (
                  <p className="text-xs whitespace-pre-wrap text-muted-foreground">{item.note}</p>
                ) : null}
                {item.submittedFileId ? (
                  <a
                    href={`/api/files/${item.submittedFileId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-fit text-xs font-medium text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
                  >
                    Lihat berkas hasil{item.submittedFileName ? ` — ${item.submittedFileName}` : ""}
                  </a>
                ) : null}
                {item.resultNote ? (
                  <p className="rounded bg-muted/60 p-2 text-xs whitespace-pre-wrap">
                    Catatan penilaian: {item.resultNote}
                  </p>
                ) : null}
                {canMutate && (item.status === "DIKUMPUL" || overdue) ? (
                  gradingId === item.id ? (
                    <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={score}
                          onChange={(e) => setScore(e.target.value)}
                          placeholder="Skor 0-100"
                          disabled={savingGrade}
                          aria-label="Skor tugas uji"
                          className="h-11 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:w-32"
                        />
                        <button
                          type="button"
                          disabled={savingGrade}
                          onClick={() => void handleSaveGrade()}
                          className="inline-flex h-11 items-center gap-1.5 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white outline-none hover:bg-teal-700 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:h-9"
                        >
                          {savingGrade ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : null}
                          Simpan Nilai
                        </button>
                        <button
                          type="button"
                          disabled={savingGrade}
                          onClick={() => setGradingId(null)}
                          className="inline-flex h-11 items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground outline-none hover:bg-accent sm:h-9"
                        >
                          Batal
                        </button>
                      </div>
                      <textarea
                        value={resultNote}
                        onChange={(e) => setResultNote(e.target.value)}
                        placeholder="Catatan penilaian (opsional)"
                        rows={2}
                        maxLength={1000}
                        disabled={savingGrade}
                        aria-label="Catatan penilaian tugas uji"
                        className="w-full rounded-md border bg-background p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startGrading(item)}
                      className="w-fit rounded-md border px-2.5 py-1.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      Nilai
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fitur 9 — Riwayat Panggilan                                         */
/* ------------------------------------------------------------------ */

const CALL_OUTCOME_STYLES: Record<CallOutcome, string> = {
  DIANGKAT:
    "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900",
  TIDAK_DIANGKAT:
    "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  JADWAL_ULANG:
    "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  NOMOR_SALAH:
    "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900",
};

export function CallLogSection({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [outcome, setOutcome] = useState<CallOutcome>("DIANGKAT");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const loadCalls = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiGet<{ ok: boolean; calls: CallLog[] }>(
        `/api/admin/applications/${applicationId}/calls`
      );
      setCalls(Array.isArray(res?.calls) ? res.calls : []);
    } catch {
      // Panel pelengkap; biarkan kosong saat gagal.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  async function handleCreate() {
    if (sending) return;
    setSending(true);
    try {
      const res = await apiPost<{ ok: boolean; calls: CallLog[] }>(
        `/api/admin/applications/${applicationId}/calls`,
        {
          outcome,
          note: note.trim() || undefined,
        }
      );
      toast.success("Panggilan dicatat");
      setNote("");
      setFormOpen(false);
      setCalls(Array.isArray(res?.calls) ? res.calls : []);
    } catch (err) {
      reportError(err);
    } finally {
      setSending(false);
    }
  }

  const sorted = [...calls].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <PhoneCall className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Riwayat Panggilan</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {calls.length}
        </span>
        {canMutate ? (
          <button
            type="button"
            onClick={() => setFormOpen((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Phone className="size-3.5" aria-hidden="true" />
            {formOpen ? "Tutup" : "Catat Panggilan"}
          </button>
        ) : null}
      </div>

      {formOpen && canMutate ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5">
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as CallOutcome)}
            disabled={sending}
            aria-label="Hasil panggilan"
            className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9"
          >
            {CALL_OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {CALL_OUTCOME_LABELS[o]}
              </option>
            ))}
          </select>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ringkasan percakapan (opsional)"
            rows={2}
            maxLength={1000}
            disabled={sending}
            aria-label="Ringkasan panggilan"
            className="w-full rounded-md border bg-background p-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          />
          <button
            type="button"
            disabled={sending}
            onClick={() => void handleCreate()}
            className="inline-flex h-11 w-fit items-center gap-1.5 rounded-md bg-rose-600 px-3 text-xs font-semibold text-white outline-none hover:bg-rose-700 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:h-9"
          >
            {sending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-3.5" aria-hidden="true" />
            )}
            Simpan
          </button>
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat riwayat panggilan...
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada panggilan tercatat.</p>
      ) : (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
          {sorted.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 rounded-md border p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                    CALL_OUTCOME_STYLES[c.outcome]
                  )}
                >
                  {CALL_OUTCOME_LABELS[c.outcome] ?? c.outcome}
                </span>
                <span className="text-xs font-medium">{c.actor}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {formatDateTime(c.createdAt)}
                </span>
              </div>
              {c.note ? (
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">{c.note}</p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fitur 10 — Inbox Terpadu                                            */
/* ------------------------------------------------------------------ */

const INBOX_KIND_ICON = {
  email: MailPlus,
  question: MessageCircle,
  call: Phone,
} as const;

const INBOX_DIRECTION_STYLES = {
  in: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900",
  out: "bg-teal-100 text-teal-700 border-teal-200 dark:bg-teal-950 dark:text-teal-400 dark:border-teal-900",
} as const;

export function InboxSection({ applicationId }: { applicationId: string }) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [hasUnanswered, setHasUnanswered] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    apiGet<{ items: InboxItem[]; hasUnanswered: boolean }>(
      `/api/admin/applications/${applicationId}/inbox`
    )
      .then((res) => {
        if (cancelled) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
        setHasUnanswered(Boolean(res?.hasUnanswered));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applicationId]);

  const sorted = [...items].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Inbox className="size-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Inbox Terpadu</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {items.length}
        </span>
      </div>

      {hasUnanswered ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          Pertanyaan terakhir belum dibalas
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat inbox...
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada email, pertanyaan, atau panggilan untuk pelamar ini.
        </p>
      ) : (
        <div className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1 nice-scrollbar">
          {sorted.map((item) => {
            const Icon = INBOX_KIND_ICON[item.kind] ?? Inbox;
            const isLong = (item.body ?? "").length > 180;
            const open = expanded.has(item.id);
            return (
              <div key={item.id} className="flex flex-col gap-1 rounded-md border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                      INBOX_DIRECTION_STYLES[item.direction]
                    )}
                  >
                    {item.direction === "in" ? "Masuk" : "Keluar"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">{item.title}</span>
                  <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                    {formatRelative(item.at)}
                  </span>
                </div>
                {item.body ? (
                  <button
                    type="button"
                    disabled={!isLong}
                    onClick={() => toggleExpand(item.id)}
                    className={cn(
                      "text-left text-xs whitespace-pre-wrap text-muted-foreground",
                      isLong && "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                      !open && "line-clamp-3"
                    )}
                  >
                    {item.body}
                  </button>
                ) : null}
                {item.unanswered ? (
                  <span className="w-fit rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
                    Menunggu balasan
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fitur 11 — Dokumen Internal (khusus admin)                          */
/* ------------------------------------------------------------------ */

type InternalDocRow = InternalDoc & { filename?: string | null };

export function InternalDocsSection({
  applicationId,
  canMutate,
}: {
  applicationId: string;
  canMutate: boolean;
}) {
  const { reportError } = useAdminSession();
  const [docs, setDocs] = useState<InternalDocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadDocs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiGet<{ docs: InternalDocRow[] }>(
        `/api/admin/applications/${applicationId}/internal-docs`
      );
      setDocs(Array.isArray(res?.docs) ? res.docs : []);
    } catch {
      // Panel pelengkap; biarkan kosong saat gagal.
    } finally {
      if (!silent) setLoading(false);
    }
  }, [applicationId]);

  useEffect(() => {
    void loadDocs();
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, [loadDocs]);

  async function handleUpload() {
    if (uploading) return;
    if (!file) {
      toast.error("Pilih berkas terlebih dahulu.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("label", label.trim() || file.name);
      const res = await apiFetch<{ ok: boolean; docs: InternalDocRow[] }>(
        `/api/admin/applications/${applicationId}/internal-docs`,
        { method: "POST", body: fd }
      );
      setDocs(Array.isArray(res?.docs) ? res.docs : []);
      toast.success("Dokumen internal diunggah");
      setLabel("");
      setFile(null);
    } catch (err) {
      reportError(err);
    } finally {
      setUploading(false);
    }
  }

  function handleDeleteClick(docId: string) {
    // Konfirmasi dua-klik sederhana: klik pertama menampilkan "Yakin?" 3 detik.
    if (confirmId === docId) {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      setConfirmId(null);
      void doDelete(docId);
      return;
    }
    setConfirmId(docId);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = setTimeout(() => setConfirmId(null), 3000);
  }

  async function doDelete(docId: string) {
    try {
      const res = await apiFetch<{ ok: boolean; docs: InternalDocRow[] }>(
        `/api/admin/applications/${applicationId}/internal-docs?docId=${encodeURIComponent(docId)}`,
        jsonInit("DELETE")
      );
      setDocs(Array.isArray(res?.docs) ? res.docs : []);
      toast.success("Dokumen internal dihapus");
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileUp className="size-4 text-zinc-600 dark:text-zinc-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Dokumen Internal</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Khusus admin — tidak pernah tampil di halaman status pelamar.
      </p>

      {canMutate ? (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-2.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Label dokumen, mis. Sketsa Kontrak"
              maxLength={60}
              disabled={uploading}
              aria-label="Label dokumen internal"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:flex-1"
            />
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={uploading}
              aria-label="Pilih berkas dokumen internal"
              className="h-11 w-full text-xs file:mr-2 file:h-8 file:rounded-md file:border file:file:bg-background file:file:px-2 file:file:text-xs sm:h-9 sm:w-auto"
            />
            <button
              type="button"
              disabled={uploading || !file}
              onClick={() => void handleUpload()}
              className="inline-flex h-11 w-fit items-center gap-1.5 rounded-md bg-zinc-800 px-3 text-xs font-semibold text-white outline-none hover:bg-zinc-900 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300 sm:h-9"
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="size-3.5" aria-hidden="true" />
              )}
              Unggah
            </button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Memuat dokumen internal...
        </p>
      ) : docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Belum ada dokumen internal.</p>
      ) : (
        <div className="flex max-h-96 flex-col gap-1.5 overflow-y-auto pr-1 nice-scrollbar">
          {docs.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{doc.label}</span>
                {doc.filename ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">{doc.filename}</span>
                ) : null}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {formatDateTime(doc.createdAt)}
                {doc.uploadedBy ? ` · ${doc.uploadedBy}` : ""}
              </span>
              <a
                href={`/api/files/${doc.fileId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                Unduh
              </a>
              {canMutate ? (
                <button
                  type="button"
                  onClick={() => handleDeleteClick(doc.id)}
                  aria-label={`Hapus dokumen internal ${doc.label}`}
                  className={cn(
                    "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    confirmId === doc.id
                      ? "border-rose-300 bg-rose-600 text-white hover:bg-rose-700"
                      : "text-muted-foreground hover:bg-accent hover:text-rose-600"
                  )}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  {confirmId === doc.id ? "Yakin?" : "Hapus"}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fitur 13 — Masa Berlaku Dokumen                                     */
/* ------------------------------------------------------------------ */

const DOC_EXPIRY_SUGGESTIONS = ["SIM A", "SIM B", "KTP", "Surat Sehat", "STNK"];

export function DocExpirySection({
  app,
  canMutate,
  onSaved,
}: {
  app: Application;
  canMutate: boolean;
  onSaved: (app: Application) => void;
}) {
  const { reportError } = useAdminSession();
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  const entries = app.docExpiries ?? [];

  async function save(next: typeof entries, message: string) {
    if (saving) return;
    setSaving(true);
    try {
      const updated = await apiPatch<Application>(
        `/api/admin/applications/${app.id}`,
        { docExpiries: next }
      );
      toast.success(message);
      onSaved(updated);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  function handleAdd() {
    if (!label.trim() || !expiresAt) {
      toast.error("Label dan tanggal kedaluwarsa wajib diisi.");
      return;
    }
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) {
      toast.error("Tanggal tidak valid.");
      return;
    }
    void save(
      [
        ...entries,
        {
          id: `exp${Date.now()}`,
          label: label.trim(),
          expiresAt: d.toISOString(),
        },
      ],
      "Masa berlaku dokumen ditambahkan"
    );
    setLabel("");
    setExpiresAt("");
  }

  function expiryBadge(iso: string) {
    const days = daysUntil(iso);
    if (days == null) return null;
    if (days < 0) {
      return (
        <span className="inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-semibold text-white">
          Kedaluwarsa
        </span>
      );
    }
    if (days <= 30) {
      return (
        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400">
          {days} hari lagi
        </span>
      );
    }
    if (days <= 60) {
      return (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
          {days} hari lagi
        </span>
      );
    }
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">
        {days} hari lagi
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="size-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Masa Berlaku Dokumen</p>
        <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-xs font-medium tabular-nums text-secondary-foreground">
          {entries.length}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Belum ada dokumen dengan masa berlaku (SIM, KTP, surat sehat, dll).
        </p>
      ) : (
        <div className="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-1 nice-scrollbar">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{entry.label}</span>
              <span className="text-xs text-muted-foreground">{formatDate(entry.expiresAt)}</span>
              {expiryBadge(entry.expiresAt)}
              {canMutate ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void save(
                      entries.filter((e) => e.id !== entry.id),
                      "Dokumen dihapus dari daftar"
                    )
                  }
                  aria-label={`Hapus masa berlaku ${entry.label}`}
                  className="text-muted-foreground outline-none hover:text-rose-600 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 dark:hover:text-rose-400"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {canMutate ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              list={`doc-expiry-suggestions-${app.id}`}
              placeholder="Label dokumen"
              maxLength={80}
              disabled={saving}
              aria-label="Label dokumen berjangka"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:w-40"
            />
            <datalist id={`doc-expiry-suggestions-${app.id}`}>
              {DOC_EXPIRY_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={saving}
              aria-label="Tanggal kedaluwarsa dokumen"
              className="h-11 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9 sm:w-40"
            />
          </div>
          <button
            type="button"
            disabled={saving || !label.trim() || !expiresAt}
            onClick={handleAdd}
            className="inline-flex h-11 w-fit items-center rounded-md bg-teal-600 px-3 text-xs font-semibold text-white outline-none hover:bg-teal-700 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 sm:h-9"
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : null}
            Tambah
          </button>
        </div>
      ) : null}
    </div>
  );
}
