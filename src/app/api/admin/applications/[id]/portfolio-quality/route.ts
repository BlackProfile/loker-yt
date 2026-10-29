// NR69 (Fitur #6) — Analisis kualitas portofolio via VLM.
// POST /api/admin/applications/[id]/portfolio-quality — gunakan VLM (createVision)
// untuk menilai kualitas konten portofolio kandidat (URL gambar langsung atau
// thumbnail YouTube bila portfolioUrl adalah URL video YouTube). Hasil disimpan ke
// Application.portfolioQualityScore + Application.portfolioQualitySummary (JSON).
// OWNER/HR saja. Log aktivitas "AI_PORTFOLIO_QUALITY".
//
// Catatan MVP: VLM hanya menerima gambar. Bila portfolioUrl adalah URL video
// non-YouTube (Vimeo/Instagram/TikTok), respons 400 dengan pesan ramah. Bila URL
// gambar (jpg/png/webp) langsung, kirim sebagai image_url ke VLM. Bila URL YouTube,
// ambil thumbnail hqdefault dan kirim sebagai image_url.
import ZAI from "z-ai-web-dev-sdk";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { can } from "@/lib/permissions";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, clampPercent, asTrimmedString } from "@/lib/ai-json";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { serializeApplication } from "@/lib/seed";
import { youtubeEmbedId } from "@/components/landing/landing-utils";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 120_000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const VLM_PROMPT =
  "Anda adalah penilai konten kreatif untuk proses rekrutmen. Nilai gambar portofolio " +
  "kandidat ini dari empat sudut: (1) komposisi & tata letak, (2) daya tarik visual / hook, " +
  "(3) kualitas editing / polish, (4) kesesuaian dengan citra merek modern. " +
  "Jawab HANYA dengan JSON valid berformat: " +
  '{"score": angka 0-100, "summary": string deskripsi singkat bahasa Indonesia, ' +
  '"strengths": array of string (3 butir kelebihan), "weaknesses": array of string (3 butir kekurangan)}. ' +
  "Tanpa komentar, tanpa markdown.";

type VisionContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type PortfolioQualityResult = {
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  source: "youtube_thumbnail" | "image_url";
  generatedAt: string;
};

/**
 * Tentukan URL gambar yang akan dikirim ke VLM:
 * - URL gambar langsung (jpg/jpeg/png/webp/gif) -> pakai apa adanya (source: image_url)
 * - URL YouTube -> https://img.youtube.com/vi/{id}/hqdefault.jpg (source: youtube_thumbnail)
 * - URL lain -> null (tidak didukung MVP ini).
 */
function resolveImageUrl(portfolioUrl: string): {
  url: string;
  source: "youtube_thumbnail" | "image_url";
} | null {
  const trimmed = portfolioUrl.trim();
  if (!trimmed) return null;
  // Coba YouTube dulu.
  const ytId = youtubeEmbedId(trimmed);
  if (ytId) {
    return {
      url: `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`,
      source: "youtube_thumbnail",
    };
  }
  // URL gambar langsung: ambil path/ekstensi (abaikan query string).
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const pathname = url.pathname.toLowerCase();
  const isImage =
    pathname.endsWith(".jpg") ||
    pathname.endsWith(".jpeg") ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".webp") ||
    pathname.endsWith(".gif");
  if (!isImage) return null;
  return { url: trimmed, source: "image_url" };
}

/** Panggil VLM (createVision) dan kembalikan teks hasilnya. */
async function vlmJudge(content: VisionContentItem[]): Promise<string> {
  type ZaiInstance = Awaited<ReturnType<typeof ZAI.create>>;
  type CreateVisionBody = Parameters<ZaiInstance["chat"]["completions"]["createVision"]>[0];
  const body = {
    messages: [{ role: "user", content }],
    thinking: { type: "disabled" },
  } as CreateVisionBody;
  const completion = await withTimeout(
    withZaiRetry((zai) => zai.chat.completions.createVision(body)),
    "Portfolio Quality (VLM)",
    AI_TIMEOUT_MS,
  );
  return (completion?.choices?.[0]?.message?.content ?? "").trim();
}

/** Parse respons VLM menjadi objek PortfolioQualityResult; null bila gagal. */
function parseVlmResult(
  text: string,
  source: "youtube_thumbnail" | "image_url",
): PortfolioQualityResult | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const score = clampPercent(obj.score);
  if (score == null) return null;
  const summary = asTrimmedString(obj.summary, 2000);
  const strengths = Array.isArray(obj.strengths)
    ? obj.strengths
        .map((s) => asTrimmedString(s, 300))
        .filter((s) => s.length > 0)
        .slice(0, 10)
    : [];
  const weaknesses = Array.isArray(obj.weaknesses)
    ? obj.weaknesses
        .map((s) => asTrimmedString(s, 300))
        .filter((s) => s.length > 0)
        .slice(0, 10)
    : [];
  return {
    score,
    summary,
    strengths,
    weaknesses,
    source,
    generatedAt: new Date().toISOString(),
  };
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const allowed = await can(session.role, "kelola_lamaran");
    if (!allowed) {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      // sertakan relasi standar agar serializeApplication lengkap.
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const portfolioUrl = (application.portfolioUrl ?? "").trim();
    if (!portfolioUrl) {
      return NextResponse.json(
        {
          error:
            "Lamaran ini tidak memiliki URL portofolio. Minta kandidat melengkapi tautan portofolio terlebih dahulu.",
        },
        { status: 400 },
      );
    }

    const resolved = resolveImageUrl(portfolioUrl);
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "URL portofolio tidak didukung untuk analisis VLM. Hanya URL gambar (jpg/png/webp/gif) atau URL video YouTube yang didukung. Untuk video Vimeo/Instagram/TikTok, lampirkan tautan gambar thumbnail manual di catatan lamaran.",
        },
        { status: 400 },
      );
    }

    // NR49-A — gate Pusat Kendali AI (fitur mati/kuota habis -> 503, BLOCKED tercatat).
    const result = await withAiGate(
      "portfolio_quality",
      { actor: session.name, detailOk: `portfolio ${application.id} (${resolved.source})` },
      async () => {
        const text = await vlmJudge([
          { type: "text", text: VLM_PROMPT },
          { type: "image_url", image_url: { url: resolved.url } },
        ]);
        const parsed = parseVlmResult(text, resolved.source);
        if (!parsed) {
          throw new Error("Balasan VLM tidak berisi JSON yang valid.");
        }
        return parsed;
      },
    );

    // Simpan hasil ke kolom baru.
    const updated = await db.application.update({
      where: { id },
      data: {
        portfolioQualityScore: result.score,
        portfolioQualitySummary: JSON.stringify(result),
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: "AI",
        action: "AI_PORTFOLIO_QUALITY",
        detail: `Kualitas portofolio dinilai (skor ${result.score}/100, sumber: ${result.source})`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);

    return NextResponse.json({
      application: serializeApplication(updated),
      score: result.score,
      summary: result.summary,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      source: result.source,
      generatedAt: result.generatedAt,
    });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/applications/[id]/portfolio-quality]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal menganalisis kualitas portofolio. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}
