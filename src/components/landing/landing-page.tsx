"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { motion, MotionConfig } from "framer-motion";
import {
  Instagram,
  Mail,
  Menu,
  Phone,
  Quote,
  Sparkles,
} from "lucide-react";
import type {
  Position,
  PositionPublicStats,
  SectionVisibility,
  SiteContent,
} from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { LangProvider, useLang } from "@/components/landing/lang-context";
import {
  AnimatedNumber,
  BrandMark,
  Container,
  FadeIn,
  HoverLift,
  ICON_TILE,
  ROSE_BADGE,
  Stagger,
  StaggerItem,
} from "@/components/landing/primitives";
import {
  buildPositionUrl,
  employmentTypeOf,
  instagramHref,
  whatsappHref,
} from "@/components/landing/landing-utils";
import { LangToggle } from "@/components/landing/lang-toggle";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { DeadlineCountdown } from "@/components/landing/deadline-countdown";
import { ShareMenu } from "@/components/landing/share-menu";
import { PositionsSection } from "@/components/landing/positions-section";
import { StatusCheckSection } from "@/components/landing/status-check";
import { SubscribeSection } from "@/components/landing/subscribe-section";
import { ChatWidget } from "@/components/landing/chat-widget";
import { BenefitIcon } from "@/components/landing/benefit-icon";

type LandingPageProps = {
  content: SiteContent;
  positions: Position[];
  stats: { openRoles: number; totalApplications: number };
  /** Kuota & jumlah lamaran per posisi (dari PublicContentResponse.positionStats) untuk badge publik. */
  positionStats?: Record<string, PositionPublicStats>;
  /** true saat data sedang dimuat ulang di latar belakang (realtime) — tanpa flicker. */
  refreshing?: boolean;
  /** Buka halaman detail lowongan (?posisi=slug) — persyaratan + formulir per lowongan. */
  onOpenPosition: (slug: string) => void;
};

// Link nav/footer mengikuti visibilitas section terkait —
// anchor menuju section yang disembunyikan tidak boleh dirender.
function useNavLinks(sections: SectionVisibility) {
  const { t } = useLang();
  return [
    { key: "positions" as const, href: "#posisi", label: t.nav.positions },
    { key: "benefits" as const, href: "#benefit", label: t.nav.benefits },
    { key: "steps" as const, href: "#cara-lamar", label: t.nav.howToApply },
    { key: "statusCheck" as const, href: "#status", label: t.nav.status },
    { key: "faq" as const, href: "#faq", label: t.nav.faq },
  ].filter((link) => sections[link.key]);
}

// Status "halaman sudah digulir" via useSyncExternalStore (murah, tanpa setState di effect).
function useScrolled(threshold = 8): boolean {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener("scroll", notify, { passive: true });
      return () => window.removeEventListener("scroll", notify);
    },
    () => window.scrollY > threshold,
    () => false,
  );
}

function Navbar({
  siteName,
  tagline,
  sections,
}: {
  siteName: string;
  tagline: string;
  sections: SectionVisibility;
}) {
  const { t } = useLang();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navLinks = useNavLinks(sections);
  // Hamburger seluler hanya bila isinya ada: link nav atau CTA lamaran.
  const hasMobileMenu = navLinks.length > 0 || sections.positions;
  const scrolled = useScrolled();

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b bg-background/80 backdrop-blur transition-[box-shadow] duration-300",
        scrolled && "shadow-sm",
      )}
    >
      <Container
        className={cn(
          "flex h-16 items-center justify-between gap-4 transition-[height] duration-300",
          scrolled && "h-14",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-bold">{siteName}</p>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {tagline}
            </p>
          </div>
        </div>

        {navLinks.length > 0 ? (
          <nav
            aria-label={t.nav.mainNav}
            className="hidden items-center gap-1 lg:flex"
          >
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 md:flex">
            <LangToggle />
            <ThemeToggle />
          </div>
          {sections.positions ? (
            <Button size="sm" asChild className="hidden md:inline-flex">
              <a href="#posisi">{t.nav.applyNow}</a>
            </Button>
          ) : null}

          {hasMobileMenu ? (
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 md:hidden"
                  aria-label={t.nav.openMenu}
                >
                  <Menu className="h-5 w-5" aria-hidden="true" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80">
                <SheetHeader>
                  <SheetTitle className="flex items-center gap-2 text-base">
                    <BrandMark size="sm" />
                    {siteName}
                  </SheetTitle>
                  <SheetDescription className="sr-only">
                    {t.nav.mobileNav}
                  </SheetDescription>
                </SheetHeader>
                <nav
                  aria-label={t.nav.mobileNav}
                  className="flex flex-col gap-1 px-4"
                >
                  {navLinks.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  ))}
                  {sections.positions ? (
                    <Button asChild className="mt-3">
                      <a href="#posisi" onClick={() => setMobileOpen(false)}>
                        {t.nav.applyNow}
                      </a>
                    </Button>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t.aria.langToggle} / {t.aria.themeToggle}
                    </span>
                    <div className="flex items-center gap-2">
                      <LangToggle />
                      <ThemeToggle />
                    </div>
                  </div>
                </nav>
              </SheetContent>
            </Sheet>
          ) : null}
        </div>
      </Container>
    </header>
  );
}

function Hero({
  content,
  stats,
  sections,
}: {
  content: SiteContent;
  stats: LandingPageProps["stats"];
  sections: SectionVisibility;
}) {
  const { t } = useLang();

  return (
    <section className="relative overflow-hidden bg-zinc-950 text-zinc-50">
      <div aria-hidden="true" className="bg-grid-pattern absolute inset-0" />
      {/* Glow blob rose mengambang pelan (loop y + opacity, hanya transform/opacity) */}
      <div
        aria-hidden="true"
        className="absolute -top-32 left-1/2 h-96 w-[44rem] max-w-full -translate-x-1/2"
      >
        <motion.div
          className="h-full w-full rounded-full bg-rose-600/20 blur-3xl"
          animate={{ y: [0, 24, 0], opacity: [0.75, 1, 0.75] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <motion.div
        aria-hidden="true"
        className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl"
        animate={{ y: [0, -18, 0], opacity: [0.7, 1, 0.7] }}
        transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
      />

      <Container className="relative py-20 md:py-28">
        {/* Entrance berurutan: badge → judul → deskripsi → countdown → CTA → statistik */}
        <Stagger className="max-w-3xl" gap={0.09} delay={0.05}>
          <StaggerItem>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-zinc-300">
              <span
                className="dot-pulse h-2 w-2 rounded-full bg-emerald-400 text-emerald-400"
                aria-hidden="true"
              />
              {content.heroBadge}
            </div>
          </StaggerItem>

          <StaggerItem>
            <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-6xl">
              {content.heroTitle}{" "}
              {content.heroHighlight ? (
                <span className="text-gradient">{content.heroHighlight}</span>
              ) : null}
            </h1>
          </StaggerItem>

          <StaggerItem>
            <p className="mt-6 max-w-2xl text-base text-zinc-400 md:text-lg">
              {content.heroDescription}
            </p>
          </StaggerItem>

          {content.deadline ? (
            <StaggerItem>
              <DeadlineCountdown deadline={content.deadline} />
            </StaggerItem>
          ) : null}

          <StaggerItem>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {sections.positions ? (
                <Button size="lg" className="h-11" asChild>
                  <a href="#posisi">{t.nav.applyNow}</a>
                </Button>
              ) : null}
              <ShareMenu dark siteName={content.siteName} tagline={content.tagline} />
            </div>
          </StaggerItem>

          <StaggerItem className="mt-14">
            <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 pt-8">
              <div className="min-w-0 pr-3 sm:pr-10">
                <p className="text-xl font-bold tabular-nums sm:text-2xl md:text-3xl">
                  <AnimatedNumber value={stats.openRoles} />
                </p>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  {t.hero.statsOpen}
                </p>
              </div>
              <div className="min-w-0 px-3 sm:px-10">
                <p className="text-xl font-bold tabular-nums sm:text-2xl md:text-3xl">
                  <AnimatedNumber value={stats.totalApplications} suffix="+" />
                </p>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  {t.hero.statsApps}
                </p>
              </div>
              <div className="min-w-0 pl-3 sm:pl-10">
                <p className="text-xl font-bold tabular-nums sm:text-2xl md:text-3xl">
                  <AnimatedNumber value={100} suffix="%" />
                </p>
                <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                  {t.hero.statsRemote}
                </p>
              </div>
            </div>
          </StaggerItem>
        </Stagger>
      </Container>
    </section>
  );
}

function AboutSection({
  content,
  stats,
}: {
  content: SiteContent;
  stats: LandingPageProps["stats"];
}) {
  const { t } = useLang();

  return (
    <section className="bg-muted/40 py-16 md:py-24">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <FadeIn>
            <Badge variant="outline" className={ROSE_BADGE}>
              {t.about.badge}
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {content.aboutTitle}
            </h2>
            <p className="mt-4 text-muted-foreground md:text-lg">
              {content.aboutDescription}
            </p>
          </FadeIn>

          <FadeIn delay={0.1}>
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-rose-600 to-amber-500 p-8 text-white shadow-sm">
              <Sparkles className="h-10 w-10" aria-hidden="true" />
              <p className="mt-4 text-xl font-semibold">{t.about.cardTitle}</p>
              <p className="mt-2 text-sm text-white/80">{t.about.cardBody}</p>
            </div>
            {/* Padding/gap mengecil di layar sangat kecil agar 3 kolom tidak sesak */}
            <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-4">
              <HoverLift className="h-full">
                <Card className="h-full gap-1 rounded-2xl p-3 text-center transition-shadow hover:shadow-md sm:p-4">
                  <p className="text-lg font-bold tabular-nums sm:text-xl md:text-2xl">
                    <AnimatedNumber value={stats.openRoles} />
                  </p>
                  <p className="text-xs text-muted-foreground">{t.about.statActive}</p>
                </Card>
              </HoverLift>
              <HoverLift className="h-full">
                <Card className="h-full gap-1 rounded-2xl p-3 text-center transition-shadow hover:shadow-md sm:p-4">
                  <p className="text-lg font-bold tabular-nums sm:text-xl md:text-2xl">
                    <AnimatedNumber value={stats.totalApplications} suffix="+" />
                  </p>
                  <p className="text-xs text-muted-foreground">{t.about.statApps}</p>
                </Card>
              </HoverLift>
              <HoverLift className="h-full">
                <Card className="h-full gap-1 rounded-2xl p-3 text-center transition-shadow hover:shadow-md sm:p-4">
                  <p className="text-lg font-bold tabular-nums sm:text-xl md:text-2xl">
                    2 Jt+
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.about.statCommunity}
                  </p>
                </Card>
              </HoverLift>
            </div>
          </FadeIn>
        </div>
      </Container>
    </section>
  );
}

function BenefitsSection({ content }: { content: SiteContent }) {
  const { t } = useLang();

  return (
    <section id="benefit" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.benefits.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.benefits.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.benefits.desc}</p>
        </FadeIn>

        {content.benefits.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">{t.benefits.empty}</p>
        ) : (
          <Stagger className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {content.benefits.map((benefit, index) => (
              <StaggerItem key={`${benefit.title}-${index}`} className="h-full">
                <HoverLift className="h-full">
                  <Card className="h-full gap-4 rounded-2xl p-6 transition-shadow hover:shadow-md">
                    <div className={cn("w-fit rounded-xl p-3", ICON_TILE)}>
                      <BenefitIcon name={benefit.icon} className="h-6 w-6" />
                    </div>
                    <h3 className="font-semibold">{benefit.title}</h3>
                    <p className="text-sm text-muted-foreground">
                      {benefit.description}
                    </p>
                  </Card>
                </HoverLift>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </Container>
    </section>
  );
}

function HowToApplySection() {
  const { t } = useLang();

  return (
    <section id="cara-lamar" className="scroll-mt-24 bg-muted/40 py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.howTo.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.howTo.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.howTo.desc}</p>
        </FadeIn>

        <Stagger className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.howTo.steps.map((step, index) => (
            <StaggerItem key={step.title} className="h-full">
              <HoverLift className="h-full">
                <Card className="h-full gap-3 rounded-2xl p-6 transition-shadow hover:shadow-md">
                  <span
                    aria-hidden="true"
                    className="text-4xl font-bold text-rose-600/20 dark:text-rose-400/20"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="font-semibold">{step.title}</h3>
                  <p className="text-sm text-muted-foreground">{step.description}</p>
                </Card>
              </HoverLift>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </section>
  );
}

function VoicesSection({ content }: { content: SiteContent }) {
  const { t } = useLang();

  if (content.teamMembers.length === 0) return null;

  return (
    <section className="bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.voices.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.voices.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.voices.desc}</p>
        </FadeIn>

        <Stagger className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          {content.teamMembers.map((member, index) => (
            <StaggerItem key={`${member.name}-${index}`} className="h-full">
              <HoverLift className="h-full">
                <Card className="h-full gap-4 rounded-2xl p-6 transition-shadow hover:shadow-md">
                  <Quote
                    className="h-7 w-7 text-rose-600 dark:text-rose-400"
                    aria-hidden="true"
                  />
                  <p className="text-sm italic leading-relaxed">
                    &ldquo;{member.quote}&rdquo;
                  </p>
                  <div className="mt-auto flex items-center gap-3 border-t pt-4">
                    <span
                      aria-hidden="true"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-rose-600 to-amber-500 text-sm font-bold text-white"
                    >
                      {member.name
                        .trim()
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((part) => part.charAt(0).toUpperCase())
                        .join("") || "?"}
                    </span>
                    <div className="leading-tight">
                      <p className="text-sm font-semibold">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                  </div>
                </Card>
              </HoverLift>
            </StaggerItem>
          ))}
        </Stagger>
      </Container>
    </section>
  );
}

function FaqSection({ content }: { content: SiteContent }) {
  const { t } = useLang();

  return (
    <section id="faq" className="scroll-mt-24 bg-muted/40 py-16 md:py-24">
      <Container>
        <FadeIn className="mx-auto max-w-3xl">
          <div className="text-center">
            <Badge variant="outline" className={ROSE_BADGE}>
              {t.faq.badge}
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {t.faq.title}
            </h2>
            <p className="mt-3 text-muted-foreground">{t.faq.desc}</p>
          </div>

          {content.faqs.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              {t.faq.empty}
            </p>
          ) : (
            <Card className="mt-10 rounded-2xl px-6 py-2 md:px-8">
              <Accordion type="single" collapsible>
                {content.faqs.map((faq, index) => (
                  <AccordionItem
                    key={`${faq.question}-${index}`}
                    value={`faq-${index}`}
                  >
                    <AccordionTrigger className="text-left text-sm font-medium md:text-base">
                      {faq.question}
                    </AccordionTrigger>
                    <AccordionContent className="text-sm text-muted-foreground">
                      {faq.answer}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Card>
          )}
        </FadeIn>
      </Container>
    </section>
  );
}

function FinalCtaSection({
  content,
  sections,
}: {
  content: SiteContent;
  sections: SectionVisibility;
}) {
  const { t } = useLang();

  return (
    <section className="bg-background py-16 md:py-24">
      <Container>
        <FadeIn>
          <div className="relative overflow-hidden rounded-3xl bg-zinc-950 px-6 py-16 text-center text-zinc-50 md:px-12 md:py-20">
            <div aria-hidden="true" className="bg-grid-pattern absolute inset-0" />
            <div
              aria-hidden="true"
              className="absolute -top-24 left-1/2 h-72 w-[36rem] max-w-full -translate-x-1/2"
            >
              <motion.div
                className="h-full w-full rounded-full bg-rose-600/20 blur-3xl"
                animate={{ y: [0, 18, 0], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                {t.cta.title}
              </h2>
              <p className="mt-4 text-zinc-400">{t.cta.desc}</p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                {sections.positions ? (
                  <Button size="lg" className="h-11" asChild>
                    <a href="#posisi">{t.cta.apply}</a>
                  </Button>
                ) : null}
                <Button
                  size="lg"
                  variant="outline"
                  className="h-11 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  asChild
                >
                  <a
                    href={whatsappHref(content.contactWhatsapp)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t.cta.whatsapp}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}

function Footer({
  content,
  sections,
}: {
  content: SiteContent;
  sections: SectionVisibility;
}) {
  const { t } = useLang();
  const navLinks = useNavLinks(sections);

  return (
    <footer className="mt-auto border-t bg-background">
      <Container className="py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark />
              <div className="leading-tight">
                <p className="font-bold">{content.siteName}</p>
                <p className="text-xs text-muted-foreground">{content.tagline}</p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              {content.footerText}
            </p>
          </div>

          {navLinks.length > 0 ? (
            <nav aria-label={t.footer.nav}>
              <h3 className="text-sm font-semibold">{t.footer.nav}</h3>
              <ul className="mt-4 space-y-1">
                {navLinks.map((link) => (
                  <li key={link.href}>
                    <a
                      href={link.href}
                      className="inline-flex min-h-11 items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <div>
            <h3 className="text-sm font-semibold">{t.footer.contact}</h3>
            <ul className="mt-4 space-y-1">
              <li>
                <a
                  href={`mailto:${content.contactEmail}`}
                  className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Mail
                    className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                    aria-hidden="true"
                  />
                  <span className="break-all">{content.contactEmail}</span>
                </a>
              </li>
              <li>
                <a
                  href={whatsappHref(content.contactWhatsapp)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Phone
                    className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                    aria-hidden="true"
                  />
                  <span>{t.footer.whatsapp}</span>
                </a>
              </li>
              <li>
                <a
                  href={instagramHref(content.instagram)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Instagram
                    className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                    aria-hidden="true"
                  />
                  <span className="break-all">
                    {content.instagram || "Instagram"}
                  </span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Garis bawah footer: hak cipta + catatan kecil. */}
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t pt-6 text-center sm:flex-row sm:text-left">
          <p className="text-xs text-muted-foreground">{content.footerText}</p>
          <p className="text-xs text-muted-foreground/70">
            {content.siteName} — {content.tagline}
          </p>
        </div>
      </Container>
    </footer>
  );
}

/**
 * JSON-LD JobPosting untuk SEO (dipasang/dibongkar sesuai perubahan positions).
 * Bila focusSlug cocok dengan sebuah posisi (deep link /?posisi=slug), emit SATU
 * schema JobPosting posisi tersebut — lengkap dengan url deep link — else semua posisi.
 */
function useJobPostingJsonLd(
  positions: Position[],
  siteName: string,
  focusSlug?: string | null,
) {
  useEffect(() => {
    const focused = focusSlug
      ? (positions.find((position) => position.slug === focusSlug) ?? null)
      : null;
    const jobPostings = focused
      ? [
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            title: focused.title,
            description: focused.description.trim().slice(0, 300),
            hiringOrganization: { "@type": "Organization", name: siteName },
            jobLocationType: "TELECOMMUTE",
            employmentType: employmentTypeOf(focused.type),
            datePosted: focused.createdAt,
            ...(focused.closesAt ? { validThrough: focused.closesAt } : {}),
            ...(focused.slug ? { url: buildPositionUrl(focused) } : {}),
          },
        ]
      : positions.map((position) => ({
          "@context": "https://schema.org",
          "@type": "JobPosting",
          title: position.title,
          description: position.description,
          hiringOrganization: { "@type": "Organization", name: siteName },
          jobLocationType: "TELECOMMUTE",
          employmentType: employmentTypeOf(position.type),
          datePosted: position.createdAt,
          ...(position.closesAt ? { validThrough: position.closesAt } : {}),
        }));
    const script = document.createElement("script");
    script.id = "jobposting-ld";
    script.type = "application/ld+json";
    script.textContent = JSON.stringify(jobPostings);
    document.head.appendChild(script);
    return () => {
      document.getElementById("jobposting-ld")?.remove();
    };
  }, [positions, siteName, focusSlug]);
}

function LandingShell({
  content,
  positions,
  stats,
  positionStats,
  onOpenPosition,
}: LandingPageProps) {
  // Visibilitas tiap bagian halaman publik (dikendalikan dari panel admin).
  const sections = content.sections;

  useJobPostingJsonLd(positions, content.siteName);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col">
        <Navbar
          siteName={content.siteName}
          tagline={content.tagline}
          sections={sections}
        />
        <main className="flex-1">
          {sections.hero ? (
            <Hero content={content} stats={stats} sections={sections} />
          ) : null}
          {sections.positions ? (
            <PositionsSection
              positions={positions}
              siteName={content.siteName}
              positionStats={positionStats}
              onOpenPosition={onOpenPosition}
            />
          ) : null}
          {sections.about ? <AboutSection content={content} stats={stats} /> : null}
          {sections.benefits ? <BenefitsSection content={content} /> : null}
          {sections.steps ? <HowToApplySection /> : null}
          {sections.statusCheck ? <StatusCheckSection /> : null}
          {sections.testimonials ? <VoicesSection content={content} /> : null}
          {sections.faq ? <FaqSection content={content} /> : null}
          {sections.finalCta ? (
            <FinalCtaSection content={content} sections={sections} />
          ) : null}
          {sections.subscribe ? <SubscribeSection /> : null}
        </main>
        <Footer content={content} sections={sections} />
        {content.chatbotEnabled && sections.chatbot ? <ChatWidget /> : null}
      </div>
    </MotionConfig>
  );
}

export function LandingPage(props: LandingPageProps) {
  return (
    <LangProvider>
      <LandingShell {...props} />
    </LangProvider>
  );
}
