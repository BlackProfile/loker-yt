"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  Eye,
  Flame,
  Laptop,
  MapPin,
  Pin,
  RotateCw,
  Sparkles,
  Timer,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Position, PositionPublicStats } from "@/lib/types";
import { WORK_MODES, WORK_MODE_LABELS, type WorkMode } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLang } from "@/components/landing/lang-context";
import {
  HoverLift,
  ROSE_BADGE,
  Container,
  FadeIn,
} from "@/components/landing/primitives";
import { EmptyJobsState } from "@/components/landing/empty-jobs";
import {
  fillTemplate,
  isPastIso,
  isWithinDaysAhead,
  isWithinDaysBack,
} from "@/components/landing/landing-utils";
import { DeadlineCountdownCompact } from "@/components/landing/deadline-countdown";
import { cn } from "@/lib/utils";

// Chip status (palet zinc/rose/amber — tanpa biru/indigo/violet).
// NR62 — CHIP_ORANGE dihapus: semua nuansa oranye dilebur ke CHIP_AMBER.
const CHIP_URGENT = "border-transparent bg-rose-600 text-white";
const CHIP_AMBER =
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400";
const CHIP_ZINC =
  "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
const CHIP_FEATURED = "border-transparent bg-amber-500 text-zinc-950";
const CHIP_MUTED = "border-transparent bg-muted text-muted-foreground";

// NR62 — maks 2 chip urgensi (Urgent > Segera Ditutup > Baru) + "Unggulan";
// sisanya tampil sebagai chip muted "+n" ber-tooltip.
const MAX_STATUS_CHIPS = 2;
const MAX_BENEFIT_PREVIEW = 2;

type StatusChip = {
  key: string;
  label: string;
  className: string;
  Icon: LucideIcon;
};

/** Badge featured (Pin "Unggulan") + chip status otomatis, maks 3 chip + "+n".
 * NR-28-A: chip kuota dipindah ke meter kuota di badan kartu (lihat QuotaMeter
 * pada PositionCard) agar informasi kuota tampil satu kali dan lebih visual. */
function PositionBadges({
  position,
  className,
}: {
  position: Position;
  className?: string;
}) {
  const { t } = useLang();

  // Urutan prioritas: Urgent > Segera Ditutup > Baru (NR62).
  const chips: StatusChip[] = [
    ...(position.urgent
      ? [
          {
            key: "urgent",
            label: t.positions.urgent,
            className: CHIP_URGENT,
            Icon: Flame,
          },
        ]
      : []),
    ...(position.closesAt && isWithinDaysAhead(position.closesAt, 3)
      ? [
          {
            key: "closing-soon",
            label: t.positions.segeraDitutup,
            className: CHIP_AMBER,
            Icon: Timer,
          },
        ]
      : []),
    ...(isWithinDaysBack(position.createdAt, 7)
      ? [
          {
            key: "baru",
            label: t.positions.baru,
            className: CHIP_AMBER,
            Icon: Sparkles,
          },
        ]
      : []),
  ];

  if (!position.featured && chips.length === 0) return null;

  const visibleChips = chips.slice(0, MAX_STATUS_CHIPS);
  const hiddenChips = chips.slice(MAX_STATUS_CHIPS);
  const hiddenCount = hiddenChips.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {position.featured ? (
        <Badge className={CHIP_FEATURED} variant="outline">
          <Pin className="h-3 w-3" aria-hidden="true" />
          {t.positions.featured}
        </Badge>
      ) : null}
      {visibleChips.map((chip) => (
        <Badge key={chip.key} className={chip.className} variant="outline">
          <chip.Icon className="h-3 w-3" aria-hidden="true" />
          {chip.label}
        </Badge>
      ))}
      {hiddenCount > 0 ? (
        <Badge
          className={CHIP_MUTED}
          variant="outline"
          title={hiddenChips.map((chip) => chip.label).join(" · ")}
        >
          {fillTemplate(t.positions.chipMore, { n: hiddenCount })}
        </Badge>
      ) : null}
    </div>
  );
}

/** Badge mode kerja (fitur non-remote): emerald=Remote, amber=On-site, rose=Hybrid. */
const WORK_MODE_BADGE: Record<WorkMode, string> = {
  REMOTE:
    "border-transparent bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400",
  ONSITE:
    "border-transparent bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/20 dark:text-amber-400",
  HYBRID:
    "border-transparent bg-rose-500/10 text-rose-700 ring-1 ring-inset ring-rose-500/20 dark:text-rose-400",
};

/** Badge mode kerja + kota (mis. "On-site · Jakarta") — dipakai kartu posisi, embed, & header detail. */
export function WorkModeBadge({
  position,
  className,
}: {
  position: Position;
  className?: string;
}) {
  const mode = position.workMode;
  if (!mode || !(mode in WORK_MODE_LABELS)) return null;
  const city = position.city?.trim() || null;
  return (
    <Badge
      variant="outline"
      className={cn("gap-1", WORK_MODE_BADGE[mode], className)}
      title={city ? `${WORK_MODE_LABELS[mode]} · ${city}` : WORK_MODE_LABELS[mode]}
    >
      {WORK_MODE_LABELS[mode]}
      {city ? <span className="opacity-70">· {city}</span> : null}
    </Badge>
  );
}

function PositionCard({
  position,
  stats,
  onOpenPosition,
  applyBlocked = false,
}: {
  position: Position;
  stats?: PositionPublicStats;
  /** Buka halaman detail per lowongan (?posisi=slug) — tombol selalu tampil. */
  onOpenPosition: (slug: string) => void;
  /** NR45 — pendaftaran ditutup sementara (mode perawatan APPLY_ONLY). */
  applyBlocked?: boolean;
}) {
  const { t, lang } = useLang();
  // Animasi meter kuota dihentikan bila pengguna memilih reduce-motion.
  const reduceMotion = useReducedMotion();

  // Konten dua bahasa: saat lang "en" dan versi EN terisi (non-kosong),
  // pakai versi EN; selain itu fallback ke versi Indonesia.
  const displayTitle =
    lang === "en" && position.titleEn ? position.titleEn : position.title;
  const displayDescription =
    lang === "en" && position.descriptionEn
      ? position.descriptionEn
      : position.description;
  const displayRequirements =
    lang === "en" && position.requirementsEn.length > 0
      ? position.requirementsEn
      : position.requirements;

  const remaining = stats?.remainingQuota ?? null;
  const quotaFull = remaining === 0;
  // NR-28-A — meter kuota: server menghitung remainingQuota = maxApplicants -
  // lamaran aktif, sehingga total kuota efektif = lamaran aktif + sisa.
  const quotaApps = stats?.applications ?? 0;
  const quotaTotal = remaining !== null ? quotaApps + remaining : null;
  const quotaFilledPct =
    quotaTotal !== null && quotaTotal > 0
      ? Math.min(100, Math.round((quotaApps / quotaTotal) * 100))
      : 0;
  const closed = position.closesAt ? isPastIso(position.closesAt) : false;
  const formClosed = position.applyOpen === false;
  // NR45 — mode perawatan APPLY_ONLY ikut mematikan tombol Lamar.
  const applyDisabled = quotaFull || closed || formClosed || applyBlocked;
  const applyLabel = applyBlocked
    ? t.positions.pendaftaranDitutup
    : quotaFull
    ? t.positions.kuotaPenuh
    : closed
      ? t.positions.lamarDitutup
      : formClosed
        ? t.positions.formClosed
        : t.positions.apply;
  const hasCover = Boolean(position.coverFileId);

  // NR62 — baris meta ringkas SATU baris teks muted dengan pemisah titik:
  // mode kerja+kota · jenis · gaji · N pelamar (maks satu ikon MapPin).
  const activeMode =
    position.workMode && position.workMode in WORK_MODE_LABELS
      ? position.workMode
      : null;
  const city = position.city?.trim() || null;
  const metaParts = [
    activeMode
      ? city && position.workMode !== "REMOTE"
        ? `${WORK_MODE_LABELS[activeMode]} · ${city}`
        : WORK_MODE_LABELS[activeMode]
      : null,
    position.type,
    position.salaryVisible && position.salaryText ? position.salaryText : null,
    stats && stats.applications > 0
      ? fillTemplate(t.positions.applicants, { n: stats.applications })
      : null,
  ].filter((part): part is string => part !== null);

  return (
    <Card
      className={cn(
        "h-full cursor-pointer overflow-hidden rounded-2xl transition-shadow hover:shadow-lg hover:shadow-rose-600/10 dark:hover:shadow-black/30",
        hasCover ? "gap-0 p-0" : "gap-4 p-6",
        position.featured && "ring-1 ring-rose-600/30",
      )}
      onClick={() => onOpenPosition(position.slug ?? position.id)}
    >
      {hasCover ? (
        <img
          src={`/api/files/${position.coverFileId}`}
          alt={fillTemplate(t.positions.coverAlt, { title: displayTitle })}
          loading="lazy"
          className="aspect-[2/1] w-full object-cover"
        />
      ) : null}

      <div className={cn("flex flex-1 flex-col gap-4", hasCover && "p-6")}>
        <div>
          <Badge className={ROSE_BADGE} variant="outline">
            {position.department}
          </Badge>
          <h3 className="mt-3 text-lg font-semibold">{displayTitle}</h3>
          <PositionBadges position={position} className="mt-2" />
          {/* NR62 — meta jadi satu baris teks muted (pengganti 4-5 badge). */}
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate" title={metaParts.join(" · ")}>
              {metaParts.join(" · ")}
            </span>
          </p>
        </div>

        <p className="line-clamp-3 text-sm text-muted-foreground">
          {displayDescription}
        </p>

        {position.benefits.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {position.benefits.slice(0, MAX_BENEFIT_PREVIEW).map((benefit, index) => (
              <Badge
                key={`${position.id}-benefit-${index}`}
                variant="secondary"
                className="rounded-full font-normal"
              >
                {benefit}
              </Badge>
            ))}
            {position.benefits.length > MAX_BENEFIT_PREVIEW ? (
              <span className="text-xs text-muted-foreground">
                {fillTemplate(t.positions.benefitLainnya, {
                  n: position.benefits.length - MAX_BENEFIT_PREVIEW,
                })}
              </span>
            ) : null}
          </div>
        ) : null}

        {/* NR62 — ticker deadline (kiri) + meter kuota (kanan) dalam SATU baris. */}
        {(position.closesAt && !closed) || (quotaTotal !== null && quotaTotal > 0) ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {position.closesAt && !closed ? (
              <DeadlineCountdownCompact deadline={position.closesAt} />
            ) : null}
            {quotaTotal !== null && quotaTotal > 0 ? (
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={quotaFilledPct}
                aria-label={
                  quotaFull
                    ? t.positions.kuotaPenuh
                    : fillTemplate(t.positions.sisaKuota, { n: remaining ?? 0 })
                }
                className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none"
              >
                {quotaFull ? (
                  <Badge variant="outline" className={cn("shrink-0 gap-1", ROSE_BADGE)}>
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {t.positions.kuotaPenuh}
                  </Badge>
                ) : (
                  <Badge variant="outline" className={cn("shrink-0 gap-1", CHIP_ZINC)}>
                    <Users className="h-3 w-3" aria-hidden="true" />
                    {fillTemplate(t.positions.sisaKuota, { n: remaining ?? 0 })}
                  </Badge>
                )}
                <span
                  aria-hidden="true"
                  className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800 sm:w-28"
                >
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-rose-600 to-amber-500"
                    initial={false}
                    animate={{ width: `${quotaFilledPct}%` }}
                    transition={
                      reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }
                    }
                  />
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
          {/* NR62 — bullet persyaratan dihapus dari kartu; hitungan/fallback tetap di sini,
              detail lengkap ada di halaman (?posisi=slug). */}
          <span className="text-xs text-muted-foreground">
            {displayRequirements.length > 0
              ? `${displayRequirements.length} ${t.positions.requirementsCount}`
              : t.positions.reqFallback}
          </span>
          <div className="flex items-center gap-2">
            {/* Selalu tampil: detail kini halaman penuh (?posisi=slug) tempat
                formulir lamaran per lowongan berada. */}
            <Button
              size="sm"
              variant="outline"
              aria-label={`${t.positions.detailAria}: ${position.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenPosition(position.slug ?? position.id);
              }}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t.positions.detail}
            </Button>
            <Button
              size="sm"
              disabled={applyDisabled}
              className="transition-transform hover:scale-[1.04] active:scale-95"
              onClick={(event) => {
                event.stopPropagation();
                onOpenPosition(position.slug ?? position.id);
              }}
            >
              {applyLabel}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function FilterChip({
  active,
  children,
  onClick,
  ariaLabel,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      className="rounded-full"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

type DropdownOption = {
  value: string;
  label: string;
  count: number | null;
};

/**
 * Dropdown filter ringkas: trigger ikon + label (berubah jadi nilai aktif
 * berwarna rose saat terpilih), menu satu-pilih dengan hitungan posisi.
 * Menggantikan baris chip "Semua + opsi" agar panel filter tetap 1 baris.
 */
function FilterDropdown({
  icon: Icon,
  placeholder,
  allLabel,
  options,
  activeValue,
  onClear,
  onSelect,
  triggerAria,
}: {
  icon: LucideIcon;
  /** Label netral saat belum ada pilihan (mis. "Jenis"). */
  placeholder: string;
  /** Opsi pertama menu (mis. "Semua jenis"). */
  allLabel: string;
  options: DropdownOption[];
  activeValue: string | null;
  onClear: () => void;
  onSelect: (value: string) => void;
  triggerAria: string;
}) {
  const activeOption =
    options.find((option) => option.value === activeValue) ?? null;
  const active = activeOption !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={triggerAria}
          className={cn(
            "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            active
              ? "border-rose-600/40 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
              : "border-zinc-200 bg-background text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-background dark:text-zinc-300 dark:hover:bg-zinc-800",
          )}
        >
          <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
          {active ? activeOption.label : placeholder}
          <ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44 rounded-xl">
        <DropdownMenuItem className="gap-2" onSelect={onClear}>
          <Check
            className={cn(
              "h-4 w-4 text-rose-600 dark:text-rose-400",
              !active && "opacity-0",
            )}
            aria-hidden="true"
          />
          <span>{allLabel}</span>
        </DropdownMenuItem>
        {options.map((option) => {
          const isActive = option.value === activeValue;
          return (
            <DropdownMenuItem
              key={option.value}
              className="gap-2"
              onSelect={() => onSelect(option.value)}
            >
              <Check
                className={cn(
                  "h-4 w-4 text-rose-600 dark:text-rose-400",
                  !isActive && "opacity-0",
                )}
                aria-hidden="true"
              />
              <span className="flex-1">{option.label}</span>
              {option.count !== null ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {option.count}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PositionsSection({
  positions,
  onOpenPosition,
  positionStats = {},
  applyBlocked = false,
}: {
  positions: Position[];
  /**
   * Nama situs (dipertahankan di kontrak props — dipakai fitur share yang kini
   * berada di halaman detail per lowongan).
   */
  siteName: string;
  /** Buka halaman detail per lowongan (?posisi=slug) via pushState. */
  onOpenPosition: (slug: string) => void;
  /** Kuota & jumlah lamaran per id posisi (dari PublicContentResponse.positionStats). */
  positionStats?: Record<string, PositionPublicStats>;
  /** NR45 — pendaftaran ditutup sementara (mode perawatan APPLY_ONLY). */
  applyBlocked?: boolean;
}) {
  const { t } = useLang();
  const [department, setDepartment] = useState<string | null>(null);
  const [jobType, setJobType] = useState<string | null>(null);
  const [workMode, setWorkMode] = useState<WorkMode | null>(null);
  const [city, setCity] = useState<string | null>(null);

  // Featured lebih dulu, lalu urutan existing (Array.sort stabil).
  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => Number(b.featured) - Number(a.featured)),
    [positions],
  );

  const departments = useMemo(
    () => Array.from(new Set(sortedPositions.map((p) => p.department))).sort(),
    [sortedPositions],
  );
  const jobTypes = useMemo(
    () => Array.from(new Set(sortedPositions.map((p) => p.type))),
    [sortedPositions],
  );

  // Filter mode kerja (fitur non-remote): opsi dropdown + jumlah posisi.
  const modeOptions = useMemo(
    () =>
      WORK_MODES.map((mode) => ({
        mode,
        count: sortedPositions.filter((p) => p.workMode === mode).length,
      })).filter((chip) => chip.count > 0),
    [sortedPositions],
  );
  // Kota kandidat filter: hanya posisi non-remote yang mencantumkan kota.
  const cities = useMemo(
    () =>
      Array.from(
        new Set(
          sortedPositions.flatMap((p) =>
            p.workMode !== "REMOTE" && p.city?.trim() ? [p.city.trim()] : [],
          ),
        ),
      ).sort(),
    [sortedPositions],
  );

  // Opsi dropdown (nilai + label + hitungan) untuk toolbar filter.
  const typeOptions = useMemo(
    () =>
      jobTypes.map((type) => ({
        value: type,
        label: type,
        count: sortedPositions.filter((p) => p.type === type).length,
      })),
    [jobTypes, sortedPositions],
  );
  const modeDropdownOptions = useMemo(
    () =>
      modeOptions.map(({ mode, count }) => ({
        value: mode,
        label: WORK_MODE_LABELS[mode],
        count,
      })),
    [modeOptions],
  );
  const cityOptions = useMemo(
    () =>
      cities.map((c) => ({
        value: c,
        label: c,
        count: sortedPositions.filter(
          (p) => p.workMode !== "REMOTE" && p.city?.trim() === c,
        ).length,
      })),
    [cities, sortedPositions],
  );
  // NR62 — departemen > 4: baris chip berganti dropdown "Departemen" agar
  // panel filter tetap satu baris ringkas.
  const deptDropdown = departments.length > 4;
  const deptOptions = useMemo(
    () =>
      departments.map((dept) => ({
        value: dept,
        label: dept,
        count: sortedPositions.filter((p) => p.department === dept).length,
      })),
    [departments, sortedPositions],
  );

  const hasActiveFilters =
    department !== null || jobType !== null || workMode !== null || city !== null;
  const resetFilters = () => {
    setDepartment(null);
    setJobType(null);
    setWorkMode(null);
    setCity(null);
  };

  const filtered = sortedPositions.filter(
    (p) =>
      (department === null || p.department === department) &&
      (jobType === null || p.type === jobType) &&
      (workMode === null || p.workMode === workMode) &&
      (city === null || (p.workMode !== "REMOTE" && p.city?.trim() === city)),
  );

  return (
    <section id="posisi" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.positions.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.positions.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.positions.desc}</p>
        </FadeIn>

        {positions.length === 0 ? (
          <EmptyJobsState
            className="mt-10"
            title={t.positions.emptyTitle}
            description={t.positions.emptyBody}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                <RotateCw className="h-4 w-4" aria-hidden="true" />
                {t.status.interview.reload}
              </Button>
            }
          />
        ) : (
          <>
            <FadeIn className="mt-8">
              {/* Panel filter dua lapis: baris 1 kategori (chip, hanya bila
                  departemen <= 4 — NR62: jika lebih, jadi dropdown), baris 2
                  toolbar ringkas (dropdown Departemen/Jenis/Mode/Kota + hitungan
                  hasil + reset). */}
              <div className="space-y-3 rounded-2xl border bg-muted/40 p-3 md:p-4">
                {deptDropdown ? null : (
                  <div
                    role="group"
                    aria-label={t.positions.deptLabel}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <FilterChip
                      active={department === null}
                      onClick={() => setDepartment(null)}
                      ariaLabel={`${t.positions.deptLabel}: ${t.positions.all}`}
                    >
                      {t.positions.all}
                    </FilterChip>
                    {departments.map((dept) => (
                      <FilterChip
                        key={dept}
                        active={department === dept}
                        onClick={() => setDepartment(department === dept ? null : dept)}
                        ariaLabel={`${t.positions.deptLabel}: ${dept}`}
                      >
                        {dept}
                      </FilterChip>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {deptDropdown ? (
                    /* Label "Departemen" hardcode — tidak ada kunci dict yang
                       pas & strings.ts sedang diedit agen paralel (NR62). */
                    <FilterDropdown
                      icon={Building2}
                      placeholder="Departemen"
                      allLabel={t.positions.all}
                      options={deptOptions}
                      activeValue={department}
                      onClear={() => setDepartment(null)}
                      onSelect={setDepartment}
                      triggerAria={t.positions.deptLabel}
                    />
                  ) : null}
                  <FilterDropdown
                    icon={Briefcase}
                    placeholder={t.positions.filterTypeLabel}
                    allLabel={t.positions.allTypes}
                    options={typeOptions}
                    activeValue={jobType}
                    onClear={() => setJobType(null)}
                    onSelect={setJobType}
                    triggerAria={t.positions.typeLabel}
                  />
                  {modeDropdownOptions.length > 0 ? (
                    <FilterDropdown
                      icon={Laptop}
                      placeholder={t.positions.filterModeLabel}
                      allLabel={t.positions.allModes}
                      options={modeDropdownOptions}
                      activeValue={workMode}
                      onClear={() => setWorkMode(null)}
                      onSelect={(value) => setWorkMode(value as WorkMode)}
                      triggerAria={t.positions.modeLabel}
                    />
                  ) : null}
                  {cityOptions.length > 0 ? (
                    <FilterDropdown
                      icon={MapPin}
                      placeholder={t.positions.filterCityLabel}
                      allLabel={t.positions.allCities}
                      options={cityOptions}
                      activeValue={city}
                      onClear={() => setCity(null)}
                      onSelect={setCity}
                      triggerAria={t.positions.cityLabel}
                    />
                  ) : null}
                  <div className="ml-auto flex items-center gap-1.5">
                    <span
                      aria-live="polite"
                      className="hidden text-xs tabular-nums text-muted-foreground sm:inline"
                    >
                      {fillTemplate(t.positions.resultCount, { n: filtered.length })}
                    </span>
                    {hasActiveFilters ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 rounded-full px-2.5 text-muted-foreground hover:text-foreground"
                        onClick={resetFilters}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {t.positions.clearFilters}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </FadeIn>

            {filtered.length === 0 ? (
              <EmptyJobsState
                className="mt-8"
                title={t.positions.filterEmptyTitle}
                description={t.positions.filterEmptyBody}
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" onClick={resetFilters}>
                      {t.positions.resetFilter}
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <motion.div
                layout
                className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {filtered.map((position) => (
                    <motion.div
                      key={position.id}
                      layout
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                      className="h-full"
                    >
                      <HoverLift className="h-full">
                        <PositionCard
                          position={position}
                          stats={positionStats[position.id]}
                          onOpenPosition={onOpenPosition}
                          applyBlocked={applyBlocked}
                        />
                      </HoverLift>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </>
        )}
      </Container>
    </section>
  );
}
