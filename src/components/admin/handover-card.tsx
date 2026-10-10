"use client";

// NR46 — Kartu "Serah Terima Harian" (dashboard, SEMUA role admin).
// GET   /api/admin/handover?days=7 -> { notes, mineToday, today }.
// POST  /api/admin/handover { needsAction, risks, notes } — catatan hari ini
//       (satu catatan per penulis per tanggal; menulis ulang = memperbarui).
// PATCH /api/admin/handover { id, action: "acknowledge" } — tandai ditindak.
//
// Aturan peran: OWNER/HR dapat menulis & menandai; VIEWER hanya membaca
// (form disembunyikan, tombol tandai tidak tampil — server tetap menegakkan).
// Tanpa polling: muat saat mount + segarkan setelah aksi.

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { HandoverNoteView } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { CollapsibleCard } from "./collapsible-card";
import { apiGet, apiPatch, apiPost } from "./api";
import { formatRelative } from "./format";
import { useAdminSession } from "./admin-context";

type HandoverResponse = {
  notes: HandoverNoteView[];
  mineToday: HandoverNoteView | null;
  today: string;
};

type HandoverForm = {
  needsAction: string;
  risks: string;
  notes: string;
};

const EMPTY_FORM: HandoverForm = { needsAction: "", risks: "", notes: "" };

// "2025-01-17" -> "Jumat, 17 Januari 2025" (diparse sebagai tanggal lokal agar
// tidak bergeser zona waktu).
function formatForDate(key: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return key;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return key;
  return new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d);
}

const STATUS_BADGE: Record<
  HandoverNoteView["status"],
  { label: string; className: string }
> = {
  OPEN: {
    label: "Terbuka",
    className:
      "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400",
  },
  ACKNOWLEDGED: {
    label: "Ditindak",
    className:
      "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400",
  },
};

// Bagian isi catatan yang tidak kosong (label kecil di depan).
function NoteSection({ label, value }: { label: string; value: string }) {
  const text = (value ?? "").trim();
  if (!text) return null;
  return (
    <p className="text-sm">
      <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}:
      </span>
      <span className="whitespace-pre-wrap">{text}</span>
    </p>
  );
}

export function HandoverCard() {
  const { role } = useAdminSession();
  const canWrite = role !== "VIEWER";

  const [data, setData] = useState<HandoverResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<HandoverForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [ackBusyId, setAckBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await apiGet<HandoverResponse>("/api/admin/handover?days=7");
      setData(res);
    } catch {
      // Kartu tetap tampil; daftar kosong tanpa crash.
      setData((prev) => prev ?? { notes: [], mineToday: null, today: "" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Prefill form dari catatan hari ini milik sendiri — hanya saat ID catatan
  // berubah agar ketikan pengguna tidak tertimpa saat refresh berkala.
  const mineTodayId = data?.mineToday?.id ?? null;
  useEffect(() => {
    if (!data?.mineToday) return;
    setForm({
      needsAction: data.mineToday.needsAction ?? "",
      risks: data.mineToday.risks ?? "",
      notes: data.mineToday.notes ?? "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineTodayId]);

  async function handleSave() {
    if (saving) return;
    if (!form.needsAction.trim() && !form.risks.trim() && !form.notes.trim()) {
      toast.warning("Isi minimal satu bagian catatan sebelum menyimpan.");
      return;
    }
    setSaving(true);
    try {
      await apiPost<{ ok?: boolean }>("/api/admin/handover", {
        needsAction: form.needsAction.trim(),
        risks: form.risks.trim(),
        notes: form.notes.trim(),
      });
      toast.success("Catatan serah terima disimpan");
      await refresh();
    } catch {
      toast.error("Gagal menyimpan catatan serah terima.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAcknowledge(note: HandoverNoteView) {
    if (ackBusyId) return;
    setAckBusyId(note.id);
    try {
      await apiPatch<{ ok?: boolean }>("/api/admin/handover", {
        id: note.id,
        action: "acknowledge",
      });
      toast.success("Catatan ditandai sudah ditindak.");
      await refresh();
    } catch {
      toast.error("Gagal menandai catatan.");
    } finally {
      setAckBusyId(null);
    }
  }

  const notes = data?.notes ?? [];
  const hasMineToday = data?.mineToday != null;

  return (
    <CollapsibleCard
      id="serah-terima-harian"
      icon={ClipboardList}
      title="Serah Terima Harian"
      description="Catatan pergantian jaga: hal yang perlu ditindak besok, risiko, dan catatan umum tim."
      defaultOpen
    >
      {canWrite ? (
        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <p className="text-sm font-medium">
            {hasMineToday ? "Catatan Anda hari ini sudah ada — perbarui bila perlu." : "Tutup hari ini"}
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handover-needs">Perlu ditindak besok</Label>
              <Textarea
                id="handover-needs"
                rows={3}
                value={form.needsAction}
                onChange={(e) => setForm((f) => ({ ...f, needsAction: e.target.value }))}
                placeholder="mis. Follow-up kandidat LM-00123"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handover-risks">Risiko / perhatian</Label>
              <Textarea
                id="handover-risks"
                rows={3}
                value={form.risks}
                onChange={(e) => setForm((f) => ({ ...f, risks: e.target.value }))}
                placeholder="mis. Offer belum dijawab, deadline 2 hari"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="handover-notes">Catatan umum</Label>
              <Textarea
                id="handover-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="mis. ServerMaintenance selesai malam ini"
              />
            </div>
          </div>
          <div>
            <Button
              className="h-11 active:scale-[0.99] sm:h-10"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : hasMineToday ? (
                "Perbarui Catatan Hari Ini"
              ) : (
                "Simpan Catatan Hari Ini"
              )}
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Mode Pengamat — catatan serah terima hanya dapat dibaca.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Catatan 7 hari terakhir
        </p>
        {loading && data === null ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ) : notes.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            Belum ada catatan serah terima. Mulai dengan mengisi formulir di atas.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {notes.map((note) => {
              const statusMeta = STATUS_BADGE[note.status] ?? STATUS_BADGE.OPEN;
              return (
                <li key={note.id} className="flex flex-col gap-2 rounded-lg border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 flex-1 text-sm font-medium">
                      {formatForDate(note.forDate)}
                    </p>
                    <Badge
                      variant="outline"
                      className={`shrink-0 px-1.5 py-0 text-[10px] ${statusMeta.className}`}
                    >
                      {statusMeta.label}
                    </Badge>
                    {note.status === "OPEN" && canWrite ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 shrink-0"
                        disabled={ackBusyId !== null}
                        onClick={() => void handleAcknowledge(note)}
                      >
                        {ackBusyId === note.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : null}
                        Tandai Ditindak
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Penulis: {note.authorName} · {formatRelative(note.createdAt)}
                    {note.acknowledgedByName
                      ? ` · ditindak oleh ${note.acknowledgedByName}`
                      : ""}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    <NoteSection label="Perlu ditindak" value={note.needsAction} />
                    <NoteSection label="Risiko" value={note.risks} />
                    <NoteSection label="Catatan" value={note.notes} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CollapsibleCard>
  );
}
