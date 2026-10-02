"use client";

// Panel Perbarui CV (NR-15 idea 11 — dipindah verbatim dari status-page.tsx
// pada NR-18-a). NR-18-a Bagian 2: dibungkus panel collapsible — default TERTUTUP.
// State form (file terpilih) hidup di orchestrator, jadi tidak ter-reset saat
// panel dilipat/dibuka.

import type { ChangeEvent } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fillTemplate } from "@/components/landing/landing-utils";
import type { Dict } from "@/components/landing/strings";
import { StatusSection } from "./status-shared";

export function CvUpdatePanel({
  cvFileName,
  cvFile,
  onSelectCvFile,
  cvUploading,
  onSubmitCvUpdate,
  p,
}: {
  cvFileName: string | null | undefined;
  cvFile: File | null;
  onSelectCvFile: (event: ChangeEvent<HTMLInputElement>) => void;
  cvUploading: boolean;
  onSubmitCvUpdate: () => Promise<void>;
  p: Dict["status"]["page"];
}) {
  return (
    <StatusSection icon={FileUp} title={p.cvTitle} defaultOpen={false}>
      {cvFileName ? (
        <p className="mt-2 text-sm">
          <span className="text-muted-foreground">
            {fillTemplate(p.cvCurrent, { name: cvFileName })}
          </span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{p.cvNone}</p>
      )}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="file"
          accept=".pdf,application/pdf"
          aria-label={p.cvAria}
          disabled={cvUploading}
          className="h-11 w-full text-xs sm:max-w-xs"
          onChange={onSelectCvFile}
        />
        <Button
          size="sm"
          className="h-11 sm:h-9"
          disabled={!cvFile || cvUploading}
          onClick={() => void onSubmitCvUpdate()}
        >
          {cvUploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {p.cvUploading}
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" aria-hidden="true" />
              {p.cvUpload}
            </>
          )}
        </Button>
      </div>
      {cvFile ? (
        <p className="mt-2 text-xs text-muted-foreground">{cvFile.name}</p>
      ) : null}
    </StatusSection>
  );
}
