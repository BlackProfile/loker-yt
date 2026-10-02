"use client";

// Panel Tanya Tim Rekrutmen (NR-15 idea 10 — dipindah verbatim dari
// status-page.tsx pada NR-18-a). NR-18-a Bagian 2: dibungkus panel collapsible —
// default TERBUKA bila ada pesan di thread, TERTUTUP bila kosong. State teks
// form hidup di orchestrator, jadi tidak ter-reset saat panel dilipat/dibuka.

import { Clock, MessageCircle, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fillTemplate, formatDateTimeId } from "@/components/landing/landing-utils";
import type { Dict } from "@/components/landing/strings";
import type { TrackQuestionInfo } from "@/lib/types";
import { QUESTION_MAX_LENGTH } from "./status-types";
import { StatusSection } from "./status-shared";

export function QaPanel({
  questions,
  qaText,
  setQaText,
  qaBusy,
  onSubmitQuestion,
  p,
}: {
  questions: TrackQuestionInfo[];
  qaText: string;
  setQaText: (value: string) => void;
  qaBusy: boolean;
  onSubmitQuestion: () => Promise<void>;
  p: Dict["status"]["page"];
}) {
  return (
    <StatusSection icon={MessageCircle} title={p.qaTitle} defaultOpen={questions.length > 0}>
      <p className="mt-2 text-sm text-muted-foreground">{p.qaDesc}</p>

      {/* Thread pertanyaan-jawaban (terbaru di atas) */}
      {questions.length > 0 ? (
        <ul className="nice-scrollbar mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
          {questions.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 dark:border-zinc-500/30 dark:bg-zinc-500/5"
            >
              <p className="text-xs font-medium text-muted-foreground">
                {p.qaYou} · {formatDateTimeId(item.askedAt)}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed">
                {item.question}
              </p>
              {item.answer ? (
                <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    {p.qaTeam}
                    {item.answeredAt
                      ? ` · ${formatDateTimeId(item.answeredAt)}`
                      : ""}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-emerald-900 dark:text-emerald-200">
                    {item.answer}
                  </p>
                </div>
              ) : (
                <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  {p.qaPending}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{p.qaEmpty}</p>
      )}

      {/* Form pertanyaan baru */}
      <form
        className="mt-4 border-t pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmitQuestion();
        }}
      >
        <Label htmlFor="qa-new-question" className="text-sm font-medium">
          {p.qaFormLabel}
        </Label>
        <Textarea
          id="qa-new-question"
          rows={3}
          value={qaText}
          onChange={(e) => setQaText(e.target.value)}
          placeholder={p.qaPh}
          maxLength={QUESTION_MAX_LENGTH}
          className="mt-1.5"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {fillTemplate(p.qaCounter, {
              used: qaText.length,
              max: QUESTION_MAX_LENGTH,
            })}
          </span>
          <Button
            type="submit"
            size="sm"
            className="h-11 sm:h-9"
            disabled={qaBusy || !qaText.trim()}
          >
            {qaBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {p.qaSending}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" aria-hidden="true" />
                {p.qaSend}
              </>
            )}
          </Button>
        </div>
      </form>
    </StatusSection>
  );
}
