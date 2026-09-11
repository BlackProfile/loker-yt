"use client";

import { useSyncExternalStore } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import type { Position, SiteContent } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import { BrandMark, ROSE_BADGE } from "@/components/landing/primitives";

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
    () => () => {},
    () => window.location.origin,
    () => "",
  );

  const applyUrl = `${origin}/#lamar`;

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
          {positions.length === 0 ? (
            <Card className="items-center gap-2 rounded-xl p-8 text-center">
              <p className="text-sm font-semibold">{t.positions.emptyTitle}</p>
              <p className="text-xs text-muted-foreground">
                {t.positions.emptyBody}
              </p>
            </Card>
          ) : (
            positions.map((position) => (
              <Card key={position.id} className="gap-2 rounded-xl p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={ROSE_BADGE}>
                    {position.department}
                  </Badge>
                  <Badge variant="secondary">{position.type}</Badge>
                  <Badge variant="secondary" className="gap-1">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    {position.location}
                  </Badge>
                </div>
                <h3 className="font-semibold leading-snug">{position.title}</h3>
                <p className="line-clamp-1 text-sm text-muted-foreground">
                  {position.description}
                </p>
                <div className="mt-1 flex justify-end">
                  <Button size="sm" asChild>
                    <a
                      href={applyUrl}
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
            ))
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
