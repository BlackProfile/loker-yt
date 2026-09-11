// Kontrak tipe data bersama untuk aplikasi rekrutmen konten kreator (v2).
// Dipakai oleh API (backend) dan komponen (frontend). Jangan duplikasi tipe di tempat lain.

export type ApplicationStatus = "NEW" | "REVIEWED" | "INTERVIEW" | "ACCEPTED" | "REJECTED";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "NEW",
  "REVIEWED",
  "INTERVIEW",
  "ACCEPTED",
  "REJECTED",
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  NEW: "Baru",
  REVIEWED: "Ditinjau",
  INTERVIEW: "Wawancara",
  ACCEPTED: "Diterima",
  REJECTED: "Ditolak",
};

// Alur pipeline untuk timeline pelacakan pelamar
export const STATUS_FLOW: ApplicationStatus[] = ["NEW", "REVIEWED", "INTERVIEW"];

/* ------------------------------ Pipeline per lowongan ------------------------------ */

// Tahap pipeline disimpan sebagai string pada Application.status.
// Posisi tanpa stages kustom memakai 5 status bawaan di atas;
// posisi dengan stages kustom memakai label tahapnya sendiri (bebas teks).
export type StageKey = string;

export type ScreeningQuestion = { id: string; label: string; required: boolean };

export type ReplyTemplates = {
  apply: string | null;
  accept: string | null;
  reject: string | null;
};

export type AssignmentInfo = {
  title: string | null;
  url: string | null;
  note: string | null;
};

export type AiRecommendation = "LAYAK_WAWANCARA" | "PERTIMBANGKAN" | "TIDAK_COCCOK";

export const AI_RECOMMENDATION_LABELS: Record<AiRecommendation, string> = {
  LAYAK_WAWANCARA: "Layak Wawancara",
  PERTIMBANGKAN: "Pertimbangkan",
  TIDAK_COCCOK: "Kurang Cocok",
};

export type BenefitItem = { icon: string; title: string; description: string };

export type FaqItem = { question: string; answer: string };

export type TeamMember = { name: string; role: string; quote: string };

// Konten situs yang bisa diatur lewat panel admin
export type SiteContent = {
  siteName: string;
  tagline: string;
  heroBadge: string;
  heroTitle: string;
  heroHighlight: string;
  heroDescription: string;
  deadline: string; // string tampilan bebas, mis. "30 September 2025"; boleh kosong
  aboutTitle: string;
  aboutDescription: string;
  benefits: BenefitItem[];
  faqs: FaqItem[];
  teamMembers: TeamMember[]; // suara/testimoni tim
  contactEmail: string;
  contactWhatsapp: string; // format internasional tanpa "+", mis. 6281234567890
  instagram: string;
  footerText: string;
  // Otomasi & integrasi
  chatbotEnabled: boolean;
  discordWebhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  // Visibilitas tiap bagian halaman publik (dikendalikan dari panel admin)
  sections: SectionVisibility;
};

/* ------------------------ Visibilitas bagian halaman publik ------------------------ */

export type SectionKey =
  | "hero"
  | "positions"
  | "about"
  | "benefits"
  | "steps"
  | "applyForm"
  | "statusCheck"
  | "testimonials"
  | "faq"
  | "subscribe"
  | "finalCta"
  | "chatbot";

export const SECTION_KEYS: SectionKey[] = [
  "hero",
  "positions",
  "about",
  "benefits",
  "steps",
  "applyForm",
  "statusCheck",
  "testimonials",
  "faq",
  "subscribe",
  "finalCta",
  "chatbot",
];

export const SECTION_LABELS: Record<SectionKey, string> = {
  hero: "Hero & Pengantar",
  positions: "Daftar Posisi",
  about: "Tentang Studio",
  benefits: "Benefit Bergabung",
  steps: "Cara Melamar",
  applyForm: "Formulir Lamaran",
  statusCheck: "Cek Status Lamaran",
  testimonials: "Testimoni Tim",
  faq: "FAQ",
  subscribe: "Langganan Notifikasi Posisi Baru",
  finalCta: "CTA Penutup",
  chatbot: "Widget Chatbot",
};

// Kunci -> boolean (true = bagian tampil di halaman publik)
export type SectionVisibility = Record<SectionKey, boolean>;

export type Position = {
  id: string;
  title: string;
  slug: string | null; // untuk deep link /?posisi=slug
  department: string;
  type: string;
  location: string;
  description: string;
  requirements: string[];
  isActive: boolean;
  closesAt: string | null; // ISO date atau null
  order: number;
  createdAt: string;

  // Tampilan & konten
  coverFileId: string | null; // URL publik: /api/files/{coverFileId}
  salaryText: string | null;
  salaryVisible: boolean;
  benefits: string[];
  examples: string[]; // URL contoh karya (YouTube/TikTok/Instagram)
  urgent: boolean;
  featured: boolean;

  // Formulir & screening
  screeningQuestions: ScreeningQuestion[];
  requireCv: boolean;
  requireIntro: boolean;
  requirePortfolio: boolean;
  maxApplicants: number | null;

  // Publikasi
  publishAt: string | null;

  // Pipeline & otomasi
  stages: string[]; // [] = pipeline bawaan (5 status)
  aiCriteria: string | null;
  autoShortlistScore: number | null;
  autoShortlistStage: string | null;
  replyTemplates: ReplyTemplates;
  assignment: AssignmentInfo;

  // Evaluasi & kolaborasi
  rubricCriteria: string[];
  checklistTemplate: string[];
  noteTemplates: string[];
  views: number;
};

export type PositionPublicStats = {
  applications: number;
  remainingQuota: number | null; // null = tanpa kuota
};

export type Application = {
  id: string;
  name: string;
  email: string;
  phone: string;
  positionId: string | null;
  positionTitle: string | null;
  socialLinks: string | null;
  portfolioUrl: string | null;
  experience: string;
  motivation: string;
  status: StageKey; // tahap pipeline: 5 status bawaan ATAU tahap kustom milik posisi
  adminNotes: string | null;
  trackingCode: string;
  rating: number; // 0-5
  tags: string[];
  interviewAt: string | null;
  talentPool: boolean;
  aiScore: number | null; // 0-100
  aiSummary: string | null;
  aiRecommendation: AiRecommendation | null;
  aiAnalyzedAt: string | null;
  transcript: string | null; // hasil ASR audio intro
  source: string | null; // jawaban "dari mana tahu lowongan ini"
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  screeningAnswers: Record<string, string> | null; // {questionId: jawaban}
  rubricScores: Record<string, number> | null; // {kriteria: 1-5}
  checklistState: string[]; // item checklist yang dicentang
  cvFileId: string | null;
  cvFileName: string | null;
  introFileId: string | null;
  introFileName: string | null;
  createdAt: string;
};

export type Role = "OWNER" | "HR" | "VIEWER";

export const ROLES: Role[] = ["OWNER", "HR", "VIEWER"];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Pemilik",
  HR: "HR",
  VIEWER: "Pengamat",
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
};

export type AdminSession = { id: string; name: string; email: string; role: Role };

export type Subscriber = { id: string; email: string; createdAt: string };

export type LogEntry = {
  id: string;
  applicationId: string | null;
  applicationName: string | null;
  actor: string;
  action: string;
  detail: string | null;
  createdAt: string;
};

// GET /api/public/content
export type PublicContentResponse = {
  site: SiteContent;
  positions: Position[]; // hanya tayang (aktif, publishAt tercapai, belum lewat closesAt), featured dulu
  stats: { openRoles: number; totalApplications: number };
  positionStats: Record<string, PositionPublicStats>; // kuota & jumlah lamaran per posisi (untuk badge publik)
};

// GET /api/admin/position-stats
export type PositionStatsRow = {
  positionId: string;
  title: string;
  slug: string | null;
  isActive: boolean;
  views: number;
  applications: number;
  conversion: number | null; // persen applications/views, null bila views 0
  avgAiScore: number | null;
  funnel: { stage: string; count: number }[]; // sesuai stages posisi (atau bawaan)
  topSource: { source: string; count: number } | null; // sumber pelamar terbanyak
  sources: { source: string; count: number }[]; // semua sumber terurut terbanyak
};
export type AdminPositionStatsResponse = { rows: PositionStatsRow[] };

// POST /api/positions/[id]/view
export type PositionViewResponse = { ok: true; views: number };

// POST /api/admin/upload (multipart "file")
export type AdminUploadResponse = { ok: true; fileId: string; url: string }; // url = /api/files/{fileId}

// POST /api/admin/ai/cover { positionId }
export type AiCoverResponse = { ok: true; fileId: string; url: string } | { ok: false; error: string };

// GET /api/admin/overview
export type AdminOverviewResponse = {
  stats: {
    total: number;
    NEW: number;
    REVIEWED: number;
    INTERVIEW: number;
    ACCEPTED: number;
    REJECTED: number;
    /** lamaran pada tahap kustom (pipeline posisi tertentu) */
    CUSTOM: number;
  };
  recent: Application[]; // 5 lamaran terbaru
  daily: { date: string; count: number }[]; // 30 hari terakhir (ISO yyyy-MM-dd)
  upcomingInterviews: Application[]; // maks 5 terdekat
  stale: Application[]; // lamaran NEW/REVIEWED tanpa perubahan > 7 hari (maks 5)
  subscriberCount: number;
  avgAiScore: number | null;
};

// POST /api/public/track -> { code }
export type TrackResponse = {
  found: boolean;
  status?: StageKey; // tahap pipeline (bawaan atau kustom per posisi)
  positionTitle?: string | null;
  positionSlug?: string | null;
  submittedAt?: string;
  steps?: { key: string; label: string; done: boolean; at: string | null }[];
  assignment?: { title: string | null; url: string | null; note: string | null } | null; // info tes posisi (jika ada)
};

// POST /api/applications -> sukses
export type ApplySuccessResponse = {
  ok: true;
  id: string;
  trackingCode: string;
  autoReply: string | null; // pesan konfirmasi dari template apply posisi (sudah substitusi variabel)
  assignment: AssignmentInfo | null; // info tes/brief untuk posisi ini
};

// POST /api/chat -> { message, history }
export type ChatResponse = { reply: string };

// Ikon lucide yang diizinkan untuk item benefit (dipakai admin & landing)
export const BENEFIT_ICONS = [
  "Sparkles",
  "Film",
  "Users",
  "Rocket",
  "Wallet",
  "GraduationCap",
  "Globe",
  "Clock",
  "Zap",
  "Award",
  "Heart",
  "Calendar",
  "Camera",
  "Mic",
  "PenTool",
  "TrendingUp",
] as const;

// Jenis pekerjaan untuk posisi lowongan
export const POSITION_TYPES = ["Full-time", "Part-time", "Freelance", "Kontrak"] as const;

// Batas unggahan
export const CV_MAX_BYTES = 5 * 1024 * 1024; // 5 MB, PDF saja
export const INTRO_MAX_BYTES = 10 * 1024 * 1024; // 10 MB, audio mp3/wav/m4a

// Opsi sumber pelamar ("dari mana kamu tahu lowongan ini?")
export const APPLICATION_SOURCES = [
  "Instagram",
  "TikTok",
  "YouTube",
  "Twitter/X",
  "Teman/Rekan",
  "Mesin pencari",
  "Lainnya",
] as const;
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number];
