"use client";

// Section "Proses Seleksi" (pengganti HowToApplySection lama) — 6 tahap
// seleksi dari t.selection dengan durasi, kiat sukses expandable, dan CTA.
// Anchor id="cara-lamar" dipertahankan persis agar nav/footer tidak rusak.

import { useState } from "react";
import {
  Briefcase,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock,
  FileSearch,
  FileUp,
  MailCheck,
  MessagesSquare,
  Rocket,
  Search,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useLang } from "@/components/landing/lang-context";
import {
  Container,
  FadeIn,
  HoverLift,
  ROSE_BADGE,
  Stagger,
  StaggerItem,
} from "@/components/landing/primitives";

// Ikon per tahap — urutan tetap mengikuti t.selection.stages.
const STAGE_ICONS = [
  FileUp,
  FileSearch,
  ClipboardCheck,
  MessagesSquare,
  MailCheck,
  Rocket,
] as const;

export function SelectionProcessSection() {
  const { t } = useLang();
  // Hanya SATU kumpulan kiat yang terbuka pada satu waktu (null = semua lipat).
  const [openTipsIndex, setOpenTipsIndex] = useState<number | null>(null);

  return (
    <section id="cara-lamar" className="scroll-mt-24 bg-muted/40 py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.selection.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.selection.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.selection.desc}</p>
        </FadeIn>

        <Stagger className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {t.selection.stages.map((stage, index) => {
            const Icon = STAGE_ICONS[index % STAGE_ICONS.length];
            const tipsOpen = openTipsIndex === index;
            return (
              <StaggerItem key={stage.title} className="h-full">
                <HoverLift className="h-full">
                  <Card className="h-full gap-3 rounded-2xl p-6 transition-shadow hover:shadow-md">
                    <div className="flex items-start justify-between">
                      <span
                        aria-hidden="true"
                        className="text-4xl font-bold text-rose-600/20 dark:text-rose-400/20"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"
                      >
                        <Icon className="size-5" />
                      </span>
                    </div>
                    <h3 className="font-semibold">{stage.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {stage.description}
                    </p>
                    <span className="inline-flex w-fit items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                      <Clock className="size-3" aria-hidden="true" />
                      {stage.duration}
                    </span>
                    {stage.tips.length > 0 ? (
                      <div className="mt-auto">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenTipsIndex(tipsOpen ? null : index)
                          }
                          aria-expanded={tipsOpen}
                          className="group inline-flex min-h-11 items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-0"
                        >
                          <ChevronDown
                            className={cn(
                              "size-3.5 transition-transform",
                              tipsOpen && "rotate-180",
                            )}
                            aria-hidden="true"
                          />
                          {tipsOpen ? t.selection.tipsHide : t.selection.tipsToggle}
                        </button>
                        {tipsOpen ? (
                          <ul className="mt-1.5 rounded-lg border bg-muted/40 p-2.5 text-xs text-muted-foreground">
                            {stage.tips.map((tip) => (
                              <li key={tip} className="flex items-start gap-1.5">
                                <Check
                                  className="mt-0.5 size-3 shrink-0 text-rose-600 dark:text-rose-400"
                                  aria-hidden="true"
                                />
                                <span className="leading-relaxed">{tip}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </Card>
                </HoverLift>
              </StaggerItem>
            );
          })}
        </Stagger>

        <FadeIn delay={0.15} className="mt-10 flex flex-wrap gap-3">
          <Button asChild>
            <a href="#posisi">
              <Briefcase className="size-4" aria-hidden="true" />
              {t.selection.ctaJobs}
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="#status">
              <Search className="size-4" aria-hidden="true" />
              {t.selection.ctaStatus}
            </a>
          </Button>
        </FadeIn>
      </Container>
    </section>
  );
}
