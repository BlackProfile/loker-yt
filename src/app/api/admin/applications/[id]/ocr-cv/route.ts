// POST /api/admin/applications/[id]/ocr-cv — ekstraksi teks CV (Task 20-c).
// PDF: teks diekstrak langsung dari stream (zlib); bila tak terbaca (hasil pindai),
// dikirim ke VLM via ZAI (file_url). Gambar: langsung dikirim ke VLM (image_url base64).
// Hasil disimpan ke Application.cvText (maks 8000 karakter) + ActivityLog OCR_CV.
// Body { peek?: true } → hanya membaca cvText yang sudah ada (tanpa OCR) — boleh untuk semua role.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 120_000;
const CV_TEXT_MAX_CHARS = 8000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const VLM_PROMPT =
  "Ekstrak seluruh teks yang terbaca dari dokumen CV berikut. Tuliskan apa adanya sebagai teks polos " +
  "(plain text) dalam bahasa asli dokumen, pertahankan struktur bagian (pendidikan, pengalaman, keterampilan). " +
  "Tanpa komentar, tanpa markdown, tanpa penutup.";

type VisionContentItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file_url"; file_url: { url: string } };

/** Dekode string literal PDF: escape \n \r \t \( \) \\ dan oktal \ddd. */
function decodePdfString(value: string): string {
  return value.replace(/\\([0-7]{1,3})|\\(.)/g, (_match, oct: string | undefined, ch: string) => {
    if (oct) return String.fromCharCode(parseInt(oct, 8));
    switch (ch) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "";
      case "f":
        return "\n";
      default:
        return ch;
    }
  });
}

/**
 * Ekstraksi teks mentah dari PDF: buka setiap stream (inflate bila terkompresi),
 * lalu kumpulkan string literal pada operator teks (Tj/TJ). Heuristik — cukup untuk
 * mendeteksi "apakah PDF ini punya lapisan teks yang bisa dibaca".
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const textChunks: string[] = [];
  let cursor = 0;
  for (;;) {
    const streamStart = raw.indexOf("stream", cursor);
    if (streamStart === -1) break;
    let contentStart = streamStart + "stream".length;
    if (raw[contentStart] === "\r") contentStart++;
    if (raw[contentStart] === "\n") contentStart++;
    const streamEnd = raw.indexOf("endstream", contentStart);
    if (streamEnd === -1) break;
    cursor = streamEnd + "endstream".length;

    const section = raw.slice(contentStart, streamEnd);
    let content = section;
    try {
      content = inflateSync(Buffer.from(section, "latin1")).toString("latin1");
    } catch {
      // stream tanpa kompresi — pakai apa adanya
    }
    if (/BT\b|\bTj\b|\bTJ\b/.test(content)) textChunks.push(content);
  }

  const parts: string[] = [];
  const literalRe = /\((?:\\[\s\S]|[^\\()])*\)/g;
  for (const chunk of textChunks) {
    const matches = chunk.match(literalRe) ?? [];
    for (const match of matches) {
      parts.push(decodePdfString(match.slice(1, -1)));
    }
  }
  return parts
    .join(" ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Heuristik: teks cukup panjang dan mayoritas huruf (bukan sampah encoding). */
function looksLikeRealText(text: string): boolean {
  if (text.length < 120) return false;
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  return letters / text.length > 0.3;
}

/** Panggil VLM (createVision) dan kembalikan teks hasilnya. */
async function vlmExtract(content: VisionContentItem[]): Promise<string> {
  const completion = await withTimeout(
    withZaiRetry((zai) =>
      zai.chat.completions.createVision({
        messages: [{ role: "user", content }],
        thinking: { type: "disabled" },
      }),
    ),
    "OCR CV (VLM)",
    AI_TIMEOUT_MS,
  );
  return (completion?.choices?.[0]?.message?.content ?? "").trim();
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const peek =
      body !== null && typeof body === "object" && (body as { peek?: unknown }).peek === true;

    // peek = baca cvText yang sudah ada saja (read-only, semua role).
    if (!peek && session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { id } = await params;
    const application = await db.application.findUnique({
      where: { id },
      include: { cvFile: true },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    if (peek) {
      return NextResponse.json({ cvText: application.cvText, cached: true });
    }
    // Sudah pernah diekstraksi — jangan buang biaya OCR ulang.
    if (application.cvText) {
      return NextResponse.json({ cvText: application.cvText, cached: true });
    }
    if (!application.cvFile) {
      return NextResponse.json(
        { error: "Lamaran ini tidak memiliki file CV." },
        { status: 400 }
      );
    }

    const asset = application.cvFile;
    const mimeType = asset.mimeType.toLowerCase();
    const isImage = mimeType.startsWith("image/");
    const isPdf = mimeType === "application/pdf" || asset.filename.toLowerCase().endsWith(".pdf");
    if (!isImage && !isPdf) {
      return NextResponse.json(
        { error: "Format CV tidak didukung untuk OCR. Gunakan PDF atau gambar." },
        { status: 400 }
      );
    }

    const absolutePath = path.isAbsolute(asset.path)
      ? asset.path
      : path.join(process.cwd(), asset.path);
    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch {
      return NextResponse.json(
        { error: "File CV tidak ditemukan di server." },
        { status: 502 }
      );
    }

    let text = "";
    let method: string;
    if (isImage) {
      text = await vlmExtract([
        { type: "text", text: VLM_PROMPT },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${buffer.toString("base64")}` } },
      ]);
      method = "VLM (gambar)";
    } else {
      const extracted = extractPdfText(buffer);
      if (looksLikeRealText(extracted)) {
        text = extracted;
        method = "teks PDF";
      } else {
        // PDF hasil pindai / tanpa lapisan teks → VLM via file_url (SDK mendukung PDF).
        text = await vlmExtract([
          { type: "text", text: VLM_PROMPT },
          { type: "file_url", file_url: { url: `data:application/pdf;base64,${buffer.toString("base64")}` } },
        ]);
        method = "VLM (PDF)";
      }
    }

    text = text.replace(/\r\n/g, "\n").trim().slice(0, CV_TEXT_MAX_CHARS);
    if (!text) {
      console.error("[POST /api/admin/applications/[id]/ocr-cv] hasil ekstraksi kosong");
      return NextResponse.json(
        { error: "Tidak ada teks yang bisa dibaca dari CV ini." },
        { status: 502 }
      );
    }

    await db.application.update({ where: { id }, data: { cvText: text } });
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: "AI",
        action: "OCR_CV",
        detail: `Teks CV diekstraksi (${text.length} karakter, metode: ${method})`,
      },
    });

    // Realtime: timeline/log lamaran bertambah — segarkan daftar admin.
    void emitRealtime(REALTIME_EVENTS.applications);

    return NextResponse.json({ cvText: text, cached: false });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/ocr-cv]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal membaca CV dengan OCR. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
