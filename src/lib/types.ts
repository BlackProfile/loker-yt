// Kontrak tipe data bersama untuk aplikasi rekrutmen konten kreator (v2).
// Dipakai oleh API (backend) dan komponen (frontend). Jangan duplikasi tipe di tempat lain.

import type { FormAnswerValue, FormSchema } from "@/lib/form-schema";

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

// Kategori fitur admin per tahap pipeline (tab Pipeline: Ditinjau/Wawancara/Diterima/Ditolak).
// Tahap bawaan punya kategori tetap; tahap kustom dipetakan lewat Position.stageCategories.
export type StageCategory = "REVIEW" | "INTERVIEW" | "ACCEPTED" | "REJECTED";
export const STAGE_CATEGORIES: StageCategory[] = ["REVIEW", "INTERVIEW", "ACCEPTED", "REJECTED"];
export const STAGE_CATEGORY_LABELS: Record<StageCategory, string> = {
  REVIEW: "Ditinjau",
  INTERVIEW: "Wawancara",
  ACCEPTED: "Diterima",
  REJECTED: "Ditolak",
};

/* ------------------------------- Bot Telegram ------------------------------- */

// Kunci toggle alert bot Telegram (pesan masuk ke chat admin yang terdaftar).
export type TelegramAlertKey =
  | "newApplication" // lamaran baru masuk (dengan tombol aksi)
  | "survey" // survei pengalaman kandidat diisi
  | "emailFailed" // email di kotak keluar gagal terkirim
  | "system" // event sistem: wawancara, offer, NO_SHOW, rekap
  | "quota" // kuota posisi hampir penuh / penuh
  | "digest" // digest pagi 07:00 WIB
  | "interviewReminder" // pengingat wawancara H-1 hari & H-2 jam
  | "slaStale" // alert lamaran menginap melewati batas SLA
  | "candidateActivity" // aktivitas pelamar: slot, konfirmasi, offer, dokumen
  | "digestEvening" // digest sore 17.00 WIB
  | "digestWeekly" // rekap mingguan Senin pagi
  | "exportScheduled"; // ekspor CSV terjadwal (Senin)

export const TELEGRAM_ALERT_KEYS: TelegramAlertKey[] = [
  "newApplication",
  "survey",
  "emailFailed",
  "system",
  "quota",
  "digest",
  "interviewReminder",
  "slaStale",
  "candidateActivity",
  "digestEvening",
  "digestWeekly",
  "exportScheduled",
];

export const TELEGRAM_ALERT_LABELS: Record<TelegramAlertKey, string> = {
  newApplication: "Lamaran baru masuk",
  survey: "Survei kandidat diisi",
  emailFailed: "Email gagal terkirim",
  system: "Event sistem (wawancara, offer, rekap)",
  quota: "Kuota posisi hampir penuh",
  digest: "Digest pagi (07.00 WIB)",
  interviewReminder: "Pengingat wawancara (H-1 & H-2 jam)",
  slaStale: "Lamaran menginap (SLA)",
  candidateActivity: "Aktivitas pelamar (slot, offer, dokumen)",
  digestEvening: "Digest sore (17.00 WIB)",
  digestWeekly: "Rekap mingguan (Senin)",
  exportScheduled: "Ekspor CSV terjadwal (Senin)",
};

export type TelegramAlerts = Record<TelegramAlertKey, boolean>;

export const DEFAULT_TELEGRAM_ALERTS: TelegramAlerts = {
  newApplication: true,
  survey: true,
  emailFailed: true,
  system: true,
  quota: true,
  digest: true,
  interviewReminder: true,
  slaStale: true,
  candidateActivity: true,
  digestEvening: true,
  digestWeekly: true,
  exportScheduled: true,
};

// Alert non-kritis: ditahan saat mode tenang (jam tenang) dan dirangkum di
// digest pagi berikutnya. Alert kritis (kuota, email gagal, SLA, sistem) tetap terkirim.
export const TELEGRAM_QUIET_HOLDABLE: TelegramAlertKey[] = [
  "newApplication",
  "survey",
  "candidateActivity",
];

export type TelegramQuietHours = { enabled: boolean; startHour: number; endHour: number };

export const DEFAULT_TELEGRAM_QUIET_HOURS: TelegramQuietHours = {
  enabled: true,
  startHour: 21, // 21.00 WIB
  endHour: 8, // sampai 08.00 WIB
};

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
  // Bot Telegram dua arah (admin): whitelist chat terdaftar + izin aksi tulis + pilihan alert
  telegramWriteEnabled: boolean; // izinkan aksi tulis dari bot (ubah tahap, dsb.)
  telegramAllowedChats: string[]; // daftar chat id terdaftar (hasil pairing /mulai KODE)
  telegramAlerts: TelegramAlerts; // jenis alert yang dikirim ke Telegram
  telegramLastDigest: string; // tanggal digest terakhir "YYYY-MM-DD" (Asia/Bangkok) — internal
  telegramMutes: Record<string, string>; // mode diam per chat: chatId -> ISO waktu sampai bisu — internal
  telegramLastChart: string; // tanggal grafik mingguan terakhir "YYYY-MM-DD" (Asia/Bangkok) — internal
  telegramQuotaAlerts: Record<string, number>; // dedup alert kuota: positionId -> sisa kuota saat terakhir diingatkan — internal
  // Mode tutup rekrutmen — saat true, halaman publik menampilkan banner
  // pengumuman dan formulir lamaran tidak bisa dikirim.
  recruitmentClosed: boolean;
  recruitmentClosedMessage: string;
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

  // Mode kerja & lokasi terstruktur (fitur non-remote)
  workMode: WorkMode; // REMOTE | ONSITE | HYBRID
  city: string | null; // kota kerja (ONSITE/HYBRID)
  address: string | null; // alamat kantor lengkap
  mapsUrl: string | null; // tautan Google Maps
  workHours: string | null; // mis. "Senin-Jumat, 09.00-18.00 WIB"
  shiftSystem: ShiftSystem; // NONE | FIXED | ROTATING
  facilities: string[]; // fasilitas untuk yang bekerja di kantor
  dailySlotQuota: number | null; // kuota slot wawancara on-site per hari

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
  // NR-22 — slot opsional wizard klasik bisa disembunyikan per posisi
  showCvField: boolean;
  showIntroField: boolean;
  showPortfolioField: boolean;
  showSocialField: boolean;
  // NR-24 — tampilkan kolom opsional ekspektasi gaji di wizard
  showExpectedSalary: boolean;
  customDocs: string[]; // label dokumen wajib tambahan (bebas, mis. "KTP", "Ijazah")
  maxApplicants: number | null;
  applyOpen: boolean; // formulir lamaran posisi ini buka/tutup (setting per posisi)
  formSchema: FormSchema | null; // Form Builder per posisi — null = mode klasik

  // Publikasi
  publishAt: string | null;

  // Pipeline & otomasi
  stages: string[]; // [] = pipeline bawaan (5 status)
  stageCategories: Record<string, StageCategory>; // kategori tahap kustom: {"Tahap": "REVIEW" | ...}
  stageNotes: Record<string, string> | null; // NR-15 override penjelasan tahap di halaman status
  stageWipLimits: Record<string, number> | null; // NR-19 batas kapasitas per tahap pipeline (null = tanpa batas)
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

  // Wawancara per lowongan
  interviewMode: InterviewMode;
  interviewPlatform: InterviewPlatform;
  interviewDuration: number;
  interviewCriteria: string[]; // [] = pakai DEFAULT_INTERVIEW_CRITERIA
  interviewInviteTemplate: string | null;

  // Offer & onboarding per lowongan
  offerTemplate: string | null;
  welcomeTemplate: string | null;
  probationMonths: number;
  onboardingDocs: string[]; // label dokumen wajib onboarding
  reapplyCooldownDays: number;
  autoCloseOnHired: boolean;

  // Rentang gaji wajar (validasi offer) — null = tanpa batas
  salaryMin: number | null;
  salaryMax: number | null;

  // Rencana ronde wawancara bawaan (opsional — tidak semua API menyertakan)
  roundPlan?: RoundPlanTemplate[];

  // Konten dua bahasa (opsional) — dipakai publik bila lang aktif "en"
  // dan field terisi (non-kosong); selain itu fallback ke versi Indonesia.
  titleEn: string | null;
  descriptionEn: string | null;
  requirementsEn: string[];
};

/** Satu entri rencana ronde wawancara pada Position.roundPlan (JSON). */
export type RoundPlanTemplate = {
  round: number; // ronde ke-n (1, 2, ...)
  name: string; // mis. "HR Screen", "User Trial", "Final"
  mode?: InterviewMode;
  platform?: InterviewPlatform;
  durationMin?: number;
  interviewers?: string[]; // pewawancara default
};

export type PositionPublicStats = {
  applications: number;
  remainingQuota: number | null; // null = tanpa kuota
};

/** Dokumen wajib tambahan yang diunggah pelamar (dari customDocs posisi). */
export type ExtraDoc = {
  label: string;
  filename: string;
  fileId: string; // URL publik admin: /api/files/{fileId}
};

/** Catatan bertimestamp pada video intro pelamar (detik ke berapa + isi catatan). */
export type VideoNote = {
  t: number; // detik ke-n dalam video
  note: string;
};

/** Event webhook keluar yang bisa dilangganan endpoint eksternal. */
export const WEBHOOK_EVENTS = [
  "application.created",
  "application.stage_changed",
  "application.archived",
  "offer.sent",
  "offer.responded",
  "interview.scheduled",
  "interview.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "*": "Semua event",
  "application.created": "Lamaran baru masuk",
  "application.stage_changed": "Tahap pelamar berubah",
  "application.archived": "Lamaran diarsipkan",
  "offer.sent": "Penawaran dikirim ke pelamar",
  "offer.responded": "Pelamar menjawab penawaran",
  "interview.scheduled": "Wawancara dijadwalkan",
  "interview.completed": "Wawancara selesai",
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

  // Info kehadiran untuk posisi non-remote (on-site/hybrid) — diisi dari wizard
  domisili?: string | null; // kota domisili pelamar
  komuterPlan?: KomuterPlan | null; // SIAP_KOMUTER | PERLU_RELOKASI | TIDAK
  shiftPref?: ShiftPref | null; // PAGI | SIANG | MALAM | APA_SAJA
  startDatePref?: string | null; // perkiraan kapan bisa mulai kerja

  formAnswers?: Record<string, FormAnswerValue> | null; // Task 30 — jawaban Form Builder {fieldId: nilai}
  rubricScores: Record<string, number> | null; // {kriteria: 1-5}
  checklistState: string[]; // item checklist yang dicentang
  cvFileId: string | null;
  cvFileName: string | null;
  introFileId: string | null;
  introFileName: string | null;
  extraDocs: ExtraDoc[]; // dokumen wajib tambahan yang diunggah pelamar

  // Penolakan terstruktur
  rejectionReason: RejectionReason | null;
  rejectionNote: string | null;
  rejectedAt: string | null;

  // Penawaran (offer)
  offerStatus: OfferStatus | null;
  offerSalary: string | null;
  offerType: string | null;
  offerStartDate: string | null;
  offerNote: string | null;
  offerDeadline: string | null;
  offerSentAt: string | null;
  offerRespondedAt: string | null;
  offerDeclineReason: string | null;

  // Onboarding
  hiredAt: string | null;
  probationEnd: string | null;
  onboardingDocs: OnboardingDoc[];

  // Kualitas data
  isDuplicate?: boolean; // true = lamaran ganda terdeteksi (badge "Duplikat" di tabel)

  // Task 27 — SLA, arsip, sampah, catatan video, persetujuan
  stageUpdatedAt?: string | null; // terakhir kali tahap berubah (SLA)
  archivedAt?: string | null; // arsip otomatis/manual
  deletedAt?: string | null; // tong sampah (soft delete)
  videoNotes?: VideoNote[]; // catatan bertimestamp video intro
  consentAt?: string | null; // persetujuan privasi pelamar

  // NR-15 — read receipt & konfirmasi tanggal mulai (halaman Cek Status)
  candidateSeenAt?: string | null; // terakhir pelamar membuka status lamaran ini
  candidateSeenCount?: number; // berapa kali halaman status dibuka
  startConfirmedAt?: string | null; // pelamar konfirmasi tanggal mulai
  startProposedAt?: string | null; // usulan tanggal mulai baru dari pelamar
  startProposedNote?: string | null; // catatan singkat dari pelamar

  // NR-24 — fitur per pelamar (fondasi batch 1)
  expectedSalary: number | null; // ekspektasi gaji bulanan pelamar (Rp)
  starredBy: string[]; // AdminUser.id yang menandai lamaran ini penting (bintang personal)
  holdReason: string | null; // alasan proses ditahan (HOLD)
  holdReviewAt: string | null; // tanggal review ulang untuk HOLD (ISO)
  docExpiries: Record<string, string>; // {fileId: "YYYY-MM-DD"} masa berlaku dokumen extraDocs
  mergedIntoId: string | null; // id lamaran utama bila lamaran ini digabung
  snoozeUntil: string | null; // tanggal tindak lanjut (dipakai juga snooze bot Telegram & cron lonceng)

  createdAt: string;
};

/* ------------------------ NR-24 — fitur per pelamar (kontrak) ------------------------ */

/** Satu entri riwayat panggilan telepon ke pelamar (ApplicationCall). */
export type CallLog = {
  id: string;
  result: "DIANGGAT" | "TIDAK_DIANGGAT" | "SALAH_SAMBUNGAN";
  summary: string;
  actor: string;
  createdAt: string;
};

/** Satu tes/asesmen yang dikirim ke pelamar (ApplicationAssessment). */
export type Assessment = {
  id: string;
  title: string;
  link: string | null;
  note: string | null;
  dueAt: string | null;
  status: "SENT" | "SUBMITTED" | "LATE";
  score: number | null;
  feedback: string | null;
  createdAt: string;
  submittedAt: string | null;
};

/** Satu dokumen internal lamaran (ApplicationInternalDoc) — hanya terlihat admin. */
export type InternalDoc = {
  id: string;
  name: string;
  fileId: string;
  uploadedBy: string;
  createdAt: string;
};

/** Item kotak masuk gabungan (email, pertanyaan pelamar, atau hasil panggilan). */
export type InboxItem = {
  kind: "EMAIL" | "QUESTION" | "CALL";
  at: string;
  from: string;
  title: string;
  body: string;
  answered?: boolean;
};

/** Ringkasan satu lamaran milik pelamar yang sama (daftar riwayat lamaran). */
export type ApplicationHistoryItem = {
  id: string;
  trackingCode: string | null;
  positionTitle: string | null;
  status: string;
  createdAt: string;
  aiScore: number | null;
};

/** Entri daftar Do-not-Hire (Setting "doNotHire" — map {key: {reason, by, at}}). */
export type DoNotHireEntry = {
  key: string;
  reason: string;
  by: string;
  at: string;
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
  invitePending?: boolean; // NR-19 undangan set-sandi masih menunggu
  inviteExpiresAt?: string | null;
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

  // NR-15 — kesehatan halaman Cek Status (dasbor admin)
  statusHealth?: {
    checksToday: number; // total bukaan halaman status hari ini (semua lamaran)
    loginsToday: number; // login track-auth sukses hari ini
    avgViewDelayHours: number | null; // rata-rata jeda "tahap berubah -> dilihat pelamar" (7 hari terakhir)
    mostStalledStage: { label: string; medianDays: number } | null; // tahap dengan waktu tunggu terlama (lamaran aktif)
  };
};

// POST /api/public/track -> { code, email } — email WAJIB cocok dengan lamaran
// (login ganda: kode pelacakan bertindak sebagai kata sandi).
// Pertanyaan pelamar dari halaman status (thread tanya-jawab dengan tim rekrutmen).
export type TrackQuestionInfo = {
  id: string;
  question: string;
  answer: string | null; // null = menunggu jawaban admin
  askedAt: string;
  answeredAt: string | null;
};

// Item riwayat tahap yang sudah dilewati (timeline bertanggal).
export type StageHistoryItem = { key: string; label: string; at: string };

// Satu perubahan sejak kunjungan terakhir pelamar (ringkasan "Apa yang Berubah").
export type TrackChangeInfo = { at: string; text: string };

export type TrackResponse = {
  found: boolean;
  status?: StageKey; // tahap pipeline (bawaan atau kustom per posisi)
  positionTitle?: string | null;
  positionSlug?: string | null;
  submittedAt?: string;
  updatedAt?: string; // terakhir kali lamaran berubah apa pun (untuk "terakhir diperbarui")
  steps?: { key: string; label: string; done: boolean; at: string | null }[];
  assignment?: { title: string | null; url: string | null; note: string | null } | null; // info tes posisi (jika ada)
  // Sesi wawancara aktif + riwayat (terurut ronde)
  interviews?: TrackInterviewInfo[];
  offer?: TrackOfferInfo | null;
  rejection?: { reasonLabel: string; note: string | null } | null; // note hanya jika admin memberi feedback
  rejectionReason?: string | null; // alasan mentah (mis. MENARIK_DIRI) untuk mapping tampilan
  onboarding?: TrackOnboardingInfo | null;
  cooldown?: { until: string; days: number } | null; // pelamar masih dalam masa jeda lamar ulang
  // Slot jadwal yang bisa dipilih pelamar (hanya bila tahap belum final; maks 8, urut terdekat)
  slots?: TrackSlotInfo[];
  // Rencana onboarding dari admin (agenda hari pertama; tampil terpisah dari checklist dokumen)
  onboardingPlan?: OnboardingPlanItem[] | null;

  // NR-15 — transparansi & keterlibatan
  stageHistory?: StageHistoryItem[] | null; // tahap yang sudah dilewati + tanggal
  stageNote?: Record<string, string> | null; // penjelasan per tahap (override posisi > default)
  stageEstimates?: Record<string, number> | null; // tahap -> estimasi hari (median historis)
  questions?: TrackQuestionInfo[] | null; // thread tanya-jawab pelamar
  cvFileName?: string | null; // nama CV saat ini (panel perbarui CV)
  surveyToken?: string | null; // token survei bila status final & belum diisi (tombol Beri Ulasan)
  candidateStart?: {
    startDate: string | null; // tanggal mulai dari offer
    confirmedAt: string | null; // saat pelamar konfirmasi
    proposedAt: string | null; // saat pelamar mengusul ulang
    note: string | null; // catatan usulan pelamar
  } | null;
};

// Ringkasan satu lamaran milik satu email (untuk daftar multi-lamaran di halaman status).
export type TrackSummary = {
  trackingCode: string;
  positionTitle: string | null;
  positionSlug: string | null;
  status: string; // StageKey bawaan atau tahap kustom per posisi
  submittedAt: string;
  statusUpdatedAt: string; // terakhir kali tahap/isi lamaran berubah
};

// POST /api/public/track-auth — login pelamar (email + kode pelacakan).
// Sukses: daftar SEMUA lamaran aktif milik email tersebut (multi-lamaran sekali login).
export type TrackAuthResponse = {
  ok: boolean;
  applications?: TrackSummary[];
  lockedForSec?: number; // sisa detik kunci lockout (bila ok=false karena lockout)
  // NR-15 — "Apa yang Berubah" sejak kunjungan terakhir, dipetakan per kode lamaran.
  // Klien mengirim header "x-lumina-seen" berisi JSON {kode: epochMs}; server menyertakan
  // daftar perubahan (tahap pindah, jadwal dibuat, offer dikirim, dll) untuk tiap kode.
  changes?: Record<string, TrackChangeInfo[]>;
};

// GET /api/admin/analytics — data tab analitik
export type AnalyticsResponse = {
  totals: {
    applications: number;
    rejected: number;
    hired: number;
    offersSent: number;
    offersAccepted: number;
    interviewsCompleted: number;
    noShows: number;
  };
  funnel: { stage: string; count: number }[]; // bucket bawaan + CUSTOM
  rejectionReasons: { reason: string; label: string; count: number }[];
  timeToRejectAvgDays: number | null;
  timeToHireAvgDays: number | null;
  offerAcceptanceRate: number | null; // persen
  interviewPassRate: number | null; // persen LANJUT dari selesai
  avgInterviewScore: number | null; // 1-5
  interviewerLoad: { name: string; count: number }[];
  monthly: { month: string; applications: number; hires: number }[]; // 6 bulan terakhir
};

// GET /api/admin/action-items — kartu "Perlu Tindakan" dashboard
export type ActionItemsResponse = {
  rescheduleRequests: {
    interviewId: string;
    applicationId: string;
    name: string;
    positionTitle: string | null;
    scheduledAt: string;
    proposedAt: string | null;
    reason: string | null;
  }[];
  offersAwaiting: {
    applicationId: string;
    name: string;
    positionTitle: string | null;
    salary: string | null;
    deadline: string | null;
  }[];
  unscoredInterviews: {
    interviewId: string;
    applicationId: string;
    name: string;
    positionTitle: string | null;
    completedAt: string | null;
  }[];
  onboardingIncomplete: {
    applicationId: string;
    name: string;
    positionTitle: string | null;
    missingDocs: string[];
  }[];
  wipOver?: { // NR-19 tahap melewati batas kapasitas (WIP limit)
    positionId: string;
    positionTitle: string | null;
    stage: string;
    count: number;
    limit: number;
  }[];
  followupDue: { // NR-24 — lamaran di-snooze yang mendekati/jatuh tempo tindak lanjut
    id: string;
    name: string;
    trackingCode: string | null;
    snoozeUntil: string | null;
    positionTitle: string | null;
  }[];
  holdReviewDue: { // NR-24 — lamaran HOLD yang mendekati/jatuh tempo review ulang
    id: string;
    name: string;
    trackingCode: string | null;
    holdReason: string | null;
    holdReviewAt: string | null;
    positionTitle: string | null;
  }[];
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

/* ------------------------------ Wawancara (Zoom/Meet/onsite) ------------------------------ */

export type InterviewMode = "ONLINE" | "ONSITE";
export const INTERVIEW_MODES: InterviewMode[] = ["ONLINE", "ONSITE"];
export const INTERVIEW_MODE_LABELS: Record<InterviewMode, string> = {
  ONLINE: "Online",
  ONSITE: "Onsite (tatap muka)",
};

export type InterviewPlatform =
  | "GOOGLE_MEET"
  | "ZOOM"
  | "MICROSOFT_TEAMS"
  | "WHATSAPP"
  | "TELEPON"
  | "LAINNYA";
export const INTERVIEW_PLATFORMS: InterviewPlatform[] = [
  "GOOGLE_MEET",
  "ZOOM",
  "MICROSOFT_TEAMS",
  "WHATSAPP",
  "TELEPON",
  "LAINNYA",
];
export const INTERVIEW_PLATFORM_LABELS: Record<InterviewPlatform, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  WHATSAPP: "WhatsApp Call",
  TELEPON: "Telepon",
  LAINNYA: "Lainnya",
};

export type InterviewStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "RESCHEDULE_REQUESTED"
  | "COMPLETED"
  | "NO_SHOW"
  | "CANCELLED";
export const INTERVIEW_STATUSES: InterviewStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "RESCHEDULE_REQUESTED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
];
export const INTERVIEW_STATUS_LABELS: Record<InterviewStatus, string> = {
  SCHEDULED: "Terjadwal",
  CONFIRMED: "Dikonfirmasi",
  RESCHEDULE_REQUESTED: "Minta Ubah Jadwal",
  COMPLETED: "Selesai",
  NO_SHOW: "Tidak Hadir",
  CANCELLED: "Dibatalkan",
};

export type InterviewRecommendation = "LANJUT" | "CADANGAN" | "TOLAK";
export const INTERVIEW_RECOMMENDATIONS: InterviewRecommendation[] = ["LANJUT", "CADANGAN", "TOLAK"];
export const INTERVIEW_RECOMMENDATION_LABELS: Record<InterviewRecommendation, string> = {
  LANJUT: "Lanjut ke tahap berikutnya",
  CADANGAN: "Cadangkan (talent pool)",
  TOLAK: "Tolak kandidat",
};

/** Kriteria scorecard wawancara bila posisi tidak mendefinisikan sendiri. */
export const DEFAULT_INTERVIEW_CRITERIA: string[] = [
  "Komunikasi",
  "Portofolio & Karya",
  "Kemampuan Teknis",
  "Kecocokan Budaya",
];

/** Satu sesi wawancara (multi-ronde) milik sebuah lamaran. */
export type Interview = {
  id: string;
  applicationId: string;
  round: number;
  mode: InterviewMode;
  platform: InterviewPlatform;
  meetingLink: string | null;
  address: string | null;
  scheduledAt: string; // ISO
  durationMin: number;
  interviewers: string[]; // nama pewawancara
  status: InterviewStatus;
  scores: Record<string, number> | null; // {kriteria: 1-5}
  recommendation: InterviewRecommendation | null;
  notes: string | null;
  recordingUrl: string | null;
  completedAt: string | null;
  checkedInAt?: string | null; // saat kandidat ditandai hadir datang ke kantor (on-site)
  rescheduleReason: string | null;
  rescheduleProposedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // konteks ringkas untuk daftar admin (opsional, dari API)
  applicationName?: string;
  applicationPhone?: string;
  positionTitle?: string | null;
  trackingCode?: string;
  // rekaman & transkrip (diisi route transcribe; opsional pada serialisasi lama)
  transcript?: string | null;
  transcriptSummary?: string | null;
  slotId?: string | null; // slot self-service yang dipilih pelamar
};

/* ------------------------------ Slot wawancara self-service ------------------------------ */

/** Slot jadwal yang dibuka admin — dipilih sendiri oleh pelamar dari halaman status. */
export type InterviewSlot = {
  id: string;
  positionId: string | null;
  positionTitle: string | null;
  scheduledAt: string; // ISO
  durationMin: number;
  mode: InterviewMode;
  platform: InterviewPlatform;
  meetingLink: string | null;
  address: string | null;
  interviewers: string[];
  bookedByApplicationId: string | null;
  bookedByName: string | null; // nama pelamar yang membooking (dari API admin)
  bookedAt: string | null;
  createdAt: string;
};

/** Slot tersedia pada TrackResponse (versi publik, tanpa data booking). */
export type TrackSlotInfo = {
  id: string;
  scheduledAt: string;
  durationMin: number;
  mode: InterviewMode;
  platform: InterviewPlatform;
  meetingLink: string | null;
  address: string | null;
  interviewers: string[];
};

/** Item rencana onboarding (agenda hari pertama, mentor, target). */
export type OnboardingPlanItem = {
  id: string;
  label: string;
  owner?: string;
  dueAt?: string | null;
  done: boolean;
};

// POST /api/public/slots/book -> sukses
export type SlotBookResponse = { ok: true; round: number; scheduledAt: string };

/* ---------------------------------- Penolakan terstruktur ---------------------------------- */

export type RejectionReason =
  | "KUALIFIKASI"
  | "PENGALAMAN"
  | "PORTOFOLIO"
  | "KUOTA"
  | "TIDAK_HADIR"
  | "MENARIK_DIRI"
  | "TIDAK_RESPON"
  | "DUPLICATE"
  | "LAINNYA";

export const REJECTION_REASONS: RejectionReason[] = [
  "KUALIFIKASI",
  "PENGALAMAN",
  "PORTOFOLIO",
  "KUOTA",
  "TIDAK_HADIR",
  "MENARIK_DIRI",
  "TIDAK_RESPON",
  "DUPLICATE",
  "LAINNYA",
];

export const REJECTION_REASON_LABELS: Record<RejectionReason, string> = {
  KUALIFIKASI: "Kualifikasi belum sesuai",
  PENGALAMAN: "Pengalaman kurang relevan",
  PORTOFOLIO: "Portofolio tidak sesuai niche",
  KUOTA: "Kuota telah terpenuhi",
  TIDAK_HADIR: "Tidak hadir wawancara",
  MENARIK_DIRI: "Menarik lamaran sendiri",
  TIDAK_RESPON: "Tidak merespons dalam waktu yang ditentukan",
  DUPLICATE: "Lamaran ganda",
  LAINNYA: "Alasan lain",
};

export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
export const OFFER_STATUSES: OfferStatus[] = ["PENDING", "ACCEPTED", "DECLINED", "EXPIRED"];
export const OFFER_STATUS_LABELS: Record<OfferStatus, string> = {
  PENDING: "Menunggu Jawaban",
  ACCEPTED: "Diterima Pelamar",
  DECLINED: "Ditolak Pelamar",
  EXPIRED: "Kedaluwarsa",
};

/** Dokumen onboarding yang harus diunggah pelamar setelah diterima. */
export type OnboardingDoc = {
  id: string;
  label: string;
  required: boolean;
  done: boolean;
  fileId: string | null; // /api/files/{fileId}
};

/* ------------------------------ Penawaran untuk halaman status ------------------------------ */

export type TrackOfferInfo = {
  status: OfferStatus;
  salary: string | null;
  type: string | null;
  startDate: string | null;
  note: string | null;
  deadline: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  declineReason: string | null;
  message: string | null; // teks penawaran (dari template posisi, sudah diisi variabel)
};

export type TrackInterviewInfo = {
  id: string;
  round: number;
  mode: InterviewMode;
  platform: InterviewPlatform;
  meetingLink: string | null;
  address: string | null;
  scheduledAt: string;
  durationMin: number;
  interviewers: string[];
  status: InterviewStatus;
  rescheduleReason: string | null;
  rescheduleProposedAt: string | null;
};

export type TrackOnboardingInfo = {
  hiredAt: string | null;
  probationEnd: string | null;
  docs: OnboardingDoc[];
  welcomeMessage: string | null;
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

// Mode kerja posisi: penuh remote, penuh di kantor, atau campuran (fitur non-remote)
export const WORK_MODES = ["REMOTE", "ONSITE", "HYBRID"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  REMOTE: "Remote",
  ONSITE: "On-site",
  HYBRID: "Hybrid",
};

// Sistem shift untuk posisi yang dikerjakan di kantor
export const SHIFT_SYSTEMS = ["NONE", "FIXED", "ROTATING"] as const;
export type ShiftSystem = (typeof SHIFT_SYSTEMS)[number];
export const SHIFT_SYSTEM_LABELS: Record<ShiftSystem, string> = {
  NONE: "Tanpa shift",
  FIXED: "Shift tetap",
  ROTATING: "Shift bergilir",
};

// Kesiapan shift pelamar (pertanyaan wizard untuk posisi on-site/hybrid)
export const SHIFT_PREFS = ["PAGI", "SIANG", "MALAM", "APA_SAJA"] as const;
export type ShiftPref = (typeof SHIFT_PREFS)[number];
export const SHIFT_PREF_LABELS: Record<ShiftPref, string> = {
  PAGI: "Shift pagi",
  SIANG: "Shift siang",
  MALAM: "Shift malam",
  APA_SAJA: "Apa saja",
};

// Rencana komuter pelamar (pertanyaan wizard untuk posisi on-site/hybrid)
export const KOMUTER_PLANS = ["SIAP_KOMUTER", "PERLU_RELOKASI", "TIDAK"] as const;
export type KomuterPlan = (typeof KOMUTER_PLANS)[number];
export const KOMUTER_PLAN_LABELS: Record<KomuterPlan, string> = {
  SIAP_KOMUTER: "Siap komuter setiap hari",
  PERLU_RELOKASI: "Perlu relokasi",
  TIDAK: "Belum bisa",
};

// Preset dokumen wajib yang umum untuk posisi on-site (tombol cepat di form posisi)
export const ONSITE_DOC_PRESETS = ["KTP", "SKCK", "Surat Keterangan Sehat"] as const;

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
