"use client";

// Halaman detail per lowongan (?posisi=slug) — persyaratan, ketentuan, benefit,
// contoh karya, dan FORMULIR PENDAFTARAN khusus lowongan ini.
// Data hidup: komponen menerima positions dari useLiveResource (realtime),
// sehingga posisi yang baru ditutup/diarsip otomatis keluar dari tampilan.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BookOpenCheck,
  Briefcase,
  CalendarClock,
  Check,
  Circle,
  ClipboardList,
  Copy,
  FileText,
  Flame,
  Gift,
  Link2,
  ListChecks,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Pin,
  Sparkles,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Position,
  PositionPublicStats,
  SiteContent,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import {
  BrandMark,
  Container,
  FadeIn,
  ROSE_BADGE,
} from "@/components/landing/primitives";
import {
  buildPositionUrl,
  fillTemplate,
  formatDateTimeId,
  instagramHref,
  isWithinDaysAhead,
  isWithinDaysBack,
  safeExternalUrl,
  twitterShareHref,
  waShareHref,
  whatsappHref,
  youtubeEmbedId,
} from "@/components/landing/landing-utils";
import { DeadlineCountdown } from "@/components/landing/deadline-countdown";
import { ApplyWizard } from "@/components/landing/apply-wizard";
import { stageLabel, stagesForPosition } from "@/lib/stages";

const SOON_DAYS = 3;
const NEW_DAYS = 7;

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof ListChecks;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      {children}
    </h2>
  );
}

function TermRow({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof ListChecks;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <div className="mt-0.5 text-sm">{children}</div>
      </div>
    </div>
  );
}

export function PositionDetailView(
  props: {
    slug: string;
    content: SiteContent;
    positions: Position[];
    positionStats?: Record<string, PositionPublicStats>;
    refreshing?: boolean;
    onBack: () => void;
  },
) {
  // Detail dirender dari HomeView (di luar LandingPage) — butuh LangProvider sendiri.
  return (
    <LangProvider>
      <PositionDetailViewInner {...props} />
    </LangProvider>
  );
}

function PositionDetailViewInner({
  slug,
  content,
  positions,
  positionStats = {},
  refreshing = false,
  onBack,
}: {
  slug: string;
  content: SiteContent;
  positions: Position[];
  positionStats?: Record<string, PositionPublicStats>;
  refreshing?: boolean;
  onBack: () => void;
}) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  const position = useMemo(
    () => positions.find((p) => p.slug === slug) ?? null,
    [positions, slug],
  );

  const shareUrl = position ? buildPositionUrl(position) : "";

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(t.detail.shareCopied);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Gagal menyalin tautan.");
    }
  };

  // Lowongan hilang dari daftar tayang (ditutup/diarsip/nonaktif) → tampilan "tidak ditemukan".
  if (!position) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <DetailHeader
          siteName={content.siteName}
          tagline={content.tagline}
          live={t.detail.live}
          onBack={onBack}
          backLabel={t.detail.back}
        />
        <main className="flex flex-1 items-center justify-center px-4 py-20">
          <FadeIn className="w-full max-w-md text-center">
            <Card className="gap-4 rounded-2xl p-8">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                <Briefcase className="size-7" aria-hidden="true" />
              </span>
              <div>
                <h1 className="text-xl font-bold">{t.detail.notFoundTitle}</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.detail.notFoundDesc}
                </p>
              </div>
              <Button onClick={onBack} className="mx-auto min-h-11">
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t.detail.browseOthers}
              </Button>
            </Card>
          </FadeIn>
        </main>
      </div>
    );
  }

  const stats = positionStats[position.id] ?? null;
  const isNew = isWithinDaysBack(position.createdAt, NEW_DAYS);
  const isSoon = !!position.closesAt && isWithinDaysAhead(position.closesAt, SOON_DAYS);
  const quotaFull = stats?.remainingQuota != null && stats.remainingQuota <= 0;
  const canApplyOnline = content.sections.applyForm && !quotaFull;
  const stages = stagesForPosition(position.stages);

  const requiredFiles = [
    position.requireCv ? t.detail.termsFilesCv : null,
    position.requireIntro ? t.detail.termsFilesIntro : null,
    position.requirePortfolio ? t.detail.termsFilesPortfolio : null,
  ].filter((x): x is string => x !== null);

  const workEmbeds = position.examples
    .map((url) => ({ url, id: youtubeEmbedId(url) }))
    .filter((x) => x.id !== null)
    .slice(0, 4);
  const workLinks = position.examples.filter(
    (url) => youtubeEmbedId(url) === null && safeExternalUrl(url),
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DetailHeader
        siteName={content.siteName}
        tagline={content.tagline}
        live={t.detail.live}
        refreshing={refreshing}
        onBack={onBack}
        backLabel={t.detail.back}
      />

      <main className="flex-1 pb-20">
        {/* Cover */}
        {position.coverFileId ? (
          <FadeIn>
            <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
              <img
                src={`/api/files/${position.coverFileId}`}
                alt={`Cover lowongan ${position.title}`}
                className="h-44 w-full rounded-2xl border object-cover shadow-sm md:h-64"
              />
            </div>
          </FadeIn>
        ) : null}

        <Container className="w-full max-w-5xl">
          {/* Header posisi */}
          <FadeIn className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={ROSE_BADGE}>
                {t.detail.badge}
              </Badge>
              {position.featured ? (
                <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                  <Pin className="size-3" aria-hidden="true" />
                  {t.detail.badgeFeatured}
                </Badge>
              ) : null}
              {position.urgent ? (
                <Badge variant="outline" className="border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400">
                  <Flame className="size-3" aria-hidden="true" />
                  {t.detail.badgeUrgent}
                </Badge>
              ) : null}
              {isNew ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
                  <Sparkles className="size-3" aria-hidden="true" />
                  {t.detail.badgeNew}
                </Badge>
              ) : null}
              {isSoon ? (
                <Badge variant="outline" className="border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                  <CalendarClock className="size-3" aria-hidden="true" />
                  {t.detail.badgeSoon}
                </Badge>
              ) : null}
            </div>

            <h1 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {position.title}
            </h1>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Briefcase className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                {position.department}
              </span>
              <span className="flex items-center gap-1.5">
                <ClipboardList className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                {position.type}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                {position.location}
              </span>
              {position.salaryVisible && position.salaryText ? (
                <span className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <Wallet className="size-4" aria-hidden="true" />
                  {position.salaryText}
                </span>
              ) : null}
              <span className="flex items-center gap-1.5">
                <CalendarClock className="size-4" aria-hidden="true" />
                {t.detail.posted} {formatDateTimeId(position.createdAt)}
              </span>
            </div>

            {/* Aksi: bagikan + salin tautan khusus lowongan */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={copyLink}>
                {copied ? (
                  <Check className="size-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {t.detail.shareCopy}
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                <a href={waShareHref(`${position.title} — ${shareUrl}`)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" />
                  WhatsApp
                </a>
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                <a href={twitterShareHref(position.title, shareUrl)} target="_blank" rel="noopener noreferrer">
                  <Link2 className="size-4" aria-hidden="true" />
                  X
                </a>
              </Button>
            </div>

            {position.closesAt ? (
              <div className="mt-6">
                <DeadlineCountdown deadline={position.closesAt} />
              </div>
            ) : null}
          </FadeIn>

          <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-10">
            {/* Konten kiri: deskripsi, persyaratan, ketentuan, benefit, karya */}
            <div className="flex flex-col gap-10 lg:col-span-3">
              <FadeIn>
                <SectionTitle icon={FileText}>{t.detail.sectionDesc}</SectionTitle>
                <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground md:text-base">
                  {position.description}
                </p>
              </FadeIn>

              {position.requirements.length > 0 ? (
                <FadeIn>
                  <SectionTitle icon={ListChecks}>{t.detail.sectionReq}</SectionTitle>
                  <ul className="mt-3 space-y-2.5">
                    {position.requirements.map((req) => (
                      <li key={req} className="flex items-start gap-2.5 text-sm">
                        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </FadeIn>
              ) : null}

              {/* Ketentuan lamaran — turunan dari pengaturan posisi */}
              <FadeIn>
                <SectionTitle icon={ClipboardList}>{t.detail.sectionTerms}</SectionTitle>
                <Card className="mt-3 divide-y rounded-2xl p-2 md:p-3">
                  <TermRow icon={FileText} label={t.detail.termsFiles}>
                    {requiredFiles.length > 0 ? (
                      <span>{requiredFiles.join(" · ")}</span>
                    ) : (
                      <span className="text-muted-foreground">{t.detail.termsFilesNone}</span>
                    )}
                  </TermRow>
                  <TermRow icon={CalendarClock} label={t.detail.termsDeadline}>
                    {position.closesAt ? (
                      <span>{formatDateTimeId(position.closesAt)}</span>
                    ) : (
                      <span className="text-muted-foreground">{t.detail.termsDeadlineNone}</span>
                    )}
                  </TermRow>
                  <TermRow icon={Users} label={t.detail.termsQuota}>
                    {position.maxApplicants != null ? (
                      <span
                        className={cn(
                          quotaFull && "font-medium text-rose-600 dark:text-rose-400",
                        )}
                      >
                        {quotaFull
                          ? t.detail.termsQuotaFull
                          : stats
                            ? fillTemplate(t.detail.termsQuotaValue, {
                                used: stats.applications,
                                max: position.maxApplicants,
                                left: stats.remainingQuota ?? 0,
                              })
                            : position.maxApplicants}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t.detail.termsQuotaUnlimited}</span>
                    )}
                  </TermRow>
                  <TermRow icon={ListChecks} label={t.detail.termsScreening}>
                    <span>
                      {position.screeningQuestions.length > 0
                        ? fillTemplate(t.detail.termsScreeningCount, {
                            n: position.screeningQuestions.length,
                          })
                        : t.detail.termsScreeningNone}
                    </span>
                  </TermRow>
                  {position.assignment.title ? (
                    <TermRow icon={ClipboardList} label={t.detail.termsTest}>
                      <span>{position.assignment.title}</span>
                    </TermRow>
                  ) : null}
                  {stages.length > 0 ? (
                    <TermRow icon={Workflow} label={t.detail.termsProcess}>
                      <span className="flex flex-wrap gap-1.5">
                        {stages.map((stage, index) => (
                          <span
                            key={stage}
                            className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800"
                          >
                            {index + 1}. {stageLabel(stage)}
                          </span>
                        ))}
                      </span>
                    </TermRow>
                  ) : null}
                </Card>
              </FadeIn>

              {position.benefits.length > 0 ? (
                <FadeIn>
                  <SectionTitle icon={Gift}>{t.detail.sectionBenefit}</SectionTitle>
                  <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {position.benefits.map((benefit) => (
                      <li
                        key={benefit}
                        className="flex items-start gap-2.5 rounded-lg border bg-zinc-50/60 p-3 text-sm dark:bg-zinc-900/40"
                      >
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </FadeIn>
              ) : null}

              {workEmbeds.length > 0 || workLinks.length > 0 ? (
                <FadeIn>
                  <SectionTitle icon={Sparkles}>{t.detail.sectionWorks}</SectionTitle>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {workEmbeds.map(({ url, id }) => (
                      <div
                        key={url}
                        className="aspect-video overflow-hidden rounded-xl border bg-zinc-950"
                      >
                        <iframe
                          src={`https://www.youtube.com/embed/${id}`}
                          title={`Contoh karya ${position.title}`}
                          className="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          loading="lazy"
                        />
                      </div>
                    ))}
                    {workLinks.map((url) => {
                      const safe = safeExternalUrl(url);
                      return safe ? (
                        <a
                          key={url}
                          href={safe}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-h-11 items-center gap-2 truncate rounded-xl border p-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Link2 className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                          <span className="truncate">{url}</span>
                        </a>
                      ) : null;
                    })}
                  </div>
                </FadeIn>
              ) : null}
            </div>

            {/* Kanan: formulir pendaftaran khusus lowongan ini (sticky) */}
            <div className="lg:col-span-2">
              <FadeIn delay={0.1} className="lg:sticky lg:top-24">
                <Card className="gap-4 rounded-2xl p-5 md:p-6">
                  {canApplyOnline ? (
                    <>
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                          <FileText className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold leading-tight">
                            {position.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t.detail.badge}
                          </p>
                        </div>
                      </div>
                      <ApplyWizard
                        positions={[position]}
                        positionId={position.id}
                        onPositionIdChange={() => {}}
                        lockPosition
                      />
                    </>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                          <CalendarClock className="size-4" aria-hidden="true" />
                        </span>
                        <p className="text-sm font-semibold">
                          {quotaFull ? t.detail.termsQuotaFull : t.detail.applyClosedTitle}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {content.sections.applyForm
                          ? t.detail.applyClosedDesc
                          : t.detail.applyDisabledDesc}
                      </p>
                    </div>
                  )}

                  {/* Kontak (selalu tampil di kartu kanan) */}
                  <div className="flex flex-col gap-1 border-t pt-4">
                    <a
                      href={`mailto:${content.contactEmail}`}
                      className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Mail className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                      <span className="break-all">{content.contactEmail}</span>
                    </a>
                    <a
                      href={whatsappHref(content.contactWhatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Phone className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                      <span className="break-all">{content.contactWhatsapp}</span>
                    </a>
                    <a
                      href={instagramHref(content.instagram)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <Link2 className="size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                      <span className="break-all">{content.instagram || "Instagram"}</span>
                    </a>
                  </div>
                </Card>
              </FadeIn>
            </div>
          </div>
        </Container>
      </main>

      <footer className="border-t py-6">
        <Container className="flex flex-col items-center justify-between gap-3 text-xs text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <BrandMark size="sm" />
            <span>{content.siteName}</span>
          </div>
          <span>{content.tagline}</span>
        </Container>
      </footer>
    </div>
  );
}

function DetailHeader({
  siteName,
  tagline,
  live,
  refreshing = false,
  onBack,
  backLabel,
}: {
  siteName: string;
  tagline: string;
  live: string;
  refreshing?: boolean;
  onBack: () => void;
  backLabel: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-bold">{siteName}</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {tagline}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border bg-zinc-50/60 px-2.5 py-1 text-xs text-muted-foreground dark:bg-zinc-900/40 sm:inline-flex">
            <span className="dot-pulse h-1.5 w-1.5 rounded-full bg-emerald-500 text-emerald-500" aria-hidden="true" />
            {live}
            {refreshing ? (
              <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-500" aria-hidden="true" />
            ) : null}
          </span>
          <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
            <span className="sm:hidden">Kembali</span>
          </Button>
        </div>
      </Container>
    </header>
  );
}
