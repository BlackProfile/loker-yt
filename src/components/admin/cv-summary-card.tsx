"use client";

// NR38-C fitur 5 — kartu "Ringkasan CV" di tab AI & Berkas dialog detail.
// Ringkasan dibuat MANUAL via tombol (tidak auto-run saat dialog dibuka).
// Backend: POST /api/admin/applications/[id]/cv-summary (LLM atas hasil OCR).
// State ringkasan hidup di dialog induk agar bertahan saat tab berpindah.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, ScrollText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "./api";
import { formatDate } from "./format";
import { useAdminSession } from "./admin-context";

export type CvSummary = {
  bullets: string[];
  generatedAt: string;
};

export function CvSummaryCard({
  applicationId,
  summary,
  onSummaryChange,
}: {
  applicationId: string;
  summary: CvSummary | null;
  onSummaryChange: (summary: CvSummary | null) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [working, setWorking] = useState(false);

  async function generate() {
    if (working) return;
    setWorking(true);
    try {
      const res = await apiPost<{ ok: boolean; summary: CvSummary }>(
        `/api/admin/applications/${applicationId}/cv-summary`
      );
      onSummaryChange(res.summary);
      toast.success("Ringkasan CV dibuat");
    } catch (err) {
      reportError(err);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ScrollText className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-sm font-semibold">Ringkasan CV</p>
        {summary ? (
          <span className="text-xs text-muted-foreground">
            Dibuat {summary.generatedAt ? formatDate(summary.generatedAt) : "—"}
          </span>
        ) : null}
      </div>
      {summary && summary.bullets.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {summary.bullets.slice(0, 6).map((bullet, i) => (
            <li key={i}>{bullet}</li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          Belum ada ringkasan. Ringkasan butuh teks CV hasil OCR terlebih dahulu.
        </p>
      )}
      {canMutate ? (
        <Button
          variant="outline"
          size="sm"
          className="h-11 w-fit active:scale-[0.99] sm:h-9"
          onClick={() => void generate()}
          disabled={working}
        >
          {working ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="size-4" aria-hidden="true" />
          )}
          {summary ? "Buat ulang" : "Buat ringkasan"}
        </Button>
      ) : null}
    </div>
  );
}
