// Seed data awal + helper serialisasi & filter (SERVER-ONLY — jangan diimpor dari komponen klien).
import type {
  Application as ApplicationRecordModel,
  Interview as InterviewRecordModel,
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
  INTERVIEW_MODES,
  INTERVIEW_PLATFORMS,
  INTERVIEW_RECOMMENDATIONS,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
  REJECTION_REASONS,
  SECTION_KEYS,
  STAGE_CATEGORIES,
  type AdminUser,
  type AiRecommendation,
  type Application,
  type ApplicationStatus,
  type AssignmentInfo,
  type BenefitItem,
  type FaqItem,
  type Interview,
  type InterviewMode,
  type InterviewPlatform,
  type InterviewRecommendation,
  type InterviewStatus,
  type OfferStatus,
  type OnboardingDoc,
  type Position,
  type RejectionReason,
  type ReplyTemplates,
  type ScreeningQuestion,
  type StageCategory,
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

/** Parse requirements / daftar string dari JSON string menjadi string[]. */
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

/** Parse daftar pertanyaan screening dari JSON string (aman terhadap nilai rusak). */
export function parseScreeningQuestions(raw: string): ScreeningQuestion[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: ScreeningQuestion[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const obj = (parsed[i] && typeof parsed[i] === "object" ? parsed[i] : {}) as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      if (!label) continue;
      const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `q${i + 1}`;
      result.push({ id, label, required: obj.required === true });
    }
    return result.slice(0, 10);
  } catch {
    return [];
  }
}

/** Parse objek string sederhana dari JSON (jawaban screening). */
export function parseStringRecord(raw: string | null | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key === "string" && key && typeof value === "string") result[key] = value;
      else if (typeof key === "string" && key && typeof value === "number") result[key] = String(value);
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** Parse objek angka sederhana dari JSON (skor rubrik 1-5). */
export function parseScoreRecord(raw: string | null | undefined): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const num = typeof value === "number" ? value : Number(value);
      if (key && Number.isFinite(num)) result[key] = Math.min(5, Math.max(1, Math.round(num)));
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

/** Normalisasi template balasan dari record (kolom terpisah -> objek). */
function parseReplyTemplates(apply: string | null, accept: string | null, reject: string | null): ReplyTemplates {
  return { apply: apply ?? null, accept: accept ?? null, reject: reject ?? null };
}

function parseAssignment(title: string | null, url: string | null, note: string | null): AssignmentInfo {
  return { title: title ?? null, url: url ?? null, note: note ?? null };
}

/** Ubah judul menjadi slug URL-aman: huruf kecil, tanda hubung, tanpa karakter aneh. */
export function slugifyTitle(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return base || "posisi";
}

/** Cari slug unik (tambah -2, -3, ... bila sudah dipakai posisi lain). */
export async function ensureUniqueSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugifyTitle(title);
  let candidate = base;
  let counter = 2;
  for (;;) {
    const existing = await db.position.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
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

/** Parse dokumen onboarding dari JSON string (aman terhadap nilai rusak). */
export function parseOnboardingDocs(raw: string | null | undefined): OnboardingDoc[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const docs: OnboardingDoc[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const obj = (parsed[i] && typeof parsed[i] === "object" ? parsed[i] : {}) as Record<string, unknown>;
      const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 120) : "";
      if (!label) continue;
      docs.push({
        id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim().slice(0, 40) : `doc${i + 1}`,
        label,
        required: obj.required === true,
        done: obj.done === true,
        fileId: typeof obj.fileId === "string" && obj.fileId.trim() ? obj.fileId.trim() : null,
      });
    }
    return docs.slice(0, 10);
  } catch {
    return [];
  }
}

/** Parse pemetaan kategori tahap kustom dari JSON string (aman terhadap nilai rusak). */
export function parseStageCategories(raw: string | null | undefined): Record<string, StageCategory> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, StageCategory> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const stage = typeof key === "string" ? key.trim().slice(0, 40) : "";
      if (!stage) continue;
      if (typeof value === "string" && (STAGE_CATEGORIES as string[]).includes(value)) {
        result[stage] = value as StageCategory;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/** Sanitasi enum wawancara/offer/rejection dari input tak dikenal. */
export function sanitizeInterviewMode(value: unknown): InterviewMode {
  return value === "ONSITE" ? "ONSITE" : "ONLINE";
}
export function sanitizeInterviewPlatform(value: unknown): InterviewPlatform {
  return (INTERVIEW_PLATFORMS as string[]).includes(String(value))
    ? (value as InterviewPlatform)
    : "GOOGLE_MEET";
}
export function sanitizeInterviewStatus(value: unknown): InterviewStatus | null {
  return (INTERVIEW_STATUSES as string[]).includes(String(value))
    ? (value as InterviewStatus)
    : null;
}
export function sanitizeInterviewRecommendation(value: unknown): InterviewRecommendation | null {
  return (INTERVIEW_RECOMMENDATIONS as string[]).includes(String(value))
    ? (value as InterviewRecommendation)
    : null;
}
export function sanitizeOfferStatus(value: unknown): OfferStatus | null {
  return (OFFER_STATUSES as string[]).includes(String(value)) ? (value as OfferStatus) : null;
}
export function sanitizeRejectionReason(value: unknown): RejectionReason | null {
  return (REJECTION_REASONS as string[]).includes(String(value))
    ? (value as RejectionReason)
    : null;
}

/** Ubah record Prisma Position menjadi bentuk tipe `Position` v3 (JSON fields terurai). */
export function serializePosition(record: PositionRecordModel): Position {
  return {
    id: record.id,
    title: record.title,
    slug: record.slug,
    department: record.department,
    type: record.type,
    location: record.location,
    description: record.description,
    requirements: parseRequirements(record.requirements),
    isActive: record.isActive,
    closesAt: record.closesAt ? record.closesAt.toISOString() : null,
    order: record.order,
    createdAt: record.createdAt.toISOString(),

    coverFileId: record.coverFileId,
    salaryText: record.salaryText,
    salaryVisible: record.salaryVisible,
    benefits: parseRequirements(record.benefits),
    examples: parseRequirements(record.examples),
    urgent: record.urgent,
    featured: record.featured,

    screeningQuestions: parseScreeningQuestions(record.screeningQuestions),
    requireCv: record.requireCv,
    requireIntro: record.requireIntro,
    requirePortfolio: record.requirePortfolio,
    maxApplicants: record.maxApplicants,

    publishAt: record.publishAt ? record.publishAt.toISOString() : null,

    stages: parseRequirements(record.stages),
    stageCategories: parseStageCategories(record.stageCategories),
    aiCriteria: record.aiCriteria,
    autoShortlistScore: record.autoShortlistScore,
    autoShortlistStage: record.autoShortlistStage,
    replyTemplates: parseReplyTemplates(record.applyTemplate, record.acceptTemplate, record.rejectTemplate),
    assignment: parseAssignment(record.assignmentTitle, record.assignmentUrl, record.assignmentNote),

    rubricCriteria: parseRequirements(record.rubricCriteria),
    checklistTemplate: parseRequirements(record.checklistTemplate),
    noteTemplates: parseRequirements(record.noteTemplates),
    views: record.views,

    interviewMode: sanitizeInterviewMode(record.interviewMode),
    interviewPlatform: sanitizeInterviewPlatform(record.interviewPlatform),
    interviewDuration: record.interviewDuration,
    interviewCriteria: parseRequirements(record.interviewCriteria),
    interviewInviteTemplate: record.interviewInviteTemplate,

    offerTemplate: record.offerTemplate,
    welcomeTemplate: record.welcomeTemplate,
    probationMonths: record.probationMonths,
    onboardingDocs: parseRequirements(record.onboardingDocs),
    reapplyCooldownDays: record.reapplyCooldownDays,
    autoCloseOnHired: record.autoCloseOnHired,
  };
}

const AI_RECOMMENDATION_VALUES = Object.keys(AI_RECOMMENDATION_LABELS);

/** Ubah record Prisma Application (include relasi) menjadi tipe `Application` v3. */
export function serializeApplication(record: ApplicationRecord): Application {
  const status = record.status && record.status.trim().length > 0 ? record.status.trim() : "NEW";
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
    source: record.source,
    utmSource: record.utmSource,
    utmMedium: record.utmMedium,
    utmCampaign: record.utmCampaign,
    screeningAnswers: parseStringRecord(record.screeningAnswers),
    rubricScores: parseScoreRecord(record.rubricScores),
    checklistState: parseRequirements(record.checklistState),
    cvFileId: record.cvFileId,
    cvFileName: record.cvFile?.filename ?? null,
    introFileId: record.introFileId,
    introFileName: record.introFile?.filename ?? null,

    rejectionReason: sanitizeRejectionReason(record.rejectionReason),
    rejectionNote: record.rejectionNote,
    rejectedAt: record.rejectedAt ? record.rejectedAt.toISOString() : null,

    offerStatus: sanitizeOfferStatus(record.offerStatus),
    offerSalary: record.offerSalary,
    offerType: record.offerType,
    offerStartDate: record.offerStartDate ? record.offerStartDate.toISOString() : null,
    offerNote: record.offerNote,
    offerDeadline: record.offerDeadline ? record.offerDeadline.toISOString() : null,
    offerSentAt: record.offerSentAt ? record.offerSentAt.toISOString() : null,
    offerRespondedAt: record.offerRespondedAt ? record.offerRespondedAt.toISOString() : null,
    offerDeclineReason: record.offerDeclineReason,

    hiredAt: record.hiredAt ? record.hiredAt.toISOString() : null,
    probationEnd: record.probationEnd ? record.probationEnd.toISOString() : null,
    onboardingDocs: parseOnboardingDocs(record.onboardingDocs),

    createdAt: record.createdAt.toISOString(),
  };
}

/** Ubah record Prisma Interview menjadi tipe `Interview` (JSON fields terurai). */
export function serializeInterview(record: InterviewRecordModel): Interview {
  return {
    id: record.id,
    applicationId: record.applicationId,
    round: record.round,
    mode: sanitizeInterviewMode(record.mode),
    platform: sanitizeInterviewPlatform(record.platform),
    meetingLink: record.meetingLink,
    address: record.address,
    scheduledAt: record.scheduledAt.toISOString(),
    durationMin: record.durationMin,
    interviewers: parseTags(record.interviewers),
    status: sanitizeInterviewStatus(record.status) ?? "SCHEDULED",
    scores: parseScoreRecord(record.scores),
    recommendation: sanitizeInterviewRecommendation(record.recommendation),
    notes: record.notes,
    recordingUrl: record.recordingUrl,
    completedAt: record.completedAt ? record.completedAt.toISOString() : null,
    rescheduleReason: record.rescheduleReason,
    rescheduleProposedAt: record.rescheduleProposedAt
      ? record.rescheduleProposedAt.toISOString()
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
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
    // Tahap bisa berupa 5 status bawaan ATAU label tahap kustom milik posisi.
    const clean = status.trim().slice(0, 40);
    if (clean) where.status = clean;
    else valid = false;
  }

  const source = searchParams.get("source")?.trim();
  if (source) where.source = { contains: source.slice(0, 40) };

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
  source: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
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
    source: "YouTube",
    utmSource: "youtube",
    utmCampaign: "video-editor",
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
    source: "Instagram",
    utmSource: "instagram",
    utmCampaign: "story",
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
    source: "TikTok",
    utmSource: "tiktok",
    utmCampaign: "bio",
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
    source: "Instagram",
    utmSource: "instagram",
    utmCampaign: "story",
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
    source: "Teman/Rekan",
    utmSource: null,
    utmCampaign: null,
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

  // 4. Posisi lowongan default (dengan seluruh fitur per lowongan v3)
  const positionCount = await db.position.count();
  if (positionCount === 0) {
    const defaultPositions: DefaultPositionSeed[] = DEFAULT_POSITIONS;
    for (const position of defaultPositions) {
      const slug = await ensureUniqueSlug(position.title);
      await db.position.create({
        data: {
          title: position.title,
          slug,
          department: position.department,
          type: position.type,
          location: position.location,
          description: position.description,
          requirements: JSON.stringify(position.requirements),
          isActive: true,
          order: position.order,
          salaryText: position.salaryText ?? null,
          salaryVisible: position.salaryVisible ?? false,
          benefits: JSON.stringify(position.benefits ?? []),
          examples: JSON.stringify(position.examples ?? []),
          urgent: position.urgent ?? false,
          featured: position.featured ?? false,
          screeningQuestions: JSON.stringify(position.screeningQuestions ?? []),
          requireCv: position.requireCv ?? false,
          requireIntro: position.requireIntro ?? false,
          requirePortfolio: position.requirePortfolio ?? false,
          maxApplicants: position.maxApplicants ?? null,
          aiCriteria: position.aiCriteria ?? null,
          applyTemplate: position.applyTemplate ?? null,
          acceptTemplate: position.acceptTemplate ?? null,
          rejectTemplate: position.rejectTemplate ?? null,
          assignmentTitle: position.assignmentTitle ?? null,
          assignmentUrl: position.assignmentUrl ?? null,
          assignmentNote: position.assignmentNote ?? null,
          rubricCriteria: JSON.stringify(position.rubricCriteria ?? []),
          checklistTemplate: JSON.stringify(position.checklistTemplate ?? []),
          noteTemplates: JSON.stringify(position.noteTemplates ?? []),
        },
      });
    }
  }

  // 4b. Backfill slug untuk posisi lama yang belum punya (idempoten).
  const missingSlug = await db.position.findMany({ where: { slug: null }, select: { id: true, title: true } });
  for (const position of missingSlug) {
    const slug = await ensureUniqueSlug(position.title);
    await db.position.update({ where: { id: position.id }, data: { slug } });
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
          source: sample.source,
          utmSource: sample.utmSource,
          utmCampaign: sample.utmCampaign,
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

/**
 * Auto-tutup posisi (dipanggil lazy dari route GET):
 * 1. closesAt sudah lewat, atau
 * 2. kuota maxApplicants tercapai (lamaran non-ditolak >= kuota).
 * Setiap penutupan dicatat di ActivityLog (actor "Sistem", action AUTO_CLOSE).
 */
export async function closeExpiredPositions(): Promise<void> {
  const now = new Date();

  const expired = await db.position.findMany({
    where: { isActive: true, closesAt: { lt: now } },
    select: { id: true, title: true },
  });
  for (const position of expired) {
    await db.position.update({ where: { id: position.id }, data: { isActive: false } });
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: "Sistem",
        action: "AUTO_CLOSE",
        detail: `Posisi "${position.title}" ditutup otomatis karena melewati batas waktu pendaftaran.`,
      },
    });
  }

  const withQuota = await db.position.findMany({
    where: { isActive: true, maxApplicants: { not: null } },
    select: { id: true, title: true, maxApplicants: true, _count: { select: { applications: { where: { status: { not: "REJECTED" } } } } } },
  });
  for (const position of withQuota) {
    const quota = position.maxApplicants ?? 0;
    if (quota > 0 && position._count.applications >= quota) {
      await db.position.update({ where: { id: position.id }, data: { isActive: false } });
      await db.activityLog.create({
        data: {
          applicationId: null,
          actor: "Sistem",
          action: "AUTO_CLOSE",
          detail: `Posisi "${position.title}" ditutup otomatis karena kuota pelamar (${quota}) sudah penuh.`,
        },
      });
    }
  }
}
