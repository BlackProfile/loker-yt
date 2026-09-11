"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Calendar,
  Check,
  Clapperboard,
  Clock,
  FolderOpen,
  Instagram,
  Lock,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { Position, SiteContent } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ApplyForm } from "@/components/landing/apply-form";
import { BenefitIcon } from "@/components/landing/benefit-icon";

type LandingPageProps = {
  content: SiteContent;
  positions: Position[];
  stats: { openRoles: number; totalApplications: number };
  onOpenAdmin: () => void;
};

const NAV_LINKS = [
  { href: "#posisi", label: "Posisi" },
  { href: "#benefit", label: "Benefit" },
  { href: "#cara-lamar", label: "Cara Lamar" },
  { href: "#faq", label: "FAQ" },
] as const;

const STEPS = [
  {
    number: "01",
    title: "Pilih Posisi",
    description:
      "Telusuri lowongan yang tersedia dan temukan yang paling cocok dengan keahlianmu.",
  },
  {
    number: "02",
    title: "Isi Formulir",
    description:
      "Lengkapi data diri dan tautan karyamu. Hanya butuh 3 menit.",
  },
  {
    number: "03",
    title: "Wawancara Online",
    description:
      "Tim kami akan menghubungimu via WhatsApp atau email untuk sesi tanya jawab.",
  },
  {
    number: "04",
    title: "Gabung Tim",
    description:
      "Ikuti onboarding singkat dan mulai proyek pertamamu bersama kami.",
  },
] as const;

const ROSE_BADGE = "border-rose-200 bg-rose-50 text-rose-600";

function whatsappHref(number: string) {
  return `https://wa.me/${number.replace(/[^\d]/g, "")}`;
}

function instagramHref(handle: string) {
  const trimmed = handle.trim();
  if (!trimmed) return "#";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://instagram.com/${trimmed.replace(/^@/, "")}`;
}

function Container({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>
      {children}
    </div>
  );
}

function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, ease: "easeOut", delay }}
    >
      {children}
    </motion.div>
  );
}

function BrandMark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-br from-rose-600 to-amber-500 text-white",
        size === "md" ? "p-2" : "p-1.5",
      )}
    >
      <Clapperboard
        className={size === "md" ? "h-5 w-5" : "h-4 w-4"}
        aria-hidden="true"
      />
    </div>
  );
}

function Navbar({
  siteName,
  tagline,
}: {
  siteName: string;
  tagline: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

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

        <nav
          aria-label="Navigasi utama"
          className="hidden items-center gap-1 md:flex"
        >
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <Button size="sm" asChild className="ml-2">
            <a href="#lamar">Lamar Sekarang</a>
          </Button>
        </nav>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11 md:hidden"
              aria-label="Buka menu"
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
                Menu navigasi {siteName}
              </SheetDescription>
            </SheetHeader>
            <nav aria-label="Menu seluler" className="flex flex-col gap-1 px-4">
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {link.label}
                </a>
              ))}
              <Button asChild className="mt-3">
                <a href="#lamar" onClick={() => setMobileOpen(false)}>
                  Lamar Sekarang
                </a>
              </Button>
            </nav>
          </SheetContent>
        </Sheet>
      </Container>
    </header>
  );
}

function Hero({
  content,
  stats,
}: {
  content: SiteContent;
  stats: LandingPageProps["stats"];
}) {
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
            <p className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
              <Calendar className="h-4 w-4 text-rose-400" aria-hidden="true" />
              Pendaftaran ditutup: {content.deadline}
            </p>
          ) : null}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button size="lg" className="h-11" asChild>
              <a href="#lamar">Lamar Sekarang</a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11 border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
              asChild
            >
              <a href="#posisi">Lihat Posisi</a>
            </Button>
          </div>
        </FadeIn>

        <FadeIn delay={0.15} className="mt-14">
          <div className="grid grid-cols-3 divide-x divide-white/10 border-t border-white/10 pt-8">
            <div className="pr-4 sm:pr-10">
              <p className="text-2xl font-bold md:text-3xl">{stats.openRoles}</p>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                Posisi Terbuka
              </p>
            </div>
            <div className="px-4 sm:px-10">
              <p className="text-2xl font-bold md:text-3xl">
                {stats.totalApplications}+
              </p>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                Pelamar Masuk
              </p>
            </div>
            <div className="pl-4 sm:pl-10">
              <p className="text-2xl font-bold md:text-3xl">100%</p>
              <p className="mt-1 text-xs text-zinc-400 sm:text-sm">
                Tim Remote
              </p>
            </div>
          </div>
        </FadeIn>
      </Container>
    </section>
  );
}

function PositionCard({
  position,
  onApply,
}: {
  position: Position;
  onApply: (positionId: string) => void;
}) {
  return (
    <Card className="h-full gap-4 rounded-2xl p-6">
      <div>
        <Badge className="border-rose-200 bg-rose-50 text-rose-700">
          {position.department}
        </Badge>
        <h3 className="mt-3 text-lg font-semibold">{position.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{position.type}</Badge>
          <Badge variant="secondary" className="gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {position.location}
          </Badge>
        </div>
      </div>

      <p className="line-clamp-3 text-sm text-muted-foreground">
        {position.description}
      </p>

      {position.requirements.length > 0 ? (
        <ul className="space-y-2">
          {position.requirements.slice(0, 3).map((requirement, index) => (
            <li
              key={`${position.id}-req-${index}`}
              className="flex items-start gap-2 text-sm text-muted-foreground"
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                aria-hidden="true"
              />
              <span>{requirement}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          Detail kebutuhan menyusul.
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-xs text-muted-foreground">
          {position.requirements.length > 0
            ? `${position.requirements.length} persyaratan`
            : ""}
        </span>
        <Button size="sm" onClick={() => onApply(position.id)}>
          Lamar Posisi Ini
        </Button>
      </div>
    </Card>
  );
}

function PositionsSection({
  positions,
  onApply,
}: {
  positions: Position[];
  onApply: (positionId: string) => void;
}) {
  return (
    <section id="posisi" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            Lowongan
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            Posisi yang Dibutuhkan
          </h2>
          <p className="mt-3 text-muted-foreground">
            Semua peran bersifat remote dan fleksibel. Temukan yang paling
            sesuai dengan keahlianmu.
          </p>
        </FadeIn>

        {positions.length === 0 ? (
          <FadeIn className="mt-10">
            <Card className="items-center gap-3 rounded-2xl p-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                <FolderOpen className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="font-semibold">Belum ada posisi yang dibuka.</p>
              <p className="text-sm text-muted-foreground">
                Pantau terus halaman ini.
              </p>
            </Card>
          </FadeIn>
        ) : (
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {positions.map((position, index) => (
              <FadeIn
                key={position.id}
                delay={Math.min(index, 5) * 0.06}
                className="h-full"
              >
                <PositionCard position={position} onApply={onApply} />
              </FadeIn>
            ))}
          </div>
        )}
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
  return (
    <section className="bg-zinc-50 py-16 md:py-24">
      <Container>
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <FadeIn>
            <Badge variant="outline" className={ROSE_BADGE}>
              Tentang Kami
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
              <p className="mt-4 text-xl font-semibold">
                Berkarya bersama, tumbuh bersama.
              </p>
              <p className="mt-2 text-sm text-white/80">
                Kami membangun rumah kreatif tempat ide-ide liar dieksekusi
                dengan rapi.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              <Card className="gap-1 rounded-2xl p-4 text-center">
                <p className="text-xl font-bold md:text-2xl">
                  {stats.openRoles}
                </p>
                <p className="text-xs text-muted-foreground">Posisi Aktif</p>
              </Card>
              <Card className="gap-1 rounded-2xl p-4 text-center">
                <p className="text-xl font-bold md:text-2xl">
                  {stats.totalApplications}+
                </p>
                <p className="text-xs text-muted-foreground">Lamaran Masuk</p>
              </Card>
              <Card className="gap-1 rounded-2xl p-4 text-center">
                <p className="text-xl font-bold md:text-2xl">2 Jt+</p>
                <p className="text-xs text-muted-foreground">Komunitas</p>
              </Card>
            </div>
          </FadeIn>
        </div>
      </Container>
    </section>
  );
}

function BenefitsSection({ content }: { content: SiteContent }) {
  return (
    <section id="benefit" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            Benefit
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            Kenapa Bergabung dengan Kami?
          </h2>
          <p className="mt-3 text-muted-foreground">
            Lebih dari sekadar pekerjaan — kami bantu kamu bertumbuh jadi
            kreator profesional.
          </p>
        </FadeIn>

        {content.benefits.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">
            Benefit akan segera diumumkan.
          </p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {content.benefits.map((benefit, index) => (
              <FadeIn
                key={`${benefit.title}-${index}`}
                delay={Math.min(index, 5) * 0.06}
                className="h-full"
              >
                <Card className="h-full gap-4 rounded-2xl p-6">
                  <div className="w-fit rounded-xl bg-rose-100 p-3 text-rose-600">
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
  return (
    <section
      id="cara-lamar"
      className="scroll-mt-24 bg-zinc-50 py-16 md:py-24"
    >
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            Alur
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            Cara Melamar
          </h2>
          <p className="mt-3 text-muted-foreground">
            Empat langkah sederhana dari menemukan posisi hingga menjadi bagian
            dari tim.
          </p>
        </FadeIn>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <FadeIn key={step.number} delay={index * 0.06} className="h-full">
              <Card className="h-full gap-3 rounded-2xl p-6">
                <span
                  aria-hidden="true"
                  className="text-4xl font-bold text-rose-600/20"
                >
                  {step.number}
                </span>
                <h3 className="font-semibold">{step.title}</h3>
                <p className="text-sm text-muted-foreground">
                  {step.description}
                </p>
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
  return (
    <section id="lamar" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <div className="grid gap-8 lg:grid-cols-5 lg:gap-10">
          <FadeIn className="lg:col-span-2">
            <Badge variant="outline" className={ROSE_BADGE}>
              Formulir
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              Siap Bergabung dengan Kami?
            </h2>
            <p className="mt-4 text-muted-foreground">
              Isi formulir dengan data terbaikmu. Semakin jelas portofolio dan
              pengalamanmu, semakin besar peluangmu untuk diterima.
            </p>

            <ul className="mt-6 space-y-3">
              <li className="flex items-start gap-3">
                <ShieldCheck
                  className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
                  aria-hidden="true"
                />
                <span className="text-sm text-muted-foreground">
                  Data kamu aman dan hanya dipakai untuk seleksi
                </span>
              </li>
              <li className="flex items-start gap-3">
                <Clock
                  className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
                  aria-hidden="true"
                />
                <span className="text-sm text-muted-foreground">
                  Respons dalam 1-3 hari kerja
                </span>
              </li>
              <li className="flex items-start gap-3">
                <MessageCircle
                  className="mt-0.5 h-5 w-5 shrink-0 text-rose-600"
                  aria-hidden="true"
                />
                <span className="text-sm text-muted-foreground">
                  Pertanyaan? Hubungi kami
                </span>
              </li>
            </ul>

            <Card className="mt-8 gap-3 rounded-2xl p-6">
              <p className="text-sm font-semibold">Kontak</p>
              <a
                href={`mailto:${content.contactEmail}`}
                className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Mail
                  className="h-4 w-4 shrink-0 text-rose-600"
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
                  className="h-4 w-4 shrink-0 text-rose-600"
                  aria-hidden="true"
                />
                <span>WhatsApp {content.contactWhatsapp}</span>
              </a>
              <a
                href={instagramHref(content.instagram)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center gap-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Instagram
                  className="h-4 w-4 shrink-0 text-rose-600"
                  aria-hidden="true"
                />
                <span className="break-all">{content.instagram || "Instagram"}</span>
              </a>
            </Card>
          </FadeIn>

          <FadeIn delay={0.1} className="lg:col-span-3">
            <Card className="rounded-2xl p-6 md:p-8">
              <ApplyForm
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

function FaqSection({ content }: { content: SiteContent }) {
  return (
    <section id="faq" className="scroll-mt-24 bg-zinc-50 py-16 md:py-24">
      <Container>
        <FadeIn className="mx-auto max-w-3xl">
          <div className="text-center">
            <Badge variant="outline" className={ROSE_BADGE}>
              FAQ
            </Badge>
            <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              Pertanyaan yang Sering Diajukan
            </h2>
            <p className="mt-3 text-muted-foreground">
              Belum menemukan jawaban? Hubungi kami via WhatsApp.
            </p>
          </div>

          {content.faqs.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted-foreground">
              Belum ada pertanyaan yang terdaftar.
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

function FinalCtaSection({ content }: { content: SiteContent }) {
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
                Masih ragu untuk mulai?
              </h2>
              <p className="mt-4 text-zinc-400">
                Ngobrol dulu santai dengan tim kami. Siapkan portofolio
                terbaikmu, sisanya kita bantu.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button size="lg" className="h-11" asChild>
                  <a href="#lamar">Lamar Sekarang</a>
                </Button>
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
                    Chat via WhatsApp
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
  onOpenAdmin,
}: {
  content: SiteContent;
  onOpenAdmin: () => void;
}) {
  return (
    <footer className="mt-auto border-t bg-background">
      <Container className="py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <div className="flex items-center gap-3">
              <BrandMark />
              <div className="leading-tight">
                <p className="font-bold">{content.siteName}</p>
                <p className="text-xs text-muted-foreground">
                  {content.tagline}
                </p>
              </div>
            </div>
            <p className="mt-4 max-w-sm text-sm text-muted-foreground">
              {content.footerText}
            </p>
          </div>

          <nav aria-label="Navigasi footer">
            <h3 className="text-sm font-semibold">Navigasi</h3>
            <ul className="mt-4 space-y-1">
              {NAV_LINKS.map((link) => (
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

          <div>
            <h3 className="text-sm font-semibold">Kontak</h3>
            <ul className="mt-4 space-y-1">
              <li>
                <a
                  href={`mailto:${content.contactEmail}`}
                  className="flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Mail
                    className="h-4 w-4 shrink-0 text-rose-600"
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
                    className="h-4 w-4 shrink-0 text-rose-600"
                    aria-hidden="true"
                  />
                  <span>WhatsApp</span>
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
                    className="h-4 w-4 shrink-0 text-rose-600"
                    aria-hidden="true"
                  />
                  <span className="break-all">{content.instagram || "Instagram"}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t pt-6 sm:flex-row">
          <p className="text-xs text-muted-foreground">{content.footerText}</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenAdmin}
            aria-label="Buka panel admin"
            className="text-muted-foreground"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Admin
          </Button>
        </div>
      </Container>
    </footer>
  );
}

export function LandingPage({
  content,
  positions,
  stats,
  onOpenAdmin,
}: LandingPageProps) {
  const [selectedPositionId, setSelectedPositionId] = useState("");

  const handleApplyPosition = (positionId: string) => {
    setSelectedPositionId(positionId);
    document.getElementById("lamar")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar siteName={content.siteName} tagline={content.tagline} />
      <main className="flex-1">
        <Hero content={content} stats={stats} />
        <PositionsSection positions={positions} onApply={handleApplyPosition} />
        <AboutSection content={content} stats={stats} />
        <BenefitsSection content={content} />
        <HowToApplySection />
        <ApplySection
          content={content}
          positions={positions}
          positionId={selectedPositionId}
          onPositionIdChange={setSelectedPositionId}
        />
        <FaqSection content={content} />
        <FinalCtaSection content={content} />
      </main>
      <Footer content={content} onOpenAdmin={onOpenAdmin} />
    </div>
  );
}
