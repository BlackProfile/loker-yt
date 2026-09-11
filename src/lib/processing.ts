// Orkestrasi pemrosesan latar belakang setelah lamaran masuk:
// (1) AI screening, (2) transkripsi audio intro, (3) notifikasi Discord/Telegram.
// SERVER-ONLY — fire-and-forget; DIJAMIN TIDAK THROW.
import { analyzeApplication } from "@/lib/ai";
import { db } from "@/lib/db";
import { sendNewApplicationNotifications } from "@/lib/notify";
import { transcribeIntroAudio } from "@/lib/transcribe";

/** Guard anti-duplikasi: satu applicationId hanya diproses sekali pada satu waktu. */
const processingSet = new Set<string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Jalankan seluruh langkah pemrosesan latar belakang untuk satu lamaran.
 * Aman dipanggil fire-and-forget (void startBackgroundProcessing(id)) — tidak pernah melempar error.
 */
export async function startBackgroundProcessing(applicationId: string): Promise<void> {
  if (processingSet.has(applicationId)) {
    return; // sudah berjalan — cegah duplikasi
  }
  processingSet.add(applicationId);

  try {
    // (1) AI screening
    try {
      await analyzeApplication(applicationId);
    } catch (error) {
      console.error("[processing] analyzeApplication gagal:", errorMessage(error));
    }

    // (2) Transkripsi audio intro (jika ada)
    try {
      await transcribeIntroAudio(applicationId);
    } catch (error) {
      console.error("[processing] transcribeIntroAudio gagal:", errorMessage(error));
    }

    // (3) Notifikasi Discord/Telegram
    try {
      const application = await db.application.findUnique({
        where: { id: applicationId },
        include: { position: { select: { title: true } } },
      });
      if (application) {
        await sendNewApplicationNotifications({
          id: application.id,
          name: application.name,
          positionTitle: application.position?.title ?? null,
          trackingCode: application.trackingCode,
        });
      }
    } catch (error) {
      console.error("[processing] sendNewApplicationNotifications gagal:", errorMessage(error));
    }
  } finally {
    processingSet.delete(applicationId);
  }
}
