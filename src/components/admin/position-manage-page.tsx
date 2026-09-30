"use client";

// HUB "Satu Pintu Kelola Posisi" — halaman khusus per lowongan (dibuka dari tab
// Posisi → tombol "Kelola", deep-link: #admin/posisi/<id>[/suffix]).
// Satu halaman dengan sub-navigasi pill: Ringkasan (hub), Konten, Formulir,
// Penerimaan, Seleksi, Wawancara, Pesan, dan Statistik. Setiap mode merender
// halaman penuh; perpindahan mode dikelola parent lewat onModeChange agar hash
// URL ikut tersinkron. Aksi cepat (Cari Talent Lama / Nurture) tinggal di
// Ringkasan bersama dialognya.

import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Loader2,
  MapPin,
  MessagesSquare,
  Pencil,
  QrCode,
  RefreshCw,
  ScrollText,
  Search,
  Sprout,
  Users,
  Video,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Application, Position, PositionStatsRow } from "@/lib/types";
import {
  isCvEnabled,
  isCvRequired,
  isFormSchemaActive,
  isIntroEnabled,
  isIntroRequired,
  isPortfolioEnabled,
  isPortfolioRequired,
} from "@/lib/form-schema";
import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "./api";
import { copyText, formatDateTime, formatDate, initialsOf } from "./format";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { Reveal } from "./motion-primitives";
import { AiScoreBadge, StatusBadge } from "./status-badge";
import { PositionFormPage } from "./position-form-page";
import { FormBuilderPage } from "./form-builder-page";
import {
  PositionIntakePage,
  PositionInterviewPage,
  PositionMessagesPage,
  PositionSelectionPage,
} from "./position-settings-pages";
import { PositionStatsPage } from "./position-stats-page";
import { positionDeepLink } from "./position-qr-dialog";

export type ManageMode =
  | "view"
  | "konten"
  | "formulir"
  | "penerimaan"
  | "seleksi"
  | "wawancara"
  | "pesan"
  | "statistik";

type Props = {
  position: Position;
  stats: PositionStatsRow | null;
  mode: ManageMode;
  onModeChange: (m: ManageMode) => void;
  onBack: () => void;
  onUpdated: (p: Position) => void;
};

const SUB_NAV: { mode: ManageMode; label: string; icon: LucideIcon }[] = [
  { mode: "view", label: "Ringkasan", icon: LayoutDashboard },
  { mode: "konten", label: "Konten", icon: FileText },
  { mode: "formulir", label: "Formulir", icon: ListChecks },
  { mode: "penerimaan", label: "Penerimaan", icon: Inbox },
  { mode: "seleksi", label: "Seleksi", icon: Workflow },
  { mode: "wawancara", label: "Wawancara", icon: Video },
  { mode: "pesan", label: "Pesan", icon: MessagesSquare },
  { mode: "statistik", label: "Statistik", icon: BarChart3 },
];

/* ------------------------- Talent rediscovery & nurture ------------------------- */

type RediscoverResult = {
  id: string;
  name: string;
  skor: number;
  alasan: string;
  appliedAt: string;
  priorTitle: string | null;
};

// Warna badge skor kecocokan (emerald kuat, amber menengah, zinc sisanya).
function skorBadgeClass(skor: number): string {
  if (skor >= 75) {
    return "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400";
  }
  if (skor >= 45) {
    return "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400";
  }
  return "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
}

export function PositionManagePage({
  position,
  stats,
  mode,
  onModeChange,
  onBack,
  onUpdated,
}: Props) {
  const { canMutate, reportError } = useAdminSession();

  /* ---------------------------- Pelamar posisi ---------------------------- */

  const [applicants, setApplicants] = useState<Application[] | null>(null);
  const [applicantsLoading, setApplicantsLoading] = useState(true);

  const loadApplicants = useCallback(async () => {
    try {
      const data = await apiGet<Application[]>("/api/admin/applications");
      setApplicants(
        (Array.isArray(data) ? data : []).filter((a) => a.positionId === position.id),
      );
    } catch {
      // Senyap: daftar pelamar bersifat pelengkap; tombol coba lagi tersedia.
      setApplicants(null);
    } finally {
      setApplicantsLoading(false);
    }
  }, [position.id]);

  useEffect(() => {
    void loadApplicants();
  }, [loadApplicants]);

  // Realtime: lamaran masuk/berubah → segarkan daftar pelamar posisi ini.
  useLiveRefresh("applications:changed", () => {
    void loadApplicants();
  });

  const quotaLeft = useMemo(() => {
    if (position.maxApplicants == null) return null;
    const used = applicants?.filter((a) => a.status !== "REJECTED").length ?? 0;
    return Math.max(0, position.maxApplicants - used);
  }, [applicants, position.maxApplicants]);

  const publicUrl = positionDeepLink(position);

  async function handleCopyLink() {
    const ok = await copyText(publicUrl);
    if (ok) toast.success("Tautan posisi disalin");
    else toast.error("Gagal menyalin tautan");
  }

  /* ------------------------------ QR tautan ------------------------------ */

  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  // setState hanya di callback async (bukan body effect secara sinkron).
  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    QRCode.toDataURL(publicUrl, { width: 256, margin: 2 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [publicUrl]);

  /* --------------------------- Talent rediscovery (AI) --------------------------- */

  const [rediscoverTarget, setRediscoverTarget] = useState<Position | null>(null);
  const [rediscoverLoading, setRediscoverLoading] = useState(false);
  const [rediscoverError, setRediscoverError] = useState<string | null>(null);
  const [rediscoverData, setRediscoverData] = useState<{ total: number; results: RediscoverResult[] } | null>(null);

  async function openRediscover(target: Position) {
    setRediscoverTarget(target);
    setRediscoverData(null);
    setRediscoverError(null);
    setRediscoverLoading(true);
    try {
      const data = await apiPost<{ total: number; results: RediscoverResult[] }>(
        `/api/admin/positions/${target.id}/rediscover`
      );
      setRediscoverData(data);
    } catch (err) {
      setRediscoverError(
        err instanceof Error ? err.message : "Gagal mencari talent lama. Coba lagi."
      );
    } finally {
      setRediscoverLoading(false);
    }
  }

  async function retryRediscover() {
    if (rediscoverTarget) await openRediscover(rediscoverTarget);
  }

  /* ----------------------------- Nurture kandidat ----------------------------- */

  const [nurtureTarget, setNurtureTarget] = useState<Position | null>(null);
  const [nurtureCount, setNurtureCount] = useState<number | null>(null);
  const [nurtureLoading, setNurtureLoading] = useState(false);
  const [nurtureSending, setNurtureSending] = useState(false);

  async function openNurture(target: Position) {
    setNurtureTarget(target);
    setNurtureCount(null);
    setNurtureLoading(true);
    try {
      const data = await apiGet<{ count: number }>(
        `/api/admin/positions/${target.id}/nurture?preview=1`
      );
      setNurtureCount(data.count);
    } catch (err) {
      setNurtureTarget(null);
      reportError(err);
    } finally {
      setNurtureLoading(false);
    }
  }

  async function handleNurture() {
    if (!nurtureTarget || nurtureSending) return;
    setNurtureSending(true);
    try {
      const data = await apiPost<{ queued: number }>(
        `/api/admin/positions/${nurtureTarget.id}/nurture`
      );
      toast.success(`${data.queued} email disiapkan`, {
        description: `Email nurture untuk posisi ${nurtureTarget.title} masuk kotak keluar.`,
      });
      setNurtureTarget(null);
    } catch (err) {
      reportError(err);
    } finally {
      setNurtureSending(false);
    }
  }

  /* --------------------------- Ringkasan formulir --------------------------- */

  // Form Builder v2 aktif → ringkasan mengikuti skema; selain itu ringkasan
  // klasik (flag berkas + pertanyaan screening).
  const schemaActive = isFormSchemaActive(position);
  const activeSchema = schemaActive ? position.formSchema : null;
  const filesSection =
    activeSchema?.sections.find((s) => s.kind === "files") ?? null;

  if (mode === "formulir") {
    return (
      <FormBuilderPage
        position={position}
        onBack={() => onModeChange("view")}
        onUpdated={onUpdated}
        onOpenIntake={() => onModeChange("penerimaan")}
      />
    );
  }

  if (mode === "konten") {
    return (
      <PositionFormPage
        editing={position}
        onCancel={() => onModeChange("view")}
        onSaved={(p) => {
          onUpdated(p);
          onModeChange("view");
        }}
      />
    );
  }

  if (mode === "penerimaan") {
    return (
      <PositionIntakePage
        key={position.id}
        position={position}
        onBack={() => onModeChange("view")}
        onSaved={(p) => onUpdated(p)}
      />
    );
  }

  if (mode === "seleksi") {
    return (
      <PositionSelectionPage
        key={position.id}
        position={position}
        statsRow={stats}
        onBack={() => onModeChange("view")}
        onSaved={(p) => onUpdated(p)}
      />
    );
  }

  if (mode === "wawancara") {
    return (
      <PositionInterviewPage
        key={position.id}
        position={position}
        onBack={() => onModeChange("view")}
        onSaved={(p) => onUpdated(p)}
      />
    );
  }

  if (mode === "pesan") {
    return (
      <PositionMessagesPage
        key={position.id}
        position={position}
        onBack={() => onModeChange("view")}
        onSaved={(p) => onUpdated(p)}
      />
    );
  }

  if (mode === "statistik") {
    return (
      <PositionStatsPage
        position={position}
        stats={stats}
        onBack={() => onModeChange("view")}
      />
    );
  }

  // mode === "view" — Ringkasan (halaman utama hub).
  return (
    <div className="flex flex-col gap-4">
      {/* Header halaman */}
      <Reveal className="flex flex-col gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 h-11 gap-2 sm:h-9"
            onClick={onBack}
            aria-label="Kembali ke daftar posisi"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Kelola Posisi
          </Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-rose-600 to-amber-500 text-white">
              <Briefcase className="size-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold leading-tight">
                {position.title}
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="size-3" aria-hidden="true" />
                  {position.location || "-"}
                </span>
                <span>{position.department}</span>
                <span>{position.type}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {position.isActive ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() => void openRediscover(position)}
                  disabled={!canMutate || rediscoverLoading}
                >
                  <Search className="size-4" aria-hidden="true" />
                  Cari Talent Lama
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() => void openNurture(position)}
                  disabled={!canMutate || nurtureSending}
                >
                  <Sprout className="size-4" aria-hidden="true" />
                  Nurture Kandidat
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => onModeChange("konten")}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Posisi
            </Button>
          </div>
        </div>
      </Reveal>

      {/* Sub-navigasi bagian kelola */}
      <Reveal delay={0.05}>
        <nav
          aria-label="Bagian kelola posisi"
          className="nice-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {SUB_NAV.map((item) => {
            const active = mode === item.mode;
            return (
              <Button
                key={item.mode}
                className={cn(
                  "h-11 shrink-0 gap-1.5 rounded-full px-3 text-xs sm:h-8 sm:text-sm",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-transparent text-muted-foreground hover:bg-zinc-100 dark:hover:bg-zinc-800",
                )}
                onClick={() => onModeChange(item.mode)}
                aria-current={active ? "page" : undefined}
              >
                <item.icon className="size-4" aria-hidden="true" />
                {item.label}
              </Button>
            );
          })}
        </nav>
      </Reveal>

      {/* Statistik ringkas */}
      <Reveal delay={0.1} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          {
            label: "Lamaran masuk",
            value: stats?.applications ?? applicants?.length ?? 0,
            icon: FileText,
          },
          { label: "Dilihat", value: stats?.views ?? position.views ?? 0, icon: ExternalLink },
          {
            label: "Konversi",
            value: stats?.conversion != null ? `${stats.conversion}%` : "-",
            icon: BarChart3,
          },
          {
            label: position.maxApplicants != null ? "Sisa kuota" : "Kuota",
            value:
              position.maxApplicants != null
                ? (quotaLeft ?? position.maxApplicants)
                : "Tanpa kuota",
            icon: Users,
          },
        ].map((item) => (
          <Card key={item.label} className="gap-1 rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <item.icon className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            </div>
            <p className="text-xl font-bold tabular-nums">{item.value}</p>
          </Card>
        ))}
      </Reveal>

      {/* Bagikan posisi — tautan + QR halaman publik */}
      <Reveal delay={0.15}>
        <Card className="gap-4 rounded-2xl p-5 md:p-6">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Bagikan Posisi
            </CardTitle>
            <CardDescription className="mt-1">
              Tautan & QR untuk halaman publik posisi ini.
            </CardDescription>
          </div>
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="flex shrink-0 items-center justify-center rounded-xl border bg-white p-2">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code tautan posisi ${position.title}`}
                  className="size-32 sm:size-40"
                  width={256}
                  height={256}
                />
              ) : (
                <Loader2
                  className="size-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                readOnly
                value={publicUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Tautan publik posisi"
                className="w-full rounded-lg border bg-zinc-50/60 px-3 py-2 font-mono text-xs text-muted-foreground dark:bg-zinc-900/40"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() => void handleCopyLink()}
                >
                  <Copy className="size-4" aria-hidden="true" />
                  Salin Link
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 sm:h-9"
                  onClick={() =>
                    window.open(publicUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Lihat Halaman Publik
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </Reveal>

      {/* Ringkasan formulir lamaran — diedit di mode "formulir" */}
      <Reveal delay={0.2}>
        <Card className="gap-4 rounded-2xl p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                Formulir Lamaran
              </CardTitle>
              <CardDescription className="mt-1">
                {schemaActive
                  ? "Pertanyaan dan berkas lamaran mengikuti skema Form Builder posisi ini."
                  : "Berkas wajib, kuota pelamar, dan pertanyaan screening yang diisi pelamar saat melamar posisi ini."}
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="h-11 shrink-0 sm:h-9"
              onClick={() => onModeChange("formulir")}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Kelola Formulir
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {schemaActive && activeSchema ? (
              <>
                <Badge
                  variant="outline"
                  className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                >
                  Skema aktif
                </Badge>
                <Badge variant="secondary">{activeSchema.sections.length} bagian</Badge>
                <Badge variant="secondary">{activeSchema.fields.length} pertanyaan</Badge>
                {filesSection ? (
                  <>
                    {isCvEnabled(filesSection) ? (
                      <Badge variant="secondary">
                        CV · {isCvRequired(filesSection) ? "wajib" : "opsional"}
                      </Badge>
                    ) : null}
                    {isIntroEnabled(filesSection) ? (
                      <Badge variant="secondary">
                        Audio/Video Intro ·{" "}
                        {isIntroRequired(filesSection) ? "wajib" : "opsional"}
                      </Badge>
                    ) : null}
                    {isPortfolioEnabled(filesSection) ? (
                      <Badge variant="secondary">
                        Portofolio ·{" "}
                        {isPortfolioRequired(filesSection) ? "wajib" : "opsional"}
                      </Badge>
                    ) : null}
                  </>
                ) : null}
                {position.customDocs.length > 0 ? (
                  <Badge variant="secondary">
                    {position.customDocs.length} dokumen tambahan
                  </Badge>
                ) : null}
                <Badge variant="secondary">
                  Kuota:{" "}
                  {position.maxApplicants != null ? position.maxApplicants : "tanpa batas"}
                </Badge>
              </>
            ) : (
              <>
                {[
                  { label: "CV", required: position.requireCv },
                  { label: "Audio/Video Intro", required: position.requireIntro },
                  { label: "Portofolio", required: position.requirePortfolio },
                ].map((doc) => (
                  <Badge
                    key={doc.label}
                    variant="secondary"
                    className={
                      doc.required
                        ? "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                        : ""
                    }
                  >
                    {doc.label} · {doc.required ? "wajib" : "opsional"}
                  </Badge>
                ))}
                {position.customDocs.length > 0 ? (
                  <Badge variant="secondary">
                    {position.customDocs.length} dokumen tambahan
                  </Badge>
                ) : null}
                <Badge variant="secondary">
                  Kuota:{" "}
                  {position.maxApplicants != null ? position.maxApplicants : "tanpa batas"}
                </Badge>
                <Badge variant="secondary">
                  {position.screeningQuestions.length} pertanyaan screening
                </Badge>
                {position.screeningQuestions.length > 0 ? (
                  <Badge variant="secondary">
                    {position.screeningQuestions.filter((q) => q.required).length} wajib dijawab
                  </Badge>
                ) : null}
              </>
            )}
          </div>
        </Card>
      </Reveal>

      {/* Pratinjau konten + pelamar posisi */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Reveal delay={0.25} className="xl:col-span-2">
          <Card className="gap-4 rounded-2xl p-5 md:p-6">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ScrollText className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                Konten Lowongan
              </CardTitle>
              <CardDescription className="mt-1">
                Ringkasan isi yang tampil di halaman publik.
              </CardDescription>
            </div>
            <div className="nice-scrollbar max-h-64 overflow-y-auto rounded-xl border bg-zinc-50/60 p-4 dark:bg-zinc-900/40">
              <p className="line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {position.description}
              </p>
              <Separator className="my-3" />
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{position.requirements.length} persyaratan</Badge>
                <Badge variant="secondary">{position.benefits.length} benefit</Badge>
                <Badge variant="secondary">{position.customDocs.length} dokumen tambahan</Badge>
              </div>
            </div>
            <Button
              variant="outline"
              className="mx-auto min-h-11 sm:min-h-10"
              onClick={() => onModeChange("konten")}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Konten
            </Button>
          </Card>
        </Reveal>

        <Reveal delay={0.3} className="xl:col-span-3">
          <Card className="gap-4 rounded-2xl p-5 md:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                  Pelamar Posisi Ini
                </CardTitle>
                <CardDescription className="mt-1">
                  {applicants
                    ? `${applicants.length} lamaran · kelola detail di tab Pelamar.`
                    : "Memuat lamaran..."}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 shrink-0"
                onClick={() => void loadApplicants()}
                aria-label="Segarkan daftar pelamar"
              >
                <Loader2
                  className={`size-4 ${applicantsLoading ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
              </Button>
            </div>

            {applicantsLoading && applicants === null ? (
              <div className="flex flex-col gap-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
                ))}
              </div>
            ) : applicants === null ? (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Gagal memuat daftar pelamar.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 min-h-11 sm:min-h-10"
                  onClick={() => {
                    setApplicantsLoading(true);
                    void loadApplicants();
                  }}
                >
                  Coba Lagi
                </Button>
              </div>
            ) : applicants.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Belum ada lamaran untuk posisi ini.
              </div>
            ) : (
              <ul className="nice-scrollbar flex max-h-72 flex-col gap-2 overflow-y-auto">
                {applicants.map((applicant) => (
                  <li
                    key={applicant.id}
                    className="flex items-center gap-3 rounded-lg border px-3 py-2"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-600 to-amber-500 text-[11px] font-bold text-white">
                      {initialsOf(applicant.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{applicant.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDateTime(applicant.createdAt)} · {applicant.trackingCode}
                      </p>
                    </div>
                    <AiScoreBadge score={applicant.aiScore} />
                    <StatusBadge status={applicant.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </Reveal>
      </div>

      {/* Dialog hasil talent rediscovery (AI) */}
      <Dialog
        open={!!rediscoverTarget}
        onOpenChange={(open) => {
          if (!open) setRediscoverTarget(null);
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-hidden rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Cari Talent Lama
            </DialogTitle>
            <DialogDescription>
              {rediscoverTarget ? rediscoverTarget.title : "-"}
              {rediscoverTarget ? ` — ${rediscoverTarget.department}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="nice-scrollbar -mr-2 max-h-[70vh] overflow-y-auto pr-2">
            {rediscoverLoading ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Loader2 className="size-6 animate-spin text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  Menganalisis kandidat dari talent pool & pelamar ditolak dengan AI...
                </p>
              </div>
            ) : rediscoverError ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-rose-600 dark:text-rose-400">{rediscoverError}</p>
                <Button variant="outline" onClick={() => void retryRediscover()} className="h-9">
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Coba Lagi
                </Button>
              </div>
            ) : rediscoverData && rediscoverData.results.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  Dianalisis dari {rediscoverData.total} kandidat (talent pool & ditolak, maks 150) — 5 teratas.
                </p>
                <ul className="flex flex-col gap-2">
                  {rediscoverData.results.map((result, index) => (
                    <li key={result.id} className="flex flex-col gap-1.5 rounded-xl border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                          <span className="shrink-0 tabular-nums text-muted-foreground">{index + 1}.</span>
                          <span className="truncate">{result.name}</span>
                        </p>
                        <Badge variant="outline" className={`shrink-0 tabular-nums ${skorBadgeClass(result.skor)}`}>
                          Skor {result.skor}
                        </Badge>
                      </div>
                      {result.alasan ? (
                        <p className="text-xs leading-relaxed text-muted-foreground">{result.alasan}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        Lamar {formatDate(result.appliedAt)}
                        {result.priorTitle ? ` — ${result.priorTitle}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Belum ada kandidat lama yang cocok ditemukan untuk posisi ini.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Konfirmasi nurture kandidat ditolak */}
      <AlertDialog
        open={!!nurtureTarget}
        onOpenChange={(open) => {
          if (!open) setNurtureTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nurture Kandidat?</AlertDialogTitle>
            <AlertDialogDescription>
              {nurtureLoading ? (
                "Menghitung kandidat yang memenuhi kriteria..."
              ) : nurtureCount === 0 ? (
                <>
                  Tidak ada kandidat yang memenuhi kriteria: ditolak lebih dari 60 hari lalu (bukan karena menarik
                  diri) pada posisi ini atau posisi satu departemen dengan &quot;
                  {nurtureTarget?.title ?? "-"}&quot;.
                </>
              ) : (
                <>
                  Email &quot;Kabar baik dari Lumina Studio&quot; akan disiapkan untuk{" "}
                  <span className="font-semibold text-foreground tabular-nums">{nurtureCount}</span> kandidat yang
                  ditolak lebih dari 60 hari lalu (bukan karena menarik diri) pada posisi ini atau posisi satu
                  departemen. Email masuk kotak keluar beserta catatan log.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={nurtureSending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleNurture();
              }}
              disabled={nurtureLoading || nurtureCount === 0 || nurtureSending}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {nurtureSending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyiapkan...
                </>
              ) : (
                "Ya, Siapkan Email"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
