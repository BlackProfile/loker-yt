"use client";

// Halaman khusus per lowongan (dibuka dari tab Posisi → tombol "Kelola").
// Menyatukan semua yang dibutuhkan untuk mengelola SATU lowongan di satu
// tempat: identitas & statistik ringkas, EDITOR DOKUMEN WAJIB pendaftar
// (CV / audio intro / portofolio + dokumen tambahan bebas), pratinjau konten,
// dan daftar pelamar posisi ini. Bisa di-deep-link: #admin/posisi/<id>.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  BarChart3,
  Briefcase,
  Copy,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  QrCode,
  ScrollText,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { Application, Position, PositionStatsRow } from "@/lib/types";
import { apiGet, apiPatch } from "./api";
import { copyText, formatDateTime, initialsOf } from "./format";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { Reveal } from "./motion-primitives";
import { AiScoreBadge, StatusBadge } from "./status-badge";
import { PositionFormPage } from "./position-form-page";

const MAX_CUSTOM_DOCS = 8;
const CUSTOM_DOC_MAX_LEN = 80;

type Props = {
  position: Position;
  stats: PositionStatsRow | null;
  onBack: () => void;
  startInEdit?: boolean;
  onStats: (position: Position) => void;
  onQr: (position: Position) => void;
  onUpdated: (position: Position) => void;
};

export function PositionManagePage({
  position,
  stats,
  onBack,
  startInEdit = false,
  onStats,
  onQr,
  onUpdated,
}: Props) {
  const { canMutate, reportError } = useAdminSession();

  // Mode "edit lengkap" di halaman (bukan popup): seluruh tampilan kelola
  // digantikan formulir posisi inline. startInEdit dipakai saat halaman ini
  // dibuka langsung dari tombol Edit di daftar posisi.
  const [editOpen, setEditOpen] = useState(startInEdit);

  /* ------------------------- Editor dokumen wajib ------------------------- */

  const [docForm, setDocForm] = useState({
    requireCv: position.requireCv,
    requireIntro: position.requireIntro,
    requirePortfolio: position.requirePortfolio,
    customDocs: [...position.customDocs],
  });
  const [newDoc, setNewDoc] = useState("");
  const [savingDocs, setSavingDocs] = useState(false);

  // Saat posisi berganti (dari daftar ke posisi lain), selaraskan form dokumen.
  // Pembaruan nilai dari luar (realtime) TIDAK menimpa suntingan yang belum disimpan.
  const [lastPositionId, setLastPositionId] = useState(position.id);
  if (lastPositionId !== position.id) {
    setLastPositionId(position.id);
    setDocForm({
      requireCv: position.requireCv,
      requireIntro: position.requireIntro,
      requirePortfolio: position.requirePortfolio,
      customDocs: [...position.customDocs],
    });
    setNewDoc("");
  }

  const docsDirty =
    docForm.requireCv !== position.requireCv ||
    docForm.requireIntro !== position.requireIntro ||
    docForm.requirePortfolio !== position.requirePortfolio ||
    JSON.stringify(docForm.customDocs) !== JSON.stringify(position.customDocs);

  const addCustomDoc = useCallback(() => {
    const label = newDoc.trim().slice(0, CUSTOM_DOC_MAX_LEN);
    if (label.length < 2) {
      toast.error("Nama dokumen minimal 2 karakter.");
      return;
    }
    if (docForm.customDocs.length >= MAX_CUSTOM_DOCS) {
      toast.error(`Maksimal ${MAX_CUSTOM_DOCS} dokumen tambahan.`);
      return;
    }
    if (docForm.customDocs.some((d) => d.toLowerCase() === label.toLowerCase())) {
      toast.error("Dokumen dengan nama itu sudah ada.");
      return;
    }
    setDocForm((prev) => ({ ...prev, customDocs: [...prev.customDocs, label] }));
    setNewDoc("");
  }, [newDoc, docForm.customDocs]);

  const removeCustomDoc = useCallback((label: string) => {
    setDocForm((prev) => ({
      ...prev,
      customDocs: prev.customDocs.filter((d) => d !== label),
    }));
  }, []);

  async function saveDocs() {
    if (!canMutate || savingDocs || !docsDirty) return;
    setSavingDocs(true);
    try {
      const updated = await apiPatch<Position>(
        `/api/admin/positions/${position.id}`,
        {
          requireCv: docForm.requireCv,
          requireIntro: docForm.requireIntro,
          requirePortfolio: docForm.requirePortfolio,
          customDocs: docForm.customDocs,
        },
      );
      onUpdated(updated);
      toast.success("Pengaturan dokumen pendaftar disimpan");
    } catch (err) {
      reportError(err);
    } finally {
      setSavingDocs(false);
    }
  }

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

  const docToggleRows: { key: "requireCv" | "requireIntro" | "requirePortfolio"; label: string; desc: string }[] = [
    {
      key: "requireCv",
      label: "CV",
      desc: "Berkas PDF ringkasan diri pelamar (maks 5 MB). Bila wajib, lamaran tanpa CV ditolak otomatis oleh form.",
    },
    {
      key: "requireIntro",
      label: "Audio/Video perkenalan",
      desc: "Rekaman singkat pelamar (MP3/WAV/M4A/WEBM, maks 10 MB) — otomatis ditranskripsi AI.",
    },
    {
      key: "requirePortfolio",
      label: "Portofolio / link sosial media",
      desc: "Tautan portofolio atau sosial media wajib diisi pelamar.",
    },
  ];

  // Edit lengkap sebagai halaman (bukan popup): kembalikan formulir inline.
  if (editOpen) {
    return (
      <PositionFormPage
        editing={position}
        statsRow={stats}
        onCancel={() => setEditOpen(false)}
        onSaved={(updated) => {
          setEditOpen(false);
          onUpdated(updated);
        }}
      />
    );
  }

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
              asChild
            >
              <a
                href={`/?posisi=${encodeURIComponent(position.slug ?? position.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Lihat halaman publik posisi"
              >
                <ExternalLink className="size-4" aria-hidden="true" />
                <span className="sm:hidden">Publik</span>
              </a>
            </Button>
            <Button
              size="sm"
              className="h-11 sm:h-9"
              onClick={() => setEditOpen(true)}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Lengkap
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

      {/* EDITOR: dokumen yang wajib diunggah pendaftar */}
      <Reveal delay={0.1}>
        <Card className="gap-4 rounded-2xl p-5 md:p-6">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Dokumen dari Pendaftar
            </CardTitle>
            <CardDescription className="mt-1">
              Atur berkas yang perlu diunggah pelamar saat melamar posisi ini.
              Perubahan langsung berlaku di formulir publik.
            </CardDescription>
          </div>

          <div className="flex flex-col divide-y rounded-xl border">
            {docToggleRows.map((row) => (
              <div key={row.key} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <Label className="text-sm font-semibold">{row.label}</Label>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {row.desc}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Switch
                    checked={docForm[row.key]}
                    onCheckedChange={(checked) =>
                      setDocForm((prev) => ({ ...prev, [row.key]: checked }))
                    }
                    disabled={!canMutate || savingDocs}
                    aria-label={`${row.label} diunggah pelamar`}
                  />
                  <span className="text-[11px] text-muted-foreground">
                    {docForm[row.key] ? "Wajib" : "Opsional"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Dokumen tambahan bebas */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-semibold">Dokumen wajib tambahan</Label>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Misal: KTP, Ijazah, Sertifikat, Surat Sehat. Pelamar wajib
              mengunggah semuanya (PDF/gambar/Word, maks 5 MB per berkas,
              maksimal {MAX_CUSTOM_DOCS} dokumen).
            </p>
            {docForm.customDocs.length > 0 ? (
              <ul className="flex flex-col gap-1.5">
                {docForm.customDocs.map((doc) => (
                  <li
                    key={doc}
                    className="flex min-h-10 items-center justify-between gap-2 rounded-lg border bg-zinc-50/60 px-3 py-1.5 dark:bg-zinc-900/40"
                  >
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <FileText className="size-3.5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                      <span className="truncate">{doc}</span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8 shrink-0 text-muted-foreground hover:text-rose-600"
                      onClick={() => removeCustomDoc(doc)}
                      disabled={!canMutate || savingDocs}
                      aria-label={`Hapus dokumen ${doc}`}
                    >
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                Belum ada dokumen tambahan.
              </p>
            )}
            <div className="flex items-center gap-2">
              <Input
                value={newDoc}
                onChange={(e) => setNewDoc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomDoc();
                  }
                }}
                placeholder="Nama dokumen, mis. KTP"
                className="h-11 sm:flex-1"
                maxLength={CUSTOM_DOC_MAX_LEN}
                disabled={!canMutate || savingDocs || docForm.customDocs.length >= MAX_CUSTOM_DOCS}
                aria-label="Nama dokumen baru"
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 shrink-0 sm:h-10"
                onClick={addCustomDoc}
                disabled={
                  !canMutate ||
                  savingDocs ||
                  docForm.customDocs.length >= MAX_CUSTOM_DOCS
                }
              >
                <Plus className="size-4" aria-hidden="true" />
                Tambah
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t pt-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" aria-hidden="true" />
              {docsDirty ? "Ada perubahan belum disimpan." : "Semua perubahan tersimpan."}
            </p>
            <Button
              onClick={() => void saveDocs()}
              disabled={!canMutate || savingDocs || !docsDirty}
              className="min-w-28"
            >
              {savingDocs ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : (
                "Simpan"
              )}
            </Button>
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
                <Badge variant="secondary">{position.screeningQuestions.length} pertanyaan screening</Badge>
                {position.customDocs.length > 0 ? (
                  <Badge variant="secondary">{position.customDocs.length} dokumen tambahan</Badge>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              className="mx-auto min-h-11 sm:min-h-10"
              onClick={() => setEditOpen(true)}
              disabled={!canMutate}
            >
              <Pencil className="size-4" aria-hidden="true" />
              Edit Konten Lengkap
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
