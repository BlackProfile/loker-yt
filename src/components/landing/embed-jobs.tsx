"use client";

import { useSyncExternalStore } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { Position, SiteContent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import { BrandMark, HoverLift, ROSE_BADGE } from "@/components/landing/primitives";

// Langganan statis untuk useSyncExternalStore (nilai tidak pernah berubah).
const emptySubscribe = () => () => {};

function EmbedJobsInner({
  content,
  positions,
}: {
  content: SiteContent;
  positions: Position[];
}) {
  const { t } = useLang();
  // origin halaman utama dibaca via useSyncExternalStore (aman SSR).
  const origin = useSyncExternalStore(
    emptySubscribe,
    () => window.location.origin,
    () => "",
  );
  // Filter deep link ?posisi=slug (slug posisi; fallback id) — tanpa param perilaku lama.
  const posisiParam = useSyncExternalStore(
    emptySubscribe,
    () => new URLSearchParams(window.location.search).get("posisi"),
    () => null,
  );

  const visiblePositions = posisiParam
    ? positions.filter(
        (position) => position.slug === posisiParam || position.id === posisiParam,
      )
    : positions;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <header className="flex items-center gap-3 border-b pb-4">
          <BrandMark size="sm" />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-bold">{content.siteName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {content.tagline}
            </p>
          </div>
        </header>

        <main className="mt-4 flex flex-col gap-3">
          {visiblePositions.length === 0 ? (
            <Card className="items-center gap-2 rounded-xl p-8 text-center">
              <p className="text-sm font-semibold">
                {posisiParam ? t.positions.filterEmptyTitle : t.positions.emptyTitle}
              </p>
              <p className="text-xs text-muted-foreground">
                {posisiParam ? t.positions.filterEmptyBody : t.positions.emptyBody}
              </p>
            </Card>
          ) : (
            visiblePositions.map((position) => {
              // Kartu posisi tertaut ke formulir dengan posisi terpilih via deep link.
              const applyHref = position.slug
                ? `${origin}/?posisi=${encodeURIComponent(position.slug)}#lamar`
                : `${origin}/#lamar`;
              return (
                <HoverLift key={position.id}>
                  <Card className="gap-2 rounded-xl p-4 transition-shadow hover:shadow-md sm:p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={ROSE_BADGE}>
                        {position.department}
                      </Badge>
                      <Badge variant="secondary">{position.type}</Badge>
                      <Badge variant="secondary" className="gap-1">
                        <MapPin className="h-3 w-3" aria-hidden="true" />
                        {position.location}
                      </Badge>
                      {position.urgent ? (
                        <Badge className="border-transparent bg-rose-600 text-white" variant="outline">
                          {t.positions.urgent}
                        </Badge>
                      ) : null}
                    </div>
                    <h3 className="font-semibold leading-snug">{position.title}</h3>
                    <p className="line-clamp-1 text-sm text-muted-foreground">
                      {position.description}
                    </p>
                    <div className="mt-1 flex justify-end">
                      <Button size="sm" asChild>
                        <a
                          href={applyHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`${t.embed.applyButton} - ${position.title}`}
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          {t.embed.applyButton}
                        </a>
                      </Button>
                    </div>
                  </Card>
                </HoverLift>
              );
            })
          )}
        </main>

        <footer className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground">
          {content.footerText}
        </footer>
      </div>
    </div>
  );
}

export function EmbedJobs({
  content,
  positions,
}: {
  content: SiteContent;
  positions: Position[];
}) {
  return (
    <LangProvider>
      <EmbedJobsInner content={content} positions={positions} />
    </LangProvider>
  );
}
