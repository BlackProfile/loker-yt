"use client";

// NR66 — Pencocok posisi ("Cari Posisi yang Cocok").
// Kuis 4 pertanyaan pilihan tunggal; jawaban dipetakan ke kata kunci yang
// dicocokkan ke teks posisi terbuka (judul + departemen + jenis + deskripsi +
// persyaratan + benefit) di sisi klien — tanpa request tambahan, tanpa DB.
// Pertanyaan 4 memberi bonus mode kerja (REMOTE/ONSITE/HYBRID; "apa saja"
// tanpa bonus). Hasil: maksimal 2 rekomendasi teratas + alasan kemiripan +
// CTA membuka detail posisi via onOpenPosition (alur sama dengan kartu
// lowongan). Semua teks dari dict t.matcher (ID/EN).

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Compass,
  SearchX,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Position, WorkMode } from "@/lib/types";
import { WORK_MODE_LABELS } from "@/lib/types";
import { useLang } from "@/components/landing/lang-context";
import { fillTemplate, isPastIso } from "@/components/landing/landing-utils";
import { cn } from "@/lib/utils";

// Kata kunci per pilihan — URUTAN harus sama dengan opsi di dict t.matcher
// (q1Options..q3Options). Cocokkan dengan contains di haystack huruf kecil.
const KEYWORD_GROUPS: string[][][] = [
  // Q1 — aktivitas favorit
  [
    ["video", "editing", "editor", "thumbnail", "desain", "visual", "kamera", "motion"],
    ["naskah", "penulis", "menulis", "copywriter", "artikel", "cerita", "skrip"],
    ["social media", "sosial", "komunitas", "instagram", "tiktok", "audiens", "media"],
    ["strategi", "produksi", "analitik", "koordinasi", "proyek", "kampanye", "planning"],
  ],
  // Q2 — gaya kerja
  [
    ["detail", "presisi", "rafli", "kualitas", "estetika", "komposisi", "warna"],
    ["ide", "kreatif", "brainstorm", "konsep", "gagasan", "kreativitas"],
    ["komunitas", "audiens", "komunikasi", "interaksi", "kolaborasi", "hubungan"],
    ["rencana", "timeline", "jadwal", "manajemen", "kalender", "organisasi"],
  ],
  // Q3 — jenis karya
  [
    ["video", "reels", "vlog", "youtube", "tiktok", "short"],
    ["artikel", "naskah", "tulisan", "blog", "copywriting", "skrip"],
    ["thumbnail", "desain", "grafis", "poster", "banner", "ilustrasi"],
    ["riset", "tren", "analitik", "kalender", "strategi", "data"],
  ],
];

// Bonus mode kerja untuk Q4 (indeks 0-2 = REMOTE/ONSITE/HYBRID, 3 = apa saja).
const MODE_BY_OPTION: (WorkMode | null)[] = ["REMOTE", "ONSITE", "HYBRID", null];

type MatchResult = {
  position: Position;
  score: number;
  hits: string[];
};

/** Kumpulkan posisi yang masih bisa dilamar (aktif, buka, belum lewat tenggat). */
function eligiblePositions(positions: Position[]): Position[] {
  return positions.filter(
    (p) => p.isActive && p.applyOpen && !(p.closesAt && isPastIso(p.closesAt)),
  );
}

/** Hitung skor satu posisi terhadap jawaban kuis; kembalikan juga kata kunci yang kena. */
function scorePosition(position: Position, answers: (number | null)[]): MatchResult {
  const haystack = [
    position.title,
    position.department,
    position.type,
    position.description,
    position.requirements.join(" "),
    position.benefits.join(" "),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  const hits: string[] = [];
  KEYWORD_GROUPS.forEach((group, qi) => {
    const opt = answers[qi];
    if (opt == null) return;
    for (const kw of group[opt] ?? []) {
      if (haystack.includes(kw)) {
        score += 1;
        if (!hits.includes(kw)) hits.push(kw);
      }
    }
  });

  const modeOpt = answers[3];
  const mode = modeOpt != null ? MODE_BY_OPTION[modeOpt] : null;
  if (mode && position.workMode === mode) {
    score += 2;
    hits.push(WORK_MODE_LABELS[mode]);
  }

  return { position, score, hits };
}

export function PositionMatcher({
  positions,
  onOpenPosition,
  applyBlocked,
}: {
  positions: Position[];
  onOpenPosition: (slug: string) => void;
  applyBlocked: boolean;
}) {
  const { t } = useLang();
  const m = t.matcher;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0); // 0..3 = indeks pertanyaan, 4 = hasil
  const [answers, setAnswers] = useState<(number | null)[]>([
    null,
    null,
    null,
    null,
  ]);

  const questions = useMemo(
    () => [
      { q: m.q1, options: m.q1Options },
      { q: m.q2, options: m.q2Options },
      { q: m.q3, options: m.q3Options },
      { q: m.q4, options: m.q4Options },
    ],
    [m],
  );

  const results = useMemo<{ top: MatchResult | null; alt: MatchResult | null }>(() => {
    if (step < 4) return { top: null, alt: null };
    const scored = eligiblePositions(positions)
      .map((p) => scorePosition(p, answers))
      .filter((r) => r.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(b.position.featured) - Number(a.position.featured) ||
          Number(b.position.urgent) - Number(a.position.urgent) ||
          a.position.order - b.position.order,
      );
    return { top: scored[0] ?? null, alt: scored[1] ?? null };
  }, [step, positions, answers]);

  const reset = () => {
    setAnswers([null, null, null, null]);
    setStep(0);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const choose = (optIndex: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[step] = optIndex;
      return next;
    });
    setStep((s) => Math.min(s + 1, 4));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const openDetail = (r: MatchResult) => {
    handleOpenChange(false);
    onOpenPosition(r.position.slug ?? r.position.id);
  };

  const isResult = step === 4;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-5"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Compass className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        {m.trigger}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400">
                <Sparkles className="size-4" aria-hidden="true" />
              </span>
              {m.title}
            </DialogTitle>
            <DialogDescription>{m.intro}</DialogDescription>
          </DialogHeader>

          {!isResult ? (
            <div>
              {/* Progres: teks langkah + empat titik */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {fillTemplate(m.stepOf, { n: String(step + 1), total: "4" })}
                </p>
                <div className="flex items-center gap-1.5" aria-hidden="true">
                  {questions.map((_, i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1.5 rounded-full transition-colors",
                        i < step || isResult
                          ? "bg-emerald-500"
                          : i === step
                            ? "w-5 bg-rose-600"
                            : "w-1.5 bg-muted-foreground/30",
                      )}
                    />
                  ))}
                </div>
              </div>

              <p
                role="heading"
                aria-level={3}
                className="mt-4 text-base font-semibold"
              >
                {questions[step].q}
              </p>

              <div className="mt-3 flex flex-col gap-2" role="group">
                {questions[step].options.map((label, optIndex) => {
                  const selected = answers[step] === optIndex;
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => choose(optIndex)}
                      aria-pressed={selected}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border bg-background px-4 py-2.5 text-left text-sm outline-none transition-colors",
                        "hover:border-rose-300 hover:bg-rose-50/60 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/10",
                        "focus-visible:ring-2 focus-visible:ring-ring/50",
                        selected &&
                          "border-rose-400 bg-rose-50 dark:border-rose-500/50 dark:bg-rose-500/10",
                      )}
                    >
                      <span className="font-medium">{label}</span>
                      {selected ? (
                        <Check
                          className="size-4 shrink-0 text-rose-600 dark:text-rose-400"
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goBack}
                  disabled={step === 0}
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  {m.back}
                </Button>
              </div>
            </div>
          ) : results.top ? (
            <div>
              <p className="text-sm font-semibold">{m.resultTitle}</p>

              {[{ r: results.top, label: m.topLabel, rose: true }, { r: results.alt, label: m.altLabel, rose: false }].map(
                ({ r, label, rose }) =>
                  r ? (
                    <div
                      key={r.position.id}
                      className={cn(
                        "mt-3 rounded-2xl border p-4",
                        rose
                          ? "border-rose-200 bg-rose-50/60 dark:border-rose-500/30 dark:bg-rose-500/10"
                          : "border-border bg-muted/40",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            rose
                              ? "border-transparent bg-rose-600 text-white"
                              : "border-transparent bg-muted text-muted-foreground"
                          }
                        >
                          {label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {r.position.department} ·{" "}
                          {WORK_MODE_LABELS[r.position.workMode]}
                        </span>
                      </div>
                      <p className="mt-2 font-semibold">{r.position.title}</p>

                      {r.hits.length > 0 ? (
                        <div className="mt-2.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                            {m.reasonLabel}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {r.hits.slice(0, 4).map((hit) => (
                              <span
                                key={hit}
                                className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px] text-muted-foreground"
                              >
                                <Check
                                  className="size-3 text-emerald-600 dark:text-emerald-400"
                                  aria-hidden="true"
                                />
                                {hit}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-3.5 flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" onClick={() => openDetail(r)}>
                          {m.detailCta}
                          <ArrowLeft className="size-4 rotate-180" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={reset}>
                          {m.retake}
                        </Button>
                      </div>
                    </div>
                  ) : null,
              )}

              {applyBlocked ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
                  {m.closedNote}
                </p>
              ) : null}

              <Button type="button" variant="outline" size="sm" asChild className="mt-3">
                <a href="#posisi" onClick={() => handleOpenChange(false)}>
                  {m.browseAll}
                </a>
              </Button>
            </div>
          ) : (
            <div className="py-2 text-center">
              <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <SearchX className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-3 font-semibold">{m.noMatchTitle}</p>
              <p className="mt-1 text-sm text-muted-foreground">{m.noMatchBody}</p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                <Button type="button" variant="outline" size="sm" asChild>
                  <a href="#posisi" onClick={() => handleOpenChange(false)}>
                    {m.browseAll}
                  </a>
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  {m.retake}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
