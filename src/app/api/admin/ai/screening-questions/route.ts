// POST /api/admin/ai/screening-questions — generator pertanyaan screening via LLM.
// Body { positionId }. Hanya OWNER/HR. Membaca konten posisi (title, description,
// requirements, aiCriteria) lalu menghasilkan 5-6 pertanyaan screening berbahasa
// Indonesia yang bisa dijawab singkat: { questions: [{ label }] }.
// Tidak menulis ke DB — hasil ditambahkan ke formulir oleh admin (tetap bisa disunting).
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, asTrimmedString } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseRequirements } from "@/lib/seed";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

const MAX_QUESTIONS = 6;
const LABEL_MAX = 120;

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
    const positionId =
      body && typeof body === "object"
        ? asTrimmedString((body as { positionId?: unknown }).positionId, 64)
        : "";
    if (!positionId) {
      return NextResponse.json(
        { error: "positionId wajib diisi." },
        { status: 400 }
      );
    }

    const position = await db.position.findUnique({ where: { id: positionId } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const requirements = parseRequirements(position.requirements).slice(0, 8);

    const systemPrompt =
      "Kamu adalah spesialis rekrutmen untuk studio konten kreator. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      "Buat 5-6 pertanyaan screening untuk pelamar posisi berikut.",
      "",
      `Posisi: ${position.title}`,
      `Deskripsi posisi: ${position.description.slice(0, 600)}`,
      `Persyaratan: ${requirements.length ? requirements.join("; ") : "(tidak dirinci)"}`,
      position.aiCriteria
        ? `Kriteria khusus dari admin: ${position.aiCriteria.slice(0, 600)}`
        : "",
      "",
      "Aturan output:",
      "- Bahasa Indonesia, nada profesional dan ramah.",
      "- Setiap pertanyaan harus bisa dijawab singkat (1-3 kalimat), bukan esai.",
      "- Relevan dengan keterampilan/pengalaman yang dibutuhkan posisi ini.",
      "- Hindari pertanyaan diskriminatif (usia, agama, suku, status pernikahan, dan sejenisnya).",
      `- Maksimal ${LABEL_MAX} karakter per pertanyaan.`,
      'Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain): {"questions": [{"label": "<pertanyaan>"}, ...]}',
    ]
      .filter(Boolean)
      .join("\n");

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
      "Pembuatan pertanyaan screening",
      AI_TIMEOUT_MS,
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    const rawList =
      parsed && Array.isArray(parsed.questions) ? parsed.questions : [];
    const labels = rawList
      .map((item) => {
        if (typeof item === "string") return asTrimmedString(item, LABEL_MAX);
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return asTrimmedString((item as { label?: unknown }).label, LABEL_MAX);
        }
        return "";
      })
      .filter((label) => label.length >= 3)
      .filter((label, index, all) => all.indexOf(label) === index)
      .slice(0, MAX_QUESTIONS);

    if (labels.length === 0) {
      console.error(
        "[POST /api/admin/ai/screening-questions] hasil LLM tidak bisa diparse:",
        raw.slice(0, 300)
      );
      return NextResponse.json(
        { error: "AI tidak menghasilkan pertanyaan yang valid. Coba lagi sebentar." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      questions: labels.map((label) => ({ label })),
    });
  } catch (error) {
    console.error("[POST /api/admin/ai/screening-questions]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal membuat pertanyaan screening. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
