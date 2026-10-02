"use client";

// Panel onboarding: dokumen & info bergabung (dipindah verbatim dari
// status-page.tsx pada NR-18-a). NR-18-a Bagian 2: dibungkus panel collapsible —
// default TERBUKA bila ada dokumen yang diminta, tertutup bila tidak ada.

import type { ChangeEvent } from "react";
import { CheckCircle2, Download, Loader2, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fillTemplate, formatDateId } from "@/components/landing/landing-utils";
import type { Dict } from "@/components/landing/strings";
import type { OnboardingDoc, TrackOnboardingInfo } from "@/lib/types";
import { StatusSection } from "./status-shared";

export function OnboardingPanel({
  onboarding,
  onboardingDocs,
  onboardingDoneCount,
  uploadingDocId,
  onUploadDoc,
  t,
}: {
  onboarding: TrackOnboardingInfo;
  onboardingDocs: OnboardingDoc[];
  onboardingDoneCount: number;
  uploadingDocId: string | null;
  onUploadDoc: (docId: string, event: ChangeEvent<HTMLInputElement>) => void;
  t: Dict;
}) {
  return (
    <StatusSection
      icon={Sparkles}
      title={t.status.onboarding.title}
      defaultOpen={onboardingDocs.length > 0}
      containerClassName="border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10"
      iconClassName="text-emerald-800 dark:text-emerald-300"
      titleClassName="normal-case tracking-normal text-emerald-800 dark:text-emerald-300"
    >
      {onboarding.welcomeMessage ? (
        <p className="mt-2 whitespace-pre-line font-medium leading-relaxed text-emerald-900 dark:text-emerald-200">
          {onboarding.welcomeMessage}
        </p>
      ) : null}
      <div className="mt-2 grid gap-1 text-sm text-emerald-800/90 dark:text-emerald-300/90">
        {onboarding.hiredAt ? (
          <p>
            {fillTemplate(t.status.onboarding.since, {
              date: formatDateId(onboarding.hiredAt),
            })}
          </p>
        ) : null}
        {onboarding.probationEnd ? (
          <p>
            {fillTemplate(t.status.onboarding.probation, {
              date: formatDateId(onboarding.probationEnd),
            })}
          </p>
        ) : null}
      </div>
      {onboardingDocs.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
            {fillTemplate(t.status.onboarding.docsProgress, {
              done: onboardingDoneCount,
              total: onboardingDocs.length,
            })}
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {onboardingDocs.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center gap-2 text-sm">
                {doc.done ? (
                  <CheckCircle2
                    className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : (
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border-2 border-emerald-600/40 dark:border-emerald-400/40"
                    aria-hidden="true"
                  />
                )}
                <span className="font-medium text-emerald-900 dark:text-emerald-200">
                  {doc.label}
                  {doc.required ? (
                    <>
                      <span aria-hidden="true"> *</span>
                      <span className="sr-only">
                        {" "}
                        ({t.status.onboarding.required})
                      </span>
                    </>
                  ) : null}
                </span>
                {uploadingDocId === doc.id ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                ) : null}
                {doc.done && doc.fileId ? (
                  <a
                    href={`/api/files/${doc.fileId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={fillTemplate(t.status.onboarding.downloadAria, {
                      label: doc.label,
                    })}
                    className="inline-flex h-11 items-center gap-1 text-xs font-medium text-emerald-700 underline-offset-2 hover:underline sm:h-auto dark:text-emerald-400"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {t.status.onboarding.download}
                  </a>
                ) : null}
                {!doc.done ? (
                  <Input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png"
                    aria-label={fillTemplate(t.status.onboarding.uploadAria, {
                      label: doc.label,
                    })}
                    disabled={uploadingDocId !== null}
                    className="h-11 w-full max-w-xs border-emerald-300 bg-background text-xs dark:border-emerald-500/40"
                    onChange={(event) =>
                      onUploadDoc(doc.id, event)
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </StatusSection>
  );
}
