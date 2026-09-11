// Helper AI untuk screening lamaran, pertanyaan wawancara, dan draft balasan.
// SERVER-ONLY — jangan pernah diimpor dari komponen klien.
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { parseRequirements } from "@/lib/seed";
import { AI_RECOMMENDATION_LABELS, type AiRecommendation } from "@/lib/types";

const AI_TIMEOUT_MS = 60_000; // 60 detik

type ZaiInstance = Awaited<ReturnType<typeof ZAI.create>>;

let zaiInstance: ZaiInstance | null = null;

/** Ambil instance SDK ZAI (di-cache di level modul agar tidak dibuat berulang). */
export async function getZai(): Promise<ZaiInstance> {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

/** Jalankan promise dengan batas waktu; gagal jika melebihi timeoutMs. */
export function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number = AI_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} melebihi batas waktu ${Math.round(timeoutMs / 1000)} detik`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Pesan error ringkas tanpa stack berisik. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* --------------------------------- Parsing hasil LLM --------------------------------- */

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fence ? fence[1] : trimmed).trim();
}

function isAiRecommendation(value: string): value is AiRecommendation {
  return value === "LAYAK_WAWANCARA" || value === "PERTIMBANGKAN" || value === "TIDAK_COCCOK";
}

/** Normalisasi kata kunci rekomendasi dari teks bebas (mis. "layak wawancara"). */
function normalizeRecommendation(raw: string): AiRecommendation | null {
  const candidate = raw.trim().toUpperCase().replace(/\s+/g, "_");
  return isAiRecommendation(candidate) ? candidate : null;
}

/** Turunkan rekomendasi dari skor bila kata kunci tidak ditemukan. */
function deriveRecommendationFromScore(score: number): AiRecommendation {
  if (score >= 75) return "LAYAK_WAWANCARA";
  if (score >= 45) return "PERTIMBANGKAN";
  return "TIDAK_COCCOK";
}

function clampScore(score: number): number {
  return Math.min(100, Math.max(0, Math.round(score)));
}

/** Coba ekstrak hasil screening dengan regex bila JSON.parse gagal. */
function extractWithRegex(text: string): { score: number; summary: string; recommendation: AiRecommendation } | null {
  const scoreMatch =
    text.match(/score["']?\s*[:=]\s*["']?(\d{1,3})/i) ??
    text.match(/(\d{1,3})\s*\/\s*100/) ??
    text.match(/\b(\d{1,3})\b/);
  if (!scoreMatch) return null;
  const score = clampScore(Number(scoreMatch[1]));

  const summaryMatch = text.match(/summary["']?\s*[:=]\s*"([^"]+)"/i);
  const firstLine =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^\d/.test(line) && !/score/i.test(line)) ?? "";
  const summary = (summaryMatch ? summaryMatch[1] : firstLine).trim().slice(0, 300);

  const recMatch = text.match(/(LAYAK[\s_]?WAWANCARA|PERTIMBANGKAN|TIDAK[\s_]?COCCOK)/i);
  const recommendation = (recMatch ? normalizeRecommendation(recMatch[1]) : null) ?? deriveRecommendationFromScore(score);

  return {
    score,
    summary: summary || `Skor kecocokan ${score}/100.`,
    recommendation,
  };
}

/** Parse jawaban LLM menjadi hasil screening; null bila benar-benar gagal. */
export function parseScreeningResult(raw: string): {
  score: number;
  summary: string;
  recommendation: AiRecommendation;
} | null {
  const text = stripMarkdownFence(raw);
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const scoreValue = typeof obj.score === "number" ? obj.score : Number(obj.score);
      const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
      const recommendation = typeof obj.recommendation === "string" ? normalizeRecommendation(obj.recommendation) : null;
      if (Number.isFinite(scoreValue) && summary.length > 0) {
        const score = clampScore(scoreValue);
        return {
          score,
          summary,
          recommendation: recommendation ?? deriveRecommendationFromScore(score),
        };
      }
    }
  } catch {
    // lanjut ke fallback regex
  }
  return extractWithRegex(text);
}

/* --------------------------------- Prompt builder ---------------------------------- */

type ApplicationForPrompt = {
  name: string;
  experience: string;
  motivation: string;
  portfolioUrl: string | null;
  socialLinks: string | null;
  position: {
    title: string;
    department: string;
    type: string;
    location: string;
    description: string;
    requirements: string;
  } | null;
};

function buildCandidateSection(app: ApplicationForPrompt): string {
  return [
    `Nama: ${app.name}`,
    `Pengalaman: ${app.experience}`,
    `Alasan melamar: ${app.motivation}`,
    `Portofolio: ${app.portfolioUrl?.trim() || "tidak diisi"}`,
    `Link sosial media: ${app.socialLinks?.trim() || "tidak diisi"}`,
  ].join("\n");
}

function buildPositionSection(app: ApplicationForPrompt): string {
  if (!app.position) return "Posisi: (tidak diketahui — evaluasi berdasarkan data kandidat saja)";
  const requirements = parseRequirements(app.position.requirements);
  const requirementLines = requirements.length > 0 ? requirements.map((r) => `- ${r}`).join("\n") : "- (tidak dirinci)";
  return [
    `Posisi: ${app.position.title}`,
    `Departemen: ${app.position.department}`,
    `Jenis: ${app.position.type} — Lokasi: ${app.position.location}`,
    `Deskripsi: ${app.position.description}`,
    "Persyaratan:",
    requirementLines,
  ].join("\n");
}

/* --------------------------------- Fungsi utama AI --------------------------------- */

export type ScreeningResult = {
  score: number;
  summary: string;
  recommendation: AiRecommendation;
};

/**
 * Analisis AI screening untuk satu lamaran.
 * Menyimpan hasil ke Application + mencatat ActivityLog. Return null bila gagal.
 */
export async function analyzeApplication(applicationId: string): Promise<ScreeningResult | null> {
  try {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: { position: true },
    });
    if (!application) return null;

    const systemPrompt =
      "Kamu adalah HR screening assistant untuk studio konten kreator. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      "Evaluasi kecocokan kandidat berikut untuk posisi yang dilamar.",
      "",
      buildPositionSection(application),
      "",
      "Data kandidat:",
      buildCandidateSection(application),
      "",
      'Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain) dengan format:',
      '{"score": <0-100 integer>, "summary": "<maksimal 2 kalimat bahasa Indonesia>", "recommendation": "LAYAK_WAWANCARA" | "PERTIMBANGKAN" | "TIDAK_COCCOK"}',
    ].join("\n");

    const zai = await getZai();
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      }),
      "Analisis AI",
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const result = parseScreeningResult(raw);
    if (!result) {
      console.error("[ai] analyzeApplication: hasil LLM tidak bisa diparse");
      return null;
    }

    const now = new Date();
    await db.application.update({
      where: { id: applicationId },
      data: {
        aiScore: result.score,
        aiSummary: result.summary,
        aiRecommendation: result.recommendation,
        aiAnalyzedAt: now,
      },
    });
    await db.activityLog.create({
      data: {
        applicationId,
        actor: "AI",
        action: "AI_SCREENING",
        detail: `Skor ${result.score}/100 — ${AI_RECOMMENDATION_LABELS[result.recommendation]}`,
      },
    });
    return result;
  } catch (error) {
    console.error("[ai] analyzeApplication gagal:", errorMessage(error));
    return null;
  }
}

/**
 * Buat 5 pertanyaan wawancara personal berdasarkan data kandidat + posisi.
 * Return teks daftar bernomor (bahasa Indonesia) tanpa menyimpan ke DB; null bila gagal.
 */
export async function generateInterviewQuestions(applicationId: string): Promise<string | null> {
  try {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: { position: true },
    });
    if (!application) return null;

    const systemPrompt =
      "Kamu adalah HR interviewer berpengalaman untuk studio konten kreator. Tulis pertanyaan wawancara yang tajam, personal, dan relevan.";
    const userPrompt = [
      "Buat 5 pertanyaan wawancara personal untuk kandidat berikut, berdasarkan lamaran dan posisinya.",
      "",
      buildPositionSection(application),
      "",
      "Data kandidat:",
      buildCandidateSection(application),
      "",
      "Aturan output:",
      "- Bahasa Indonesia, nada profesional tapi hangat.",
      "- Format daftar bernomor 1 sampai 5, satu pertanyaan per nomor, tanpa teks pembuka/penutup.",
      "- Pertanyaan harus menggali pengalaman, portofolio, motivasi, dan kesesuaian dengan persyaratan posisi.",
      "- Tanpa markdown bold/italic, tanpa penjelasan tambahan.",
    ].join("\n");

    const zai = await getZai();
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      }),
      "Pembuatan pertanyaan wawancara",
    );
    const text = (completion?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      console.error("[ai] generateInterviewQuestions: balasan LLM kosong");
      return null;
    }
    return text;
  } catch (error) {
    console.error("[ai] generateInterviewQuestions gagal:", errorMessage(error));
    return null;
  }
}

/**
 * Draft balasan email/WhatsApp yang hangat & profesional sesuai status lamaran saat ini.
 * Return teks siap kirim (bahasa Indonesia, tanpa markdown); null bila gagal.
 */
export async function generateReplyDraft(applicationId: string): Promise<string | null> {
  try {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: { position: { select: { title: true } } },
    });
    if (!application) return null;

    const status = application.status;
    const statusGuide =
      status === "ACCEPTED"
        ? "- Diterima: ucapkan selamat dan beri undangan proses onboarding (tanpa tanggal spesifik, arahkan menyambung koordinasi selanjutnya)."
        : status === "INTERVIEW"
          ? "- Wawancara: undangan menindaklanjuti dengan ajukan kesediaan jadwal wawancara (minta kandidat memilih rentang waktu yang cocok)."
          : status === "REJECTED"
            ? "- Ditolak: sampaikan apresiasi tulus atas waktu & minatnya, beri semangat, dan ajak mendaftar lagi pada kesempatan berikutnya."
            : "- Baru/Ditinjau: konfirmasi bahwa lamarannya sudah diterima dan sedang dalam proses seleksi, mohon menunggu kabar selanjutnya.";

    const systemPrompt =
      "Kamu adalah staf HR studio konten kreator yang menulis balasan lamaran yang hangat, profesional, dan siap dikirim.";
    const userPrompt = [
      "Buat draft balasan (email/WhatsApp) untuk kandidat berikut sesuai status lamarannya.",
      "",
      `Kandidat: ${application.name}`,
      `Posisi: ${application.position?.title ?? "-"}`,
      `Kode pelacakan: ${application.trackingCode ?? "-"}`,
      `Status lamaran: ${status}`,
      "",
      "Panduan konten sesuai status:",
      statusGuide,
      "",
      "Aturan output:",
      "- Bahasa Indonesia, hangat dan profesional, langsung siap kirim.",
      "- Sapa kandidat dengan namanya.",
      "- Tanda tangan sebagai Tim HR Lumina Studio.",
      "- Tanpa markdown (tanpa **, #, bullet), tanpa placeholder dalam kurung siku, tanpa penjelasan tambahan di luar isi pesan.",
    ].join("\n");

    const zai = await getZai();
    const completion = await withTimeout(
      zai.chat.completions.create({
        messages: [
          { role: "assistant", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      }),
      "Pembuatan draft balasan",
    );
    const text = (completion?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      console.error("[ai] generateReplyDraft: balasan LLM kosong");
      return null;
    }
    return text;
  } catch (error) {
    console.error("[ai] generateReplyDraft gagal:", errorMessage(error));
    return null;
  }
}
