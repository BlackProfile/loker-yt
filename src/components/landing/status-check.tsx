"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  BadgeCheck,
  BadgeX,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  Search,
} from "lucide-react";
import {
  STATUS_FLOW,
  type StageKey,
  type TrackResponse,
} from "@/lib/types";
import { stageLabel } from "@/lib/stages";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLang } from "@/components/landing/lang-context";
import { Container, FadeIn, ROSE_BADGE } from "@/components/landing/primitives";
import { formatDateTimeId, safeExternalUrl } from "@/components/landing/landing-utils";
import { useLiveEvent } from "@/lib/live-client";
import { Badge } from "@/components/ui/badge";

// Debounce recheck realtime — endpoint track bisa punya rate-limit (min. 1 detik).
const LIVE_RECHECK_DEBOUNCE_MS = 1000;

type StepView = { key: string; label: string; done: boolean; at: string | null };

/** Tahap terminal bawaan (label tahap kustom bisa apa saja — tak dianggap final). */
function isFinalStatus(status?: StageKey): boolean {
  return status === "ACCEPTED" || status === "REJECTED";
}

export function StatusCheckSection() {
  const { t } = useLang();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TrackResponse | null>(null);
  const [notFound, setNotFound] = useState(false);
  // Kode yang sedang dilacak (aktif di state) — dipakai untuk recheck realtime.
  const [trackedCode, setTrackedCode] = useState("");
  const recheckTimerRef = useRef<number | null>(null);

  async function handleTrack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    // Batalkan recheck realtime yang tertunda — pelacakan manual sedang berjalan.
    if (recheckTimerRef.current) {
      window.clearTimeout(recheckTimerRef.current);
      recheckTimerRef.current = null;
    }
    setTrackedCode(trimmed);
    setLoading(true);
    try {
      const res = await fetch("/api/public/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as TrackResponse | null;
      if (!res.ok || !data) {
        toast.error(t.apply.errors.submitFailed);
        return;
      }
      if (!data.found) {
        setResult(null);
        setNotFound(true);
        return;
      }
      setResult(data);
      setNotFound(false);
    } catch {
      toast.error(t.apply.errors.submitFailed);
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pengecekan ulang SENYAP saat broadcast "applications:changed" masuk:
   * tanpa spinner, data lama tetap tampil, dan state hanya di-swap bila isi
   * benar-benar berubah (anti-flicker). Kegagalan jaringan diabaikan diam.
   */
  async function recheckSilently(codeValue: string) {
    try {
      const res = await fetch("/api/public/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeValue }),
      });
      if (!res.ok) return; // gagal senyap — pertahankan hasil terakhir
      const data = (await res.json().catch(() => null)) as TrackResponse | null;
      if (!data || !data.found) return; // lamaran tak ditemukan lagi — biarkan tampilan lama
      setResult((prev) => {
        if (prev && JSON.stringify(prev) === JSON.stringify(data)) return prev;
        return data;
      });
      setNotFound(false);
    } catch {
      // senyap
    }
  }

  // Realtime: lamaran berubah di admin -> perbarui status pelacakan secara senyap.
  useLiveEvent("applications:changed", () => {
    if (!trackedCode) return;
    // Debounce >= 1 detik (rate-limit endpoint track) + gabungkan burst event.
    if (recheckTimerRef.current) window.clearTimeout(recheckTimerRef.current);
    recheckTimerRef.current = window.setTimeout(() => {
      recheckTimerRef.current = null;
      void recheckSilently(trackedCode);
    }, LIVE_RECHECK_DEBOUNCE_MS);
  });

  // Bersihkan timer recheck saat komponen dilepas.
  useEffect(() => {
    return () => {
      if (recheckTimerRef.current) window.clearTimeout(recheckTimerRef.current);
    };
  }, []);

  const steps: StepView[] = result
    ? (result.steps ??
      STATUS_FLOW.map((key) => ({
        key,
        label: stageLabel(key),
        done: false,
        at: null,
      })))
    : [];
  const finalStatus = isFinalStatus(result?.status) ? result?.status : undefined;
  const currentKey = !finalStatus ? result?.status : undefined;
  // URL brief tes posisi (disanitasi — hanya http/https).
  const assignmentUrl = result?.assignment?.url
    ? safeExternalUrl(result.assignment.url)
    : null;

  return (
    <section id="status" className="scroll-mt-24 bg-muted/40 py-16 md:py-24">
      <Container>
        <FadeIn className="mx-auto flex max-w-xl flex-col items-center text-center">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.status.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.status.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.status.desc}</p>

          <Card className="mt-8 w-full rounded-2xl p-6 text-left md:p-8">
            <form onSubmit={handleTrack} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-2">
                <Label htmlFor="track-code">{t.status.codeLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    id="track-code"
                    name="code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder={t.status.codePh}
                    className="h-11 flex-1 font-mono uppercase"
                    autoComplete="off"
                    maxLength={24}
                  />
                  <Button type="submit" className="h-11 min-w-24" disabled={loading || !code.trim()}>
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        {t.status.tracking}
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" aria-hidden="true" />
                        {t.status.track}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </form>

            {notFound ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              >
                {t.status.notFound}
              </div>
            ) : null}

            {result && result.found ? (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="mt-6 flex flex-col gap-5"
                role="status"
              >
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  {result.positionTitle ? (
                    <p>
                      <span className="text-muted-foreground">{t.status.positionLabel}: </span>
                      <span className="font-medium">{result.positionTitle}</span>
                    </p>
                  ) : null}
                  {result.submittedAt ? (
                    <p>
                      <span className="text-muted-foreground">{t.status.submittedLabel}: </span>
                      <span className="font-medium">{formatDateTimeId(result.submittedAt)}</span>
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.status.resultTitle}
                  </p>
                  <ol className="mt-4 space-y-0">
                    {steps.map((step, index) => {
                      const isLast = index === steps.length - 1;
                      const isCurrent = step.key === currentKey && !step.done;
                      return (
                        <li key={step.key} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            {step.done ? (
                              <CheckCircle2
                                className="h-6 w-6 shrink-0 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                            ) : isCurrent ? (
                              <span
                                className="relative flex h-6 w-6 shrink-0 items-center justify-center"
                                aria-hidden="true"
                              >
                                <span className="absolute inset-0 animate-ping rounded-full bg-rose-500/30" />
                                <span className="relative h-3 w-3 rounded-full bg-rose-500" />
                              </span>
                            ) : (
                              <span
                                className="flex h-6 w-6 shrink-0 items-center justify-center"
                                aria-hidden="true"
                              >
                                <span className="h-3 w-3 rounded-full border-2 border-muted-foreground/40 bg-muted" />
                              </span>
                            )}
                            {!isLast ? (
                              <span
                                aria-hidden="true"
                                className={
                                  step.done
                                    ? "my-1 w-px flex-1 bg-emerald-500/50 dark:bg-emerald-400/50"
                                    : "my-1 w-px flex-1 bg-border"
                                }
                              />
                            ) : null}
                          </div>
                          <div className={isLast ? "pb-0" : "pb-5"}>
                            <p
                              className={
                                step.done || isCurrent
                                  ? "text-sm font-medium"
                                  : "text-sm text-muted-foreground"
                              }
                            >
                              {step.label || step.key}
                            </p>
                            {step.at ? (
                              <p className="text-xs text-muted-foreground">
                                {formatDateTimeId(step.at)}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </div>

                {/* Info tes seleksi posisi (bila posisi punya assignment) */}
                {result.assignment &&
                (result.assignment.title || result.assignment.note || result.assignment.url) ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                    <div className="flex items-start gap-2.5">
                      <ClipboardList
                        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                        aria-hidden="true"
                      />
                      <div className="min-w-0 text-sm">
                        <p className="font-medium text-amber-800 dark:text-amber-300">
                          {t.status.assignmentTitle}
                          {result.assignment.title ? `: ${result.assignment.title}` : ""}
                        </p>
                        {result.assignment.note ? (
                          <p className="mt-1 whitespace-pre-line leading-relaxed text-amber-700/90 dark:text-amber-200/80">
                            {result.assignment.note}
                          </p>
                        ) : null}
                        {assignmentUrl ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-11 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 sm:h-9 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
                            asChild
                          >
                            <a
                              href={assignmentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" aria-hidden="true" />
                              {t.status.openBrief}
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                {finalStatus === "ACCEPTED" ? (
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                  >
                    <BadgeCheck className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {t.status.accepted}
                  </div>
                ) : null}
                {finalStatus === "REJECTED" ? (
                  <div
                    role="status"
                    className="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                  >
                    <BadgeX className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {t.status.rejected}
                  </div>
                ) : null}
              </motion.div>
            ) : null}
          </Card>
        </FadeIn>
      </Container>
    </section>
  );
}
