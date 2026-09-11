"use client";

import { useEffect, useState } from "react";
import {
  Clock,
  Instagram,
  Lock,
  Mail,
  Menu,
  MessageCircle,
  Phone,
  Quote,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  Position,
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
  BrandMark,
  Container,
  FadeIn,
  ICON_TILE,
  ROSE_BADGE,
} from "@/components/landing/primitives";
import {
  employmentTypeOf,
  instagramHref,
  whatsappHref,
} from "@/components/landing/landing-utils";
import { LangToggle } from "@/components/landing/lang-toggle";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { DeadlineCountdown } from "@/components/landing/deadline-countdown";
import { ShareMenu } from "@/components/landing/share-menu";
import { PositionsSection } from "@/components/landing/positions-section";
import { ApplyWizard } from "@/components/landing/apply-wizard";
import { StatusCheckSection } from "@/components/landing/status-check";
import { SubscribeSection } from "@/components/landing/subscribe-section";
import { ChatWidget } from "@/components/landing/chat-widget";
import { BenefitIcon } from "@/components/landing/benefit-icon";

type LandingPageProps = {
  content: SiteContent;
  positions: Position[];
  stats: { openRoles: number; totalApplications: number };
  onOpenAdmin: () => void;
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

const TRUST_ICONS = [ShieldCheck, Clock, MessageCircle];

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
  const hasMobileMenu = navLinks.length > 0 || sections.applyForm;

  return (
    <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur">
      <Container className="flex h-16 items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div className="leading-tight">
            <p className="font-bold">{siteName}</p>
            <p className="hidden text-xs text-muted-foreground sm:block">
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
          {sections.applyForm ? (
            <Button size="sm" asChild className="hidden md:inline-flex">
              <a href="#lamar">{t.nav.applyNow}</a>
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
                  {sections.applyForm ? (
                    <Button asChild className="mt-3">
                      <a href="#lamar" onClick={() => setMobileOpen(false)}>
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
      <div
        aria-hidden="true"
        className="absolute -top-32 left-1/2 h-96 w-[44rem] max-w-full -translate-x-1/2 rounded-full bg-rose-600/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-amber-500/10 blur-3xl"
      />

      <Container className="relative py-20 md:py-28">
        <FadeIn className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-zinc-300">
            <span
              className="dot-pulse h-2 w-2 rounded-full bg-emerald-400 text-emerald-400"
              aria-hidden="true"
            />
            {content.heroBadge}
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-6xl">
            {content.heroTitle}{" "}
            {content.heroHighlight ? (
              <span className="text-gradient">{content.heroHighlight}</span>
            ) : null}
          </h1>

          <p className="mt-6 max-w-2xl text-base text-zinc-400 md:text-lg">
            {content.heroDescription}
          </p>

          {content.deadline ? (
            <DeadlineCountdown deadline={content.deadline} />
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {sections.applyForm ? (
              <Button size="lg" className="h-11" asChild>
                <a href="#lamar">{t.nav.applyNow}</a>
              </Button>
            ) : null}
            {sections.positions ? (
              <Button
                size="lg"
                variant="outline"
                className="h-11 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
                asChild
              >
                <a href="#posisi">{t.hero.viewPositions}</a>
              </Button>
            ) : null}
            <ShareMenu dark siteName={content.siteName} tagline={content.tagline} />
          </div>
        </FadeIn>

        <FadeIn delay={0.15} className="mt-14">
          <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 pt-8">
            <div className="pr-4 sm:pr-10">
              <p className="text-2xl font-bold tabular-nums md:text-3xl">
                {stats.openRoles}
              </p>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                {t.hero.statsOpen}
              </p>
            </div>
            <div className="px-4 sm:px-10">
              <p className="text-2xl font-bold tabular-nums md:text-3xl">
                {stats.totalApplications}+
              </p>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                {t.hero.statsApps}
              </p>
            </div>
            <div className="pl-4 sm:pl-10">
              <p className="text-2xl font-bold tabular-nums md:text-3xl">100%</p>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                {t.hero.statsRemote}
              </p>
            </div>
          </div>
        </FadeIn>
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
            <div className="mt-4 grid grid-cols-3 gap-4">
              <Card className="gap-1 rounded-2xl p-4 text-center">
                <p className="text-xl font-bold tabular-nums md:text-2xl">
                  {stats.openRoles}
                </p>
                <p className="text-xs text-muted-foreground">{t.about.statActive}</p>
              </Card>
              <Card className="gap-1 rounded-2xl p-4 text-center">
                <p className="text-xl font-bold tabular-nums md:text-2xl">
                  {stats.totalApplications}+
                </p>
                <p className="text-xs text-muted-foreground">{t.about.statApps}</p>
              </Card>
              <Card className="gap-1 rounded-2xl p-4 text-center">
                <p className="text-xl font-bold md:text-2xl">2 Jt+</p>
                <p className="text-xs text-muted-foreground">
                  {t.about.statCommunity}
                </p>
              </Card>
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
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {content.benefits.map((benefit, index) => (
              <FadeIn
                key={`${benefit.title}-${index}`}
                delay={Math.min(index, 5) * 0.06}
                className="h-full"
              >
                <Card className="h-full gap-4 rounded-2xl p-6">
                  <div className={cn("w-fit rounded-xl p-3", ICON_TILE)}>
                    <BenefitIcon name={benefit.icon} className="h-6 w-6" />
                  </div>
                  <h3 className="font-semibold">{benefit.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {benefit.description}
                  </p>
                </Card>
              </FadeIn>
            ))}
          </div>
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

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {t.howTo.steps.map((step, index) => (
            <FadeIn key={step.title} delay={index * 0.06} className="h-full">
              <Card className="h-full gap-3 rounded-2xl p-6">
                <span
                  aria-hidden="true"
                  className="text-4xl font-bold text-rose-600/20 dark:text-rose-400/20"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.description}</p>
              </Card>
            </FadeIn>
          ))}
        </div>
      </Container>
    </section>
  );
}

function ApplySection({
  content,
  positions,
  positionId,
  onPositionIdChange,
}: {
  content: SiteContent;
  positions: Position[];
  positionId: string;
  onPositionIdChange: (positionId: string) => void;
}) {
  const { t } = useLang();

  return (
    <section id="lamar" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <div className="grid gap-8 lg:grid-cols-5 lg:gap-10">
          <FadeIn className="lg:col-span-2">
            <Badge variant="outline" className={ROSE_BADGE}>
              {t.apply.badge}
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {t.apply.title}
            </h2>
            <p className="mt-4 text-muted-foreground">{t.apply.desc}</p>

            <ul className="mt-6 space-y-3">
              {t.apply.trust.map((line, index) => {
                const TrustIcon = TRUST_ICONS[index] ?? ShieldCheck;
                return (
                  <li key={line} className="flex items-start gap-3">
                    <TrustIcon
                      className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400"
                      aria-hidden="true"
                    />
                    <span className="text-sm text-muted-foreground">{line}</span>
                  </li>
                );
              })}
            </ul>

            <Card className="mt-8 gap-3 rounded-2xl p-6">
              <p className="text-sm font-semibold">{t.apply.contactTitle}</p>
              <a
                href={`mailto:${content.contactEmail}`}
                className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Mail
                  className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                  aria-hidden="true"
                />
                <span className="break-all">{content.contactEmail}</span>
              </a>
              <a
                href={whatsappHref(content.contactWhatsapp)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Phone
                  className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                  aria-hidden="true"
                />
                <span>
                  {t.apply.contactWhatsapp} {content.contactWhatsapp}
                </span>
              </a>
              <a
                href={instagramHref(content.instagram)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Instagram
                  className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400"
                  aria-hidden="true"
                />
                <span className="break-all">
                  {content.instagram || "Instagram"}
                </span>
              </a>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1} className="lg:col-span-3">
            <Card className="rounded-2xl p-6 md:p-8">
              <ApplyWizard
                positions={positions}
                positionId={positionId}
                onPositionIdChange={onPositionIdChange}
              />
            </Card>
          </FadeIn>
        </div>
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

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {content.teamMembers.map((member, index) => (
            <FadeIn
              key={`${member.name}-${index}`}
              delay={Math.min(index, 5) * 0.06}
              className="h-full"
            >
              <Card className="h-full gap-4 rounded-2xl p-6">
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
            </FadeIn>
          ))}
        </div>
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
              className="absolute -top-24 left-1/2 h-72 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-rose-600/20 blur-3xl"
            />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
                {t.cta.title}
              </h2>
              <p className="mt-4 text-zinc-400">{t.cta.desc}</p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                {sections.applyForm ? (
                  <Button size="lg" className="h-11" asChild>
                    <a href="#lamar">{t.cta.apply}</a>
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
  onOpenAdmin,
}: {
  content: SiteContent;
  sections: SectionVisibility;
  onOpenAdmin: () => void;
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

        {/* pe-20 memberi ruang agar tombol Admin tidak tertutup chat widget */}
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t pe-20 pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">{content.footerText}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAdmin}
            aria-label={t.footer.adminAria}
            className="text-muted-foreground"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            {t.footer.admin}
          </Button>
        </div>
      </Container>
    </footer>
  );
}

/** JSON-LD JobPosting untuk SEO (dipasang/dibongkar sesuai perubahan positions). */
function useJobPostingJsonLd(positions: Position[], siteName: string) {
  useEffect(() => {
    const jobPostings = positions.map((position) => ({
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
  }, [positions, siteName]);
}

function LandingShell({
  content,
  positions,
  stats,
  onOpenAdmin,
}: LandingPageProps) {
  const [selectedPositionId, setSelectedPositionId] = useState("");
  // Visibilitas tiap bagian halaman publik (dikendalikan dari panel admin).
  const sections = content.sections;

  useJobPostingJsonLd(positions, content.siteName);

  const handleApplyPosition = (positionId: string) => {
    setSelectedPositionId(positionId);
    document.getElementById("lamar")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
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
            canApply={sections.applyForm}
            onApply={handleApplyPosition}
          />
        ) : null}
        {sections.about ? <AboutSection content={content} stats={stats} /> : null}
        {sections.benefits ? <BenefitsSection content={content} /> : null}
        {sections.steps ? <HowToApplySection /> : null}
        {sections.applyForm ? (
          <ApplySection
            content={content}
            positions={positions}
            positionId={selectedPositionId}
            onPositionIdChange={setSelectedPositionId}
          />
        ) : null}
        {sections.statusCheck ? <StatusCheckSection /> : null}
        {sections.testimonials ? <VoicesSection content={content} /> : null}
        {sections.faq ? <FaqSection content={content} /> : null}
        {sections.finalCta ? (
          <FinalCtaSection content={content} sections={sections} />
        ) : null}
        {sections.subscribe ? <SubscribeSection /> : null}
      </main>
      <Footer
        content={content}
        sections={sections}
        onOpenAdmin={onOpenAdmin}
      />
      {content.chatbotEnabled && sections.chatbot ? <ChatWidget /> : null}
    </div>
  );
}

export function LandingPage(props: LandingPageProps) {
  return (
    <LangProvider>
      <LandingShell {...props} />
    </LangProvider>
  );
}
