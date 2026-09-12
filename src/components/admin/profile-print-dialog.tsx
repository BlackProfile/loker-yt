"use client";

// Dialog pratinjau cetak profil kandidat (Task 20-f — fitur 4).
// Menampilkan profil siap cetak: identitas, kontak, status, skor/ringkasan AI, rating,
// pengalaman, motivasi, rubrik, riwayat wawancara ringkas, dan 10 aktivitas terakhir.
// CSS cetak inline: seluruh halaman disembunyikan, hanya #print-area yang tampil
// saat window.print() — header/panel admin otomatis ikut tersembunyi.

import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { stageLabel } from "@/lib/stages";
import {
  AI_RECOMMENDATION_LABELS,
  INTERVIEW_RECOMMENDATION_LABELS,
  INTERVIEW_STATUS_LABELS,
  type Application,
  type Interview,
  type LogEntry,
  type Position,
} from "@/lib/types";
import { apiGet } from "./api";
import { actionLabel, formatDateTime, formatShortDateTime } from "./format";

// Pola cetak: body * disembunyikan, hanya #print-area (dan isinya) yang terlihat,
// lalu diposisikan menempel satu halaman. Kontainer dialog dinetralkan agar
// profil panjang tidak terpotong batas dialog saat dicetak.
const PRINT_STYLE = `
@media print {
  html, body { height: auto !important; overflow: visible !important; }
  body * { visibility: hidden; }
  #print-area, #print-area * { visibility: visible; }
  #print-area {
    position: absolute;
    inset: 0;
    background: #ffffff;
    max-height: none;
    overflow: visible;
    padding: 0;
    margin: 0;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
  [data-slot="dialog-overlay"],
  [data-slot="dialog-content"] {
    position: static !important;
    transform: none !important;
    width: auto !important;
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
  .print-hidden { display: none !important; }
  @page { margin: 12mm; }
}
`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-bold uppercase tracking-wide text-zinc-500">{title}</h4>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function LoadingRow({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-zinc-500">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      {text}
    </p>
  );
}

function EmptyText({ text }: { text: string }) {
  return <p className="text-sm text-zinc-500">{text}</p>;
}

/** Ringkasan satu baris per sesi wawancara (ronde, jadwal, status, rekomendasi, skor). */
function interviewSummary(item: Interview): string {
  const parts = [
    `Ronde ${item.round}`,
    formatDateTime(item.scheduledAt),
    INTERVIEW_STATUS_LABELS[item.status],
  ];
  if (item.recommendation) parts.push(INTERVIEW_RECOMMENDATION_LABELS[item.recommendation]);
  const values = item.scores ? Object.values(item.scores) : [];
  if (values.length > 0) {
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    parts.push(`Skor rata-rata ${avg.toFixed(1).replace(".", ",")}/5`);
  }
  return parts.join(" · ");
}

export function ProfilePrintDialog({
  application,
  positions,
  open,
  onOpenChange,
}: {
  application: Application | null;
  positions: Position[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [interviewsLoading, setInterviewsLoading] = useState(false);

  const appId = open ? (application?.id ?? null) : null;

  // 10 aktivitas terakhir kandidat (log aktivitas per lamaran).
  // Tanpa reset state saat dialog tertutup — komponen tidak dirender dan data
  // selalu ditimpa hasil fetch terbaru saat kandidat dibuka.
  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    setLogsLoading(true);
    apiGet<LogEntry[]>(`/api/admin/logs?applicationId=${encodeURIComponent(appId)}&limit=10`)
      .then((rows) => {
        if (!cancelled) setLogs(rows);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      })
      .finally(() => {
        if (!cancelled) setLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  // Riwayat wawancara ringkas: endpoint daftar wawancara yang ada, difilter per lamaran.
  useEffect(() => {
    if (!appId) return;
    let cancelled = false;
    setInterviewsLoading(true);
    apiGet<Interview[]>("/api/admin/interviews")
      .then((rows) => {
        if (cancelled) return;
        const mine = rows
          .filter((row) => row.applicationId === appId)
          .sort((a, b) => a.round - b.round);
        setInterviews(mine);
      })
      .catch(() => {
        if (!cancelled) setInterviews([]);
      })
      .finally(() => {
        if (!cancelled) setInterviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (!application) return null;

  const app = application;
  const position = app.positionId
    ? (positions.find((p) => p.id === app.positionId) ?? null)
    : null;

  // Baris rubrik: kriteria milik posisi digabung kriteria yang sudah dinilai.
  const rubricAll = Array.from(
    new Set([...(position?.rubricCriteria ?? []), ...Object.keys(app.rubricScores ?? {})])
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="nice-scrollbar max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <style>{PRINT_STYLE}</style>

        <DialogHeader className="print-hidden">
          <DialogTitle>Pratinjau Cetak Profil Kandidat</DialogTitle>
          <DialogDescription>
            Periksa isinya, lalu cetak atau simpan sebagai PDF lewat dialog cetak browser.
          </DialogDescription>
        </DialogHeader>

        <div className="nice-scrollbar max-h-[62vh] overflow-y-auto rounded-xl border bg-zinc-50/60 p-4 print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:bg-white print:p-0 dark:bg-zinc-900/40 print:dark:bg-white">
          <div id="print-area" className="rounded-lg bg-white p-4 text-zinc-900 print:p-0">
            {/* Kop identitas */}
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-3">
              <div className="min-w-0">
                <h3 className="text-lg font-bold leading-tight">{app.name}</h3>
                <p className="text-sm text-zinc-600">{app.positionTitle ?? "Tanpa posisi"}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Kode: {app.trackingCode || "-"} · Dilamar:{" "}
                  {formatShortDateTime(app.createdAt)}
                </p>
              </div>
              <div className="text-right text-xs text-zinc-600">
                <p>
                  Status:{" "}
                  <span className="font-semibold text-zinc-900">{stageLabel(app.status)}</span>
                </p>
                <p>Rating: {app.rating}/5</p>
                <p>Skor AI: {app.aiScore != null ? `${app.aiScore}/100` : "Belum dianalisis"}</p>
              </div>
            </div>

            {/* Kontak */}
            <Section title="Kontak">
              <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <p>
                  <span className="text-zinc-500">Email: </span>
                  <span className="break-all">{app.email}</span>
                </p>
                <p>
                  <span className="text-zinc-500">Telepon: </span>
                  {app.phone}
                </p>
                <p>
                  <span className="text-zinc-500">Portofolio: </span>
                  <span className="break-all">{app.portfolioUrl ?? "-"}</span>
                </p>
                <p>
                  <span className="text-zinc-500">Link sosial: </span>
                  <span className="break-all">{app.socialLinks ?? "-"}</span>
                </p>
                <p>
                  <span className="text-zinc-500">CV: </span>
                  {app.cvFileName ?? "-"}
                </p>
              </div>
            </Section>

            {/* Analisis AI */}
            <Section title="Analisis AI">
              <p className="text-sm">
                <span className="text-zinc-500">Rekomendasi: </span>
                {app.aiRecommendation ? AI_RECOMMENDATION_LABELS[app.aiRecommendation] : "-"}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {app.aiSummary ?? "Belum ada ringkasan AI."}
              </p>
            </Section>

            {/* Pengalaman & motivasi */}
            <Section title="Pengalaman">
              <p className="whitespace-pre-wrap text-sm">{app.experience || "-"}</p>
            </Section>
            <Section title="Motivasi">
              <p className="whitespace-pre-wrap text-sm">{app.motivation || "-"}</p>
            </Section>

            {/* Rubrik evaluasi */}
            <Section title="Rubrik Evaluasi">
              {rubricAll.length === 0 ? (
                <EmptyText text="Posisi ini belum memiliki kriteria rubrik." />
              ) : (
                <table className="w-full max-w-md text-sm">
                  <tbody>
                    {rubricAll.map((kriteria) => (
                      <tr key={kriteria} className="border-b border-zinc-100 last:border-0">
                        <td className="py-1 pr-4">{kriteria}</td>
                        <td className="py-1 text-right font-medium tabular-nums">
                          {app.rubricScores?.[kriteria] ?? 0}/5
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            {/* Riwayat wawancara ringkas */}
            <Section title="Riwayat Wawancara">
              {interviewsLoading ? (
                <LoadingRow text="Memuat riwayat wawancara..." />
              ) : interviews.length === 0 ? (
                <EmptyText text="Belum ada sesi wawancara." />
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {interviews.map((item) => (
                    <li key={item.id} className="flex flex-wrap gap-x-2">
                      <span>{interviewSummary(item)}</span>
                      {item.notes ? (
                        <span className="text-xs text-zinc-500">Catatan: {item.notes}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* 10 aktivitas terakhir */}
            <Section title="10 Aktivitas Terakhir">
              {logsLoading ? (
                <LoadingRow text="Memuat aktivitas..." />
              ) : logs.length === 0 ? (
                <EmptyText text="Belum ada aktivitas tercatat." />
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {logs.map((log) => (
                    <li key={log.id} className="flex flex-wrap gap-x-2">
                      <span className="whitespace-nowrap text-xs text-zinc-500">
                        {formatShortDateTime(log.createdAt)}
                      </span>
                      <span>{actionLabel(log.action)}</span>
                      <span className="text-xs text-zinc-500">
                        {log.actor}
                        {log.detail ? ` — ${log.detail}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <p className="mt-4 border-t border-zinc-200 pt-2 text-[10px] text-zinc-500">
              Dicetak {formatDateTime(new Date().toISOString())} — Dokumen internal rekrutmen.
            </p>
          </div>
        </div>

        <DialogFooter className="print-hidden">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Cetak / Simpan PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
