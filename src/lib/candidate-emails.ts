// Email otomatis ke KANDIDAT saat tahap lamarannya berubah (ide: "email status").
// SERVER-ONLY — jangan diimpor dari komponen klien.
//
// Konfigurasi + template per status tujuan disimpan di Setting key
// "candidateEmails" (JSON). Variabel yang didukung di subject/body:
//   {nama} {posisi} {kode} {status} {tanggal} {situs}
// Pengiriman memakai queueEmail (arsip EmailOutbox; terkirim bila SMTP aktif)
// dan TIDAK PERNAH melempar error — kegagalan tidak boleh menggagalkan PATCH.

import { db } from "@/lib/db";
import { queueEmail } from "@/lib/notify";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";
import { isBuiltInStage } from "@/lib/stages";
import { randomBytes } from "crypto";

export const CANDIDATE_EMAIL_KEYS = ["REVIEWED", "INTERVIEW", "ACCEPTED", "REJECTED"] as const;
export type CandidateEmailKey = (typeof CANDIDATE_EMAIL_KEYS)[number];

export type CandidateEmailTemplate = {
  enabled: boolean;
  subject: string;
  body: string;
};

export type CandidateEmailConfig = {
  /** Master toggle seluruh email status kandidat. */
  enabled: boolean;
  /** Sertakan tautan survei pengalaman kandidat di email Diterima/Ditolak. */
  surveyEnabled: boolean;
  templates: Record<CandidateEmailKey, CandidateEmailTemplate>;
};

const DEFAULT_TEMPLATES: Record<CandidateEmailKey, CandidateEmailTemplate> = {
  REVIEWED: {
    enabled: false,
    subject: "Lamaran kamu sedang ditinjau — {posisi}",
    body:
      "Halo {nama},\n\n" +
      "Terima kasih sudah melamar posisi {posisi} di {situs}. " +
      "Lamaran kamu dengan kode {kode} sedang kami tinjau.\n\n" +
      "Kami akan mengabari lewat email ini jika ada perkembangan.\n\n" +
      "Salam,\nTim Rekrutmen {situs}",
  },
  INTERVIEW: {
    enabled: true,
    subject: "Kamu maju ke tahap wawancara — {posisi}",
    body:
      "Halo {nama},\n\n" +
      "Selamat! Lamaran kamu ({kode}) untuk posisi {posisi} di {situs} maju ke tahap wawancara.\n\n" +
      "Jadwal dan tautan wawancara akan kami kirimkan terpisah — kamu juga bisa memilih slot yang tersedia dari halaman status lamaran.\n\n" +
      "Kamu bisa mengecek status lamaran kapan saja dengan kode {kode}.\n\n" +
      "Salam,\nTim Rekrutmen {situs}",
  },
  ACCEPTED: {
    enabled: true,
    subject: "Selamat! Lamaran kamu diterima — {posisi}",
    body:
      "Halo {nama},\n\n" +
      "Selamat! Kami senang memberi kabar bahwa lamaran kamu untuk posisi {posisi} di {situs} diterima pada {tanggal}.\n\n" +
      "Tim kami akan menghubungi kamu untuk langkah selanjutnya (penawaran dan onboarding).\n\n" +
      "Salam hangat,\nTim Rekrutmen {situs}",
  },
  REJECTED: {
    enabled: true,
    subject: "Kabar terbaru untuk lamaran kamu — {posisi}",
    body:
      "Halo {nama},\n\n" +
      "Terima kasih sudah melamar posisi {posisi} di {situs} dan meluangkan waktu dalam proses ini. " +
      "Setelah pertimbangan yang cermat, untuk saat ini kami memutuskan untuk tidak melanjutkan lamaran kamu ({kode}).\n\n" +
      "Keputusan ini bukan akhir dari perjalanan kamu — kami menyimpan profil kamu dan mengundang kamu untuk melamar posisi lain yang cocok di {situs}.\n\n" +
      "Salam hangat,\nTim Rekrutmen {situs}",
  },
};

const DEFAULT_CONFIG: CandidateEmailConfig = {
  enabled: true,
  surveyEnabled: true,
  templates: {
    REVIEWED: { ...DEFAULT_TEMPLATES.REVIEWED },
    INTERVIEW: { ...DEFAULT_TEMPLATES.INTERVIEW },
    ACCEPTED: { ...DEFAULT_TEMPLATES.ACCEPTED },
    REJECTED: { ...DEFAULT_TEMPLATES.REJECTED },
  },
};

function isTemplateLike(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Baca + sanitasi Setting "candidateEmails"; fallback default bila rusak/kosong. */
export async function getCandidateEmailConfig(): Promise<CandidateEmailConfig> {
  const config: CandidateEmailConfig = {
    enabled: DEFAULT_CONFIG.enabled,
    surveyEnabled: DEFAULT_CONFIG.surveyEnabled,
    templates: {
      REVIEWED: { ...DEFAULT_TEMPLATES.REVIEWED },
      INTERVIEW: { ...DEFAULT_TEMPLATES.INTERVIEW },
      ACCEPTED: { ...DEFAULT_TEMPLATES.ACCEPTED },
      REJECTED: { ...DEFAULT_TEMPLATES.REJECTED },
    },
  };
  try {
    const setting = await db.setting.findUnique({ where: { key: "candidateEmails" } });
    if (!setting) return config;
    const parsed: unknown = JSON.parse(setting.value);
    if (!isTemplateLike(parsed)) return config;
    if (typeof parsed.enabled === "boolean") config.enabled = parsed.enabled;
    if (typeof parsed.surveyEnabled === "boolean") config.surveyEnabled = parsed.surveyEnabled;
    const templates = isTemplateLike(parsed.templates) ? parsed.templates : {};
    for (const key of CANDIDATE_EMAIL_KEYS) {
      const raw = templates[key];
      if (!isTemplateLike(raw)) continue;
      if (typeof raw.enabled === "boolean") config.templates[key].enabled = raw.enabled;
      if (typeof raw.subject === "string" && raw.subject.trim()) {
        config.templates[key].subject = raw.subject.trim().slice(0, 200);
      }
      if (typeof raw.body === "string" && raw.body.trim()) {
        config.templates[key].body = raw.body.slice(0, 5000);
      }
    }
  } catch {
    // konfigurasi rusak → pakai default, jangan gagalkan alur utama
  }
  return config;
}

/** Sanitasi payload PUT dari admin: hanya field yang valid yang diterima. */
export function sanitizeCandidateEmailConfig(input: unknown): CandidateEmailConfig | null {
  if (!isTemplateLike(input)) return null;
  const current = { ...DEFAULT_CONFIG };
  if (typeof input.enabled === "boolean") current.enabled = input.enabled;
  if (typeof input.surveyEnabled === "boolean") current.surveyEnabled = input.surveyEnabled;
  const templates = isTemplateLike(input.templates) ? input.templates : {};
  for (const key of CANDIDATE_EMAIL_KEYS) {
    const raw = templates[key];
    if (!isTemplateLike(raw)) continue;
    if (typeof raw.enabled === "boolean") current.templates[key].enabled = raw.enabled;
    if (typeof raw.subject === "string") {
      const subject = raw.subject.trim();
      if (!subject || subject.length > 200) return null;
      current.templates[key].subject = subject;
    }
    if (typeof raw.body === "string") {
      const body = raw.body;
      if (!body.trim() || body.length > 5000) return null;
      current.templates[key].body = body;
    }
  }
  return current;
}

/** Ganti semua variabel {nama} dst. pada template. */
export function renderCandidateTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

function statusLabelOf(status: string): string {
  return isBuiltInStage(status) ? STATUS_LABELS[status as ApplicationStatus] : status;
}

async function getSiteName(): Promise<string> {
  try {
    const setting = await db.setting.findUnique({ where: { key: "site" } });
    if (!setting) return "Lumina Studio";
    const parsed: unknown = JSON.parse(setting.value);
    if (isTemplateLike(parsed) && typeof parsed.siteName === "string" && parsed.siteName.trim()) {
      return parsed.siteName.trim();
    }
  } catch {
    // diam
  }
  return "Lumina Studio";
}

/**
 * Kirim email status ke kandidat (dipanggil saat tahap lamaran berubah).
 * Aman dipanggil fire-and-forget: tidak pernah melempar error.
 * Menyertakan tautan survei pengalaman kandidat untuk status ACCEPTED/REJECTED
 * bila config.surveyEnabled aktif (token dibuat di muka, score 0 = belum diisi).
 */
export async function sendCandidateStatusEmail(params: {
  applicationId: string;
  name: string;
  email: string;
  trackingCode: string | null;
  toStatus: string;
  positionTitle: string | null;
  /** Origin permintaan admin (req.headers.origin) — dipakai untuk tautan survei. */
  origin?: string;
}): Promise<void> {
  try {
    const config = await getCandidateEmailConfig();
    if (!config.enabled) return;

    const key = (
      isBuiltInStage(params.toStatus) ? params.toStatus : ""
    ) as CandidateEmailKey;
    if (!CANDIDATE_EMAIL_KEYS.includes(key)) return; // tahap kustom: tidak ada template
    const template = config.templates[key];
    if (!template.enabled) return;

    const email = params.email.trim();
    if (!email || !email.includes("@")) return; // lamaran impor bisa tanpa email valid

    const siteName = await getSiteName();
    const label = statusLabelOf(params.toStatus);
    const vars: Record<string, string> = {
      nama: params.name,
      posisi: params.positionTitle?.trim() || "posisi umum",
      kode: params.trackingCode?.trim() || "-",
      status: label,
      tanggal: new Date().toLocaleDateString("id-ID", { dateStyle: "long" }),
      situs: siteName,
    };

    // Survei pengalaman kandidat (ide terpisah) — dilampirkan pada keputusan final.
    let surveySuffix = "";
    if (config.surveyEnabled && (key === "ACCEPTED" || key === "REJECTED")) {
      try {
        const base =
          (params.origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
        if (base.startsWith("http")) {
          const token = randomBytes(16).toString("hex");
          await db.candidateSurvey.create({
            data: { token, applicationId: params.applicationId, score: 0 },
          });
          surveySuffix =
            `\n\nMenurut kamu, bagaimana pengalaman mengikuti proses rekrutmen ini? ` +
            `Kami baca semua masukan (1 menit, anonim):\n${base}/?survei=${token}`;
        }
      } catch {
        surveySuffix = ""; // survei gagal dibuat — email tetap terkirim
      }
    }

    await queueEmail({
      toEmail: email,
      subject: renderCandidateTemplate(template.subject, vars),
      body: renderCandidateTemplate(template.body, vars) + surveySuffix,
      kind: key === "REJECTED" ? "REJECT" : key === "INTERVIEW" ? "INVITE" : "SYSTEM",
      applicationId: params.applicationId,
    });

    try {
      await db.activityLog.create({
        data: {
          applicationId: params.applicationId,
          actor: "Sistem",
          action: "EMAIL_STATUS",
          detail: `Email status "${label}" dikirim ke ${email}`,
        },
      });
    } catch {
      // logging tidak boleh menggagalkan alur
    }
  } catch (error) {
    console.error(
      "[candidate-emails] sendCandidateStatusEmail gagal:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
