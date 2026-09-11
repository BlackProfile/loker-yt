"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  Briefcase,
  Check,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  Flame,
  FolderOpen,
  Loader2,
  MapPin,
  MessageCircle,
  Pin,
  QrCode,
  SearchX,
  Sparkles,
  Timer,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Position, PositionPublicStats } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/components/landing/lang-context";
import {
  HoverLift,
  ROSE_BADGE,
  Container,
  FadeIn,
} from "@/components/landing/primitives";
import {
  buildPositionUrl,
  fillTemplate,
  formatDateId,
  isPastIso,
  isWithinDaysAhead,
  isWithinDaysBack,
  safeExternalUrl,
  waShareHref,
  youtubeEmbedId,
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
  canApply,
  onApply,
  onOpenDetail,
}: {
  position: Position;
  stats?: PositionPublicStats;
  canApply: boolean; // false = sections.applyForm nonaktif, tombol lamar disembunyikan
  onApply: (positionId: string) => void;
  onOpenDetail: (position: Position) => void;
}) {
  const { t } = useLang();

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
      onClick={() => onOpenDetail(position)}
    >
      {hasCover ? (
        <img
          src={`/api/files/${position.coverFileId}`}
          alt={fillTemplate(t.positions.coverAlt, { title: position.title })}
          loading="lazy"
          className="aspect-[2/1] w-full object-cover"
        />
      ) : null}

      <div className={cn("flex flex-1 flex-col gap-4", hasCover && "p-6")}>
        <div>
          <Badge className={ROSE_BADGE} variant="outline">
            {position.department}
          </Badge>
          <h3 className="mt-3 text-lg font-semibold">{position.title}</h3>
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
          {position.description}
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

        {position.requirements.length > 0 ? (
          <ul className="space-y-2">
            {position.requirements.slice(0, 3).map((requirement, index) => (
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
            {position.requirements.length > 0
              ? `${position.requirements.length} ${t.positions.requirementsCount}`
              : ""}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label={`${t.positions.detailAria}: ${position.title}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenDetail(position);
              }}
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              {t.positions.detail}
            </Button>
            {canApply ? (
              <Button
                size="sm"
                disabled={applyDisabled}
                className="transition-transform hover:scale-[1.04] active:scale-95"
                onClick={(event) => {
                  event.stopPropagation();
                  onApply(position.id);
                }}
              >
                {applyLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** Baris share kit posisi: WhatsApp (caption lengkap + UTM), Salin Link, QR Code. */
function PositionShareRow({
  position,
  siteName,
  onOpenQr,
}: {
  position: Position;
  siteName: string;
  onOpenQr: () => void;
}) {
  const { t } = useLang();

  const shareLink = buildPositionUrl(position, "whatsapp");
  const waCaption = [
    fillTemplate(t.positions.waCaption, { title: position.title, siteName }),
    position.salaryVisible && position.salaryText
      ? position.salaryText
      : null,
    `${t.positions.waDaftar} ${shareLink}`,
  ]
    .filter(Boolean)
    .join(" — ");

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(buildPositionUrl(position, "copy"));
      toast.success(t.positions.salinBerhasil);
    } catch {
      toast.error(t.positions.salinGagal);
    }
  }

  return (
    <div className="rounded-xl border bg-muted/40 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t.positions.bagikan}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
          <a href={waShareHref(waCaption)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            {t.positions.bagikanWa}
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-11 sm:h-9"
          onClick={() => void copyLink()}
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
          {t.positions.bagikanSalin}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-11 sm:h-9"
          onClick={onOpenQr}
        >
          <QrCode className="h-4 w-4" aria-hidden="true" />
          {t.positions.bagikanQr}
        </Button>
      </div>
    </div>
  );
}

/** Isi dialog detail (position pasti non-null di sini agar narrowing TS rapi). */
function PositionDialogInner({
  position,
  siteName,
  stats,
  canApply,
  onApply,
  onOpenQr,
}: {
  position: Position;
  siteName: string;
  stats?: PositionPublicStats;
  canApply: boolean;
  onApply: (positionId: string) => void;
  onOpenQr: () => void;
}) {
  const { t } = useLang();

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

  // Contoh karya: YouTube -> iframe embed, lainnya -> chip link eksternal.
  const exampleEmbeds = position.examples
    .map((url, index) => ({ url, index, ytId: youtubeEmbedId(url) }))
    .filter((item) => item.ytId !== null);
  const exampleLinks = position.examples
    .map((url, index) => ({ url: safeExternalUrl(url), index }))
    .filter((item): item is { url: string; index: number } => item.url !== null);

  const assignmentUrl = position.assignment?.url
    ? safeExternalUrl(position.assignment.url)
    : null;

  return (
    <>
      {hasCover ? (
        <img
          src={`/api/files/${position.coverFileId}`}
          alt={fillTemplate(t.positions.coverAlt, { title: position.title })}
          loading="lazy"
          className="aspect-[2/1] w-full object-cover"
        />
      ) : null}

      <div className="p-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={ROSE_BADGE} variant="outline">
              {position.department}
            </Badge>
            <PositionBadges position={position} stats={stats} />
          </div>
          <DialogTitle className="text-left text-2xl">
            {position.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Badge variant="secondary">{position.type}</Badge>
              <Badge variant="secondary" className="gap-1">
                <MapPin className="h-3 w-3" aria-hidden="true" />
                {position.location}
              </Badge>
              <SalaryBadge position={position} />
              {position.closesAt ? (
                <Badge
                  variant="outline"
                  className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                >
                  {t.positions.closesPrefix}: {formatDateId(position.closesAt)}
                </Badge>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-5">
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t.positions.dialogDescTitle}
            </h4>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
              {position.description}
            </p>
          </div>

          {position.assignment?.title ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="flex items-start gap-2.5">
                <ClipboardList
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300">
                    {t.positions.adaTes}: {position.assignment.title}
                  </p>
                  {position.assignment.note ? (
                    <p className="mt-1 whitespace-pre-line text-amber-700/90 dark:text-amber-200/80">
                      {position.assignment.note}
                    </p>
                  ) : null}
                  {assignmentUrl ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-11 border-amber-300 bg-transparent text-amber-800 hover:bg-amber-100 hover:text-amber-900 sm:h-9 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
                      asChild
                    >
                      <a
                        href={assignmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        {t.positions.bukaTautan}
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {t.positions.dialogReqTitle}
            </h4>
            {position.requirements.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {position.requirements.map((requirement, index) => (
                  <li
                    key={`${position.id}-detail-req-${index}`}
                    className="flex items-start gap-2 text-sm"
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
              <p className="mt-2 text-sm italic text-muted-foreground">
                {t.positions.reqFallback}
              </p>
            )}
          </div>

          {position.benefits.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t.positions.dialogBenefitTitle}
              </h4>
              <ul className="mt-2 space-y-2">
                {position.benefits.map((benefit, index) => (
                  <li
                    key={`${position.id}-detail-benefit-${index}`}
                    className="flex items-start gap-2 text-sm"
                  >
                    <Check
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                      aria-hidden="true"
                    />
                    <span>{benefit}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {position.examples.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t.positions.contohKarya}
              </h4>
              {exampleLinks.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {exampleLinks.map((item) => (
                    <a
                      key={`${position.id}-example-link-${item.index}`}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-full border bg-muted/40 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-h-0"
                    >
                      <ExternalLink
                        className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400"
                        aria-hidden="true"
                      />
                      {new URL(item.url).hostname}
                    </a>
                  ))}
                </div>
              ) : null}
              {exampleEmbeds.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {exampleEmbeds.map((item) => (
                    <iframe
                      key={`${position.id}-example-video-${item.index}`}
                      src={`https://www.youtube-nocookie.com/embed/${item.ytId}?rel=0`}
                      title={`${t.positions.contohKarya} — ${position.title} (${item.index + 1})`}
                      loading="lazy"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                      className="aspect-video w-full rounded-lg border bg-black"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <PositionShareRow
            position={position}
            siteName={siteName}
            onOpenQr={onOpenQr}
          />
        </div>

        {canApply ? (
          <DialogFooter className="mt-6 gap-2 sm:gap-2">
            <DialogClose asChild>
              <Button
                disabled={applyDisabled}
                className="transition-transform hover:scale-[1.04] active:scale-95"
                onClick={() => onApply(position.id)}
              >
                {applyLabel}
              </Button>
            </DialogClose>
          </DialogFooter>
        ) : null}
      </div>
    </>
  );
}

function PositionDetailDialog({
  position,
  siteName,
  stats,
  canApply,
  onClose,
  onApply,
}: {
  position: Position | null;
  siteName: string;
  stats?: PositionPublicStats;
  canApply: boolean;
  onClose: () => void;
  onApply: (positionId: string) => void;
}) {
  const { t } = useLang();
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // Views: hitung 1x per sesi per posisi (fire-and-forget, gagal diam).
  useEffect(() => {
    if (!position) return;
    let viewed = false;
    try {
      const key = `viewed-${position.id}`;
      viewed = window.sessionStorage.getItem(key) === "1";
      if (!viewed) window.sessionStorage.setItem(key, "1");
    } catch {
      viewed = false; // storage diblokir — tetap kirim
    }
    if (viewed) return;
    void fetch(`/api/positions/${position.id}/view`, { method: "POST" }).catch(
      () => {},
    );
  }, [position]);

  // QR deep link digenerate saat dialog QR dibuka (pola share-menu).
  useEffect(() => {
    if (!qrOpen || !position) return;
    let cancelled = false;
    QRCode.toDataURL(buildPositionUrl(position), { width: 320, margin: 2 })
      .then((dataUrl) => {
        if (cancelled) return;
        setQrDataUrl(dataUrl);
        setQrLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setQrDataUrl(null);
        setQrLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [qrOpen, position]);

  // Loading di-set dari event handler (bukan body effect) — pola share-menu.
  function openQr() {
    setQrLoading(true);
    setQrDataUrl(null);
    setQrOpen(true);
  }

  return (
    <>
      <Dialog open={position !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[92vh] max-w-2xl gap-0 overflow-y-auto nice-scrollbar p-0"
        >
          {position ? (
            <>
              <DialogClose
                className={cn(
                  "absolute top-3 right-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-background/80 shadow-sm backdrop-blur transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  !position.coverFileId && "border",
                )}
                aria-label={t.positions.tutup}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </DialogClose>
              <PositionDialogInner
                position={position}
                siteName={siteName}
                stats={stats}
                canApply={canApply}
                onApply={onApply}
                onOpenQr={openQr}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {position ? (
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogContent className="max-w-xs sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{t.positions.qrTitle}</DialogTitle>
              <DialogDescription>{t.positions.qrCaption}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center rounded-xl border bg-white p-4">
              {qrLoading ? (
                <Loader2
                  className="h-8 w-8 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              ) : qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={t.positions.qrAlt}
                  className="h-56 w-56"
                  width={224}
                  height={224}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t.positions.salinGagal}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
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
  siteName,
  canApply,
  onApply,
  positionStats = {},
  initialSlug = null,
}: {
  positions: Position[];
  siteName: string;
  canApply: boolean; // false = sections.applyForm nonaktif, semua tombol lamar disembunyikan
  onApply: (positionId: string) => void;
  /** Kuota & jumlah lamaran per id posisi (dari PublicContentResponse.positionStats). */
  positionStats?: Record<string, PositionPublicStats>;
  /** Slug dari deep link /?posisi=slug — dialog detail posisi dibuka otomatis. */
  initialSlug?: string | null;
}) {
  const { t } = useLang();
  const [department, setDepartment] = useState<string | null>(null);
  const [jobType, setJobType] = useState<string | null>(null);
  // Deep link: buka dialog detail posisi otomatis saat pertama render (posisi sudah tersedia).
  const [detail, setDetail] = useState<Position | null>(() => {
    if (!initialSlug) return null;
    return positions.find((p) => p.slug === initialSlug) ?? null;
  });

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

  const hasFilters = department !== null || jobType !== null;

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
                          canApply={canApply}
                          onApply={onApply}
                          onOpenDetail={setDetail}
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

      <PositionDetailDialog
        position={detail}
        siteName={siteName}
        stats={detail ? positionStats[detail.id] : undefined}
        canApply={canApply}
        onClose={() => setDetail(null)}
        onApply={onApply}
      />
    </section>
  );
}
