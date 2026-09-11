// Transkripsi audio intro pelamar via ASR (z-ai-web-dev-sdk).
// SERVER-ONLY — jangan pernah diimpor dari komponen klien.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { db } from "@/lib/db";

const ASR_TIMEOUT_MS = 60_000; // 60 detik

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Transkripsi audio intro milik satu lamaran (jika ada) dan simpan ke Application.transcript.
 * Tidak pernah melempar error — semua kegagalan dicatat sebagai ActivityLog + console.error.
 */
export async function transcribeIntroAudio(applicationId: string): Promise<void> {
  try {
    const application = await db.application.findUnique({
      where: { id: applicationId },
      include: { introFile: true },
    });
    if (!application || !application.introFileId || !application.introFile) {
      return; // tidak ada audio intro — tidak ada yang perlu dilakukan
    }

    const file = application.introFile;
    if (!file.mimeType.toLowerCase().startsWith("audio")) {
      console.error(`[transcribe] mimeType bukan audio (${file.mimeType}) — lewati`);
      return;
    }

    const filePath = path.isAbsolute(file.path) ? file.path : path.join(process.cwd(), file.path);
    const buffer = await readFile(filePath);
    const base64Audio = buffer.toString("base64");

    const res = await withTimeout(
      withZaiRetry((zai) => zai.audio.asr.create({ file_base64: base64Audio })),
      "Transkripsi audio intro",
      ASR_TIMEOUT_MS,
    );
    const transcript = (res?.text ?? "").trim();
    if (!transcript) {
      throw new Error("hasil transkripsi kosong");
    }

    const wordCount = transcript.split(/\s+/).filter(Boolean).length;
    await db.application.update({
      where: { id: applicationId },
      data: { transcript },
    });
    await db.activityLog.create({
      data: {
        applicationId,
        actor: "AI",
        action: "TRANSCRIPTION",
        detail: `Audio intro ditranskripsi (${wordCount} kata)`,
      },
    });
  } catch (error) {
    console.error("[transcribe] transcribeIntroAudio gagal:", errorMessage(error));
    try {
      await db.activityLog.create({
        data: {
          applicationId,
          actor: "AI",
          action: "TRANSCRIPTION",
          detail: "Gagal transkripsi audio intro.",
        },
      });
    } catch (logError) {
      console.error("[transcribe] gagal menulis ActivityLog TRANSCRIPTION:", errorMessage(logError));
    }
  }
}
