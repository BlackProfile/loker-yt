// POST /api/admin/positions/[id]/answer-summary — ringkasan AI jawaban teks satu
// pertanyaan formulir (Task 33-d, tab Jawaban Form Builder).
// Body { fieldId }: kumpulkan jawaban teks unik dari lamaran posisi ini (field skema
// bertipe text/textarea), lalu minta LLM merangkum menjadi maksimal 3 poin + 3-5 tema.
// Hasil di-cache di level modul (maks 50 entri, kunci posisi+field+sidik jari data)
// agar biaya AI tidak berulang untuk data yang belum berubah. SERVER-ONLY.
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import {
  isFormSchemaActive,
  normalizeFormSchema,
  parseFormAnswers,
  parseFormSchema,
  type FormSchema,
} from "@/lib/form-schema";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

const MIN_ANSWERS = 3;
const MAX_ANSWERS = 120;
const MAX_ANSWER_LEN = 2000;
const MAX_THEMES = 5;
const CACHE_MAX = 50;

/* ------------------- Cache ringkasan (modul-level, maks 50 entri) ------------------- */

type CachedSummary = { summary: string; themes: string[] };

const summaryCache = new Map<string, CachedSummary>();

/** Kunci cache: posisi + field + jumlah jawaban + hash panjang tiap jawaban. */
function cacheKey(positionId: string, fieldId: string, answers: string[]): string {
  let hash = answers.length;
  for (const answer of answers) hash = ((hash * 31 + answer.length) & 0x7fffffff) >>> 0;
  return `${positionId}:${fieldId}:${answers.length}:${hash}`;
}

/** Simpan ke cache dengan pembuangan FIFO sederhana bila penuh. */
function cachePut(key: string, value: CachedSummary): void {
  if (summaryCache.size >= CACHE_MAX) {
    const oldest = summaryCache.keys().next().value;
    if (oldest !== undefined) summaryCache.delete(oldest);
  }
  summaryCache.set(key, value);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;
    const position = await db.position.findUnique({ where: { id } });
    if (!position || position.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    const rawFieldId =
      body && typeof body === "object" ? (body as { fieldId?: unknown }).fieldId : null;
    const fieldId = typeof rawFieldId === "string" ? rawFieldId.trim() : "";
    if (!fieldId) {
      return NextResponse.json({ error: "fieldId wajib diisi." }, { status: 400 });
    }

    const schema: FormSchema | null = normalizeFormSchema(parseFormSchema(position.formSchema));
    if (!schema || !isFormSchemaActive({ formSchema: schema })) {
      return NextResponse.json({ error: "Posisi ini belum memakai Form Builder." }, { status: 400 });
    }
    const field = schema.fields.find((f) => f.id === fieldId);
    if (!field || (field.type !== "text" && field.type !== "textarea")) {
      return NextResponse.json(
        { error: "Pertanyaan tidak ditemukan atau bukan tipe teks." },
        { status: 400 },
      );
    }

    const rows = await db.application.findMany({
      where: { positionId: id, deletedAt: null, formAnswers: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { formAnswers: true },
      take: 2000,
    });

    // Jawaban teks unik (dedupe persis), maks 120, tiap jawaban maks 2000 karakter.
    const seen = new Set<string>();
    const answers: string[] = [];
    for (const row of rows) {
      const parsed = parseFormAnswers(row.formAnswers);
      if (!parsed) continue;
      const value = parsed[fieldId];
      if (typeof value !== "string") continue;
      const text = value.trim().slice(0, MAX_ANSWER_LEN);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      answers.push(text);
      if (answers.length >= MAX_ANSWERS) break;
    }
    if (answers.length < MIN_ANSWERS) {
      return NextResponse.json(
        { error: "Minimal 3 jawaban teks untuk dirangkum." },
        { status: 400 },
      );
    }

    const key = cacheKey(id, fieldId, answers);
    const cached = summaryCache.get(key);
    if (cached) {
      return NextResponse.json(cached);
    }

    const systemPrompt =
      "Kamu adalah analis rekrutmen untuk studio konten kreator. Ringkas jawaban pelamar dalam Bahasa Indonesia. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      `Pertanyaan formulir: "${field.label}"`,
      "",
      `Berikut ${answers.length} jawaban pelamar (dipisah " --- "):`,
      answers.join(" --- "),
      "",
      "Aturan output:",
      "- summary: maksimal 3 poin ringkasan, setiap poin tepat satu kalimat, dipisah karakter newline (\\n).",
      "- themes: 3 sampai 5 tema utama dari jawaban, masing-masing 1-3 kata.",
      '- Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain): {"summary": "<poin dipisah \\n>", "themes": ["tema 1", "tema 2"]}',
    ].join("\n");

    // NR49-A — gate Pusat Kendali AI: fitur mati/kuota habis -> 503 (BLOCKED tercatat).
    // Cache hit di atas TIDAK melewati gate (tidak ada pemanggilan AI).
    const completion = await withAiGate("answer_summary", { actor: session.name }, () =>
      withTimeout(
        withZaiRetry((zai) =>
          zai.chat.completions.create({
            messages: [
              { role: "assistant", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            thinking: { type: "disabled" },
          }),
        ),
        "Ringkasan jawaban formulir",
        AI_TIMEOUT_MS,
      ),
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";

    // Parsing toleran: JSON objek bila bisa; kalau gagal, seluruh teks jadi summary.
    const parsed = extractJsonObject(raw);
    let summary = "";
    let themes: string[] = [];
    if (parsed) {
      if (typeof parsed.summary === "string") summary = parsed.summary.trim().slice(0, 4000);
      if (Array.isArray(parsed.themes)) {
        themes = parsed.themes
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
          .map((t) => t.slice(0, 40))
          .slice(0, MAX_THEMES);
      }
    }
    if (!summary) summary = raw.trim().slice(0, 4000);
    if (!summary) {
      console.error(
        "[POST /api/admin/positions/[id]/answer-summary] hasil LLM kosong:",
        raw.slice(0, 200),
      );
      return NextResponse.json(
        { error: "AI tidak menghasilkan ringkasan. Coba lagi sebentar." },
        { status: 502 },
      );
    }

    const result: CachedSummary = { summary, themes };
    cachePut(key, result);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/positions/[id]/answer-summary]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal merangkum jawaban. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}
