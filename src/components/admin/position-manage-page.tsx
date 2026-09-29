"use client";

// Halaman khusus per lowongan (dibuka dari tab Posisi → tombol "Kelola").
// Menyatukan semua yang dibutuhkan untuk mengelola SATU lowongan di satu
// tempat: identitas & statistik ringkas, ringkasan formulir lamaran,
// pratinjau konten, dan daftar pelamar posisi ini. Bisa di-deep-link:
// #admin/posisi/<id> (kelola), #admin/posisi/<id>/edit (edit posisi),
// #admin/posisi/<id>/formulir (edit formulir lamaran).
// Dua jalur EDIT terpisah — semuanya halaman penuh (bukan popup):
//   1. "Edit Posisi"      → seluruh pengaturan info lowongan (PositionFormPage mode="posisi")
//   2. "Formulir Lamaran" → berkas wajib, kuota, screening, dokumen pendaftar
//                            (PositionFormPage mode="formulir")

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  MapPin,
  Pencil,
  QrCode,
  ScrollText,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Application, Position, PositionStatsRow } from "@/lib/types";
import { apiGet } from "./api";
import { copyText, formatDateTime, initialsOf } from "./format";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { Reveal } from "./motion-primitives";
import { AiScoreBadge, StatusBadge } from "./status-badge";
import { PositionFormPage } from "./position-form-page";

type EditMode = "posisi" | "formulir";

type Props = {
  position: Position;
  stats: PositionStatsRow | null;
  /** Mode edit aktif — null berarti tampilan kelola biasa. */
  editMode: EditMode | null;
  /** Minta buka salah satu halaman edit (dari tombol di halaman ini). */
  onEdit: (mode: EditMode) => void;
  /** Tutup halaman edit kembali ke tampilan kelola (batal maupun setelah simpan). */
  onExitEdit: () => void;
  onBack: () => void;
  onStats: (position: Position) => void;
  onQr: (position: Position) => void;
  onUpdated: (position: Position) => void;
};

export function PositionManagePage({
  position,
  stats,
  editMode,
  onEdit,
  onExitEdit,
  onBack,
  onStats,
  onQr,
  onUpdated,
}: Props) {
  const { canMutate } = useAdminSession();

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

  const publicUrl = `${window.location.origin}/?posisi=${encodeURIComponent(position.slug ?? position.id)}`;

  async function handleCopyLink() {
    const ok = await copyText(publicUrl);
    if (ok) toast.success("Tautan posisi disalin");
    else toast.error("Gagal menyalin tautan");
  }

  // Edit lengkap sebagai halaman penuh (bukan popup): seluruh tampilan kelola
  // digantikan halaman formulir sesuai mode (posisi / formulir lamaran).
  if (editMode) {
    return (
      <PositionFormPage
        editing={position}
        statsRow={stats}
        mode={editMode}
        onCancel={onExitEdit}
        onSaved={(updated) => {
          onUpdated(updated);
          onExitEdit();
        }}
      />
    );
  }

  // Ringkasan berkas yang diminta dari pendaftar (diedit di halaman Formulir).
  const docSummary: { label: string; required: boolean }[] = [
    { label: "CV", required: position.requireCv },
    { label: "Audio/Video Intro", required: position.requireIntro },
    { label: "Portofolio", required: position.requirePortfolio },
    ...position.customDocs.map((doc) => ({ label: doc, required: true })),
  ];

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
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => onStats(position)}
              aria-label="Statistik posisi"
            >
              <BarChart3 className="size-4" aria-hidden="true" />
              <span className="sm:hidden">Statistik</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => onQr(position)}
              aria-label="QR posisi"
            >
              <QrCode className="size-4" aria-hidden="true" />
              <span className="sm:hidden">QR</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => void handleCopyLink()}
              aria-label="Salin tautan posisi"
            >
              <Copy className="size-4" aria-hidden="true" />
              <span className="sm:hidden">Salin Link</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() =>
                window.open(
                  position.slug
                    ? `/?posisi=${encodeURIComponent(position.slug)}`
                    : "/",
                  "_blank",
                  "noopener,noreferrer",
                )
              }
              aria-label="Lihat halaman publik posisi"
            >
              <ExternalLink className="size-4" aria-hidden="true" />
              <span className="hidden md:inline">Lihat Halaman Publik</span>
              <span className="md:hidden">Publik</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => onEdit("formulir")}
              disabled={!canMutate}
            >
              <ListChecks className="size-4" aria-hidden="true" />
              Formulir Lamaran
            </Button>
            <Button
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => onEdit("posisi")}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Posisi
            </Button>
          </div>
        </div>
      </Reveal>

      {/* Statistik ringkas */}
      <Reveal delay={0.05} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

      {/* Ringkasan formulir lamaran — diedit di halaman "Formulir Lamaran" */}
      <Reveal delay={0.1}>
        <Card className="gap-4 rounded-2xl p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                Formulir Lamaran
              </CardTitle>
              <CardDescription className="mt-1">
                Berkas wajib, kuota pelamar, dan pertanyaan screening yang
                diisi pelamar saat melamar posisi ini.
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="h-11 shrink-0 sm:h-9"
              onClick={() => onEdit("formulir")}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Formulir
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {docSummary.map((doc) => (
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
          </div>
          <div className="flex flex-wrap gap-1.5 border-t pt-3">
            <Badge variant="secondary">
              Kuota: {position.maxApplicants != null ? position.maxApplicants : "tanpa batas"}
            </Badge>
            <Badge variant="secondary">
              {position.screeningQuestions.length} pertanyaan screening
            </Badge>
            {position.screeningQuestions.length > 0 ? (
              <Badge variant="secondary">
                {position.screeningQuestions.filter((q) => q.required).length} wajib dijawab
              </Badge>
            ) : null}
          </div>
        </Card>
      </Reveal>

      {/* Pratinjau konten + pelamar posisi */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Reveal delay={0.15} className="xl:col-span-2">
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
              onClick={() => onEdit("posisi")}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Posisi
            </Button>
          </Card>
        </Reveal>

        <Reveal delay={0.2} className="xl:col-span-3">
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
    </div>
  );
}
