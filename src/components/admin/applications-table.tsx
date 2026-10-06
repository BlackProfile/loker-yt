"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Bell, Eye, MessageCircle, Share2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  HOLD_REASON_LABELS,
  type Application,
  type DocExpiry,
  type Position,
} from "@/lib/types";
import { stageLabel } from "@/lib/stages";
import { apiGet } from "./api";
import { cn } from "@/lib/utils";
import {
  daysUntil,
  formatDate,
  formatRupiah,
  formatShortDateTime,
} from "./format";
import { StatusBadge, AiScoreBadge, DomisiliChip } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { useTagDefs } from "./use-tag-defs";
// NR38-B — avatar inisial + meta umur tahap + chip gaji vs range.
import { ApplicantAvatar } from "./applicant-avatar";
import { agingDotClass, agingToneFrom, shortDuration } from "./stage-meta";
import {
  ageOf,
  stageAgeBasis,
  type ApplicationRow,
} from "./applicant-row-types";
import {
  ApplicantCardGrid,
  NewBadge,
  SalaryVerdictChip,
} from "./applicant-card-grid";

/** Mode kepadatan tabel: "compact" (padat) atau "cozy" (nyaman). */
export type TableDensity = "compact" | "cozy";

// Baris template dari /api/admin/templates (dipakai untuk pesan WhatsApp).
type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  body: string;
};

// Pesan default bila belum ada template OFFER di pustaka.
const WA_FALLBACK_TEMPLATE =
  "Halo {nama}, kami dari Lumina Studio terkait lamaran {posisi} kamu.";

/**
 * Normalisasi nomor WhatsApp ke format internasional tanpa "+" (basis 62):
 * strip non-digit; awalan "0" diganti "62"; awalan "8" diberi "62";
 * selain itu dibiarkan (mis. sudah 62... atau kode negara lain).
 */
function normalizeWaNumber(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

/** Isi variabel {nama} / {posisi} pada template; variabel lain dibiarkan. */
function fillWaTemplate(template: string, app: Application): string {
  return template
    .split("{nama}")
    .join(app.name)
    .split("{posisi}")
    .join(app.positionTitle ?? "posisi");
}

/** Badge "Diarsip" kecil (zinc outline) untuk lamaran yang diarsipkan. */
function ArchivedBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-zinc-300 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      title="Lamaran diarsipkan (tidak aktif diproses)"
    >
      Diarsip
    </span>
  );
}

/** Badge "Duplikat" kecil (amber) untuk lamaran ganda. */
function DuplicateBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      title="Lamaran ganda terdeteksi (email/CV sama)"
    >
      Duplikat
    </span>
  );
}

/** Chip/badge mini serbaguna — pola sama dengan DuplicateBadge di atas. */
function MiniChip({
  className,
  title,
  children,
}: {
  className: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        className
      )}
      title={title}
    >
      {children}
    </span>
  );
}

/** Badge "Ditahan" (amber) untuk lamaran yang di-HOLD — NR-24 fitur 8. */
function HoldBadge({ app }: { app: Application }) {
  const bits: string[] = ["Lamaran ditahan"];
  if (app.holdReason) bits.push(HOLD_REASON_LABELS[app.holdReason]);
  if (app.holdNote?.trim()) bits.push(app.holdNote.trim());
  return (
    <MiniChip
      className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      title={bits.join(" — ")}
    >
      Ditahan
    </MiniChip>
  );
}

/** Badge "Do-not-hire" (rose) — pelamar tidak direkrut — NR-24 fitur 15. */
function DoNotHireBadge({ app }: { app: Application }) {
  return (
    <MiniChip
      className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
      title={
        app.doNotHireReason?.trim()
          ? `Do-not-hire: ${app.doNotHireReason.trim()}`
          : "Pelamar ditandai do-not-hire"
      }
    >
      Do-not-hire
    </MiniChip>
  );
}

/** Badge tindak lanjut jatuh tempo (amber, ikon Bell) — NR-24 fitur 4. */
function FollowUpBadge({ app }: { app: Application }) {
  return (
    <MiniChip
      className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      title={`Tindak lanjut jatuh tempo — ${formatShortDateTime(app.followUpAt)}`}
    >
      <Bell className="size-3" aria-hidden="true" />
      {`Tindak lanjut: ${formatShortDateTime(app.followUpAt)}`}
    </MiniChip>
  );
}

/** Badge dokumen mau kedaluwarsa <= 30 hari (rose) — NR-24 fitur 13. */
function DocExpiryBadge({ docs }: { docs: DocExpiry[] }) {
  return (
    <MiniChip
      className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-400"
      title={`Dokumen mau kedaluwarsa (maks. 30 hari): ${docs
        .map((d) => d.label)
        .join(", ")}`}
    >
      {"Dokumen <30 hr"}
    </MiniChip>
  );
}

/** Tindak lanjut sudah jatuh tempo (hari ini atau terlewat)? NR-24 fitur 4. */
function isFollowUpDue(app: Application): boolean {
  if (!app.followUpAt) return false;
  const days = daysUntil(app.followUpAt);
  return days !== null && days <= 0;
}

/** Dokumen yang berakhir dalam 30 hari (atau sudah lewat). NR-24 fitur 13. */
function expiringDocs(app: Application): DocExpiry[] {
  return (app.docExpiries ?? []).filter((doc) => {
    const days = daysUntil(doc.expiresAt);
    return days !== null && days <= 30;
  });
}

/**
 * Chip ekspektasi gaji pelamar vs rentang gaji posisi — NR-24 fitur 6.
 * Sesuai = emerald, di atas = amber, di bawah / tanpa rentang = zinc.
 */
function SalaryChip({ app, position }: { app: Application; position: Position | null }) {
  const expectation = app.salaryExpectation;
  if (expectation == null) return null;
  const min = position?.salaryMin ?? null;
  const max = position?.salaryMax ?? null;
  const expectationText = formatRupiah(expectation);

  // Tanpa rentang (posisi tidak ditemukan / salaryMin & salaryMax kosong).
  if (min == null && max == null) {
    return (
      <MiniChip
        className="bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        title={`Ekspektasi: ${expectationText}`}
      >
        {`Ekspektasi: ${expectationText}`}
      </MiniChip>
    );
  }

  const rangeText =
    min != null && max != null
      ? `rentang ${formatRupiah(min)}\u2013${formatRupiah(max)}`
      : min != null
        ? `rentang minimal ${formatRupiah(min)}`
        : `rentang maksimal ${formatRupiah(max)}`;
  const title = `Ekspektasi: ${expectationText} (${rangeText})`;

  if (max != null && expectation > max) {
    return (
      <MiniChip
        className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400"
        title={title}
      >
        Di atas rentang
      </MiniChip>
    );
  }
  if (min != null && expectation < min) {
    return (
      <MiniChip
        className="bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        title={title}
      >
        Di bawah rentang
      </MiniChip>
    );
  }
  return (
    <MiniChip
      className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
      title={title}
    >
      Sesuai rentang
    </MiniChip>
  );
}

export function ApplicationsTable({
  applications,
  positions = [],
  canMutate,
  currentUserId,
  onToggleStar,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  compareIds,
  onToggleCompare,
  onOpenDetail,
  onDeleteRequest,
  onRate,
  density = "cozy",
  cardMode = false,
}: {
  applications: ApplicationRow[];
  /** Daftar posisi untuk cek ekspektasi gaji vs rentang wajar (NR-24). */
  positions?: Position[];
  canMutate: boolean;
  /** NR38-B fitur 5: kepadatan tabel — padat menyembunyikan kolom Sumber/Tags/NIK/Gaji. */
  density?: TableDensity;
  /** NR38-B fitur 9: mode kartu menggantikan tabel & daftar mobile. */
  cardMode?: boolean;
  /** NR-24 fitur 2: id admin aktif — untuk cek starredBy milik siapa. */
  currentUserId: string;
  /** NR-24 fitur 2: toggle bintang personal (state optimistik di induk). */
  onToggleStar: (app: Application) => void;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  compareIds: string[];
  onToggleCompare: (app: Application) => void;
  onOpenDetail: (app: Application) => void;
  onDeleteRequest: (app: Application) => void;
  onRate: (app: Application, rating: number) => void;
}) {
  // Cache pesan WhatsApp (body template OFFER pertama) — dimuat sekali saat pertama dipakai.
  const waTemplateRef = useRef<string | null>(null);

  // NR-24 fitur 3: warna chip tag dari definisi tag tim (useTagDefs).
  const { colorClassOf } = useTagDefs();
  // NR-24 fitur 6: peta posisi utk chip ekspektasi gaji.
  const positionById = useMemo(
    () => new Map(positions.map((p) => [p.id, p])),
    [positions]
  );

  const allSelected =
    applications.length > 0 &&
    applications.every((a) => selectedIds.has(a.id));

  function tagsPreview(tags: string[]): string[] {
    return tags.slice(0, 2);
  }

  /** Muat (sekali, lalu cache) body template OFFER pertama dari pustaka template. */
  async function loadWaTemplate(): Promise<string> {
    if (waTemplateRef.current !== null) return waTemplateRef.current;
    try {
      const rows = await apiGet<TemplateRow[]>("/api/admin/templates");
      const firstOffer = rows.find((t) => t.kind === "OFFER");
      waTemplateRef.current = firstOffer?.body ?? "";
    } catch {
      waTemplateRef.current = "";
    }
    return waTemplateRef.current;
  }

  /** Buka WhatsApp dengan pesan dari template OFFER (variabel ringkas diisi). */
  async function handleWhatsApp(app: Application) {
    const normalized = normalizeWaNumber(app.phone ?? "");
    if (!normalized) {
      toast.error("Nomor WhatsApp pelamar tidak valid.");
      return;
    }
    const template = (await loadWaTemplate()) || WA_FALLBACK_TEMPLATE;
    const message = fillWaTemplate(template, app);
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  // NR38-B fitur 5 — kepadatan: padat = padding sel py-1.5 + kolom Sumber/Tags/NIK/Gaji disembunyikan.
  const isCompact = density === "compact";
  const pad = isCompact ? "px-4 py-1.5" : "px-4 py-3";
  const padHead = isCompact ? "px-4 py-2" : "px-4 py-3";

  // NR38-B fitur 9 — mode kartu menggantikan tabel desktop & daftar mobile.
  if (cardMode) {
    return (
      <ApplicantCardGrid
        applications={applications}
        canMutate={canMutate}
        currentUserId={currentUserId}
        selectedIds={selectedIds}
        onToggleSelect={onToggleSelect}
        onToggleStar={onToggleStar}
        onOpenDetail={onOpenDetail}
      />
    );
  }

  return (
    <>
      {/* Desktop: table */}
      <Card className="hidden gap-0 overflow-hidden rounded-2xl py-0 md:block">
        <Table className="min-w-[1160px]">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className={cn("w-10", padHead)}>
                <Checkbox
                  checked={allSelected}
                  disabled={!canMutate}
                  onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
                  aria-label="Pilih semua pelamar"
                />
              </TableHead>
              {/* Kolom bintang "Tandai penting" (NR-24 fitur 2). */}
              <TableHead className={cn("w-10", isCompact ? "px-2 py-2" : "px-2 py-3")}>
                <span className="sr-only">Ditandai</span>
              </TableHead>
              <TableHead className={cn("w-10 text-center text-xs", isCompact ? "px-2 py-2" : "px-2 py-3")}>
                Bandingkan
              </TableHead>
              <TableHead className="px-4 py-3">Pelamar</TableHead>
              <TableHead className="px-4 py-3">Posisi</TableHead>
              {/* NR-32 — Data Diri Lengkap: NIK & umur pelamar */}
              <TableHead className="px-4 py-3">NIK</TableHead>
              <TableHead className="px-4 py-3">Umur</TableHead>
              <TableHead className="px-4 py-3">Sumber</TableHead>
              <TableHead className="px-4 py-3">Skor AI</TableHead>
              <TableHead className="px-4 py-3">Rating</TableHead>
              <TableHead className="px-4 py-3">Tags</TableHead>
              <TableHead className="px-4 py-3">Tanggal</TableHead>
              <TableHead className="px-4 py-3">Status</TableHead>
              <TableHead className="px-4 py-3 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.map((app) => {
              const isSelected = selectedIds.has(app.id);
              const isCompared = compareIds.includes(app.id);
              const isStarred = app.starredBy?.includes(currentUserId) ?? false;
              const position = app.positionId
                ? positionById.get(app.positionId) ?? null
                : null;
              const dueDocs = expiringDocs(app);
              // NR-28 (item 12): hover halus + group utk reveal aksi sekunder.
              // transition-colors & hover dasar sudah ada di TableRow (ui/table).
              return (
                <TableRow
                  key={app.id}
                  data-state={isSelected ? "selected" : undefined}
                  className="group md:hover:bg-zinc-50/70 md:dark:hover:bg-zinc-900/40"
                >
                  <TableCell className="px-4 py-3">
                    <Checkbox
                      checked={isSelected}
                      disabled={!canMutate}
                      onCheckedChange={(checked) =>
                        onToggleSelect(app.id, checked === true)
                      }
                      aria-label={`Pilih ${app.name}`}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-3">
                    <div className="flex justify-center">
                      {canMutate ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 hover:text-amber-600 dark:hover:text-amber-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleStar(app);
                          }}
                          title="Tandai penting"
                          aria-pressed={isStarred}
                          aria-label={
                            isStarred
                              ? `Hapus tanda penting dari ${app.name}`
                              : `Tandai penting ${app.name}`
                          }
                        >
                          <Star
                            className={cn(
                              "size-4",
                              isStarred
                                ? "fill-amber-400 text-amber-500"
                                : "text-muted-foreground/60"
                            )}
                            aria-hidden="true"
                          />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-3">
                    <div className="flex justify-center">
                      <Checkbox
                        checked={isCompared}
                        onCheckedChange={() => onToggleCompare(app)}
                        aria-label={`Bandingkan ${app.name}`}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-56 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                          // NR-28 (item 7): warna avatar deterministik dari nama.
                          avatarToneOf(app.name)
                        )}
                      >
                        {initialsOf(app.name)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="max-w-40 truncate text-sm font-semibold">
                            {app.name}
                          </span>
                          {app.isDuplicate === true ? <DuplicateBadge /> : null}
                          {app.archivedAt ? <ArchivedBadge /> : null}
                          {app.doNotHire ? <DoNotHireBadge app={app} /> : null}
                          {app.holdAt ? <HoldBadge app={app} /> : null}
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {app.email}
                          {app.phone ? ` · ${app.phone}` : ""}
                        </p>
                        {app.domisili?.trim() || app.komuterPlan ? (
                          <div className="mt-1">
                            <DomisiliChip
                              domisili={app.domisili}
                              komuterPlan={app.komuterPlan}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-36 px-4 py-3 text-sm">
                    <div className="flex flex-col gap-1">
                      <span className="truncate">{app.positionTitle ?? "-"}</span>
                      {/* Chip ekspektasi gaji vs rentang posisi (NR-24 fitur 6). */}
                      <SalaryChip app={app} position={position} />
                    </div>
                  </TableCell>
                  {/* NR-32 — NIK & umur (item inti Data Diri; "-" bila kosong). */}
                  <TableCell className="px-4 py-3 text-sm">
                    {app.nik ? (
                      <span className="font-mono text-xs" title="NIK pelamar">
                        {app.nik}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm whitespace-nowrap">
                    {(() => {
                      const age = ageOf(app.birthDate);
                      return age ? (
                        <span title={`Tanggal lahir: ${formatDate(app.birthDate)}`}>{age}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      );
                    })()}
                  </TableCell>
                  <TableCell className="max-w-32 px-4 py-3">
                    {app.source ? (
                      <span
                        className="inline-flex max-w-28 items-center gap-1.5 text-xs text-muted-foreground"
                        title={`Sumber: ${app.source}`}
                      >
                        <Share2 className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{app.source}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <AiScoreBadge score={app.aiScore} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <RatingStars
                      value={app.rating}
                      size="size-3.5"
                      onChange={canMutate ? (n) => onRate(app, n) : undefined}
                      disabled={!canMutate}
                      ariaLabel={`Rating ${app.name}`}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tagsPreview(app.tags).map((tag) => (
                        <span
                          key={tag}
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-medium",
                            colorClassOf(tag)
                          )}
                        >
                          {tag}
                        </span>
                      ))}
                      {app.tags.length > 2 ? (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                          +{app.tags.length - 2}
                        </span>
                      ) : null}
                      {app.tags.length === 0 ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                    {formatDate(app.createdAt)}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusBadge status={app.status} />
                      {/* Badge NR-24: tindak lanjut jatuh tempo + dokumen mau kedaluwarsa. */}
                      {isFollowUpDue(app) ? <FollowUpBadge app={app} /> : null}
                      {dueDocs.length > 0 ? <DocExpiryBadge docs={dueDocs} /> : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        onClick={() => onOpenDetail(app)}
                        aria-label={`Lihat detail lamaran ${app.name}`}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                        Detail
                      </Button>
                      {app.phone?.trim() ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 dark:text-emerald-400 dark:hover:bg-emerald-950"
                          onClick={() => void handleWhatsApp(app)}
                          aria-label={`Kirim WhatsApp ke ${app.name}`}
                          title="Kirim WhatsApp"
                        >
                          <MessageCircle className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                      {canMutate ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 md:opacity-0 md:transition-opacity md:duration-150 md:group-hover:opacity-100 md:group-focus-within:opacity-100 focus-visible:opacity-100 dark:hover:bg-rose-950"
                          onClick={() => onDeleteRequest(app)}
                          aria-label={`Hapus lamaran ${app.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile: daftar card */}
      <div className="flex flex-col gap-3 md:hidden">
        {applications.map((app) => {
          const isSelected = selectedIds.has(app.id);
          const isCompared = compareIds.includes(app.id);
          const isStarred = app.starredBy?.includes(currentUserId) ?? false;
          const position = app.positionId
            ? positionById.get(app.positionId) ?? null
            : null;
          const dueDocs = expiringDocs(app);
          return (
            <Card
              key={app.id}
              className="gap-0 rounded-2xl p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="px-0">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    disabled={!canMutate}
                    onCheckedChange={(checked) =>
                      onToggleSelect(app.id, checked === true)
                    }
                    aria-label={`Pilih ${app.name}`}
                    className="mt-1"
                  />
                  <span
                    className={cn(
                      "flex size-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      // NR-28 (item 7): warna avatar deterministik dari nama.
                      avatarToneOf(app.name)
                    )}
                  >
                    {initialsOf(app.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="max-w-40 truncate text-sm font-semibold">
                        {app.name}
                      </span>
                      {app.isDuplicate === true ? <DuplicateBadge /> : null}
                      {app.archivedAt ? <ArchivedBadge /> : null}
                      {app.doNotHire ? <DoNotHireBadge app={app} /> : null}
                      {app.holdAt ? <HoldBadge app={app} /> : null}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.email}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {app.positionTitle ?? "-"} · {formatDate(app.createdAt)}
                    </p>
                    {/* NR-32 — NIK & umur ringkas di kartu mobile (bila ada). */}
                    {app.nik || ageOf(app.birthDate) ? (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {app.nik ? `NIK ${app.nik}` : ""}
                        {app.nik && ageOf(app.birthDate) ? " · " : ""}
                        {ageOf(app.birthDate) ?? ""}
                      </p>
                    ) : null}
                    {/* Chip ekspektasi gaji vs rentang posisi (NR-24 fitur 6). */}
                    {app.salaryExpectation != null ? (
                      <div className="mt-1">
                        <SalaryChip app={app} position={position} />
                      </div>
                    ) : null}
                    {app.source ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Share2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{app.source}</span>
                      </p>
                    ) : null}
                    {app.domisili?.trim() || app.komuterPlan ? (
                      <div className="mt-1.5">
                        <DomisiliChip
                          domisili={app.domisili}
                          komuterPlan={app.komuterPlan}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={app.status} />
                    {/* Badge NR-24: tindak lanjut jatuh tempo + dokumen. */}
                    {isFollowUpDue(app) ? <FollowUpBadge app={app} /> : null}
                    {dueDocs.length > 0 ? <DocExpiryBadge docs={dueDocs} /> : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <AiScoreBadge score={app.aiScore} />
                  <RatingStars
                    value={app.rating}
                    size="size-3.5"
                    onChange={canMutate ? (n) => onRate(app, n) : undefined}
                    disabled={!canMutate}
                    ariaLabel={`Rating ${app.name}`}
                  />
                  {app.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        colorClassOf(tag)
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={isCompared}
                      onCheckedChange={() => onToggleCompare(app)}
                      aria-label={`Bandingkan ${app.name}`}
                    />
                    Bandingkan
                  </label>
                  {/* Toggle bintang personal (NR-24 fitur 2). */}
                  {canMutate ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0 hover:text-amber-600 dark:hover:text-amber-400"
                      onClick={() => onToggleStar(app)}
                      title="Tandai penting"
                      aria-pressed={isStarred}
                      aria-label={
                        isStarred
                          ? `Hapus tanda penting dari ${app.name}`
                          : `Tandai penting ${app.name}`
                      }
                    >
                      <Star
                        className={cn(
                          "size-5",
                          isStarred
                            ? "fill-amber-400 text-amber-500"
                            : "text-muted-foreground/60"
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  ) : null}
                  {app.phone?.trim() ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 sm:h-10 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      onClick={() => void handleWhatsApp(app)}
                    >
                      <MessageCircle className="size-4" aria-hidden="true" />
                      WhatsApp
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-10"
                    onClick={() => onOpenDetail(app)}
                  >
                    <Eye className="size-4" aria-hidden="true" />
                    Detail
                  </Button>
                  {canMutate ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-10 dark:hover:bg-rose-950"
                      onClick={() => onDeleteRequest(app)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Hapus
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
