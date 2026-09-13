// Helper AI untuk screening lamaran, pertanyaan wawancara, dan draft balasan.
// SERVER-ONLY — jangan pernah diimpor dari komponen klien.
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { parseRequirements, parseScreeningQuestions, parseStringRecord } from "@/lib/seed";
import { stagesForPosition } from "@/lib/stages";
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

/** Buang instance SDK yang ter-cache (dipakai saat request gagal, mis. token stale). */
export function resetZai(): void {
  zaiInstance = null;
}

/**
 * Jalankan operasi SDK dengan percobaan ulang sekali memakai instance segar.
 * Berguna ketika instance ter-cache menjadi tidak valid (mis. error 401/token rotasi).
 */
export async function withZaiRetry<T>(operation: (zai: ZaiInstance) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const zai = await getZai();
    try {
      return await operation(zai);
    } catch (error) {
      lastError = error;
      console.error("[ai] request SDK gagal (percobaan " + (attempt + 1) + "):", errorMessage(error));
      resetZai(); // paksa buat instance baru pada percobaan berikutnya
    }
  }
  throw lastError;
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
  screeningAnswers: string | null; // JSON {questionId: jawaban}
  position: {
    title: string;
    department: string;
    type: string;
    location: string;
    description: string;
    requirements: string;
    aiCriteria: string | null; // kriteria AI khusus posisi
    screeningQuestions: string; // JSON {id,label,required}[]
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
  const lines = [
    `Posisi: ${app.position.title}`,
    `Departemen: ${app.position.department}`,
    `Jenis: ${app.position.type} — Lokasi: ${app.position.location}`,
    `Deskripsi: ${app.position.description}`,
    "Persyaratan:",
    requirementLines,
  ];
  const criteria = app.position.aiCriteria?.trim();
  if (criteria) {
    lines.push("Kriteria khusus posisi ini (bobot utama):", criteria);
  }
  return lines.join("\n");
}

/** Bagian jawaban screening kandidat (null bila tidak ada yang bisa dipetakan). */
function buildScreeningSection(app: ApplicationForPrompt): string | null {
  const answers = parseStringRecord(app.screeningAnswers);
  if (!answers || !app.position) return null;
  const questions = parseScreeningQuestions(app.position.screeningQuestions);
  if (questions.length === 0) return null;
  const lines: string[] = [];
  for (const question of questions) {
    const answer = (answers[question.id] ?? "").trim();
    if (!answer) continue;
    lines.push(`- ${question.label}: ${answer}`);
  }
  return lines.length > 0 ? ["Jawaban screening kandidat:", ...lines].join("\n") : null;
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
    const screeningSection = buildScreeningSection(application);
    const userPrompt = [
      "Evaluasi kecocokan kandidat berikut untuk posisi yang dilamar.",
      "",
      buildPositionSection(application),
      "",
      "Data kandidat:",
      buildCandidateSection(application),
      ...(screeningSection ? ["", screeningSection] : []),
      "",
      'Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain) dengan format:',
      '{"score": <0-100 integer>, "summary": "<maksimal 2 kalimat bahasa Indonesia>", "recommendation": "LAYAK_WAWANCARA" | "PERTIMBANGKAN" | "TIDAK_COCCOK"}',
    ].join("\n");

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      ),
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

    // Auto-shortlist: pindahkan lamaran BARU otomatis bila skor melewati ambang posisi
    // dan tahap tujuan valid pada pipeline posisi.
    const position = application.position;
    const targetStage = position?.autoShortlistStage ?? null;
    if (
      position &&
      targetStage &&
      position.autoShortlistScore != null &&
      result.score >= position.autoShortlistScore &&
      application.status.trim() === "NEW" &&
      stagesForPosition(parseRequirements(position.stages)).includes(targetStage)
    ) {
      try {
        await db.application.update({
          where: { id: applicationId },
          data: { status: targetStage },
        });
        await db.activityLog.create({
          data: {
            applicationId,
            actor: "Sistem",
            action: "AUTO_SHORTLIST",
            detail: `Skor AI ${result.score} >= ambang ${position.autoShortlistScore} — dipindah otomatis ke tahap '${targetStage}'`,
          },
        });
      } catch (error) {
        console.error("[ai] auto-shortlist gagal:", errorMessage(error));
      }
    }

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

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      ),
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

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      ),
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

/* ------------------- Parser JSON ketat untuk ranking LLM (baru) ------------------- */

/** Ambil array JSON dari balasan LLM; toleran terhadap teks pembuka/penutup. */
function extractJsonArray(raw: string): unknown[] | null {
  const text = stripMarkdownFence(raw);
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // fallback: ambil potongan dari "[" pertama sampai "]" terakhir
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

function clampScore100(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

type RankedEntry = { id: string; name: string; score: number; reason: string };

/** Validasi & normalisasi entri ranking LLM: id harus dikenal, skor 0-100, entri duplikat dibuang. */
function normalizeRankedEntries(
  raw: string,
  validIds: Set<string>,
  nameOf: (id: string) => string,
  max: number,
): RankedEntry[] {
  const arr = extractJsonArray(raw);
  if (!arr) return [];
  const results: RankedEntry[] = [];
  const seen = new Set<string>();
  for (const item of arr) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!id || !validIds.has(id) || seen.has(id)) continue;
    const score = clampScore100(obj.score);
    if (score == null) continue;
    const reason = typeof obj.reason === "string" ? obj.reason.trim().slice(0, 300) : "";
    seen.add(id);
    results.push({
      id,
      name: nameOf(id),
      score,
      reason: reason || "Kandidat direkomendasikan AI.",
    });
    if (results.length >= max) break;
  }
  return results;
}

/* --------------------- Ringkasan AI kartu pipeline (baru) --------------------- */

/**
 * Buat ringkasan 2-3 kalimat (kekuatan/risiko/rekomendasi) untuk satu lamaran
 * dari experience, motivation, aiScore, transcript, dan cvText.
 * TIDAK menyimpan ke DB — route pemanggil yang menyimpan + mencatat ActivityLog.
 */
export async function generateApplicationSummaryText(applicationId: string): Promise<string | null> {
  try {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: { position: { select: { title: true, department: true } } },
    });
    if (!application) return null;

    const lines = [
      `Nama kandidat: ${application.name}`,
      `Posisi: ${application.position?.title ?? "-"} (${application.position?.department ?? "-"})`,
      `Pengalaman: ${application.experience}`,
      `Motivasi: ${application.motivation}`,
      `Skor screening AI: ${application.aiScore != null ? `${application.aiScore}/100` : "belum ada"}`,
    ];
    if (application.aiRecommendation) {
      lines.push(`Rekomendasi screening: ${application.aiRecommendation}`);
    }
    if (application.transcript?.trim()) {
      lines.push(`Transkrip audio perkenalan: ${application.transcript.trim().slice(0, 1500)}`);
    }
    if (application.cvText?.trim()) {
      lines.push(`Isi CV: ${application.cvText.trim().slice(0, 3000)}`);
    }

    const userPrompt = [
      "Buat ringkasan kandidat berikut untuk membantu HR memutuskan dengan cepat.",
      "",
      ...lines,
      "",
      "Aturan output:",
      "- Bahasa Indonesia, 2-3 kalimat saja, tanpa poin bernomor/bullet.",
      "- Kalimat 1: kekuatan utama kandidat. Kalimat 2: risiko/kekurangan. Kalimat 3: rekomendasi tindakan (mis. layak wawancara, perlu tes portofolio, dsb).",
      "- Tanpa markdown, tanpa sapaan, langsung isi ringkasannya.",
    ].join("\n");

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            {
              role: "assistant",
              content:
                "Kamu adalah HR assistant studio konten kreator. Tulis ringkas, padat, objektif, bahasa Indonesia.",
            },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      ),
      "Ringkasan AI",
    );
    const text = (completion?.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      console.error("[ai] generateApplicationSummaryText: balasan LLM kosong");
      return null;
    }
    return text.slice(0, 600);
  } catch (error) {
    console.error("[ai] generateApplicationSummaryText gagal:", errorMessage(error));
    return null;
  }
}

/* ------------------------ Shortlist cerdas posisi (baru) ------------------------ */

export type ShortlistEntry = RankedEntry;

/**
 * Ranking top 5 kandidat terbaik untuk satu posisi (lamaran aktif, bukan ditolak).
 * Return array terurut skor tertinggi; null bila gagal / tidak ada kandidat.
 */
export async function rankPositionShortlist(positionId: string): Promise<ShortlistEntry[] | null> {
  try {
    const [position, apps] = await Promise.all([
      db.position.findUnique({
        where: { id: positionId },
        select: { title: true, department: true, description: true, requirements: true, aiCriteria: true },
      }),
      db.application.findMany({
        where: { positionId, status: { not: "REJECTED" } },
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, name: true, aiScore: true, experience: true, motivation: true, portfolioUrl: true },
      }),
    ]);
    if (!position || apps.length === 0) return null;

    const requirements = parseRequirements(position.requirements);
    const candidateLines = apps.map(
      (a, i) =>
        `${i + 1}. id=${a.id} | ${a.name} | skor AI screening: ${a.aiScore ?? "-"} | portofolio: ${a.portfolioUrl?.trim() || "tidak ada"}\n   Pengalaman: ${a.experience.slice(0, 240)}\n   Motivasi: ${a.motivation.slice(0, 160)}`,
    );

    const userPrompt = [
      `Pilih 5 kandidat TERBAIK untuk posisi berikut. Bila kandidat kurang dari 5, pilih semua yang ada.`,
      "",
      `Posisi: ${position.title} (${position.department})`,
      `Deskripsi: ${position.description.slice(0, 600)}`,
      `Persyaratan: ${requirements.length > 0 ? requirements.join("; ").slice(0, 600) : "tidak dirinci"}`,
      position.aiCriteria?.trim() ? `Kriteria khusus: ${position.aiCriteria.trim().slice(0, 400)}` : "",
      "",
      "Daftar kandidat:",
      ...candidateLines,
      "",
      'Balas HANYA JSON valid (tanpa markdown/teks lain) berupa array TERURUT dari peringkat 1 (terbaik), maksimal 5 entri:',
      '[{"id":"<id kandidat>","name":"<nama>","score":<0-100 integer kecocokan posisi>,"reason":"<alasan singkat 1 kalimat bahasa Indonesia>"}]',
      "Gunakan id persis seperti daftar. score boleh berbeda dari skor AI screening (pertimbangkan portofolio & motivasi).",
    ]
      .filter((line) => line !== "")
      .join("\n");

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            {
              role: "assistant",
              content:
                "Kamu adalah HR shortlist assistant. Jawab HANYA JSON valid tanpa teks lain. Bahasa Indonesia untuk reason.",
            },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      ),
      "Shortlist AI",
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const nameOf = (id: string) => apps.find((a) => a.id === id)?.name ?? "";
    const entries = normalizeRankedEntries(raw, new Set(apps.map((a) => a.id)), nameOf, 5);
    if (entries.length === 0) {
      console.error("[ai] rankPositionShortlist: hasil LLM tidak bisa diparse");
      return null;
    }
    return entries.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("[ai] rankPositionShortlist gagal:", errorMessage(error));
    return null;
  }
}

/* --------------------- Pencarian semantik kandidat (baru) --------------------- */

export type SemanticSearchEntry = RankedEntry;

/**
 * Cari kandidat paling cocok dengan kueri bebas (mis. "editor yang bisa color grading
 * dan pernah kerja di agensi"). Kandidat diambil maks 100 terbaru; LLM menskor 0-100
 * kecocokan + alasan 1 kalimat, dikembalikan top 10. Null bila gagal.
 */
export async function semanticSearchCandidates(query: string): Promise<SemanticSearchEntry[] | null> {
  try {
    const apps = await db.application.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        aiScore: true,
        experience: true,
        motivation: true,
        cvText: true,
        position: { select: { title: true, department: true } },
      },
    });
    if (apps.length === 0) return null;

    const candidateLines = apps.map(
      (a, i) =>
        `${i + 1}. id=${a.id} | ${a.name} | posisi: ${a.position?.title ?? "-"} | skor AI: ${a.aiScore ?? "-"}\n   Pengalaman: ${a.experience.slice(0, 200)}\n   Motivasi: ${a.motivation.slice(0, 120)}${a.cvText?.trim() ? `\n   CV: ${a.cvText.trim().slice(0, 300)}` : ""}`,
    );

    const userPrompt = [
      `Kueri pencarian HR: "${query}"`,
      "",
      "Skor setiap kandidat 0-100 kecocokannya dengan kueri (100 = sangat cocok), lalu ambil 10 terbaik.",
      "Bila tidak ada yang relevan sama sekali, kembalikan array kosong [].",
      "",
      "Daftar kandidat:",
      ...candidateLines,
      "",
      'Balas HANYA JSON valid (tanpa markdown/teks lain) berupa array TERURUT dari skor tertinggi, maksimal 10 entri:',
      '[{"id":"<id kandidat>","name":"<nama>","score":<0-100 integer>,"reason":"<alasan kecocokan 1 kalimat bahasa Indonesia>"}]',
      "Gunakan id persis seperti daftar. Jangan mengarang nama.",
    ].join("\n");

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            {
              role: "assistant",
              content:
                "Kamu adalah mesin pencarian semantik kandidat HR. Jawab HANYA JSON valid tanpa teks lain. Bahasa Indonesia untuk reason.",
            },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      ),
      "Pencarian semantik",
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const nameOf = (id: string) => apps.find((a) => a.id === id)?.name ?? "";
    const entries = normalizeRankedEntries(raw, new Set(apps.map((a) => a.id)), nameOf, 10);
    return entries.sort((a, b) => b.score - a.score);
  } catch (error) {
    console.error("[ai] semanticSearchCandidates gagal:", errorMessage(error));
    return null;
  }
}
