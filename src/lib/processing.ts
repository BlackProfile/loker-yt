// Orkestrasi pemrosesan latar belakang setelah lamaran masuk:
// (1) AI screening, (2) transkripsi audio intro, (3) notifikasi Discord/Telegram.
// SERVER-ONLY — fire-and-forget; DIJAMIN TIDAK THROW.
// NR45 — seluruh pipeline kini melalui ANTREAN berbatas paralel (maks 2 tugas
// AI sekaligus, sisanya mengantre) sehingga lonjakan submit tidak menghantam
// CPU/memori sekaligus; saat Mode Hemat aktif, tugas ditunda otomatis.
import { analyzeApplication } from "@/lib/ai";
import { enqueueAiJob } from "@/lib/load-metrics";
import { db } from "@/lib/db";
// Task 4-a — alert kandidat menarik + aturan SCORE_TAG (keduanya tidak pernah throw).
import { evaluateScoreTagForApplication, notifyHighScore } from "@/lib/automation-rules";
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
 * NR45 — pekerjaan TIDAK langsung dieksekusi: masuk antrean berbatas paralel
 * (enqueueAiJob); tanda tangan & jaminan tidak-throw tetap sama untuk pemanggil.
 */
export async function startBackgroundProcessing(applicationId: string): Promise<void> {
  enqueueAiJob(applicationId, () => runPipeline(applicationId));
}

/** Isi pipeline lama — dipanggil antrean saat tugas mendapat giliran. */
async function runPipeline(applicationId: string): Promise<void> {
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

    // (1b) Task 4-a — SETELAH AI screening: alert "kandidat menarik" bila skor tinggi
    //      + evaluasi aturan SCORE_TAG untuk lamaran ini saja. Dibungkus try/catch —
    //      kegagalan tidak boleh menggagalkan pipeline.
    try {
      await notifyHighScore(applicationId);
    } catch (error) {
      console.error("[processing] notifyHighScore gagal:", errorMessage(error));
    }
    try {
      await evaluateScoreTagForApplication(applicationId);
    } catch (error) {
      console.error("[processing] evaluateScoreTagForApplication gagal:", errorMessage(error));
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
          hasCv: Boolean(application.cvFileId),
        });
      }
    } catch (error) {
      console.error("[processing] sendNewApplicationNotifications gagal:", errorMessage(error));
    }
  } finally {
    processingSet.delete(applicationId);
  }
}
