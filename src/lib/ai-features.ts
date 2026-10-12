// NR49 — Registry fitur AI (CLIENT-SAFE, tanpa import db/server).
// Satu sumber kebenaran daftar fitur AI untuk Pusat Kendali AI (UI), gate
// (server), dan Log Aktivitas AI. Dipakai bersama oleh semua paket NR49.
//
// priority:
//   "manual"     — dipicu aksi admin langsung; dijalankan kapan pun fitur aktif.
//   "background" — dipicu sistem (skrining otomatis, brief pagi cron). Bisa
//                  ditunda otomatis saat Mode Hemat aktif atau saat "Prioritas
//                  Aksi Admin" menahan tugas latar belakang.

export type AiFeaturePriority = "manual" | "background";

export type AiFeatureDef = {
  key: string;
  label: string;
  description: string;
  priority: AiFeaturePriority;
  /** Kuota bawaan per hari; null = tanpa batas (masih dibatasi kebijakan server). */
  defaultQuota: number | null;
  /** Nilai kuota maksimum yang boleh diisi admin. */
  maxQuota: number;
};

export const AI_FEATURES: AiFeatureDef[] = [
  // Fitur AI eksisting (kini punya gate & kuota terpusat)
  {
    key: "auto_screening",
    label: "Skrining Otomatis Lamaran",
    description: "AI memberi skor, ringkasan, dan rekomendasi tiap lamaran baru yang masuk.",
    priority: "background",
    defaultQuota: null,
    maxQuota: 5000,
  },
  {
    key: "cv_summary",
    label: "Ringkasan CV",
    description: "Bulatkan CV panjang menjadi butir-butir ringkas di detail kandidat.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 2000,
  },
  {
    key: "ai_reply",
    label: "Draf Balasan Email",
    description: "Susun draf balasan email untuk kandidat dari konteks lamaran.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "interview_questions",
    label: "Pertanyaan Wawancara",
    description: "Generate pertanyaan wawancara personal per kandidat.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "compare_ai",
    label: "Bandingkan Kandidat",
    description: "Analisis perbandingan dua kandidat atau lebih.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
  {
    key: "semantic_search",
    label: "Pencarian Semantik Kandidat",
    description: "Cari kandidat dengan kalimat natural, bukan kata kunci persis.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "shortlist",
    label: "Shortlist Berperingkat",
    description: "Urutkan kandidat terbaik untuk sebuah posisi.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
  {
    key: "ask_data",
    label: "Tanya Data",
    description: "Pertanyaan statistik rekrutmen dijawab dari data panel.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "ocr_cv",
    label: "OCR CV",
    description: "Ekstrak teks dari file CV gambar/PDF via model vision.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "transcribe",
    label: "Transkrip Wawancara",
    description: "Ubah rekaman wawancara menjadi teks (pengenalan suara).",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
  {
    key: "bias_check",
    label: "Cek Bias Penilaian",
    description: "Periksa catatan admin dari sudut pandang keadilan penilaian.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
  {
    key: "position_brief",
    label: "Brief Posisi",
    description: "Susun draf deskripsi/brief lowongan dari data posisi.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 300,
  },
  {
    key: "answer_summary",
    label: "Ringkasan Jawaban per Posisi",
    description: "Rekap jawaban screening seluruh pelamar satu posisi.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 300,
  },
  {
    key: "chatbot_publik",
    label: "Chatbot Publik",
    description: "Asisten tanya-jawab untuk pengunjung situs karier.",
    priority: "manual",
    defaultQuota: 500,
    maxQuota: 5000,
  },
  {
    key: "talent_rediscover",
    label: "Rediscover Talenta",
    description: "Temukan kandidat lama yang cocok untuk posisi baru.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
  {
    key: "cover_draft",
    label: "Draf Cover Laporan/Teks",
    description: "Susun draf teks pendukung dari konteks lamaran.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },

  // Fitur AI baru NR49
  {
    key: "copilot",
    label: "Copilot Admin",
    description: "Asisten percakapan yang bisa mengusulkan dan menjalankan aksi panel.",
    priority: "manual",
    defaultQuota: 300,
    maxQuota: 2000,
  },
  {
    key: "anomaly_explain",
    label: "Penjelasan Anomali",
    description: "Jelaskan penyebab angka yang berubah drastis + saran tindakan.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
  {
    key: "morning_brief",
    label: "Brief Pagi AI",
    description: "Narasi pagi otomatis: kemarin, agenda hari ini, dan yang perlu ditindak.",
    priority: "background",
    defaultQuota: 3,
    maxQuota: 10,
  },
  {
    key: "risk_explain",
    label: "Penjelasan Risiko Kandidat",
    description: "Alasan bahasa manusia di balik skor risiko tidak hadir/penolakan offer.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "auto_tag",
    label: "Sarankan Tag",
    description: "Usulan tag kandidat dari CV/jawaban; selalu menunggu persetujuan admin.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 2000,
  },
  {
    key: "rejection_insight",
    label: "Analisis Alasan Penolakan",
    description: "Kelompokkan alasan penolakan jadi tren + saran perbaikan proses.",
    priority: "manual",
    defaultQuota: 50,
    maxQuota: 200,
  },
  {
    key: "translate",
    label: "Penerjemah Kandidat",
    description: "Terjemahkan CV/jawaban berbahasa asing ke Bahasa Indonesia.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 2000,
  },
  {
    key: "announcement_draft",
    label: "Draf Pengumuman",
    description: "Tulis draf pengumuman lowongan untuk papan internal/Telegram.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 300,
  },
  {
    key: "poster",
    label: "Poster Lowongan",
    description: "Gambar poster lowongan siap bagikan (pembuatan gambar AI).",
    priority: "manual",
    defaultQuota: 20,
    maxQuota: 200,
  },
  {
    key: "scorecard_draft",
    label: "Draf Penilaian Wawancara",
    description: "Usulan nilai + justifikasi per kriteria dari transkrip wawancara.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 1000,
  },
  {
    key: "onboarding",
    label: "Paket Onboarding",
    description: "Checklist hari pertama, draf email sambutan, dan kebutuhan peralatan.",
    priority: "manual",
    defaultQuota: null,
    maxQuota: 500,
  },
];

export const AI_FEATURE_KEYS = AI_FEATURES.map((f) => f.key) as string[];

export function aiFeatureDef(key: string): AiFeatureDef | undefined {
  return AI_FEATURES.find((f) => f.key === key);
}

// ---- Tipe tampilan yang dipakai UI (client-safe) ----------------------------

export type AiControlFeatureView = {
  key: string;
  label: string;
  description: string;
  priority: AiFeaturePriority;
  enabled: boolean;
  quotaPerDay: number | null;
  usedToday: number;
};

export type AiControlView = {
  features: AiControlFeatureView[];
  manualPriority: boolean;
  /** Info Mode Hemat saat ini (hanya untuk tampilan status di kartu). */
  saveMode: { active: boolean; reason: string | null; level: string | null } | null;
  updatedAt: string | null;
};

export type AiUsagePoint = { date: string; ok: number; error: number; blocked: number };

export type AiUsageRow = {
  id: string;
  feature: string;
  featureLabel: string;
  actor: string | null;
  status: string;
  durationMs: number;
  detail: string | null;
  createdAt: string;
};

export type AiUsageView = {
  totals: { ok: number; error: number; blocked: number; featuresUsed: number };
  perFeature: { feature: string; label: string; ok: number; error: number; blocked: number }[];
  daily: AiUsagePoint[];
  recent: AiUsageRow[];
  days: number;
};

// Kontrak aksi Copilot Admin (NR49 Paket B) — client-safe agar UI bisa
// merender chip aksi tanpa import server.
export type CopilotActionType =
  | "set_application_status"
  | "toggle_position"
  | "bulk_reject_stale";

export type CopilotProposedAction = {
  type: CopilotActionType;
  label: string; // label bahasa manusia untuk chip UI
  risk: "low" | "medium" | "high";
  params: Record<string, string | number>;
};

export type CopilotReplyView = {
  reply: string;
  actions: CopilotProposedAction[];
};
