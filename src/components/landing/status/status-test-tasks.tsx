"use client";

// Panel Tugas Uji (NR-54) — daftar tugas uji yang dikirim tim untuk lamaran ini,
// lengkap dengan pengumpulan hasil langsung dari halaman Cek Status.
// State form (berkas terpilih per tugas) hidup di orchestrator (status-page.tsx),
// mengikuti pola CvUpdatePanel — tidak ter-reset saat panel dilipat/dibuka.

import type { ChangeEvent } from "react";
import { CheckCircle2, Clock, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CandidateAssessment } from "@/lib/types";
import type { Dict } from "@/components/landing/strings";
import { StatusSection } from "./status-shared";

type TestStrings = Dict["status"]["test"];

/** Ekstensi yang diterima klien — server tetap memverifikasi magic bytes. */
const TEST_FILE_ACCEPT = [
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".zip",
  ".txt",
  ".md",
  ".csv",
].join(",");

/** Chip status tugas: warna konsisten dengan gaya halaman status (amber/teal/rose). */
function statusChipClass(status: CandidateAssessment["status"]): string {
  switch (status) {
    case "DIKUMPUL":
      return "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-500/40 dark:bg-teal-950/40 dark:text-teal-400";
    case "TERLAMBAT":
      return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-950/40 dark:text-rose-400";
    default:
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300";
  }
}

function statusLabel(status: CandidateAssessment["status"], ts: TestStrings): string {
  switch (status) {
    case "DIKUMPUL":
      return ts.statusDikumpul;
    case "TERLAMBAT":
      return ts.statusTerlambat;
    default:
      return ts.statusDikirim;
  }
}

function formatDateTimeId(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.toLocaleDateString("id-ID", { dateStyle: "long" })}, ${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WIB`;
}

export function TestTasksPanel({
  assessments,
  chosenFor,
  busyId,
  onSelectTestFile,
  onSubmitTest,
  ts,
}: {
  assessments: CandidateAssessment[];
  /** id tugas yang sedang memilih berkas + nama berkasnya (null bila tidak ada). */
  chosenFor: { id: string; name: string } | null;
  busyId: string | null;
  onSelectTestFile: (assessmentId: string, event: ChangeEvent<HTMLInputElement>) => void;
  onSubmitTest: (assessmentId: string) => void;
  ts: TestStrings;
}) {
  const hasPending = assessments.some((a) => a.status !== "DIKUMPUL");
  return (
    <StatusSection
      icon={FileUp}
      title={ts.title}
      defaultOpen={hasPending}
      iconClassName="text-rose-600 dark:text-rose-400"
    >
      <p className="mt-1 text-sm text-muted-foreground">{ts.desc}</p>
      <div className="mt-3 flex flex-col gap-3">
        {assessments.map((a) => {
          const collected = a.status === "DIKUMPUL";
          const busy = busyId === a.id;
          const chosen = chosenFor?.id === a.id ? chosenFor : null;
          return (
            <div key={a.id} className="rounded-xl border p-3.5">
              <div className="flex flex-wrap items-start gap-2">
                <span className="min-w-0 flex-1 text-sm font-medium">{a.title}</span>
                <span
                  className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusChipClass(a.status)}`}
                >
                  {statusLabel(a.status, ts)}
                </span>
              </div>

              <p className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="size-3 shrink-0" aria-hidden="true" />
                {ts.dueLabel}: {formatDateTimeId(a.dueAt)}
              </p>

              {a.note ? (
                <p className="mt-2 whitespace-pre-line rounded-lg bg-muted/60 p-2.5 text-xs leading-relaxed">
                  <span className="font-medium">{ts.noteLabel}: </span>
                  {a.note}
                </p>
              ) : null}

              {collected ? (
                <div className="mt-2.5 flex flex-col gap-1">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-teal-700 dark:text-teal-400">
                    <CheckCircle2 className="size-3.5 shrink-0" aria-hidden="true" />
                    {ts.submittedLabel}
                    {a.submittedAt ? `: ${formatDateTimeId(a.submittedAt)}` : ""}
                  </p>
                  {a.submittedFileName ? (
                    <p className="truncate pl-5 text-xs text-muted-foreground">
                      {a.submittedFileName}
                    </p>
                  ) : null}
                  {a.resultScore != null ? (
                    <p className="pl-5 text-xs font-semibold text-teal-700 dark:text-teal-400">
                      {ts.resultLabel}: {a.resultScore}/100
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2.5 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <label
                      htmlFor={`test-file-${a.id}`}
                      className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-9"
                    >
                      <Upload className="size-3.5" aria-hidden="true" />
                      {ts.choose}
                    </label>
                    <input
                      id={`test-file-${a.id}`}
                      type="file"
                      accept={TEST_FILE_ACCEPT}
                      className="sr-only"
                      tabIndex={-1}
                      onChange={(e) => onSelectTestFile(a.id, e)}
                      disabled={busy}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-11 bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-600/50 sm:h-9"
                      disabled={!chosen || busy}
                      onClick={() => onSubmitTest(a.id)}
                    >
                      {busy ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="size-3.5" aria-hidden="true" />
                      )}
                      {busy ? ts.sending : ts.submit}
                    </Button>
                  </div>
                  {chosen ? (
                    <p className="truncate text-xs text-muted-foreground">
                      {ts.chosenLabel}: {chosen.name}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </StatusSection>
  );
}
