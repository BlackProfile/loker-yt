"use client";

// Section "Cek Status" di landing — kini menjadi KARTU PENGANTAR ringkas.
// Halaman penuhnya ada di src/components/landing/status-page.tsx (route #status):
// login email + kode pelacakan, daftar multi-lamaran, hero status, timeline,
// aksi wawancara/offer/onboarding, dan tarik lamaran.
// Nama export dipertahankan (StatusCheckSection) agar pemakaian di landing-page
// tidak berubah.

import { useState } from "react";
import { ArrowRight, CheckCircle2, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLang } from "@/components/landing/lang-context";
import { Container, FadeIn, ROSE_BADGE } from "@/components/landing/primitives";
import { loadSession } from "@/lib/status-session";

/** Buka halaman Cek Status (#status) — view terpisah via HomeView. */
export function openStatusPage(): void {
  history.pushState(null, "", "/#status");
  window.dispatchEvent(new Event("app:navigate"));
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function StatusCheckSection() {
  const { t } = useLang();
  // Sesi tersimpan? Tombol berubah jadi "Lanjutkan" (auto-masuk di halaman).
  const [hasSession] = useState(() =>
    typeof window !== "undefined" ? loadSession() !== null : false,
  );
  const bullets = [
    t.status.page.introBullet1,
    t.status.page.introBullet2,
    t.status.page.introBullet3,
  ];

  return (
    <section className="scroll-mt-24 bg-muted/40 py-16 md:py-24">
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
            <ul className="flex flex-col gap-2.5">
              {bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-2.5 text-sm">
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
            <Button className="mt-5 h-12 w-full gap-2 text-base" onClick={openStatusPage}>
              <KeyRound className="h-4 w-4" aria-hidden="true" />
              {hasSession ? t.status.page.resumePage : t.status.page.openPage}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Card>
        </FadeIn>
      </Container>
    </section>
  );
}
