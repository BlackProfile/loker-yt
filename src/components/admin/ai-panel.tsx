"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import {
  Briefcase,
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  Languages,
  Loader2,
  Mail,
  ScanText,
  Scale,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  AI_RECOMMENDATION_LABELS,
  type Application,
  type AiRecommendation,
  type StructuredExperience,
} from "@/lib/types";
import { apiGet, apiPost } from "./api";
import { copyText, formatDate } from "./format";
import { aiScoreStyle } from "./status-badge";
import { useAdminSession } from "./admin-context";
import { cn } from "@/lib/utils";

// Hasil POST /api/admin/applications/[id]/bias-check.
type BiasCheckResult = {
  selaras: boolean;
  skor_admin: number;
  skor_bukti_estimasi: number;
  catatan: string;
};

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

  // OCR CV (Teks CV) + bias check
  const [cvText, setCvText] = useState<string | null>(null);
  const [cvPeeked, setCvPeeked] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [showCvText, setShowCvText] = useState(true);
  const [biasLoading, setBiasLoading] = useState(false);
  const [biasResult, setBiasResult] = useState<BiasCheckResult | null>(null);

  // NR49 — terjemahan AI teks CV (tersimpan di server; semua role boleh menerjemahkan).
  const [translation, setTranslation] = useState<{ text: string; language: string } | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [transLoading, setTransLoading] = useState(false);

  // NR50 — uraian pengalaman terstruktur AI (tabel dari CV; tersimpan di server).
  const [experience, setExperience] = useState<StructuredExperience | null>(null);
  const [expLoading, setExpLoading] = useState(false);

  // Reset hasil alat AI saat kandidat berganti.
  useEffect(() => {
    setQuestions(null);
    setDraft(null);
    setShowQuestions(false);
    setShowDraft(false);
    setCvText(null);
    setCvPeeked(false);
    setOcrLoading(false);
    setBiasResult(null);
    setBiasLoading(false);
    setTranslation(null);
    setShowTranslated(false);
    setTransLoading(false);
    setExperience(null);
    setExpLoading(false);
  }, [app.id]);

  // NR49 — baca diam-diam terjemahan tersimpan saat kandidat berganti (tanpa AI).
  // Bila sudah ada, toggle "Tampilkan terjemahan" langsung tersedia.
  useEffect(() => {
    let cancelled = false;
    apiGet<{ translation: { text: string; language: string } | null }>(
      `/api/admin/applications/${app.id}/translate?field=cvText`
    )
      .then((res) => {
        if (cancelled || !res.translation) return;
        setTranslation({ text: res.translation.text, language: res.translation.language });
        setShowTranslated(false);
      })
      .catch(() => {
        // silent — terjemahan hanya pelengkap
      });
    return () => {
      cancelled = true;
    };
  }, [app.id]);

  // Baca diam-diam cvText yang sudah tersimpan (tanpa menjalankan OCR).
  useEffect(() => {
    if (!app.cvFileId || cvPeeked) return;
    let cancelled = false;
    apiPost<{ cvText: string | null; cached: boolean }>(
      `/api/admin/applications/${app.id}/ocr-cv`,
      { peek: true }
    )
      .then((res) => {
        if (cancelled) return;
        setCvText(res.cvText);
        setCvPeeked(true);
      })
      .catch(() => {
        if (!cancelled) setCvPeeked(true); // biarkan tombol OCR yang menangani ulang
      });
    return () => {
      cancelled = true;
    };
  }, [app.id, app.cvFileId, cvPeeked]);

  // NR50 — baca diam-diam pengalaman terstruktur tersimpan saat kandidat berganti.
  useEffect(() => {
    let cancelled = false;
    apiGet<{ experience: StructuredExperience | null }>(
      `/api/admin/applications/${app.id}/experience-structured`
    )
      .then((res) => {
        if (cancelled || !res.experience) return;
        setExperience(res.experience);
      })
      .catch(() => {
        // Pelengkap — abaikan kegagalan fetch.
      });
    return () => {
      cancelled = true;
    };
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

  async function runOcr() {
    if (ocrLoading || !app.cvFileId) return;
    setOcrLoading(true);
    try {
      const res = await apiPost<{ cvText: string; cached: boolean }>(
        `/api/admin/applications/${app.id}/ocr-cv`
      );
      setCvText(res.cvText);
      setCvPeeked(true);
      setShowCvText(true);
      toast.success(res.cached ? "Teks CV sudah tersedia" : "CV berhasil dibaca dengan OCR");
    } catch (err) {
      reportError(err);
    } finally {
      setOcrLoading(false);
    }
  }

  async function runBiasCheck() {
    if (biasLoading) return;
    setBiasLoading(true);
    try {
      const res = await apiPost<BiasCheckResult>(
        `/api/admin/applications/${app.id}/bias-check`
      );
      setBiasResult(res);
    } catch (err) {
      reportError(err);
    } finally {
      setBiasLoading(false);
    }
  }

  // NR49 — terjemahkan teks CV ke Bahasa Indonesia (aksi ringan, semua role).
  async function runTranslate() {
    if (transLoading) return;
    setTransLoading(true);
    try {
      const res = await apiPost<{
        translated: string | null;
        language?: string | null;
        message?: string;
      }>(`/api/admin/applications/${app.id}/translate`, { field: "cvText" });
      if (res.translated) {
        setTranslation({ text: res.translated, language: res.language ?? "Asing" });
        setShowTranslated(true);
        toast.success("Terjemahan selesai dibuat");
      } else {
        toast.info(res.message ?? "Teks sudah berbahasa Indonesia.");
      }
    } catch (err) {
      reportError(err);
    } finally {
      setTransLoading(false);
    }
  }

  // NR50 — ekstrak pengalaman terstruktur dari CV (fallback isian pengalaman).
  async function runExperience() {
    if (expLoading) return;
    setExpLoading(true);
    try {
      const res = await apiPost<{
        items: StructuredExperience["items"];
        generatedAt: string;
        message?: string;
      }>(`/api/admin/applications/${app.id}/experience-structured`);
      if (res.items.length > 0) {
        setExperience({ items: res.items, generatedAt: res.generatedAt });
        onUpdated({
          ...app,
          experienceStructured: { items: res.items, generatedAt: res.generatedAt },
        });
        toast.success("Pengalaman berhasil diekstrak dari CV");
      } else {
        toast.info(res.message ?? "Tidak ditemukan pengalaman kerja pada teks sumber.");
      }
    } catch (err) {
      reportError(err);
    } finally {
      setExpLoading(false);
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

          {/* Cek bias penilaian admin vs bukti objektif. */}
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-fit"
              onClick={() => void runBiasCheck()}
              disabled={biasLoading}
            >
              {biasLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Scale className="size-4" aria-hidden="true" />
              )}
              Cek Bias Penilaian
            </Button>
            {biasResult ? (
              <div
                className={cn(
                  "rounded-lg border p-3",
                  biasResult.selaras
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                    : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={
                      biasResult.selaras
                        ? "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                        : "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                    }
                  >
                    {biasResult.selaras ? "Selaras" : "Perlu ditinjau"}
                  </Badge>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Skor admin {biasResult.skor_admin}/100 · Estimasi bukti {biasResult.skor_bukti_estimasi}/100
                  </p>
                </div>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{biasResult.catatan}</p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Teks CV — hasil OCR, dipakai juga pencarian semantik. */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold">Teks CV</p>
        </div>
        {!app.cvFileId ? (
          <p className="text-xs text-muted-foreground">Lamaran ini tidak memiliki file CV.</p>
        ) : cvText ? (
          <>
          <Collapsible open={showCvText} onOpenChange={setShowCvText}>
            <CollapsibleTrigger className="group flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
              <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              Teks hasil ekstraksi ({cvText.length} karakter)
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="relative mt-2">
                <div className="max-h-40 overflow-y-auto nice-scrollbar rounded-lg border bg-background p-3">
                  <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">{cvText}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute right-2 top-2 h-7 bg-background/90 px-2 text-xs backdrop-blur"
                  onClick={() =>
                    void copyText(cvText).then((ok) =>
                      ok ? toast.success("Teks CV disalin") : toast.error("Gagal menyalin ke clipboard")
                    )
                  }
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  Salin
                </Button>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* NR49 — terjemahan AI: tombol untuk semua role + toggle asli/terjemahan. */}
          <div className="mt-1 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-fit text-xs"
                onClick={() => void runTranslate()}
                disabled={transLoading}
              >
                {transLoading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Menerjemahkan...
                  </>
                ) : (
                  <>
                    <Languages className="size-3.5" aria-hidden="true" />
                    Terjemahkan ke Indonesia (AI)
                  </>
                )}
              </Button>
              {translation ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setShowTranslated((v) => !v)}
                >
                  {showTranslated ? "Tampilkan asli" : "Tampilkan terjemahan"}
                </Button>
              ) : null}
            </div>
            {translation && showTranslated ? (
              <div className="rounded-lg border bg-background p-3">
                <Badge
                  variant="outline"
                  className="mb-2 border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                >
                  Terjemahan AI · {translation.language}
                </Badge>
                <p className="nice-scrollbar max-h-40 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                  {translation.text}
                </p>
              </div>
            ) : null}
          </div>
          </>
        ) : canMutate ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 w-fit"
            onClick={() => void runOcr()}
            disabled={ocrLoading || cvPeeked === false}
          >
            {ocrLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Membaca CV...
              </>
            ) : (
              <>
                <ScanText className="size-4" aria-hidden="true" />
                Baca CV dengan OCR
              </>
            )}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Teks CV belum diekstraksi untuk lamaran ini.
          </p>
        )}
      </div>

      {/* NR50 — uraian pengalaman terstruktur AI (tabel dari CV). */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Briefcase className="size-4 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-semibold">Pengalaman Terstruktur (AI)</p>
          {experience ? (
            <Badge variant="outline" className="text-[10px] tabular-nums text-muted-foreground">
              {experience.items.length} baris
            </Badge>
          ) : null}
        </div>
        {!app.cvFileId && app.experience.trim() === "" ? (
          <p className="text-xs text-muted-foreground">
            Tidak ada CV maupun isian pengalaman untuk dianalisis.
          </p>
        ) : (
          <>
            {experience ? (
              <div className="overflow-hidden rounded-lg border bg-background">
                <div className="nice-scrollbar max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-muted/70 backdrop-blur">
                      <tr className="text-muted-foreground">
                        <th className="px-2.5 py-1.5 font-semibold">Perusahaan</th>
                        <th className="px-2.5 py-1.5 font-semibold">Posisi</th>
                        <th className="px-2.5 py-1.5 font-semibold">Periode</th>
                      </tr>
                    </thead>
                    <tbody>
                      {experience.items.map((row, idx) => (
                        <tr key={`${row.company}-${idx}`} className="border-t">
                          <td className="px-2.5 py-1.5 font-medium">{row.company}</td>
                          <td className="px-2.5 py-1.5">{row.position}</td>
                          <td className="px-2.5 py-1.5 text-muted-foreground">{row.period}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Belum ada uraian terstruktur. Jalankan analisis AI untuk mengekstrak daftar
                pengalaman dari CV ke tabel rapi.
              </p>
            )}
            <div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-fit text-xs"
                onClick={() => void runExperience()}
                disabled={expLoading}
              >
                {expLoading ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Menganalisis...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    {experience ? "Analisis Ulang" : "Analisis dengan AI"}
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
