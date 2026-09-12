// POST /api/admin/applications/compare-ai — rekomendasi finalis head-to-head via LLM (Task 20-c).
// Body { ids: string[] } (2-3 id lamaran). LLM menghasilkan rekomendasi terstruktur:
// { winner, confidence: "TINGGI|SEDANG|RENDAH", alasan, kekuatan_per_kandidat, risiko_per_kandidat }.
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, asTrimmedString } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000; // perbandingan multi-kandidat butuh waktu lebih
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

type Confidence = "TINGGI" | "SEDANG" | "RENDAH";
const CONFIDENCES: Confidence[] = ["TINGGI", "SEDANG", "RENDAH"];

function normalizeConfidence(value: unknown): Confidence {
  const raw = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (CONFIDENCES as string[]).includes(raw) ? (raw as Confidence) : "SEDANG";
}

/** Format record rubrik {kriteria: 1-5} menjadi baris teks ringkas. */
function formatScores(record: Record<string, number> | null): string {
  if (!record || Object.keys(record).length === 0) return "-";
  return Object.entries(record)
    .map(([key, value]) => `${key}: ${value}/5`)
    .join("; ");
}

/** Parse string JSON kolom skor (rubrik/scorecard) menjadi record aman. */
function tryParseScores(raw: string | null): Record<string, number> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(num)) result[key] = num;
      }
      return Object.keys(result).length > 0 ? result : null;
    }
  } catch {
    return null;
  }
  return null;
}

function candidateSection(app: {
  id: string;
  name: string;
  experience: string;
  motivation: string;
  aiScore: number | null;
  aiSummary: string | null;
  rubricScores: string | null;
  positionTitle: string | null;
  transcript: string | null;
  interviews: {
    round: number;
    status: string;
    scores: string | null;
    recommendation: string | null;
    transcriptSummary: string | null;
  }[];
}): string {
  const interviewLines = app.interviews.length
    ? app.interviews
        .map(
          (interview) =>
            `  - Ronde ${interview.round} (${interview.status}): skor [${formatScores(tryParseScores(interview.scores))}]; rekomendasi pewawancara: ${interview.recommendation ?? "-"}; ringkasan: ${interview.transcriptSummary ?? "-"}`
        )
        .join("\n")
    : "  - (belum ada sesi wawancara)";
  return [
    `ID: ${app.id}`,
    `Nama: ${app.name}`,
    `Posisi: ${app.positionTitle ?? "-"}`,
    `Pengalaman: ${app.experience.slice(0, 700) || "-"}`,
    `Alasan melamar: ${app.motivation.slice(0, 500) || "-"}`,
    `Skor AI screening: ${app.aiScore ?? "belum dinilai"}/100`,
    `Ringkasan AI: ${app.aiSummary?.slice(0, 400) ?? "-"}`,
    `Rubrik admin: ${formatScores(tryParseScores(app.rubricScores))}`,
    `Transkrip audio intro: ${app.transcript?.slice(0, 500) ?? "-"}`,
    "Wawancara:",
    interviewLines,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const ids = body && typeof body === "object" ? (body as { ids?: unknown }).ids : null;
    if (
      !Array.isArray(ids) ||
      ids.length < 2 ||
      ids.length > 3 ||
      ids.some((id) => typeof id !== "string" || id.trim().length === 0)
    ) {
      return NextResponse.json(
        { error: "Pilih 2 sampai 3 kandidat untuk dibandingkan." },
        { status: 400 }
      );
    }
    const uniqueIds = [...new Set(ids.map((id) => (id as string).trim()))];

    const applications = await db.application.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        position: { select: { title: true } },
        interviews: {
          orderBy: [{ round: "asc" }],
          select: {
            round: true,
            status: true,
            scores: true,
            recommendation: true,
            transcriptSummary: true,
          },
        },
      },
    });
    if (applications.length !== uniqueIds.length) {
      return NextResponse.json(
        { error: "Sebagian kandidat tidak ditemukan. Muat ulang daftar lalu coba lagi." },
        { status: 404 }
      );
    }

    const sections = applications.map((app) =>
      candidateSection({
        id: app.id,
        name: app.name,
        experience: app.experience,
        motivation: app.motivation,
        aiScore: app.aiScore,
        aiSummary: app.aiSummary,
        rubricScores: app.rubricScores,
        positionTitle: app.position?.title ?? null,
        transcript: app.transcript,
        interviews: app.interviews,
      })
    );

    const systemPrompt =
      "Kamu adalah panel HR senior yang netral membandingkan finalis. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      "Bandingkan kandidat finalis berikut secara head-to-head untuk posisi yang dilamar.",
      "Pertimbangkan bukti: pengalaman, motivasi, skor AI screening, rubrik admin, dan hasil wawancara.",
      "",
      ...sections.flatMap((section) => [section, ""]),
      'Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain) dengan format:',
      '{"winner": "<id kandidat terbaik>", "confidence": "TINGGI" | "SEDANG" | "RENDAH", "alasan": "<1-3 kalimat bahasa Indonesia>", "kekuatan_per_kandidat": {"<id>": "<kekuatan utama>"}, "risiko_per_kandidat": {"<id>": "<risiko/catatan kehati-hatian>"}}',
      "Aturan: winner WAJIB salah satu id di atas; kekuatan_per_kandidat & risiko_per_kandidat WAJIB memuat semua id; confidence mencerminkan seberapa meyakinkan selisihnya.",
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
      "Perbandingan kandidat",
      AI_TIMEOUT_MS,
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    if (!parsed) {
      console.error(
        "[POST /api/admin/applications/compare-ai] hasil LLM tidak bisa diparse:",
        raw.slice(0, 300)
      );
      return NextResponse.json(
        { error: "AI tidak memberikan rekomendasi yang valid. Coba lagi sebentar." },
        { status: 502 }
      );
    }

    const winner = asTrimmedString(parsed.winner, 100);
    if (!uniqueIds.includes(winner)) {
      console.error("[POST /api/admin/applications/compare-ai] winner tidak dikenal:", winner);
      return NextResponse.json(
        { error: "AI memilih kandidat di luar daftar. Coba lagi sebentar." },
        { status: 502 }
      );
    }

    const asRecord = (value: unknown): Record<string, string> => {
      const result: Record<string, string> = {};
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
          result[key] = asTrimmedString(val, 500);
        }
      }
      // Pastikan setiap kandidat punya entri (fallback "-") agar UI stabil.
      for (const id of uniqueIds) {
        if (!result[id]) result[id] = "-";
      }
      return result;
    };

    return NextResponse.json({
      winner,
      confidence: normalizeConfidence(parsed.confidence),
      alasan: asTrimmedString(parsed.alasan, 1200) || "-",
      kekuatan_per_kandidat: asRecord(parsed.kekuatan_per_kandidat),
      risiko_per_kandidat: asRecord(parsed.risiko_per_kandidat),
    });
  } catch (error) {
    console.error("[POST /api/admin/applications/compare-ai]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal meminta rekomendasi AI. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
