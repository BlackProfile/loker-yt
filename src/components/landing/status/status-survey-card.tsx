"use client";

// Kartu feedback pengalaman (NR-15 idea 17 — dipindah verbatim dari
// status-page.tsx pada NR-18-a). Tampak biasa (tidak wajib dilipat).

import { ExternalLink, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Dict } from "@/components/landing/strings";

export function SurveyCard({
  surveyToken,
  p,
}: {
  surveyToken: string;
  p: Dict["status"]["page"];
}) {
  return (
    <Card className="rounded-2xl p-5 md:p-6">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Star className="h-4 w-4 text-amber-500" aria-hidden="true" />
        {p.fbTitle}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">{p.fbDesc}</p>
      <Button
        size="sm"
        variant="outline"
        className="mt-3 h-11 sm:h-9"
        onClick={() =>
          window.open(
            `/?survei=${encodeURIComponent(surveyToken)}`,
            "_blank",
            "noopener,noreferrer",
          )
        }
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        {p.fbButton}
      </Button>
    </Card>
  );
}
