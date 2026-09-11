"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  ChevronDown,
  ClipboardList,
  Copy,
  Loader2,
  Mail,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  AI_RECOMMENDATION_LABELS,
  type Application,
  type AiRecommendation,
} from "@/lib/types";
import { apiPost } from "./api";
import { copyText, formatDate } from "./format";
import { aiScoreStyle } from "./status-badge";
import { useAdminSession } from "./admin-context";
import { cn } from "@/lib/utils";

function recommendationStyle(rec: AiRecommendation | null): string {
  switch (rec) {
    case "LAYAK_WAWANCARA":
      return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900";
    case "PERTIMBANGKAN":
      return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900";
    case "TIDAK_COCCOK":
      return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
}

function AiToolResult({
  label,
  text,
}: {
  label: string;
  text: string;
}) {
  async function handleCopy() {
    const ok = await copyText(text);
    if (ok) toast.success(`${label} disalin`);
    else toast.error("Gagal menyalin ke clipboard");
  }
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-muted-foreground">{label}</p>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void handleCopy()}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          Salin
        </Button>
      </div>
      <p className="text-sm whitespace-pre-wrap">{text}</p>
    </div>
  );
}

// Panel AI di dalam dialog detail: skor + ringkasan + alat pertanyaan/draft balasan.
export function AiPanel({
  app,
  onUpdated,
}: {
  app: Application;
  onUpdated: (app: Application) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [analyzing, setAnalyzing] = useState(false);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [questions, setQuestions] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showDraft, setShowDraft] = useState(false);

  // Reset hasil alat AI saat kandidat berganti.
  useEffect(() => {
    setQuestions(null);
    setDraft(null);
    setShowQuestions(false);
    setShowDraft(false);
  }, [app.id]);

  async function analyze() {
    if (analyzing) return;
    setAnalyzing(true);
    try {
      const res = await apiPost<{
        score: number;
        summary: string;
        recommendation: AiRecommendation;
        aiAnalyzedAt: string;
      }>(`/api/admin/applications/${app.id}/ai`);
      onUpdated({
        ...app,
        aiScore: res.score,
        aiSummary: res.summary,
        aiRecommendation: res.recommendation,
        aiAnalyzedAt: res.aiAnalyzedAt,
      });
      toast.success("Analisis AI selesai");
    } catch (err) {
      reportError(err);
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadQuestions() {
    if (questionsLoading) return;
    setQuestionsLoading(true);
    try {
      const res = await apiPost<{ questions: string }>(
        `/api/admin/applications/${app.id}/ai-questions`
      );
      setQuestions(res.questions);
      setShowQuestions(true);
    } catch (err) {
      reportError(err);
    } finally {
      setQuestionsLoading(false);
    }
  }

  async function loadReply() {
    if (replyLoading) return;
    setReplyLoading(true);
    try {
      const res = await apiPost<{ draft: string }>(
        `/api/admin/applications/${app.id}/ai-reply`
      );
      setDraft(res.draft);
      setShowDraft(true);
    } catch (err) {
      reportError(err);
    } finally {
      setReplyLoading(false);
    }
  }

  const analyzed = app.aiScore != null;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-rose-50/40 p-4 dark:bg-rose-950/20">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
        <p className="text-sm font-semibold">AI Screening</p>
      </div>

      {analyzed ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "rounded-lg border px-3 py-1 text-3xl font-bold tabular-nums",
                aiScoreStyle(app.aiScore)
              )}
            >
              {app.aiScore}
            </span>
            <div className="min-w-40 flex-1">
              <Progress
                value={app.aiScore}
                aria-label={`Skor AI ${app.aiScore} dari 100`}
                className="h-2"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Dianalisis {formatDate(app.aiAnalyzedAt)}
              </p>
            </div>
            {app.aiRecommendation ? (
              <Badge
                variant="outline"
                className={recommendationStyle(app.aiRecommendation)}
              >
                {AI_RECOMMENDATION_LABELS[app.aiRecommendation]}
              </Badge>
            ) : null}
          </div>
          {app.aiSummary ? (
            <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">
              {app.aiSummary}
            </p>
          ) : null}
          {canMutate ? (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-fit text-xs"
              onClick={() => void analyze()}
              disabled={analyzing}
            >
              {analyzing ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Menganalisis...
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" aria-hidden="true" />
                  Analisis Ulang
                </>
              )}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Belum ada analisis AI untuk lamaran ini.
          </p>
          {canMutate ? (
            <Button
              className="h-9 w-fit"
              onClick={() => void analyze()}
              disabled={analyzing}
            >
              {analyzing ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menganalisis...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden="true" />
                  Analisis dengan AI
                </>
              )}
            </Button>
          ) : null}
        </div>
      )}

      {canMutate ? (
        <div className="flex flex-col gap-2 border-t pt-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => void loadQuestions()}
              disabled={questionsLoading}
            >
              {questionsLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardList className="size-4" aria-hidden="true" />
              )}
              Pertanyaan Wawancara
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              onClick={() => void loadReply()}
              disabled={replyLoading}
            >
              {replyLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Mail className="size-4" aria-hidden="true" />
              )}
              Draft Balasan
            </Button>
          </div>

          {questions ? (
            <Collapsible open={showQuestions} onOpenChange={setShowQuestions}>
              <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                Hasil pertanyaan wawancara
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <AiToolResult label="Pertanyaan Wawancara" text={questions} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}

          {draft ? (
            <Collapsible open={showDraft} onOpenChange={setShowDraft}>
              <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
                Hasil draft balasan
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <AiToolResult label="Draft Balasan" text={draft} />
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
