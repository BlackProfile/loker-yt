"use client";

// Halaman detail per lowongan (?posisi=slug) — persyaratan, ketentuan, benefit,
// contoh karya, dan FORMULIR PENDAFTARAN khusus lowongan ini.
// Formulir berada di balik GERBANG BACA: pengunjung harus membaca bagian
// kontennya dulu (dicentang otomatis via IntersectionObserver), setelah semua
// terbaca formulir terbuka otomatis. Progres per lowongan disimpan sessionStorage.
// Data hidup: komponen menerima positions dari useLiveResource (realtime),
// sehingga posisi yang baru ditutup/diarsip otomatis keluar dari tampilan.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BellRing,
  BookOpenCheck,
  Briefcase,
  BusFront,
  Calendar,
  CalendarClock,
  Check,
  Circle,
  ClipboardList,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  Flame,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  Laptop,
  Link2,
  Linkedin,
  ListChecks,
  Loader2,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  PenLine,
  Phone,
  Pin,
  Send,
  Sparkles,
  TrendingUp,
  Users,
  UtensilsCrossed,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Position,
  PositionPublicStats,
  SiteContent,
} from "@/lib/types";
import { SHIFT_SYSTEM_LABELS } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
  linkedinShareHref,
  safeExternalUrl,
  telegramShareHref,
  twitterShareHref,
  waShareHref,
  whatsappHref,
  youtubeEmbedId,
} from "@/components/landing/landing-utils";
import { DeadlineCountdown } from "@/components/landing/deadline-countdown";
import { WorkModeBadge } from "@/components/landing/positions-section";
import { ApplyWizard } from "@/components/landing/apply-wizard";
import {
  isCvEnabled,
  isCvRequired,
  isFormSchemaActive,
  isIntroEnabled,
  isIntroRequired,
  isPortfolioEnabled,
  isPortfolioRequired,
} from "@/lib/form-schema";
import { categoryForStage, stageLabel, stagesForPosition } from "@/lib/stages";

const SOON_DAYS = 3;
const NEW_DAYS = 7;

// ---------------------------------------------------------------------------
// Ikon benefit otomatis: petakan kata kunci pada teks benefit -> ikon lucide
// (fallback Sparkles). Urutan penting: aturan paling spesifik dipasang dulu.
// ---------------------------------------------------------------------------
const BENEFIT_KEYWORD_ICONS: [RegExp, LucideIcon][] = [
  [/asuransi|bpjs|kesehatan|insurance|medis|mcu/i, Heart],
  [/gaji|salary|upah|tunjangan|bonus|thr|insentif/i, Wallet],
  [/cuti|libur|leave|holiday|lifo/i, Calendar],
  [/jam\s|jam fleks|flexi|fleksibel|waktu kerja|hours/i, Clock],
  [/remote|wfh|dari mana saja|kerja jarak jauh/i, Globe],
  [/training|pelatihan|kursus|workshop|mentoring|kelas/i, GraduationCap],
  [/karier|karir|jenjang|promosi|career|growth|pengembangan/i, TrendingUp],
  [/makan|meal|lunch|catering|snack/i, UtensilsCrossed],
  [/transport|parkir|bensin|commuter|operasional/i, BusFront],
  [/laptop|peralatan|perangkat|alat kerja|equipment|gear/i, Laptop],
  [/tim|team|komunitas|community|kolaborasi/i, Users],
];

function benefitIconFor(text: string): LucideIcon {
  for (const [pattern, icon] of BENEFIT_KEYWORD_ICONS) {
    if (pattern.test(text)) return icon;
  }
  return Sparkles;
}

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

// ---------------------------------------------------------------------------
// Gerbang baca: formulir pendaftaran terkunci sampai semua bagian konten
// (deskripsi, persyaratan, ketentuan, benefit, karya) terbaca. Bagian yang
// masuk area baca viewport dicentang otomatis lewat IntersectionObserver.
// ---------------------------------------------------------------------------

type GateSection = { id: string; label: string; done: boolean };

function ApplyGate({
  sections,
  readCount,
  onJump,
  onOpen,
}: {
  sections: GateSection[];
  readCount: number;
  onJump: (id: string) => void;
  onOpen: () => void;
}) {
  const { t } = useLang();
  const total = sections.length;
  const allRead = readCount >= total;
  const progressValue = total > 0 ? Math.round((readCount / total) * 100) : 100;

  return (
    <div className="flex flex-col gap-4" aria-live="polite">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
            allRead
              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
          )}
        >
          <BookOpenCheck className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{t.detail.gateTitle}</p>
          <p className="text-xs text-muted-foreground">
            {allRead ? t.detail.gateReady : fillTemplate(t.detail.gateProgress, { read: readCount, total })}
          </p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{t.detail.gateDesc}</p>

      <div className="flex flex-col gap-2">
        <Progress
          value={progressValue}
          className={cn("h-1.5", allRead && "[&>div]:bg-emerald-500")}
          aria-label={fillTemplate(t.detail.gateProgress, { read: readCount, total })}
        />
        <p className="text-xs text-muted-foreground">{t.detail.gateHint}</p>
      </div>

      <ul className="flex flex-col gap-1.5">
        {sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              onClick={() => onJump(section.id)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                section.done
                  ? "border-emerald-200 bg-emerald-50/60 text-foreground dark:border-emerald-900 dark:bg-emerald-950/30"
                  : "bg-zinc-50/60 text-muted-foreground hover:bg-accent hover:text-foreground dark:bg-zinc-900/40",
              )}
            >
              {section.done ? (
                <BadgeCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
              <ArrowRight
                className="size-3.5 shrink-0 text-muted-foreground/60"
                aria-hidden="true"
              />
            </button>
          </li>
        ))}
      </ul>

      <Button
        className="min-h-11 w-full"
        disabled={!allRead}
        onClick={onOpen}
      >
        {allRead ? (
          <>
            <ArrowRight className="size-4" aria-hidden="true" />
            {t.detail.gateOpen}
          </>
        ) : (
          <>
            <Lock className="size-4" aria-hidden="true" />
            {t.detail.gateLocked}
          </>
        )}
      </Button>
    </div>
  );
}

// Pil progres mengambang: selama gerbang belum terbuka, pembaca tetap melihat
// progres baca di bawah layar (pengganti info gerbang yang sebelumnya selalu
// terlihat di kolom kanan). Diklik → gulir ke kartu formulir.
function GateProgressPill({
  readCount,
  total,
  onClick,
}: {
  readCount: number;
  total: number;
  onClick: () => void;
}) {
  const { t } = useLang();
  const allRead = total > 0 && readCount >= total;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <button
        type="button"
        onClick={onClick}
        aria-label={fillTemplate(t.detail.gateProgress, { read: readCount, total })}
        className="pointer-events-auto flex min-h-11 items-center gap-2.5 rounded-full border bg-background/90 py-2 pl-2.5 pr-4 shadow-lg backdrop-blur transition-colors hover:bg-accent"
      >
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-full",
            allRead
              ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
              : "bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400",
          )}
        >
          <BookOpenCheck className="size-3.5" aria-hidden="true" />
        </span>
        <span className="text-xs font-medium">
          {allRead
            ? t.detail.gateReady
            : fillTemplate(t.detail.gateProgress, { read: readCount, total })}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Daftar tunggu "Ingatkan saya bila dibuka lagi" — baris input email inline
// (tanpa dialog/modal). Sukses/gagal ditampilkan sebagai pesan inline.
// ---------------------------------------------------------------------------

const WAITLIST_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WAITLIST_SUCCESS_FALLBACK = "Siap. Kami email kamu begitu posisi ini dibuka lagi.";

function WaitlistRow({ slug }: { slug: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const registered = status === "success";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "loading") return;
    const value = email.trim();
    if (!WAITLIST_EMAIL_REGEX.test(value)) {
      setStatus("error");
      setMessage("Masukkan alamat email yang valid, misalnya nama@email.com.");
      return;
    }
    setStatus("loading");
    setMessage("");
    try {
      const res = await fetch("/api/public/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, email: value }),
      });
      const data: { ok?: boolean; message?: string; error?: string } | null =
        await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setStatus("success");
        setMessage(
          data.message && data.message.trim().length > 0
            ? data.message
            : WAITLIST_SUCCESS_FALLBACK,
        );
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data?.error ?? "Gagal mendaftar. Coba lagi nanti.");
      }
    } catch {
      setStatus("error");
      setMessage("Gagal mendaftar. Periksa koneksi internetmu lalu coba lagi.");
    }
  };

  return (
    <div className="rounded-xl border bg-zinc-50/60 p-4 dark:bg-zinc-900/40">
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
          <BellRing className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">
            Ingatkan saya bila dibuka lagi
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Tinggalkan email kamu — kami kirim kabar begitu pendaftaran posisi
            ini dibuka kembali.
          </p>
        </div>
      </div>

      {registered ? (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
          aria-live="polite"
        >
          <Check
            className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p>{message}</p>
            <button
              type="button"
              onClick={() => {
                setStatus("idle");
                setMessage("");
              }}
              className="mt-1 text-xs font-medium text-emerald-700 underline-offset-2 transition-colors hover:underline dark:text-emerald-300"
            >
              Gunakan email lain
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={submit}
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          noValidate
        >
          <label htmlFor={`waitlist-email-${slug}`} className="sr-only">
            Alamat email
          </label>
          <Input
            id={`waitlist-email-${slug}`}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="nama@email.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (status === "error") {
                setStatus("idle");
                setMessage("");
              }
            }}
            disabled={status === "loading"}
            aria-invalid={status === "error"}
            className="min-h-11 flex-1"
          />
          <Button
            type="submit"
            className="min-h-11 sm:min-h-9"
            disabled={status === "loading"}
          >
            {status === "loading" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <BellRing className="size-4" aria-hidden="true" />
            )}
            Ingatkan saya
          </Button>
        </form>
      )}

      {status === "error" && message ? (
        <p
          className="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400"
          role="alert"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lowongan serupa: posisi terbuka lain dari daftar tayang (data hidup dari
// /api/public/content via prop positions). Diurutkan: departemen sama dulu,
// lalu tipe sama; diambil 3. disembunyikan bila tidak ada kandidat.
// ---------------------------------------------------------------------------

function SimilarPositions({
  current,
  positions,
  onOpenPosition,
  title,
  description,
}: {
  current: Position | null;
  positions: Position[];
  onOpenPosition: (slug: string) => void;
  title: string;
  description: string;
}) {
  const candidates = useMemo(() => {
    const now = Date.now();
    // Daftar tayang sudah difilter server (aktif, publishAt tercapai, belum
    // lewat closesAt) — filter diulang ringan di sini sebagai pengaman.
    const open = positions.filter((p) => {
      if (current && p.id === current.id) return false;
      if (!p.isActive) return false;
      if (p.closesAt && new Date(p.closesAt).getTime() <= now) return false;
      if (p.publishAt && new Date(p.publishAt).getTime() > now) return false;
      return true;
    });
    if (!current) return open.slice(0, 3);
    const dept = current.department.trim().toLowerCase();
    const type = current.type.trim().toLowerCase();
    return open
      .sort((a, b) => {
        const aDept = a.department.trim().toLowerCase() === dept ? 0 : 1;
        const bDept = b.department.trim().toLowerCase() === dept ? 0 : 1;
        if (aDept !== bDept) return aDept - bDept;
        const aType = a.type.trim().toLowerCase() === type ? 0 : 1;
        const bType = b.type.trim().toLowerCase() === type ? 0 : 1;
        return aType - bType;
      })
      .slice(0, 3);
  }, [positions, current]);

  if (candidates.length === 0) return null;

  return (
    <section aria-label={title}>
      <SectionTitle icon={Sparkles}>{title}</SectionTitle>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {candidates.map((p) => (
          <Card key={p.id} className="flex flex-col gap-3 rounded-2xl p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" title={p.title}>
                {p.title}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className={ROSE_BADGE}>
                  {p.department}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  <ClipboardList className="size-3" aria-hidden="true" />
                  {p.type}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
                  {p.location}
                </span>
                {p.salaryVisible && p.salaryText ? (
                  <span className="flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400">
                    <Wallet className="size-3.5 shrink-0" aria-hidden="true" />
                    {p.salaryText}
                  </span>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-auto h-11 w-full sm:h-9"
              onClick={() => onOpenPosition(p.slug ?? p.id)}
            >
              Lihat detail
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </Card>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cover default: bila admin tidak mengunggah gambar sampul, halaman tetap
// punya pembuka berwarna — gradasi rose->amber + tekstur grid + ikon
// departemen. Murni dekoratif (aria-hidden), tanpa animasi (aman reduced motion).
// ---------------------------------------------------------------------------
function DefaultCover({ department }: { department: string }) {
  return (
    <div
      aria-hidden="true"
      className="relative h-44 w-full overflow-hidden rounded-2xl border bg-gradient-to-br from-rose-600 via-rose-500 to-amber-400 shadow-sm md:h-64"
    >
      {/* Tekstur grid halus */}
      <div className="absolute inset-0 opacity-10 [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:28px_28px]" />
      {/* Blob cahaya lembut */}
      <div className="absolute -right-10 -top-16 size-56 rounded-full bg-white/15 blur-2xl" />
      <div className="absolute -bottom-24 left-1/4 size-64 rounded-full bg-amber-200/25 blur-3xl" />
      {/* Ikon departemen di tengah */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="flex size-20 items-center justify-center rounded-3xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm md:size-24">
          <Briefcase className="size-10 text-white md:size-12" />
        </span>
      </div>
      {/* Kicker departemen */}
      <span className="absolute bottom-4 left-4 rounded-full bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-white backdrop-blur-sm md:bottom-6 md:left-6">
        {department}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline alur seleksi: lingkaran bernomor + garis penghubung vertikal,
// pengganti chip "1. X 2. Y" agar proses terbaca sekilas sebagai alur.
// Tahap akhir hanya diberi tanda emerald bila kategorinya memang ACCEPTED
// (bukan tahap penolakan — penolakan tetap lingkaran bernomor biasa).
// ---------------------------------------------------------------------------
function ProcessTimeline({
  stages,
  stageCategories,
}: {
  stages: string[];
  stageCategories?: Record<string, StageCategory> | null;
}) {
  const lastIsAccepted =
    stages.length > 0 &&
    categoryForStage(stages[stages.length - 1], stageCategories) === "ACCEPTED";
  return (
    <ol className="flex flex-col">
      {stages.map((stage, index) => {
        const isFinal = index === stages.length - 1;
        const isSuccess = isFinal && lastIsAccepted;
        return (
          <li key={stage} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  isSuccess ? "bg-emerald-600 text-white" : "bg-rose-600 text-white",
                )}
              >
                {isSuccess ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  index + 1
                )}
              </span>
              {!isFinal ? (
                <span
                  aria-hidden="true"
                  className="my-0.5 w-px flex-1 bg-zinc-300 dark:bg-zinc-700"
                />
              ) : null}
            </div>
            <span className="pb-3 text-sm leading-5">{stageLabel(stage)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Bar sticky ala job-board: muncul saat judul posisi terlewat dari viewport
// (scroll melewati hero) — judul + gaji + sisa hari + tombol Lamar. Hilang
// lagi saat kembali ke atas. Di mobile ditampilkan ringkas (judul + tombol).
// ---------------------------------------------------------------------------
function StickyApplyBar({
  title,
  salary,
  daysLeftText,
  visible,
  onApply,
}: {
  title: string;
  salary: string | null;
  daysLeftText: string | null;
  visible: boolean;
  onApply: () => void;
}) {
  const { t } = useLang();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          initial={reduce ? false : { y: -56, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: -56, opacity: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed inset-x-0 top-16 z-30 border-b bg-background/85 backdrop-blur"
        >
          <Container className="flex h-14 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <p className="min-w-0 truncate text-sm font-semibold">{title}</p>
              <span className="hidden shrink-0 items-center gap-3 sm:flex">
                {salary ? (
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    <Wallet className="size-3.5" aria-hidden="true" />
                    {salary}
                  </span>
                ) : null}
                {daysLeftText ? (
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    <CalendarClock className="size-3.5" aria-hidden="true" />
                    {daysLeftText}
                  </span>
                ) : null}
              </span>
            </div>
            <Button size="sm" className="h-9 shrink-0" onClick={onApply}>
              <PenLine className="size-4" aria-hidden="true" />
              {t.detail.stickyApply}
            </Button>
          </Container>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
    /** Buka lowongan lain dari seksi "Lowongan serupa" (bila tak diberikan, navigasi URL dipakai). */
    onOpenPosition?: (slug: string) => void;
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
  onOpenPosition,
}: {
  slug: string;
  content: SiteContent;
  positions: Position[];
  positionStats?: Record<string, PositionPublicStats>;
  refreshing?: boolean;
  onBack: () => void;
  onOpenPosition?: (slug: string) => void;
}) {
  const { t, lang } = useLang();
  const [copied, setCopied] = useState(false);

  // Gerbang baca: formulir terkunci sampai semua bagian konten dibaca.
  // Progres per slug disimpan sessionStorage — pindah lowongan & kembali lagi
  // tidak perlu membaca ulang.
  const [formUnlocked, setFormUnlocked] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.sessionStorage.getItem(`lumina-read-${slug}`) === "1";
    } catch {
      return false;
    }
  });
  const [readIds, setReadIds] = useState<string[]>([]);

  const position = useMemo(
    () => positions.find((p) => p.slug === slug) ?? null,
    [positions, slug],
  );

  const shareUrl = position ? buildPositionUrl(position) : "";

  // Konten dua bahasa: saat lang "en" dan versi EN terisi (non-kosong), pakai
  // versi EN; selain itu fallback ke versi Indonesia. Hanya SUMBER TEKS yang
  // berganti — struktur seksi & gerbang baca (id jangkar) tetap sama.
  const display = useMemo(() => {
    if (!position) {
      return { title: "", description: "", requirements: [] as string[] };
    }
    return {
      title:
        lang === "en" && position.titleEn ? position.titleEn : position.title,
      description:
        lang === "en" && position.descriptionEn
          ? position.descriptionEn
          : position.description,
      requirements:
        lang === "en" && position.requirementsEn.length > 0
          ? position.requirementsEn
          : position.requirements,
    };
  }, [position, lang]);

  // Contoh karya — dipakai render seksi & penentu seksi gerbang.
  const workEmbeds = useMemo(
    () =>
      (position?.examples ?? [])
        .map((url) => ({ url, id: youtubeEmbedId(url) }))
        .filter((x) => x.id !== null)
        .slice(0, 4),
    [position],
  );
  const workLinks = useMemo(
    () =>
      (position?.examples ?? []).filter(
        (url) => youtubeEmbedId(url) === null && safeExternalUrl(url),
      ),
    [position],
  );

  // Seksi konten yang dirender = seksi yang wajib dibaca (harus persis sama
  // agar tidak ada seksi yang tak terpantau dan mengunci formulir selamanya).
  const gateSections = useMemo<GateSection[]>(() => {
    if (!position) return [];
    const list: { id: string; label: string }[] = [
      { id: "sec-deskripsi", label: t.detail.sectionDesc },
    ];
    if (display.requirements.length > 0)
      list.push({ id: "sec-persyaratan", label: t.detail.sectionReq });
    list.push({ id: "sec-ketentuan", label: t.detail.sectionTerms });
    if (position.benefits.length > 0)
      list.push({ id: "sec-benefit", label: t.detail.sectionBenefit });
    if (workEmbeds.length > 0 || workLinks.length > 0)
      list.push({ id: "sec-karya", label: t.detail.sectionWorks });
    return list.map((s) => ({ ...s, done: readIds.includes(s.id) }));
  }, [position, t, display, workEmbeds, workLinks, readIds]);
  const sectionIdsKey = gateSections.map((s) => s.id).join("|");

  const unlockForm = useCallback(
    (scroll: boolean) => {
      setFormUnlocked(true);
      try {
        window.sessionStorage.setItem(`lumina-read-${slug}`, "1");
      } catch {
        /* abaikan */
      }
      toast.success(t.detail.gateUnlockedToast);
      if (scroll) {
        window.setTimeout(() => {
          document
            .getElementById("form-card")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 250);
      }
    },
    [slug, t],
  );

  const jumpToSection = useCallback((id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Pelacak baca: bagian dianggap terbaca saat bagian itu masuk area baca
  // (atas 55% viewport). Fallback tanpa IntersectionObserver → langsung buka.
  useEffect(() => {
    if (formUnlocked || sectionIdsKey === "") return;
    if (typeof IntersectionObserver === "undefined") {
      const fallback = window.setTimeout(() => setFormUnlocked(true), 0);
      return () => window.clearTimeout(fallback);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setReadIds((prev) => {
          const next = new Set(prev);
          let added = false;
          for (const entry of entries) {
            if (entry.isIntersecting && !next.has(entry.target.id)) {
              next.add(entry.target.id);
              added = true;
            }
          }
          return added ? [...next] : prev;
        });
      },
      { rootMargin: "0px 0px -45% 0px", threshold: 0 },
    );
    for (const id of sectionIdsKey.split("|")) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [formUnlocked, sectionIdsKey]);

  // Semua bagian terbaca → formulir terbuka otomatis (dengan jeda kecil agar
  // checklist selesai dulu secara visual), lalu halaman digulir ke formulir.
  useEffect(() => {
    if (formUnlocked || gateSections.length === 0) return;
    if (readIds.length >= gateSections.length) {
      const timer = window.setTimeout(() => unlockForm(true), 650);
      return () => window.clearTimeout(timer);
    }
  }, [formUnlocked, gateSections.length, readIds.length, unlockForm]);

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

  // --- Bar sticky job-board: tampil saat judul posisi keluar dari viewport ---
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const [titleOutOfView, setTitleOutOfView] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setTitleOutOfView(!entries[0]?.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [position?.id]);

  // --- Bukti sosial: catat 1 view per sesi per posisi (endpoint publik) ---
  const positionId = position?.id ?? null;
  const [viewCount, setViewCount] = useState<number | null>(null);
  useEffect(() => {
    if (!positionId) return;
    setViewCount(null);
    let key: string | null = null;
    try {
      key = `lumina-viewed-${positionId}`;
      if (window.sessionStorage.getItem(key)) return; // sudah terhitat sesi ini
    } catch {
      key = null; // sessionStorage tidak tersedia — tetap kirim, tanpa dedupe
    }
    const controller = new AbortController();
    fetch(`/api/positions/${positionId}/view`, { method: "POST", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; views?: number } | null) => {
        if (data?.ok && typeof data.views === "number") {
          setViewCount(data.views);
          if (key) {
            try {
              window.sessionStorage.setItem(key, "1");
            } catch {
              /* abaikan */
            }
          }
        }
      })
      .catch(() => {
        /* gagal diam — bukti sosial bersifat pelengkap */
      });
    return () => controller.abort();
  }, [positionId]);

  const socialViews = viewCount ?? position?.views ?? null;

  // --- Bar sticky: teks sisa hari (>= 0 hari, dari closesAt) ---
  const stickyDaysLeftText = useMemo(() => {
    if (!position?.closesAt) return null;
    const diff = new Date(position.closesAt).getTime() - Date.now();
    if (diff <= 0) return null;
    const days = Math.floor(diff / 86400000);
    return fillTemplate(t.detail.daysLeft, { n: days });
  }, [position?.closesAt, t]);

  // Gaji untuk bar sticky (hanya bila admin menampilkannya)
  const stickySalary =
    position?.salaryVisible && position?.salaryText ? position.salaryText : null;

  // Buka lowongan lain (seksi "Lowongan serupa"). Bila HomeView tidak
  // memberikan callback, replikasi perilaku navigasinya: pushState URL
  // ?posisi=slug lalu event "app:navigate" (didengarkan HomeView) — tanpa reload.
  const openPosition =
    onOpenPosition ??
    ((positionSlug: string) => {
      history.pushState(
        null,
        "",
        `/?posisi=${encodeURIComponent(positionSlug.slice(0, 80))}`,
      );
      window.dispatchEvent(new Event("app:navigate"));
      window.scrollTo({ top: 0, behavior: "auto" });
    });

  // Lowongan hilang dari daftar tayang (ditutup/diarsip/nonaktif) → tampilan "tidak ditemukan"
  // dengan daftar lowongan lain yang masih dibuka.
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
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-20">
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
          <FadeIn delay={0.1} className="mt-12 w-full max-w-3xl">
            <SimilarPositions
              current={null}
              positions={positions}
              onOpenPosition={openPosition}
              title="Lowongan yang masih dibuka"
              description="Mungkin salah satu dari lowongan berikut cocok untukmu."
            />
          </FadeIn>
        </main>
      </div>
    );
  }

  const stats = positionStats[position.id] ?? null;
  const isNew = isWithinDaysBack(position.createdAt, NEW_DAYS);
  const isSoon = !!position.closesAt && isWithinDaysAhead(position.closesAt, SOON_DAYS);
  const quotaFull = stats?.remainingQuota != null && stats.remainingQuota <= 0;
  // Persentase kuota terisi (0-100, di-clamp) — dipakai bar visual Ketentuan.
  const quotaPct =
    stats && position.maxApplicants != null && position.maxApplicants > 0
      ? Math.min(100, Math.max(0, Math.round((stats.applications / position.maxApplicants) * 100)))
      : 0;
  // Urgensi kuota: tersisa <= 20% dari maksimum (dan masih ada sisa).
  const quotaUrgent =
    stats != null &&
    position.maxApplicants != null &&
    position.maxApplicants > 0 &&
    !quotaFull &&
    (stats.remainingQuota ?? 0) / position.maxApplicants <= 0.2;
  // Formulir per posisi: terbuka bila formulir global aktif, kuota belum penuh,
  // DAN formulir posisi ini tidak ditutup oleh admin (applyOpen).
  const positionFormClosed = position.applyOpen === false;
  // Batas waktu lewat dihitung di klien juga — posisi yang baru saja melewati
  // closesAt (belum keluar dari daftar tayang) langsung diperlakukan tertutup.
  const deadlinePassed =
    !!position.closesAt && new Date(position.closesAt).getTime() <= Date.now();
  // Posisi tidak bisa dilamar: lewat closesAt ATAU applyOpen false ATAU kuota penuh.
  // Kondisi ini yang memunculkan daftar tunggu & seksi lowongan serupa.
  const applyUnavailable = quotaFull || positionFormClosed || deadlinePassed;
  const canApplyOnline =
    content.sections.applyForm && !quotaFull && !positionFormClosed && !deadlinePassed;
  const stages = stagesForPosition(position.stages);

  // Lokasi & operasional (fitur non-remote): baris "Kota — Alamat" + tautan peta
  // yang hanya dirender bila protokolnya aman (http/https).
  const locationLine =
    [position.city?.trim(), position.address?.trim()]
      .filter((part): part is string => Boolean(part))
      .join(" — ") || null;
  const mapHref = position.mapsUrl ? safeExternalUrl(position.mapsUrl) : null;

  const requiredFiles = [
    position.requireCv ? t.detail.termsFilesCv : null,
    position.requireIntro ? t.detail.termsFilesIntro : null,
    position.requirePortfolio ? t.detail.termsFilesPortfolio : null,
  ].filter((x): x is string => x !== null);

  // Form Builder per posisi (skema v2): kartu Ketentuan berkas mengikuti
  // konfigurasi bagian Berkas skema — slot CV/intro/portofolio tampil hanya
  // bila flag *Enabled aktif, tanda wajib mengikuti flag *Required (bukan
  // lagi kolom posisi); label field tipe "file" milik skema tetap ditambahkan.
  // Mode klasik (skema null/tidak aktif) tak berubah.
  const schemaActive = isFormSchemaActive(position);
  const schemaFilesSection = schemaActive
    ? (position.formSchema?.sections.find((s) => s.kind === "files") ?? null)
    : null;
  // Label field tipe "file" milik skema (labelEn-aware) — tetap ditambahkan.
  const schemaFileLabels = schemaActive
    ? (position.formSchema?.fields ?? [])
        .filter((field) => field.type === "file")
        .map((field) => (lang === "en" && field.labelEn ? field.labelEn : field.label))
    : [];
  // Daftar berkas per slot: label + tanda wajib (badge) untuk mode skema.
  const schemaFileItems: { label: string; required: boolean }[] = schemaFilesSection
    ? [
        isCvEnabled(schemaFilesSection)
          ? {
              label: t.detail.termsFilesCv,
              required: isCvRequired(schemaFilesSection),
            }
          : null,
        isIntroEnabled(schemaFilesSection)
          ? {
              label: t.detail.termsFilesIntro,
              required: isIntroRequired(schemaFilesSection),
            }
          : null,
        isPortfolioEnabled(schemaFilesSection)
          ? {
              label: t.detail.termsFilesPortfolio,
              required: isPortfolioRequired(schemaFilesSection),
            }
          : null,
        ...(position.formSchema?.fields ?? [])
          .filter((field) => field.type === "file")
          .map((field) => ({
            label: lang === "en" && field.labelEn ? field.labelEn : field.label,
            required: field.required,
          })),
      ].filter((x): x is { label: string; required: boolean } => x !== null)
    : [];
  const requiredFilesWithSchema = schemaFilesSection
    ? schemaFileItems.map((item) => item.label)
    : [...requiredFiles, ...schemaFileLabels];

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
        {/* Cover — gambar admin, atau banner gradasi otomatis bila kosong */}
        <FadeIn>
          <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
            {position.coverFileId ? (
              <img
                src={`/api/files/${position.coverFileId}`}
                alt={`Cover lowongan ${display.title}`}
                className="h-44 w-full rounded-2xl border object-cover shadow-sm md:h-64"
              />
            ) : (
              <DefaultCover department={position.department} />
            )}
          </div>
        </FadeIn>

        <Container className="w-full max-w-5xl">
          {/* Header posisi */}
          <FadeIn className="mt-8">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={ROSE_BADGE}>
                {t.detail.badge}
              </Badge>
              {/* Mode kerja + kota (fitur non-remote) — selalu tampil di header. */}
              <WorkModeBadge position={position} />
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

            <h1 ref={titleRef} className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
              {display.title}
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

            {/* Posisi remote: satu baris tenang (fitur non-remote). */}
            {position.workMode !== "ONSITE" && position.workMode !== "HYBRID" ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
                <Globe
                  className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                {t.detail.remoteAnywhere}
              </p>
            ) : null}

            {/* Bukti sosial: jumlah view + pendaftar (pelengkap, tersembunyi bila nol) */}
            {socialViews != null && socialViews > 0 ? (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-zinc-50/60 px-2.5 py-1 dark:bg-zinc-900/40">
                  <Eye className="size-3.5" aria-hidden="true" />
                  {fillTemplate(t.detail.socialProofViews, { n: socialViews })}
                </span>
                {stats && stats.applications > 0 ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border bg-zinc-50/60 px-2.5 py-1 dark:bg-zinc-900/40">
                    <Users className="size-3.5" aria-hidden="true" />
                    {fillTemplate(t.detail.socialProofApps, { n: stats.applications })}
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* Aksi: lamar (scroll ke formulir) + bagikan + salin tautan */}
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-11 sm:h-9" onClick={() => jumpToSection("form-card")}>
                <PenLine className="size-4" aria-hidden="true" />
                {t.detail.ctaApply}
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={copyLink}>
                {copied ? (
                  <Check className="size-4 text-emerald-600" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {t.detail.shareCopy}
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                <a href={waShareHref(`${display.title} — ${shareUrl}`)} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" />
                  WhatsApp
                </a>
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                <a href={telegramShareHref(display.title, shareUrl)} target="_blank" rel="noopener noreferrer">
                  <Send className="size-4" aria-hidden="true" />
                  Telegram
                </a>
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                <a href={twitterShareHref(display.title, shareUrl)} target="_blank" rel="noopener noreferrer">
                  <Link2 className="size-4" aria-hidden="true" />
                  X
                </a>
              </Button>
              <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                <a href={linkedinShareHref(shareUrl)} target="_blank" rel="noopener noreferrer">
                  <Linkedin className="size-4" aria-hidden="true" />
                  LinkedIn
                </a>
              </Button>
            </div>

            {position.closesAt ? (
              <div className="mt-6">
                <DeadlineCountdown
                  deadline={position.closesAt}
                  variant="detail"
                  publishedAt={position.createdAt}
                />
              </div>
            ) : null}
          </FadeIn>

          <div className="mt-10 flex flex-col gap-12">
            {/* Konten: deskripsi, persyaratan, ketentuan, benefit, karya.
                Setiap seksi punya id jangkar untuk pelacak baca di gerbang formulir. */}
            <div className="flex flex-col gap-10">
              <FadeIn id="sec-deskripsi" className="scroll-mt-24">
                <SectionTitle icon={FileText}>{t.detail.sectionDesc}</SectionTitle>
                <p className="mt-3 max-w-3xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground md:text-base">
                  {display.description}
                </p>
              </FadeIn>

              {display.requirements.length > 0 ? (
                <FadeIn id="sec-persyaratan" className="scroll-mt-24">
                  <SectionTitle icon={ListChecks}>{t.detail.sectionReq}</SectionTitle>
                  <ul className="mt-3 space-y-2.5">
                    {display.requirements.map((req) => (
                      <li key={req} className="flex items-start gap-2.5 text-sm">
                        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        <span>{req}</span>
                      </li>
                    ))}
                  </ul>
                </FadeIn>
              ) : null}

              {/* Ketentuan lamaran — turunan dari pengaturan posisi */}
              <FadeIn id="sec-ketentuan" className="scroll-mt-24">
                <SectionTitle icon={ClipboardList}>{t.detail.sectionTerms}</SectionTitle>
                <Card className="mt-3 divide-y rounded-2xl p-2 md:p-3">
                  <TermRow icon={FileText} label={t.detail.termsFiles}>
                    {schemaFileItems.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {schemaFileItems.map((item) => (
                          <span
                            key={item.label}
                            className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800"
                          >
                            {item.label}
                            {/* Slot wajib bagian Berkas skema ditandai rose */}
                            {item.required ? (
                              <span className="ml-1 font-semibold text-rose-600 dark:text-rose-400">
                                {t.apply.uploads.required}
                              </span>
                            ) : null}
                          </span>
                        ))}
                      </span>
                    ) : schemaFilesSection ? (
                      <span className="text-muted-foreground">{t.detail.termsFilesNone}</span>
                    ) : requiredFilesWithSchema.length > 0 ? (
                      <span>{requiredFilesWithSchema.join(" · ")}</span>
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
                      <span className="flex flex-col gap-1.5">
                        <span
                          className={cn(
                            quotaUrgent && "font-medium text-rose-600 dark:text-rose-400",
                          )}
                        >
                          {quotaFull
                            ? t.detail.termsQuotaFull
                            : stats
                              ? quotaUrgent
                                ? fillTemplate(t.detail.termsQuotaUrgent, {
                                    left: stats.remainingQuota ?? 0,
                                  })
                                : fillTemplate(t.detail.termsQuotaValue, {
                                    used: stats.applications,
                                    max: position.maxApplicants,
                                    left: stats.remainingQuota ?? 0,
                                  })
                              : position.maxApplicants}
                        </span>
                        {/* Bar kuota: terisi = gradasi rose->amber; saat tersisa
                            <= 20% seluruh bar menjadi rose (urgensi). */}
                        {stats && !quotaFull ? (
                          <span
                            aria-hidden="true"
                            className="block h-1.5 w-44 max-w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
                          >
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                quotaUrgent
                                  ? "bg-rose-600"
                                  : "bg-gradient-to-r from-rose-600 to-amber-500",
                              )}
                              style={{ width: `${quotaPct}%` }}
                            />
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t.detail.termsQuotaUnlimited}</span>
                    )}
                  </TermRow>
                  {/* Screening klasik tidak ditanyakan saat skema Form Builder aktif
                      — wizard memakai pertanyaan kustom per bagian skema. */}
                  {!schemaActive ? (
                    <TermRow icon={ListChecks} label={t.detail.termsScreening}>
                      <span>
                        {position.screeningQuestions.length > 0
                          ? fillTemplate(t.detail.termsScreeningCount, {
                              n: position.screeningQuestions.length,
                            })
                          : t.detail.termsScreeningNone}
                      </span>
                    </TermRow>
                  ) : null}
                  {position.assignment.title ? (
                    <TermRow icon={ClipboardList} label={t.detail.termsTest}>
                      <span>{position.assignment.title}</span>
                    </TermRow>
                  ) : null}
                  {stages.length > 0 ? (
                    <TermRow icon={Workflow} label={t.detail.termsProcess}>
                      <ProcessTimeline
                        stages={stages}
                        stageCategories={position.stageCategories}
                      />
                    </TermRow>
                  ) : null}
                </Card>
              </FadeIn>

              {/* Lokasi & operasional — khusus posisi on-site/hybrid (fitur non-remote).
                  Informasi pelengkap: tidak masuk daftar gerbang baca. */}
              {position.workMode === "ONSITE" || position.workMode === "HYBRID" ? (
                <FadeIn id="sec-lokasi" className="scroll-mt-24">
                  <SectionTitle icon={MapPin}>
                    {t.detail.sectionLocation}
                  </SectionTitle>
                  <Card className="mt-3 divide-y rounded-2xl p-2 md:p-3">
                    <TermRow icon={MapPin} label={t.detail.locationAddress}>
                      <span className="flex flex-col gap-1.5">
                        {locationLine ? (
                          <span>{locationLine}</span>
                        ) : (
                          <span className="text-muted-foreground">
                            {t.detail.locationAddressNone}
                          </span>
                        )}
                        {mapHref ? (
                          <a
                            href={mapHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex w-fit items-center gap-1.5 font-medium text-rose-600 underline-offset-2 transition-colors hover:text-rose-700 hover:underline dark:text-rose-400 dark:hover:text-rose-300"
                          >
                            <ExternalLink
                              className="size-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            {t.detail.openMap}
                          </a>
                        ) : null}
                      </span>
                    </TermRow>
                    {position.workHours ? (
                      <TermRow icon={Clock} label={t.detail.locationHours}>
                        <span>{position.workHours}</span>
                      </TermRow>
                    ) : null}
                    {position.shiftSystem !== "NONE" ? (
                      <TermRow icon={CalendarClock} label={t.detail.locationShift}>
                        <span>
                          {SHIFT_SYSTEM_LABELS[position.shiftSystem] ??
                            position.shiftSystem}
                        </span>
                      </TermRow>
                    ) : null}
                    {position.facilities.length > 0 ? (
                      <TermRow icon={Sparkles} label={t.detail.locationFacilities}>
                        <span className="flex flex-wrap gap-1.5">
                          {position.facilities.map((facility) => (
                            <span
                              key={facility}
                              className="flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800"
                            >
                              <Check
                                className="size-3 text-emerald-600 dark:text-emerald-400"
                                aria-hidden="true"
                              />
                              {facility}
                            </span>
                          ))}
                        </span>
                      </TermRow>
                    ) : null}
                  </Card>
                </FadeIn>
              ) : null}

              {position.benefits.length > 0 ? (
                <FadeIn id="sec-benefit" className="scroll-mt-24">
                  <SectionTitle icon={Gift}>{t.detail.sectionBenefit}</SectionTitle>
                  <ul className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {position.benefits.map((benefit) => {
                      // Ikon dipetakan otomatis dari kata kunci teks benefit.
                      const BenefitIcon = benefitIconFor(benefit);
                      return (
                        <li
                          key={benefit}
                          className="flex items-start gap-2.5 rounded-lg border bg-zinc-50/60 p-3 text-sm dark:bg-zinc-900/40"
                        >
                          <BenefitIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                          <span>{benefit}</span>
                        </li>
                      );
                    })}
                  </ul>
                </FadeIn>
              ) : null}

              {workEmbeds.length > 0 || workLinks.length > 0 ? (
                <FadeIn id="sec-karya" className="scroll-mt-24">
                  <SectionTitle icon={Sparkles}>{t.detail.sectionWorks}</SectionTitle>
                  <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {workEmbeds.map(({ url, id }) => (
                      <div
                        key={url}
                        className="aspect-video overflow-hidden rounded-xl border bg-zinc-950"
                      >
                        <iframe
                          src={`https://www.youtube.com/embed/${id}`}
                          title={`Contoh karya ${display.title}`}
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

            {/* Setelah konten: gerbang baca → formulir pendaftaran, di tengah halaman */}
            <div className="mx-auto w-full max-w-2xl">
              <FadeIn delay={0.1}>
                <Card id="form-card" className="scroll-mt-24 gap-4 rounded-2xl p-5 md:p-6">
                  {canApplyOnline ? (
                    formUnlocked ? (
                      <>
                        <div className="flex items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                            <FileText className="size-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold leading-tight">
                              {display.title}
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
                        <button
                          type="button"
                          onClick={() => jumpToSection(gateSections[0]?.id ?? "sec-deskripsi")}
                          className="flex min-h-9 items-center justify-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <BookOpenCheck className="size-3.5" aria-hidden="true" />
                          {t.detail.gateReread}
                        </button>
                      </>
                    ) : (
                      <ApplyGate
                        sections={gateSections}
                        readCount={readIds.length}
                        onJump={jumpToSection}
                        onOpen={() => unlockForm(true)}
                      />
                    )
                  ) : (
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                          <CalendarClock className="size-4" aria-hidden="true" />
                        </span>
                        <p className="text-sm font-semibold">
                          {quotaFull
                            ? t.detail.termsQuotaFull
                            : positionFormClosed
                              ? t.detail.formClosedTitle
                              : t.detail.applyClosedTitle}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {!content.sections.applyForm
                          ? t.detail.applyDisabledDesc
                          : positionFormClosed
                            ? t.detail.formClosedDesc
                            : t.detail.applyClosedDesc}
                      </p>
                      {/* Daftar tunggu hanya untuk posisi yang memang tertutup
                          (bukan saat formulir global dimatikan admin). */}
                      {applyUnavailable ? <WaitlistRow slug={position.slug ?? slug} /> : null}
                    </div>
                  )}

                  {/* Kontak (selalu tampil di kartu formulir) */}
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

            {/* Posisi lain — selalu tampil bila ada kandidat: saat lamaran tutup
                menawarkan alternatif, saat masih buka mengajak menjelajah. */}
            <FadeIn delay={0.15}>
              {applyUnavailable ? (
                <SimilarPositions
                  current={position}
                  positions={positions}
                  onOpenPosition={openPosition}
                  title="Lowongan serupa"
                  description="Sementara posisi ini belum bisa dilamar, lowongan lain berikut masih membuka pendaftaran."
                />
              ) : (
                <SimilarPositions
                  current={position}
                  positions={positions}
                  onOpenPosition={openPosition}
                  title={t.detail.similarTitle}
                  description={t.detail.similarDesc}
                />
              )}
            </FadeIn>
          </div>
        </Container>
      </main>

      {/* Bar sticky job-board — muncul saat judul terlewat dari viewport */}
      <StickyApplyBar
        title={display.title}
        salary={stickySalary}
        daysLeftText={stickyDaysLeftText}
        visible={titleOutOfView}
        onApply={() => jumpToSection("form-card")}
      />

      {/* Pil progres gerbang baca — tampil selama formulir masih terkunci */}
      {canApplyOnline && !formUnlocked && gateSections.length > 0 ? (
        <GateProgressPill
          readCount={readIds.length}
          total={gateSections.length}
          onClick={() => jumpToSection("form-card")}
        />
      ) : null}

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
