// Seed data awal + helper serialisasi data (SERVER-ONLY — jangan diimpor dari komponen klien).
import type { Application as ApplicationRecordModel, Position as PositionRecordModel } from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_POSITIONS,
  DEFAULT_SITE,
  type DefaultPositionSeed,
} from "@/lib/defaults";
import { hashPassword } from "@/lib/server-auth";
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
  type BenefitItem,
  type FaqItem,
  type Position,
  type SiteContent,
} from "@/lib/types";

/* ---------------------------------- Serialisasi ---------------------------------- */

type ApplicationRecord = ApplicationRecordModel & { position: { title: string } | null };

/** Parse requirements dari JSON string menjadi string[]. */
export function parseRequirements(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

/** Ubah record Prisma Position menjadi bentuk tipe `Position` (requirements: string[]). */
export function serializePosition(record: PositionRecordModel): Position {
  return {
    id: record.id,
    title: record.title,
    department: record.department,
    type: record.type,
    location: record.location,
    description: record.description,
    requirements: parseRequirements(record.requirements),
    isActive: record.isActive,
    order: record.order,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Ubah record Prisma Application (dengan include position) menjadi tipe `Application`. */
export function serializeApplication(record: ApplicationRecord): Application {
  const status: ApplicationStatus = (APPLICATION_STATUSES as string[]).includes(record.status)
    ? (record.status as ApplicationStatus)
    : "NEW";
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    positionId: record.positionId,
    positionTitle: record.position?.title ?? null,
    socialLinks: record.socialLinks,
    portfolioUrl: record.portfolioUrl,
    experience: record.experience,
    motivation: record.motivation,
    status,
    adminNotes: record.adminNotes,
    createdAt: record.createdAt.toISOString(),
  };
}

/* ------------------------------ Parsing konten situs ------------------------------ */

function pickString(source: Record<string, unknown>, key: keyof SiteContent, fallback: string): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

export function sanitizeBenefits(value: unknown, fallback: BenefitItem[]): BenefitItem[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => {
    const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      icon: typeof obj.icon === "string" && obj.icon ? obj.icon : "Sparkles",
      title: typeof obj.title === "string" ? obj.title : "",
      description: typeof obj.description === "string" ? obj.description : "",
    };
  });
}

export function sanitizeFaqs(value: unknown, fallback: FaqItem[]): FaqItem[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => {
    const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      question: typeof obj.question === "string" ? obj.question : "",
      answer: typeof obj.answer === "string" ? obj.answer : "",
    };
  });
}

/**
 * Normalisasi objek konten situs menjadi `SiteContent` lengkap.
 * Field yang tidak valid/tidak ada diambil dari `fallback`.
 */
export function sanitizeSiteContent(value: unknown, fallback: SiteContent = DEFAULT_SITE): SiteContent {
  const obj = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  return {
    siteName: pickString(obj, "siteName", fallback.siteName),
    tagline: pickString(obj, "tagline", fallback.tagline),
    heroBadge: pickString(obj, "heroBadge", fallback.heroBadge),
    heroTitle: pickString(obj, "heroTitle", fallback.heroTitle),
    heroHighlight: pickString(obj, "heroHighlight", fallback.heroHighlight),
    heroDescription: pickString(obj, "heroDescription", fallback.heroDescription),
    deadline: pickString(obj, "deadline", fallback.deadline),
    aboutTitle: pickString(obj, "aboutTitle", fallback.aboutTitle),
    aboutDescription: pickString(obj, "aboutDescription", fallback.aboutDescription),
    benefits: sanitizeBenefits(obj.benefits, fallback.benefits),
    faqs: sanitizeFaqs(obj.faqs, fallback.faqs),
    contactEmail: pickString(obj, "contactEmail", fallback.contactEmail),
    contactWhatsapp: pickString(obj, "contactWhatsapp", fallback.contactWhatsapp),
    instagram: pickString(obj, "instagram", fallback.instagram),
    footerText: pickString(obj, "footerText", fallback.footerText),
  };
}

/** Parse JSON string dari Setting "site" menjadi SiteContent (fallback ke DEFAULT_SITE). */
export function parseSiteContent(raw: string | null | undefined): SiteContent {
  if (!raw) return { ...DEFAULT_SITE, benefits: [...DEFAULT_SITE.benefits], faqs: [...DEFAULT_SITE.faqs] };
  try {
    const parsed: unknown = JSON.parse(raw);
    return sanitizeSiteContent(parsed, DEFAULT_SITE);
  } catch {
    return { ...DEFAULT_SITE, benefits: [...DEFAULT_SITE.benefits], faqs: [...DEFAULT_SITE.faqs] };
  }
}

/* --------------------------------- Data contoh ---------------------------------- */

type SampleApplication = {
  name: string;
  email: string;
  phone: string;
  positionTitle: string;
  portfolioUrl: string | null;
  socialLinks: string | null;
  experience: string;
  motivation: string;
  status: ApplicationStatus;
  adminNotes: string | null;
  createdAtOffsetHours: number;
};

const SAMPLE_APPLICATIONS: SampleApplication[] = [
  {
    name: "Rizky Pratama",
    email: "rizky.pratama@mail.com",
    phone: "6281234567891",
    positionTitle: "Video Editor",
    portfolioUrl: "https://youtu.be/rizky-showreel",
    socialLinks: "https://instagram.com/rizkyedits",
    experience:
      "2 tahun menjadi editor YouTube channel gaming dengan 300 ribu subscriber. Terbiasa memproduksi 15 video pendek per bulan.",
    motivation:
      "Saya ingin naik level dengan konten yang lebih kreatif dan tim yang solid. Saya mengikuti channel ini sejak awal dan paham gaya editingnya.",
    status: "NEW",
    adminNotes: null,
    createdAtOffsetHours: 30,
  },
  {
    name: "Anisa Rahma",
    email: "anisa.rahma@mail.com",
    phone: "6281234567892",
    positionTitle: "Thumbnail Designer",
    portfolioUrl: "https://behance.net/anisarahma",
    socialLinks: "https://instagram.com/anisadesign",
    experience:
      "Freelance desain grafis 3 tahun, fokus thumbnail untuk kreator edukasi. Rata-rata CTR klien naik 40%.",
    motivation:
      "Desain thumbnail adalah seni memancing rasa penasaran, dan itu yang paling saya nikmati. Saya ingin membantu channel ini bertumbuh lebih besar.",
    status: "REVIEWED",
    adminNotes: "Portofolio bagus, CTR terbukti. Jadwalkan tes desain.",
    createdAtOffsetHours: 72,
  },
  {
    name: "Bagas Saputra",
    email: "bagas.saputra@mail.com",
    phone: "6281234567893",
    positionTitle: "Penulis Naskah",
    portfolioUrl: "https://medium.com/@bagas",
    socialLinks: "https://twitter.com/bagasnulis",
    experience:
      "Penulis skrip podcast komedi selama 2 tahun dan penulis lepas untuk 5 channel YouTube.",
    motivation:
      "Menulis hook yang membuat orang berhenti scroll adalah tantangan favorit saya setiap hari.",
    status: "INTERVIEW",
    adminNotes: "Wawancara online Selasa 14.00 WIB via Google Meet.",
    createdAtOffsetHours: 120,
  },
  {
    name: "Dewi Lestari",
    email: "dewi.lestari@mail.com",
    phone: "6281234567894",
    positionTitle: "Social Media Officer",
    portfolioUrl: null,
    socialLinks: "https://instagram.com/dewismm",
    experience:
      "Mengelola sosial media brand F&B dengan pertumbuhan pengikut 80 ribu dalam 10 bulan.",
    motivation:
      "Saya suka membangun komunitas yang loyal dan interaktif. Data dan tren adalah alat kerja harian saya.",
    status: "ACCEPTED",
    adminNotes: "Mulai onboarding Senin depan. Tim HR mengirim kontrak.",
    createdAtOffsetHours: 192,
  },
  {
    name: "Fajar Nugroho",
    email: "fajar.nugroho@mail.com",
    phone: "6281234567895",
    positionTitle: "Video Editor",
    portfolioUrl: "https://vimeo.com/fajarnugroho",
    socialLinks: null,
    experience: "Fresh graduate DKV, terbiasa editing video acara kampus dan iklan singkat.",
    motivation: "Saya ingin belajar produksi konten profesional dari tim yang berpengalaman.",
    status: "REJECTED",
    adminNotes: "Belum ada pengalaman short-form. Sarankan ikut program magang berikutnya.",
    createdAtOffsetHours: 12,
  },
];

/* ------------------------------------- Seed -------------------------------------- */

async function runSeed(): Promise<void> {
  // 1. Konten situs default
  const siteSetting = await db.setting.findUnique({ where: { key: "site" } });
  if (!siteSetting) {
    await db.setting.create({ data: { key: "site", value: JSON.stringify(DEFAULT_SITE) } });
  }

  // 2. Password admin default (disimpan sebagai hash SHA-256)
  const passwordSetting = await db.setting.findUnique({ where: { key: "admin_password" } });
  if (!passwordSetting) {
    await db.setting.create({ data: { key: "admin_password", value: hashPassword(DEFAULT_ADMIN_PASSWORD) } });
  }

  // 3. Posisi lowongan default
  const positionCount = await db.position.count();
  if (positionCount === 0) {
    const defaultPositions: DefaultPositionSeed[] = DEFAULT_POSITIONS;
    for (const position of defaultPositions) {
      await db.position.create({
        data: {
          title: position.title,
          department: position.department,
          type: position.type,
          location: position.location,
          description: position.description,
          requirements: JSON.stringify(position.requirements),
          isActive: true,
          order: position.order,
        },
      });
    }
  }

  // 4. Lamaran contoh
  const applicationCount = await db.application.count();
  if (applicationCount === 0) {
    const positions = await db.position.findMany({ select: { id: true, title: true } });
    const positionIdByTitle = new Map(positions.map((p) => [p.title, p.id]));
    for (const sample of SAMPLE_APPLICATIONS) {
      await db.application.create({
        data: {
          name: sample.name,
          email: sample.email,
          phone: sample.phone,
          positionId: positionIdByTitle.get(sample.positionTitle) ?? null,
          portfolioUrl: sample.portfolioUrl,
          socialLinks: sample.socialLinks,
          experience: sample.experience,
          motivation: sample.motivation,
          status: sample.status,
          adminNotes: sample.adminNotes,
          createdAt: new Date(Date.now() - sample.createdAtOffsetHours * 60 * 60 * 1000),
        },
      });
    }
  }
}

let seedPromise: Promise<void> | null = null;

/**
 * Pastikan data awal (Setting site, password admin, posisi, lamaran contoh) sudah ada.
 * Idempoten — aman dipanggil di setiap request; pakai cache promise module-level agar tidak race.
 */
export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((error) => {
      // Reset cache agar request berikutnya bisa mencoba seed ulang.
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}
