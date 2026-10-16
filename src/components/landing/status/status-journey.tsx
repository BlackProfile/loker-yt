"use client";

// NR61 — Peta Perjalanan Seleksi (macro stepper): ringkasan 6 tahap besar
// (Lamaran → Seleksi Berkas → Tes Seleksi → Wawancara → Penawaran → Onboarding)
// yang dirender di atas timeline per-tahap (StatusTimeline). State tiap tahap
// diturunkan murni dari data TrackResponse lewat deriveJourney() — tanpa state
// lokal, jadi ikut berubah otomatis setiap detail di-refresh.

import {
  Check,
  CircleX,
  ClipboardCheck,
  FileSearch,
  FileUp,
  Lightbulb,
  MailCheck,
  MessagesSquare,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TrackResponse } from "@/lib/types";
import type { Dict, Lang } from "@/components/landing/strings";
import { formatShortDate } from "./status-types";

export type JourneyState = "done" | "active" | "pending";
export type JourneyStep = { key: string; state: JourneyState; at: string | null };

// Key internal 6 tahap makro (urut) — indeks sejajar dengan JOURNEY_ICONS
// dan p.journey.steps (dict NR61 di strings.ts, tidak diubah di sini).
const JOURNEY_KEYS = [
  "LAMARAN",
  "SELEKSI_BERKAS",
  "TES_SELEKSI",
  "WAWANCARA",
  "PENAWARAN",
  "ONBOARDING",
] as const;

const JOURNEY_ICONS: LucideIcon[] = [
  FileUp,
  FileSearch,
  ClipboardCheck,
  MessagesSquare,
  MailCheck,
  Rocket,
];

/**
 * Turunkan peta perjalanan 6 tahap makro dari data pelamar.
 * Aturan per tahap (lihat komentar di dalam). `ended` = proses berakhir
 * (rejection); saat ended tidak ada tahap aktif dan endedAtIndex menunjuk
 * tahap terjauh yang selesai. Bila tidak ada tahap "active" eksplisit,
 * tahap pending pertama dianggap posisi saat ini (activeIndex).
 */
export function deriveJourney(detail: TrackResponse): {
  steps: JourneyStep[];
  ended: boolean;
  endedAtIndex: number | null;
  activeIndex: number | null;
} {
  const assessments = detail.assessments ?? [];
  const interviews = detail.interviews ?? [];
  const offer = detail.offer ?? null;
  const onboarding = detail.onboarding ?? null;

  // 0 — LAMARAN: selalu selesai (lamaran terkirim = tahap ini lewat).
  const lamaran: JourneyStep = {
    key: JOURNEY_KEYS[0],
    state: "done",
    at: detail.submittedAt ?? null,
  };

  // 1 — SELEKSI BERKAS: selesai bila pipeline sudah maju dari tahap awal
  // (ada langkah index >= 1 yang done), atau — untuk pipeline bawaan tanpa
  // langkah kustom — status sudah bukan "NEW". Sebaliknya pending.
  const pipeSteps = detail.steps ?? [];
  const berkasDone =
    pipeSteps.some((s, i) => i >= 1 && s.done) ||
    (pipeSteps.length === 0 && detail.status != null && detail.status !== "NEW");
  const berkas: JourneyStep = {
    key: JOURNEY_KEYS[1],
    state: berkasDone ? "done" : "pending",
    at: null,
  };

  // 2 — TES SELEKSI: selesai bila ada tugas DIKUMPUL atau sudah dinilai
  // (resultScore terisi) — tanggal = submittedAt paling awal di antara tugas
  // tsb; aktif bila ada tugas DIKIRIM/TERLAMBAT yang belum dinilai.
  const tesSelesai = assessments.filter(
    (a) => a.status === "DIKUMPUL" || a.resultScore != null,
  );
  const tesDates = tesSelesai
    .map((a) => a.submittedAt)
    .filter((v): v is string => !!v)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const tesAktif = assessments.some(
    (a) => (a.status === "DIKIRIM" || a.status === "TERLAMBAT") && a.resultScore == null,
  );
  const tes: JourneyStep = {
    key: JOURNEY_KEYS[2],
    state: tesSelesai.length > 0 ? "done" : tesAktif ? "active" : "pending",
    at: tesDates.length > 0 ? tesDates[0] : null,
  };

  // 3 — WAWANCARA: selesai bila ada sesi COMPLETED (tanggal = scheduledAt
  // sesi COMPLETED terbaru); aktif bila ada sesi terjadwal (SCHEDULED /
  // CONFIRMED / RESCHEDULE_REQUESTED). NO_SHOW/CANCELLED tidak dihitung.
  const ivSelesai = interviews.filter((iv) => iv.status === "COMPLETED");
  const ivDates = ivSelesai
    .map((iv) => iv.scheduledAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const ivAktif = interviews.some(
    (iv) =>
      iv.status === "SCHEDULED" ||
      iv.status === "CONFIRMED" ||
      iv.status === "RESCHEDULE_REQUESTED",
  );
  const wawancara: JourneyStep = {
    key: JOURNEY_KEYS[3],
    state: ivSelesai.length > 0 ? "done" : ivAktif ? "active" : "pending",
    at: ivDates.length > 0 ? ivDates[ivDates.length - 1] : null,
  };

  // 4 — PENAWARAN: selesai bila offer ACCEPTED atau sudah ada hiredAt
  // (tanggal = respondedAt offer, fallback hiredAt); aktif bila offer masih
  // PENDING. DECLINED/EXPIRED tanpa hiredAt → pending (marker ended yang
  // menandai akhir proses).
  const hiredAt = onboarding?.hiredAt ?? null;
  const offerDone = offer?.status === "ACCEPTED" || hiredAt != null;
  const penawaran: JourneyStep = {
    key: JOURNEY_KEYS[4],
    state: offerDone ? "done" : offer?.status === "PENDING" ? "active" : "pending",
    at: offerDone ? (offer?.respondedAt ?? hiredAt) : null,
  };

  // 5 — ONBOARDING: selesai bila hiredAt terisi (checklist dokumen tidak
  // dihitung — itu progres operasional, bukan tahap makro).
  const onboardingStep: JourneyStep = {
    key: JOURNEY_KEYS[5],
    state: hiredAt != null ? "done" : "pending",
    at: hiredAt,
  };

  const steps: JourneyStep[] = [
    lamaran,
    berkas,
    tes,
    wawancara,
    penawaran,
    onboardingStep,
  ];

  // Proses berakhir (rejection tercatat / status REJECTED): tidak ada tahap
  // aktif; endedAtIndex = tahap terjauh yang selesai (fallback: tahap
  // terakhir yang done/active; minimal 0).
  const ended = detail.rejection != null || detail.status === "REJECTED";

  let activeIndex: number | null = null;
  if (!ended) {
    const firstActive = steps.findIndex((s) => s.state === "active");
    if (firstActive >= 0) {
      activeIndex = firstActive;
    } else {
      // Tidak ada tahap "active" eksplisit → tahap pending pertama dianggap
      // posisi saat ini; bila semua done → null.
      const firstPending = steps.findIndex((s) => s.state === "pending");
      activeIndex = firstPending >= 0 ? firstPending : null;
    }
  }

  let endedAtIndex: number | null = null;
  if (ended) {
    for (let i = steps.length - 1; i >= 0; i -= 1) {
      if (steps[i].state === "done") {
        endedAtIndex = i;
        break;
      }
    }
    if (endedAtIndex === null) {
      for (let i = steps.length - 1; i >= 0; i -= 1) {
        if (steps[i].state !== "pending") {
          endedAtIndex = i;
          break;
        }
      }
      endedAtIndex = endedAtIndex ?? 0;
    }
  }

  return { steps, ended, endedAtIndex, activeIndex };
}

/** Lingkaran ikon tahap — varian state done/active/pending. */
function JourneyCircle({
  state,
  Icon,
  className,
  iconClassName,
}: {
  state: JourneyState;
  Icon: LucideIcon;
  className: string;
  iconClassName: string;
}) {
  if (state === "done") {
    return (
      <span
        className={cn(
          "relative z-10 flex items-center justify-center rounded-full bg-emerald-600 text-white",
          className,
        )}
      >
        <Icon className={iconClassName} aria-hidden="true" />
        {/* Overlay check kecil di sudut (ikon tahap tetap terlihat) */}
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-emerald-600 ring-2 ring-background">
          <Check className="size-2.5" aria-hidden="true" />
        </span>
      </span>
    );
  }
  if (state === "active") {
    // Pola ping persis StatusTimeline: halo animate-ping bg-rose-500/30 +
    // titik solid bg-rose-500 (diskalakan jadi lingkaran penuh berisi ikon).
    return (
      <span
        className={cn(
          "relative z-10 flex items-center justify-center rounded-full",
          className,
        )}
      >
        <span
          className="absolute inset-0 animate-ping rounded-full bg-rose-500/30"
          aria-hidden="true"
        />
        <span
          className={cn(
            "relative flex items-center justify-center rounded-full bg-rose-500 text-white",
            className,
          )}
        >
          <Icon className={iconClassName} aria-hidden="true" />
        </span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "relative z-10 flex items-center justify-center rounded-full border-2 border-muted-foreground/30 bg-muted text-muted-foreground/60",
        className,
      )}
    >
      <Icon className={iconClassName} aria-hidden="true" />
    </span>
  );
}

/** Chip status kecil di bawah/kanan label tahap. */
function JourneyChip({
  state,
  at,
  lang,
  nowMs,
  p,
}: {
  state: JourneyState;
  at: string | null;
  lang: Lang;
  nowMs: number;
  p: Dict["status"]["page"];
}) {
  if (state === "done") {
    return (
      <span className="text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
        {at ? formatShortDate(at, lang, nowMs) : p.journey.stateDone}
      </span>
    );
  }
  if (state === "active") {
    return (
      <Badge
        variant="outline"
        className="border-rose-200 bg-rose-50 px-1.5 py-0 text-[10px] font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
      >
        {p.journey.stateCurrent}
      </Badge>
    );
  }
  return <span className="text-[10px] text-muted-foreground">{p.journey.statePending}</span>;
}

/** Warna garis penghubung: emerald bila tahap di sebelah kiri/atas done. */
function connectorClass(state: JourneyState): string {
  return state === "done"
    ? "bg-emerald-500/50 dark:bg-emerald-400/50"
    : "bg-border";
}

/**
 * Kartu "Peta Perjalanan Seleksi" — 6 tahap makro.
 * Desktop: baris horizontal dengan garis penghubung antar lingkaran.
 * Mobile: daftar vertikal ringkas dengan garis penghubung vertikal.
 */
export function StatusJourney({
  detail,
  lang,
  nowMs,
  p,
}: {
  detail: TrackResponse;
  lang: Lang;
  nowMs: number;
  p: Dict["status"]["page"];
}) {
  const { steps, ended, activeIndex } = deriveJourney(detail);
  const journey = p.journey;

  return (
    <Card className="rounded-2xl p-5 md:p-6">
      <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {journey.title}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{journey.subtitle}</p>

      {/* Desktop (md+): baris horizontal 6 tahap. Garis penghubung digambar
          absolut dari pusat lingkaran ke pusat lingkaran berikutnya. */}
      <ol className="mt-5 hidden items-start md:flex">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const Icon = JOURNEY_ICONS[i];
          return (
            <li
              key={step.key}
              aria-current={activeIndex === i ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center"
            >
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute left-1/2 top-5 h-px w-full -translate-y-1/2",
                    connectorClass(step.state),
                  )}
                />
              ) : null}
              <JourneyCircle
                state={step.state}
                Icon={Icon}
                className="size-9 md:size-10"
                iconClassName="size-4 md:size-[18px]"
              />
              <span
                className={cn(
                  "mt-2 max-w-24 text-center text-xs leading-tight",
                  step.state === "pending" ? "text-muted-foreground" : "font-medium",
                )}
              >
                {journey.steps[i]}
              </span>
              {/* Slot chip dengan tinggi tetap agar baris label tak bergoyang;
                  chip "Menanti" disembunyikan di desktop untuk menghemat ruang. */}
              <span className="mt-1 flex h-5 items-center">
                {step.state !== "pending" ? (
                  <JourneyChip
                    state={step.state}
                    at={step.at}
                    lang={lang}
                    nowMs={nowMs}
                    p={p}
                  />
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Mobile (<md): daftar vertikal ringkas — ikon kecil + label + chip kanan. */}
      <ol className="mt-4 flex flex-col md:hidden">
        {steps.map((step, i) => {
          const isLast = i === steps.length - 1;
          const Icon = JOURNEY_ICONS[i];
          return (
            <li
              key={step.key}
              aria-current={activeIndex === i ? "step" : undefined}
              className="flex gap-2.5"
            >
              <span className="flex flex-col items-center">
                <JourneyCircle
                  state={step.state}
                  Icon={Icon}
                  className="size-7"
                  iconClassName="size-3.5"
                />
                {!isLast ? (
                  <span
                    aria-hidden="true"
                    className={cn("my-0.5 w-px flex-1", connectorClass(step.state))}
                  />
                ) : null}
              </span>
              <span
                className={cn(
                  "flex min-h-7 min-w-0 flex-1 items-center justify-between gap-2",
                  isLast ? "" : "pb-2.5",
                )}
              >
                <span
                  className={cn(
                    "text-xs leading-tight",
                    step.state === "pending" ? "text-muted-foreground" : "font-medium",
                  )}
                >
                  {journey.steps[i]}
                </span>
                <JourneyChip
                  state={step.state}
                  at={step.at}
                  lang={lang}
                  nowMs={nowMs}
                  p={p}
                />
              </span>
            </li>
          );
        })}
      </ol>

      {/* Proses berakhir (rejection): marker rose di ujung peta + catatan. */}
      {ended ? (
        <>
          <div className="mt-4 flex md:justify-end">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              <CircleX className="size-3.5" aria-hidden="true" />
              {journey.endedLabel}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{journey.endedNote}</p>
        </>
      ) : null}

      {/* Kiat tahap aktif — hilang otomatis saat proses berakhir (activeIndex null). */}
      {activeIndex != null ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-500/30 dark:bg-amber-500/10">
          <Lightbulb
            className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p>
            <span className="font-medium">{journey.tipTitle}:</span>{" "}
            {journey.tips[activeIndex]}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
