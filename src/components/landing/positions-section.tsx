"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
  Check,
  Eye,
  Flame,
  FolderOpen,
  MapPin,
  Pin,
  SearchX,
  Sparkles,
  Timer,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Position, PositionPublicStats } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useLang } from "@/components/landing/lang-context";
import {
  HoverLift,
  ROSE_BADGE,
  Container,
  FadeIn,
} from "@/components/landing/primitives";
import {
  fillTemplate,
  isPastIso,
  isWithinDaysAhead,
  isWithinDaysBack,
} from "@/components/landing/landing-utils";
import { DeadlineCountdownCompact } from "@/components/landing/deadline-countdown";
import { cn } from "@/lib/utils";

// Chip status (palet zinc/rose/amber/orange — tanpa biru/indigo/violet).
const CHIP_URGENT = "border-transparent bg-rose-600 text-white";
const CHIP_AMBER =
  "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400";
const CHIP_ORANGE =
  "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-400";
const CHIP_ZINC =
  "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";
const CHIP_FEATURED = "border-transparent bg-amber-500 text-zinc-950";
const CHIP_MUTED = "border-transparent bg-muted text-muted-foreground";

const MAX_STATUS_CHIPS = 3;
const MAX_BENEFIT_PREVIEW = 2;

type StatusChip = {
  key: string;
  label: string;
  className: string;
  Icon: LucideIcon;
};

/** Badge featured (Pin "Unggulan") + chip status otomatis, maks 3 chip + "+n". */
function PositionBadges({
  position,
  stats,
  className,
}: {
  position: Position;
  stats?: PositionPublicStats;
  className?: string;
}) {
  const { t } = useLang();

  const remaining = stats?.remainingQuota ?? null;
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
    ...(position.closesAt && isWithinDaysAhead(position.closesAt, 3)
      ? [
          {
            key: "closing-soon",
            label: t.positions.segeraDitutup,
            className: CHIP_ORANGE,
            Icon: Timer,
          },
        ]
      : []),
    ...(remaining === 0
      ? [
          {
            key: "quota-full",
            label: t.positions.kuotaPenuh,
            className: CHIP_ZINC,
            Icon: Users,
          },
        ]
      : []),
    ...(remaining !== null && remaining > 0 && remaining <= 3
      ? [
          {
            key: "quota-low",
            label: fillTemplate(t.positions.sisaKuota, { n: remaining }),
            className: CHIP_AMBER,
            Icon: Users,
          },
        ]
      : []),
  ];

  if (!position.featured && chips.length === 0) return null;

  const visibleChips = chips.slice(0, MAX_STATUS_CHIPS);
  const hiddenCount = chips.length - visibleChips.length;

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
        <Badge className={CHIP_MUTED} variant="outline">
          {fillTemplate(t.positions.chipMore, { n: hiddenCount })}
        </Badge>
      ) : null}
    </div>
  );
}

/** Chip gaji (bila gaji ditampilkan): ikon Wallet + teks gaji. */
function SalaryBadge({ position }: { position: Position }) {
  const { t } = useLang();
  if (!position.salaryVisible || !position.salaryText) return null;
  return (
    <Badge
      variant="secondary"
      className="rounded-full"
      title={t.positions.gaji}
      aria-label={t.positions.gaji}
    >
      <Wallet className="h-3 w-3" aria-hidden="true" />
      {position.salaryText}
    </Badge>
  );
}

function PositionCard({
  position,
  stats,
  onOpenPosition,
}: {
  position: Position;
  stats?: PositionPublicStats;
  /** Buka halaman detail per lowongan (?posisi=slug) — tombol selalu tampil. */
  onOpenPosition: (slug: string) => void;
}) {
  const { t, lang } = useLang();

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
  const closed = position.closesAt ? isPastIso(position.closesAt) : false;
  const applyDisabled = quotaFull || closed;
  const applyLabel = quotaFull
    ? t.positions.kuotaPenuh
    : closed
      ? t.positions.lamarDitutup
      : t.positions.apply;
  const hasCover = Boolean(position.coverFileId);

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
          <PositionBadges position={position} stats={stats} className="mt-2" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{position.type}</Badge>
            <Badge variant="secondary" className="gap-1">
              <MapPin className="h-3 w-3" aria-hidden="true" />
              {position.location}
            </Badge>
            <SalaryBadge position={position} />
          </div>
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

        {displayRequirements.length > 0 ? (
          <ul className="space-y-2">
            {displayRequirements.slice(0, 3).map((requirement, index) => (
              <li
                key={`${position.id}-req-${index}`}
                className="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <Check
                  className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span>{requirement}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            {t.positions.reqFallback}
          </p>
        )}

        {position.closesAt && !closed ? (
          <DeadlineCountdownCompact deadline={position.closesAt} />
        ) : null}

        <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
          <span className="text-xs text-muted-foreground">
            {displayRequirements.length > 0
              ? `${displayRequirements.length} ${t.positions.requirementsCount}`
              : ""}
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

export function PositionsSection({
  positions,
  onOpenPosition,
  positionStats = {},
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
}) {
  const { t } = useLang();
  const [department, setDepartment] = useState<string | null>(null);
  const [jobType, setJobType] = useState<string | null>(null);

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

  const filtered = sortedPositions.filter(
    (p) =>
      (department === null || p.department === department) &&
      (jobType === null || p.type === jobType),
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
          <FadeIn className="mt-10">
            <Card className="items-center gap-3 rounded-2xl p-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                <FolderOpen className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="font-semibold">{t.positions.emptyTitle}</p>
              <p className="text-sm text-muted-foreground">
                {t.positions.emptyBody}
              </p>
            </Card>
          </FadeIn>
        ) : (
          <>
            <FadeIn className="mt-8 space-y-3">
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
              <div
                role="group"
                aria-label={t.positions.typeLabel}
                className="flex flex-wrap items-center gap-2"
              >
                {jobTypes.map((type) => (
                  <FilterChip
                    key={type}
                    active={jobType === type}
                    onClick={() => setJobType(jobType === type ? null : type)}
                    ariaLabel={`${t.positions.typeLabel}: ${type}`}
                  >
                    <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                    {type}
                  </FilterChip>
                ))}
              </div>
            </FadeIn>

            {filtered.length === 0 ? (
              <FadeIn className="mt-8">
                <Card className="items-center gap-3 rounded-2xl p-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <SearchX className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <p className="font-semibold">{t.positions.filterEmptyTitle}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.positions.filterEmptyBody}
                  </p>
                </Card>
              </FadeIn>
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
