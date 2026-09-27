// POST /api/admin/applications/[id]/bias-check — pemeriksa bias penilaian admin (Task 20-c).
// Membandingkan penilaian admin (rating, rubricScores, catatan) dengan bukti objektif
// (experience, motivation, cvText, aiScore, transkrip intro, scorecard wawancara).
// LLM menghasilkan JSON: { selaras: boolean, skor_admin, skor_bukti_estimasi, catatan }.
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { asLooseBoolean, asTrimmedString, clampPercent, errorMessage, extractJsonObject } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

function parseScoreRecord(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(num)) result[key] = Math.min(5, Math.max(0, num));
      }
      return Object.keys(result).length > 0 ? result : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** Skor admin 0-100: rating bintang (x20), fallback rata-rata rubrik (x20). */
function adminScoreOf(rating: number, rubric: Record<string, number> | null): number {
  if (rating > 0) return Math.round(rating * 20);
  if (rubric) {
    const values = Object.values(rubric);
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.round(avg * 20);
  }
  return 0;
}

function formatScores(record: Record<string, number> | null): string {
  if (!record) return "-";
  return Object.entries(record)
    .map(([key, value]) => `${key}: ${value}/5`)
    .join("; ") || "-";
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      include: {
        position: { select: { title: true } },
        interviews: {
          orderBy: [{ round: "asc" }],
          select: { round: true, status: true, scores: true, recommendation: true, transcriptSummary: true, notes: true },
        },
      },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const rubric = parseScoreRecord(application.rubricScores);
    const hasAdminSignal = application.rating > 0 || rubric !== null || !!application.adminNotes?.trim();
    if (!hasAdminSignal) {
      return NextResponse.json(
        { error: "Lamaran ini belum memiliki penilaian admin (rating, rubrik, atau catatan) untuk diperiksa." },
        { status: 400 }
      );
    }

    const skorAdmin = adminScoreOf(application.rating, rubric);
    const interviewLines = application.interviews.length
      ? application.interviews
          .map(
            (interview) =>
              `- Ronde ${interview.round} (${interview.status}): skor [${formatScores(
                parseScoreRecord(interview.scores)
              )}]; rekomendasi: ${interview.recommendation ?? "-"}; ringkasan: ${
                interview.transcriptSummary ?? "-"
              }; catatan: ${interview.notes?.slice(0, 300) ?? "-"}`
          )
          .join("\n")
      : "- (belum ada sesi wawancara)";

    const systemPrompt =
      "Kamu adalah auditor netral yang mendeteksi bias penilaian rekrutmen. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      "Periksa apakah penilaian admin terhadap kandidat ini SELARAS dengan bukti yang tersedia.",
      "",
      "=== PENILAIAN ADMIN ===",
      `Posisi: ${application.position?.title ?? "-"}`,
      `Rating admin: ${application.rating}/5 (setara ${skorAdmin}/100)`,
      `Rubrik admin: ${formatScores(rubric)}`,
      `Catatan admin: ${application.adminNotes?.slice(0, 800) || "-"}`,
      "",
      "=== BUKTI OBJEKTIF ===",
      `Pengalaman (formulir): ${application.experience.slice(0, 600) || "-"}`,
      `Motivasi (formulir): ${application.motivation.slice(0, 400) || "-"}`,
      `Skor AI screening: ${application.aiScore ?? "belum dinilai"}/100`,
      `Ringkasan AI: ${application.aiSummary?.slice(0, 300) ?? "-"}`,
      `Teks CV (hasil OCR): ${application.cvText?.slice(0, 1200) ?? "belum tersedia"}`,
      `Transkrip audio intro: ${application.transcript?.slice(0, 400) ?? "-"}`,
      "Wawancara:",
      interviewLines,
      "",
      "Tugas: bandingkan skor & catatan admin dengan bukti. Beri skor estimasi bukti 0-100.",
      "selaras = true bila selisih wajar (±15 poin) dan catatan admin didukung bukti; false bila penilaian tampak terlalu tinggi/rendah tanpa dasar.",
      "catatan: 1-3 kalimat bahasa Indonesia, netral dan membangun (bukan menggurui).",
      'Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain): {"selaras": true | false, "skor_admin": <0-100>, "skor_bukti_estimasi": <0-100>, "catatan": "<teks>"}',
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
      "Pemeriksaan bias",
      AI_TIMEOUT_MS,
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    const selaras = parsed ? asLooseBoolean(parsed.selaras) : null;
    const catatan = parsed ? asTrimmedString(parsed.catatan, 1200) : "";
    if (!parsed || selaras === null || !catatan) {
      console.error(
        "[POST /api/admin/applications/[id]/bias-check] hasil LLM tidak bisa diparse:",
        raw.slice(0, 300)
      );
      return NextResponse.json(
        { error: "AI tidak menghasilkan hasil pemeriksaan yang valid. Coba lagi sebentar." },
        { status: 502 }
      );
    }

    const skorBukti = clampPercent(parsed.skor_bukti_estimasi) ?? skorAdmin;
    return NextResponse.json({
      selaras,
      skor_admin: skorAdmin,
      skor_bukti_estimasi: skorBukti,
      catatan,
    });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/bias-check]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal memeriksa bias penilaian. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
