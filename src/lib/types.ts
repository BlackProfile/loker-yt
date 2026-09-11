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
  department: string;
  type: string;
  location: string;
  description: string;
  requirements: string[];
  isActive: boolean;
  closesAt: string | null; // ISO date atau null
  order: number;
  createdAt: string;
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
  status: ApplicationStatus;
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
  positions: Position[]; // hanya aktif & belum lewat closesAt, terurut order
  stats: { openRoles: number; totalApplications: number };
};

// GET /api/admin/overview
export type AdminOverviewResponse = {
  stats: {
    total: number;
    NEW: number;
    REVIEWED: number;
    INTERVIEW: number;
    ACCEPTED: number;
    REJECTED: number;
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
  status?: ApplicationStatus;
  positionTitle?: string | null;
  submittedAt?: string;
  steps?: { key: string; label: string; done: boolean; at: string | null }[];
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
