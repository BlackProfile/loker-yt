// POST /api/admin/interviews/[id]/scorecard-draft — usulan penilaian wawancara dari
// transkrip via LLM (NR49 Paket D). OWNER/HR (pola rute PATCH /api/admin/interviews/[id]).
// AI HANYA mengusulkan: hasil mengisi form scorecard di dialog sesi, disimpan manual
// admin lewat PATCH /api/admin/interviews/[id] (autosave/simpan tidak dipicu di sini).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, asTrimmedString } from "@/lib/ai-json";
import { withAiGate, AiGateError } from "@/lib/ai-control";
import { DEFAULT_INTERVIEW_CRITERIA } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Sesi wawancara tidak ditemukan." };

const AI_TIMEOUT_MS = 120_000;
const TRANSCRIPT_MAX = 12_000;
const NOTE_MAX = 2000; // sama dengan maxLength Textarea catatan di dialog sesi
const VALID_RECOMMENDATIONS = ["LANJUT", "CADANGAN", "TOLAK"] as const;

function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function clampScore(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(5, Math.max(1, Math.round(num)));
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
    const interview = await db.interview.findUnique({
      where: { id },
      include: { application: { include: { position: true } } },
    });
    if (!interview) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const transcript = (interview.transcript ?? "").trim();
    if (!transcript) {
      return NextResponse.json(
        { error: "Belum ada transkrip wawancara untuk dinilai." },
        { status: 400 },
      );
    }

    const position = interview.application?.position ?? null;

    // Sumber kriteria (berlapis, selaras dengan dialog scorecard):
    // 1) Position.interviewCriteria — kriteria yang dirender form scorecard dialog;
    // 2) Position.rubricCriteria — kriteria penilaian per lowongan (fallback);
    // 3) DEFAULT_INTERVIEW_CRITERIA — kriteria umum aplikasi.
    const criteria =
      parseStringArray(position?.interviewCriteria).length > 0
        ? parseStringArray(position?.interviewCriteria)
        : parseStringArray(position?.rubricCriteria).length > 0
          ? parseStringArray(position?.rubricCriteria)
          : DEFAULT_INTERVIEW_CRITERIA;

    const applicantName = interview.application?.name ?? "kandidat";
    const positionTitle = position?.title ?? interview.application?.position?.title ?? "-";

    const draft = await withAiGate(
      "scorecard_draft",
      { actor: session.name, detailOk: `Wawancara ${id} (${applicantName})` },
      async () => {
        const systemPrompt =
          "Kamu adalah pewawancara senior studio konten kreator Lumina Studio. Nilai transkrip " +
          "wawancara secara objektif, adil, dan berdasar bukti dari transkrip saja. Bahasa " +
          "Indonesia formal, tanpa emoji. Jawab HANYA JSON valid.";
        const userPrompt = [
          `Nilai hasil wawancara untuk kandidat ${applicantName} pada posisi ${positionTitle}.`,
          "",
          "Kriteria penilaian (nilai SETIAP kriteria dengan angka 1-5):",
          criteria.map((c) => `- ${c}`).join("\n"),
          "",
          `Transkrip wawancara (dipotong ${TRANSCRIPT_MAX} karakter pertama):`,
          transcript.slice(0, TRANSCRIPT_MAX),
          "",
          "Aturan output:",
          "- scores: objek {kriteria: angka 1-5} — kunci HARUS persis nama kriteria di atas.",
          "- justifications: objek {kriteria: alasan singkat MAKSIMAL 25 kata per kriteria}.",
          "- recommendation: salah satu dari LANJUT, CADANGAN, atau TOLAK.",
          "- summary: ringkasan hasil wawancara MAKSIMAL 60 kata.",
          'Balas HANYA JSON valid satu baris: {"scores": {"<kriteria>": 4}, "justifications": {"<kriteria>": "..."}, "recommendation": "LANJUT", "summary": "..."}',
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
          "Pembuatan draf penilaian wawancara",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        return extractJsonObject(raw);
      },
    );

    if (!draft) {
      return NextResponse.json(
        { error: "AI tidak menghasilkan penilaian yang valid. Coba lagi sebentar." },
        { status: 502 },
      );
    }

    // Validasi: kunci skor harus termasuk daftar kriteria (kriteria asing diabaikan),
    // nilai di-clamp 1-5 bulat; rekomendasi harus valid; catatan disusun ringkas.
    const rawScores =
      draft.scores && typeof draft.scores === "object" && !Array.isArray(draft.scores)
        ? (draft.scores as Record<string, unknown>)
        : {};
    const scores: Record<string, number> = {};
    for (const criterion of criteria) {
      const value = clampScore(rawScores[criterion]);
      if (value != null) {
        scores[criterion] = value;
      }
    }
    if (Object.keys(scores).length === 0) {
      return NextResponse.json(
        { error: "AI tidak memberi skor untuk kriteria mana pun. Coba lagi sebentar." },
        { status: 502 },
      );
    }

    const rawRec = asTrimmedString(draft.recommendation, 20).toUpperCase();
    const recommendation = (VALID_RECOMMENDATIONS as readonly string[]).includes(rawRec)
      ? rawRec
      : null;

    const rawJustifications =
      draft.justifications && typeof draft.justifications === "object" && !Array.isArray(draft.justifications)
        ? (draft.justifications as Record<string, unknown>)
        : {};
    const summary = asTrimmedString(draft.summary, 400);
    const noteParts: string[] = [];
    if (summary) noteParts.push(`Ringkasan: ${summary}`);
    const justificationLines = criteria
      .map((criterion) => {
        const text = asTrimmedString(rawJustifications[criterion], 200);
        return text ? `${criterion}: ${text}` : null;
      })
      .filter((line): line is string => line != null);
    if (justificationLines.length > 0) {
      noteParts.push(justificationLines.join("\n"));
    }
    const note = noteParts.join("\n\n").slice(0, NOTE_MAX);

    return NextResponse.json({ scores, recommendation, note });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/interviews/[id]/scorecard-draft]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal menyusun draf penilaian. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}
