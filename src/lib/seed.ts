// Seed data awal + helper serialisasi & filter (SERVER-ONLY — jangan diimpor dari komponen klien).
import type {
  Application as ApplicationRecordModel,
  Prisma,
  Position as PositionRecordModel,
  AdminUser as AdminUserRecordModel,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_POSITIONS,
  DEFAULT_SITE,
  DEFAULT_USERS,
  type DefaultPositionSeed,
} from "@/lib/defaults";
import { hashPassword } from "@/lib/server-auth";
import { generateUniqueTrackingCode } from "@/lib/tracking";
import {
  AI_RECOMMENDATION_LABELS,
  APPLICATION_STATUSES,
  SECTION_KEYS,
  type AdminUser,
  type AiRecommendation,
  type Application,
  type ApplicationStatus,
  type BenefitItem,
  type FaqItem,
  type Position,
  type SectionVisibility,
  type SiteContent,
  type TeamMember,
} from "@/lib/types";

/* ---------------------------------- Serialisasi ---------------------------------- */

type ApplicationRecord = ApplicationRecordModel & {
  position: { title: string } | null;
  cvFile?: { filename: string } | null;
  introFile?: { filename: string } | null;
};

/** Include standar untuk query Application agar serialisasi lengkap. */
export const APPLICATION_INCLUDE = {
  position: { select: { title: true } },
  cvFile: { select: { filename: true } },
  introFile: { select: { filename: true } },
} satisfies Prisma.ApplicationInclude;

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

/** Parse tags dari JSON string menjadi string[] (aman terhadap nilai rusak). */
export function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
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
    closesAt: record.closesAt ? record.closesAt.toISOString() : null,
    order: record.order,
    createdAt: record.createdAt.toISOString(),
  };
}

const AI_RECOMMENDATION_VALUES = Object.keys(AI_RECOMMENDATION_LABELS);

/** Ubah record Prisma Application (include relasi) menjadi tipe `Application` v2. */
export function serializeApplication(record: ApplicationRecord): Application {
  const status: ApplicationStatus = (APPLICATION_STATUSES as string[]).includes(record.status)
    ? (record.status as ApplicationStatus)
    : "NEW";
  const aiRecommendation =
    record.aiRecommendation && AI_RECOMMENDATION_VALUES.includes(record.aiRecommendation)
      ? (record.aiRecommendation as AiRecommendation)
      : null;
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
    trackingCode: record.trackingCode ?? "",
    rating: record.rating,
    tags: parseTags(record.tags),
    interviewAt: record.interviewAt ? record.interviewAt.toISOString() : null,
    talentPool: record.talentPool,
    aiScore: record.aiScore,
    aiSummary: record.aiSummary,
    aiRecommendation,
    aiAnalyzedAt: record.aiAnalyzedAt ? record.aiAnalyzedAt.toISOString() : null,
    transcript: record.transcript,
    cvFileId: record.cvFileId,
    cvFileName: record.cvFile?.filename ?? null,
    introFileId: record.introFileId,
    introFileName: record.introFile?.filename ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

/** Ubah record Prisma AdminUser menjadi tipe `AdminUser`. */
export function serializeAdminUser(record: AdminUserRecordModel): AdminUser {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: (record.role as AdminUser["role"]) ?? "VIEWER",
    isActive: record.isActive,
    createdAt: record.createdAt.toISOString(),
  };
}

/* ------------------------------ Parsing konten situs ------------------------------ */

function pickString(source: Record<string, unknown>, key: keyof SiteContent, fallback: string): string {
  const value = source[key];
  return typeof value === "string" ? value : fallback;
}

function pickBoolean(source: Record<string, unknown>, key: keyof SiteContent, fallback: boolean): boolean {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
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

export function sanitizeTeamMembers(value: unknown, fallback: TeamMember[]): TeamMember[] {
  if (!Array.isArray(value)) return fallback;
  return value.map((item) => {
    const obj = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    return {
      name: typeof obj.name === "string" ? obj.name : "",
      role: typeof obj.role === "string" ? obj.role : "",
      quote: typeof obj.quote === "string" ? obj.quote : "",
    };
  });
}

/**
 * Normalisasi konfigurasi visibilitas bagian halaman publik.
 * Kunci tak dikenal diabaikan; kunci hilang/tidak boolean diambil dari fallback.
 */
export function sanitizeSections(value: unknown, fallback: SectionVisibility): SectionVisibility {
  const result = { ...fallback };
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  const obj = value as Record<string, unknown>;
  for (const key of SECTION_KEYS) {
    const v = obj[key];
    if (typeof v === "boolean") result[key] = v;
  }
  return result;
}

/**
 * Normalisasi objek konten situs menjadi `SiteContent` lengkap.
 * Field yang tidak valid/tidak ada diambil dari `fallback` — sehingga field baru
 * (teamMembers, chatbotEnabled, sections, dll) otomatis terisi dari default tanpa menimpa nilai lama.
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
    teamMembers: sanitizeTeamMembers(obj.teamMembers, fallback.teamMembers),
    contactEmail: pickString(obj, "contactEmail", fallback.contactEmail),
    contactWhatsapp: pickString(obj, "contactWhatsapp", fallback.contactWhatsapp),
    instagram: pickString(obj, "instagram", fallback.instagram),
    footerText: pickString(obj, "footerText", fallback.footerText),
    chatbotEnabled: pickBoolean(obj, "chatbotEnabled", fallback.chatbotEnabled),
    discordWebhookUrl: pickString(obj, "discordWebhookUrl", fallback.discordWebhookUrl),
    telegramBotToken: pickString(obj, "telegramBotToken", fallback.telegramBotToken),
    telegramChatId: pickString(obj, "telegramChatId", fallback.telegramChatId),
    sections: sanitizeSections(obj.sections, fallback.sections),
  };
}

/** Parse JSON string dari Setting "site" menjadi SiteContent (fallback ke DEFAULT_SITE). */
export function parseSiteContent(raw: string | null | undefined): SiteContent {
  if (!raw) {
    return JSON.parse(JSON.stringify(DEFAULT_SITE)) as SiteContent;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return sanitizeSiteContent(parsed, DEFAULT_SITE);
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SITE)) as SiteContent;
  }
}

/* ------------------------- Filter & urutan daftar lamaran ------------------------- */

export type ParsedApplicationFilters = {
  where: Prisma.ApplicationWhereInput;
  orderBy: Prisma.ApplicationOrderByWithRelationInput[];
  valid: boolean;
};

/**
 * Bangun where/orderBy untuk GET /api/admin/applications & /export dari query params:
 * status, positionId, q, ratingMin, tag, talentPool ("1"/"true"), hasInterview ("1"), sort.
 */
export function parseApplicationFilters(searchParams: URLSearchParams): ParsedApplicationFilters {
  const where: Prisma.ApplicationWhereInput = {};
  let valid = true;

  const status = searchParams.get("status");
  if (status) {
    if ((APPLICATION_STATUSES as string[]).includes(status)) {
      where.status = status;
    } else {
      valid = false;
    }
  }

  const positionId = searchParams.get("positionId");
  if (positionId) where.positionId = positionId;

  const q = searchParams.get("q")?.trim();
  if (q) {
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }

  const ratingMin = Number.parseInt(searchParams.get("ratingMin") ?? "", 10);
  if (Number.isInteger(ratingMin)) where.rating = { gte: ratingMin };

  const tag = searchParams.get("tag")?.trim();
  if (tag) {
    where.tags = { contains: `"${tag.replace(/"/g, "")}"` };
  }

  const talentPool = searchParams.get("talentPool");
  if (talentPool === "1" || talentPool === "true") where.talentPool = true;

  const hasInterview = searchParams.get("hasInterview");
  if (hasInterview === "1" || hasInterview === "true") {
    where.NOT = { interviewAt: null };
  }

  const sort = searchParams.get("sort") ?? "newest";
  let orderBy: Prisma.ApplicationOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
  if (sort === "oldest") {
    orderBy = [{ createdAt: "asc" }, { id: "asc" }];
  } else if (sort === "aiScore") {
    orderBy = [{ aiScore: "desc" }, { createdAt: "desc" }];
  }

  return { where, orderBy, valid };
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
  rating: number;
  tags: string[];
  talentPool: boolean;
  interviewInDays: number | null;
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
    rating: 0,
    tags: [],
    talentPool: false,
    interviewInDays: null,
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
    rating: 4,
    tags: ["desain", "detailis"],
    talentPool: false,
    interviewInDays: null,
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
    rating: 5,
    tags: ["menulis", "komedi"],
    talentPool: false,
    interviewInDays: 2,
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
    rating: 5,
    tags: ["sosial media", "komunitas"],
    talentPool: true,
    interviewInDays: null,
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
    rating: 2,
    tags: ["fresh graduate"],
    talentPool: true,
    interviewInDays: null,
  },
];

/* ------------------------------------- Seed -------------------------------------- */

async function runSeed(): Promise<void> {
  // 1. Akun admin multi-user (OWNER/HR/VIEWER) jika tabel masih kosong
  const userCount = await db.adminUser.count();
  if (userCount === 0) {
    for (const user of DEFAULT_USERS) {
      await db.adminUser.create({
        data: {
          name: user.name,
          email: user.email,
          passwordHash: hashPassword(user.password),
          role: user.role,
          isActive: true,
        },
      });
    }
  }

  // 2. Konten situs: buat default atau MERGE dengan data lama
  //    (field baru yang hilang diisi dari DEFAULT_SITE, nilai lama tidak ditimpa)
  const siteSetting = await db.setting.findUnique({ where: { key: "site" } });
  if (!siteSetting) {
    await db.setting.create({ data: { key: "site", value: JSON.stringify(DEFAULT_SITE) } });
  } else {
    try {
      const parsed: unknown = JSON.parse(siteSetting.value);
      const merged = sanitizeSiteContent(parsed, DEFAULT_SITE);
      if (JSON.stringify(merged) !== siteSetting.value) {
        await db.setting.update({ where: { key: "site" }, data: { value: JSON.stringify(merged) } });
      }
    } catch {
      await db.setting.update({ where: { key: "site" }, data: { value: JSON.stringify(DEFAULT_SITE) } });
    }
  }

  // 3. Password admin legacy (kompatibilitas v1, login v2 memakai AdminUser)
  const passwordSetting = await db.setting.findUnique({ where: { key: "admin_password" } });
  if (!passwordSetting) {
    await db.setting.create({ data: { key: "admin_password", value: hashPassword(DEFAULT_ADMIN_PASSWORD) } });
  }

  // 4. Posisi lowongan default
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

  // 5. Lamaran contoh
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
          rating: sample.rating,
          tags: JSON.stringify(sample.tags),
          talentPool: sample.talentPool,
          interviewAt:
            sample.interviewInDays !== null
              ? new Date(Date.now() + sample.interviewInDays * 24 * 60 * 60 * 1000)
              : null,
          createdAt: new Date(Date.now() - sample.createdAtOffsetHours * 60 * 60 * 1000),
        },
      });
    }
  }

  // 6. Backfill: lamaran tanpa trackingCode mendapat kode unik "LM-XXXXXX"
  const missingCode = await db.application.findMany({
    where: { trackingCode: null },
    select: { id: true },
  });
  for (const app of missingCode) {
    const code = await generateUniqueTrackingCode();
    await db.application.update({ where: { id: app.id }, data: { trackingCode: code } });
  }
}

let seedPromise: Promise<void> | null = null;

/**
 * Pastikan data awal (AdminUser, Setting site, posisi, lamaran contoh, tracking code)
 * sudah ada. Idempoten — aman dipanggil di setiap request; pakai cache promise module-level
 * agar tidak race. Gagal me-reset cache agar bisa mencoba ulang.
 */
export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeed().catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}

/** Auto-tutup posisi yang closesAt-nya sudah lewat (dipanggil lazy dari route GET). */
export async function closeExpiredPositions(): Promise<void> {
  await db.position.updateMany({
    where: { isActive: true, closesAt: { lt: new Date() } },
    data: { isActive: false },
  });
}
