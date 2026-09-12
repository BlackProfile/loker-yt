// POST /api/admin/interviews/[id]/transcribe — transkripsi rekaman wawancara via ASR (ZAI)
// lalu buat ringkasan LLM (poin penting + kekuatan + kekhawatiran) dan simpan keduanya
// ke Interview.transcript & Interview.transcriptSummary.
// Pola SDK mengikuti src/lib/ai.ts (withZaiRetry) & src/lib/transcribe.ts (audio.asr.create).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { db } from "@/lib/db";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Sesi wawancara tidak ditemukan." };

const ASR_TIMEOUT_MS = 240_000; // rekaman bisa panjang (maks 25 MB)
const LLM_TIMEOUT_MS = 90_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ambil FileAsset dari recordingUrl berbentuk /api/files/{id}; null bila bukan file lokal. */
async function assetFromRecordingUrl(recordingUrl: string | null) {
  if (!recordingUrl) return null;
  const match = recordingUrl.match(/^\/api\/files\/([a-zA-Z0-9]+)$/);
  if (!match) return null;
  return db.fileAsset.findUnique({ where: { id: match[1] } });
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
      include: {
        application: { select: { name: true, position: { select: { title: true } } } },
      },
    });
    if (!interview) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const asset = await assetFromRecordingUrl(interview.recordingUrl);
    if (!asset) {
      return NextResponse.json(
        { error: "Unggah rekaman terlebih dahulu (rekaman harus tersimpan di server)." },
        { status: 400 },
      );
    }

    // 1) Transkripsi ASR — pola sama dengan transkripsi audio intro (src/lib/transcribe.ts).
    const filePath = path.isAbsolute(asset.path) ? asset.path : path.join(process.cwd(), asset.path);
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      return NextResponse.json({ error: "File rekaman tidak ditemukan di server." }, { status: 404 });
    }
    const base64Audio = buffer.toString("base64");

    const asrRes = await withTimeout(
      withZaiRetry((zai) => zai.audio.asr.create({ file_base64: base64Audio })),
      "Transkripsi rekaman wawancara",
      ASR_TIMEOUT_MS,
    );
    const transcript = (asrRes?.text ?? "").trim();
    if (!transcript) {
      return NextResponse.json(
        { error: "Hasil transkripsi kosong — rekaman mungkin tidak berisi suara yang jelas." },
        { status: 422 },
      );
    }

    // 2) Ringkasan LLM dari transkrip (4-6 baris: poin penting, kekuatan, kekhawatiran).
    const truncated = transcript.slice(0, 12_000);
    let transcriptSummary: string | null = null;
    try {
      const completion = await withTimeout(
        withZaiRetry((zai) =>
          zai.chat.completions.create({
            messages: [
              {
                role: "assistant",
                content:
                  "Kamu adalah HR assistant yang meringkas transkrip wawancara kerja. Jawab hanya berisi ringkasan, tanpa pembuka/penutup.",
              },
              {
                role: "user",
                content: [
                  `Ringkas hasil wawancara berikut untuk kandidat ${interview.application.name}${interview.application.position ? ` (posisi ${interview.application.position.title})` : ""}.`,
                  "Tulis 4-6 baris bahasa Indonesia dengan struktur persis seperti ini:",
                  "Poin penting:",
                  "- <1-2 poin isi utama pembicaraan>",
                  "Kekuatan:",
                  "- <kekuatan kandidat>",
                  "Kekhawatiran:",
                  "- <hal yang perlu ditindaklanjuti / diragukan>",
                  "",
                  "Transkrip:",
                  truncated,
                ].join("\n"),
              },
            ],
            thinking: { type: "disabled" },
          }),
        ),
        "Ringkasan transkrip wawancara",
        LLM_TIMEOUT_MS,
      );
      const text = (completion?.choices?.[0]?.message?.content ?? "").trim();
      transcriptSummary = text ? text.slice(0, 4000) : null;
    } catch (error) {
      console.error("[transcribe] ringkasan LLM gagal:", errorMessage(error));
    }

    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    await db.interview.update({
      where: { id },
      data: { transcript, transcriptSummary },
    });
    await db.activityLog.create({
      data: {
        applicationId: interview.applicationId,
        actor: "AI",
        action: "TRANSCRIPTION",
        detail: `Rekaman wawancara ronde ${interview.round} ditranskripsi (${wordCount} kata)${transcriptSummary ? " + ringkasan AI dibuat" : " (ringkasan gagal)"}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.interviews);

    return NextResponse.json({ ok: true, transcript, transcriptSummary });
  } catch (error) {
    console.error("[POST /api/admin/interviews/[id]/transcribe]", error);
    return NextResponse.json(
      { error: "Gagal mentranskripsi rekaman. Pastikan format didukung lalu coba lagi." },
      { status: 500 },
    );
  }
}
