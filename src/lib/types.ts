// Kontrak tipe data bersama untuk aplikasi rekrutmen konten kreator.
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

export type BenefitItem = { icon: string; title: string; description: string };

export type FaqItem = { question: string; answer: string };

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
  contactEmail: string;
  contactWhatsapp: string; // format internasional tanpa "+", mis. 6281234567890
  instagram: string;
  footerText: string;
};

export type Position = {
  id: string;
  title: string;
  department: string;
  type: string;
  location: string;
  description: string;
  requirements: string[];
  isActive: boolean;
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
  createdAt: string;
};

// GET /api/public/content
export type PublicContentResponse = {
  site: SiteContent;
  positions: Position[]; // hanya posisi aktif, terurut berdasarkan order
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
};

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
