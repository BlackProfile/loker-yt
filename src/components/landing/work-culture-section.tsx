"use client";

// NR68 (#13) — Section "Bekerja di Lumina" (budaya kerja) di halaman publik.
// Konten murni dari admin (SiteContent.workCulture); null = section disembunyikan.
// Tampil apa adanya di kedua bahasa (konsisten dengan aturan konten admin).

import { Heart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { SiteContent } from "@/lib/types";
import {
  Container,
  FadeIn,
  HoverLift,
  ROSE_BADGE,
  Stagger,
  StaggerItem,
} from "@/components/landing/primitives";

export function WorkCultureSection({ content }: { content: SiteContent }) {
  const wc = content.workCulture;
  if (!wc) return null;

  return (
    <section id="bekerja" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {wc.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {wc.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{wc.desc}</p>
        </FadeIn>

        <Stagger className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-2">
          {wc.items.map((item, index) => (
            <StaggerItem key={index} className="h-full">
              <HoverLift className="h-full">
                <Card className="h-full gap-3 rounded-2xl p-6 transition-shadow hover:shadow-md">
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400"
                  >
                    <Heart className="size-5" />
                  </span>
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </Card>
              </HoverLift>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </section>
  );
}
