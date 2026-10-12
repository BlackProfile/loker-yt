// NR49 Paket C fitur 5 — Penerjemah Kandidat (AI).
// POST /api/admin/applications/[id]/translate — semua role login (aksi ringan);
//      body { field: "cvText" | "motivation" }. LLM mendeteksi bahasa sumber:
//      sudah Bahasa Indonesia → { translated: null, message } (tidak disimpan);
//      selain itu diterjemahkan ke Bahasa Indonesia (istilah teknis dipertahankan)
//      dan hasil digabung ke Application.translations (JSON {field: {text, language, at}}).
// GET  /api/admin/applications/[id]/translate?field=cvText — semua role login:
//      kembalikan terjemahan tersimpan bila ada → { translation | null }.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { asTrimmedString, errorMessage, extractJsonObject } from "@/lib/ai-json";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const AI_TIMEOUT_MS = 90_000;
const SOURCE_MAX_CHARS = 8000; // batas teks yang dikirim ke LLM
const TRANSLATION_MAX_CHARS = 12_000; // batas hasil tersimpan per field

type TranslateField = "cvText" | "motivation";

function normalizeField(value: unknown): TranslateField | null {
  return value === "cvText" || value === "motivation" ? value : null;
}

/** Baca terjemahan tersimpan untuk satu field; null bila tidak ada/rusak. */
async function readStoredTranslation(
  applicationId: string,
  field: TranslateField,
): Promise<{ text: string; language: string; at: string } | null> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { translations: true },
  });
  if (!app?.translations) return null;
  try {
    const parsed: unknown = JSON.parse(app.translations);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entry = (parsed as Record<string, unknown>)[field];
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const obj = entry as Record<string, unknown>;
        if (typeof obj.text === "string" && obj.text.trim().length > 0) {
          return {
            text: obj.text,
            language: typeof obj.language === "string" ? obj.language : "Asing",
            at: typeof obj.at === "string" ? obj.at : "",
          };
        }
      }
    }
  } catch {
    // JSON rusak — anggap tidak ada.
  }
  return null;
}

/** Gabungkan satu terjemahan baru ke kolom translations (JSON merge). */
async function mergeTranslation(
  applicationId: string,
  field: TranslateField,
  entry: { text: string; language: string; at: string },
): Promise<void> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { translations: true },
  });
  let obj: Record<string, unknown> = {};
  if (app?.translations) {
    try {
      const parsed: unknown = JSON.parse(app.translations);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        obj = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      obj = {};
    }
  }
  obj[field] = entry;
  await db.application.update({
    where: { id: applicationId },
    data: { translations: JSON.stringify(obj) },
  });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;
    const field = normalizeField(req.nextUrl.searchParams.get("field")) ?? "cvText";
    const translation = await readStoredTranslation(id, field);
    return NextResponse.json({ translation });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/translate]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat terjemahan." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    const field = normalizeField(
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).field
        : null,
    );
    if (!field) {
      return NextResponse.json(
        { error: "Field harus bernilai \"cvText\" atau \"motivation\"." },
        { status: 400 },
      );
    }

    const application = await db.application.findUnique({
      where: { id },
      select: { id: true, name: true, cvText: true, motivation: true },
    });
    if (!application) {
      return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
    }

    const source = (field === "cvText" ? application.cvText : application.motivation) ?? "";
    const trimmedSource = source.trim();
    if (!trimmedSource) {
      return NextResponse.json(
        { error: "Teks tidak tersedia untuk diterjemahkan." },
        { status: 400 },
      );
    }

    const outcome = await withAiGate(
      "translate",
      { actor: session.name, detailOk: `Terjemahan ${field}` },
      async () => {
        const systemPrompt =
          "Kamu adalah penerjemah profesional Lumina Studio. Diberi teks milik kandidat " +
          "(CV atau jawaban motivasi). Tugasmu: (1) deteksi bahasa teks; (2) bila teks " +
          "SUDAH berbahasa Indonesia, kembalikan translated bernilai null; (3) selain itu " +
          "terjemahkan ke Bahasa Indonesia formal dengan tetap mempertahankan istilah " +
          "teknis (nama tools/software/sertifikasi tidak diterjemahkan), tata letak paragraf " +
          "mengikuti teks asli. Balas HANYA JSON valid: " +
          '{"language": "<nama bahasa sumber>", "translated": "<terjemahan>" | null}';
        const userPrompt = [
          `Teks milik kandidat ${application.name}:`,
          '"""',
          trimmedSource.slice(0, SOURCE_MAX_CHARS),
          '"""',
          "",
          'Balas HANYA JSON: {"language": "...", "translated": "..." | null}',
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
          "Penerjemah Kandidat",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJsonObject(raw);
        if (!parsed) {
          throw new Error("AI gagal menerjemahkan teks ini.");
        }
        const language = asTrimmedString(parsed.language, 60) || "Asing";
        const translated = asTrimmedString(parsed.translated, TRANSLATION_MAX_CHARS);
        return { language, translated };
      },
    );

    if (!outcome.translated) {
      // Sudah berbahasa Indonesia — tidak ada yang disimpan.
      return NextResponse.json({
        translated: null,
        message: "Teks sudah berbahasa Indonesia.",
      });
    }

    const at = new Date().toISOString();
    await mergeTranslation(id, field, { text: outcome.translated, language: outcome.language, at });
    return NextResponse.json({ translated: outcome.translated, language: outcome.language });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/applications/[id]/translate]", errorMessage(error));
    return NextResponse.json(
      { error: "Terjemahan gagal dibuat. Coba lagi beberapa saat." },
      { status: 500 },
    );
  }
}
