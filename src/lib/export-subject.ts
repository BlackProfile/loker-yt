// NR-41 H17 — Bundel ekspor data subjek (SERVER-ONLY).
// buildDataSubjectExport() menyusun DataSubjectExport untuk satu lamaran:
// profil lengkap + interviews/comments/questions/checkIns/surveys/cards + files.
// Dipakai oleh: /api/admin/applications/[id]/export-data (admin, semua data)
// dan /api/public/track-export (pelamar, TANPA catatan internal).
import { db } from "@/lib/db";
import type { DataSubjectExport } from "@/lib/types";

/** Field internal admin yang tidak boleh ikut ekspor versi pelamar. */
const INTERNAL_APP_FIELDS = [
  "adminNotes",
  "rubricScores",
  "screeningVerdicts",
  "videoNotes",
  "checklistState",
  "starredBy",
] as const;

/** Ambil fileId dari kolom JSON {label,filename,fileId}[] / {fileId,...}[]. */
function fileIdsFromJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const fileId = (item as Record<string, unknown>).fileId;
        if (typeof fileId === "string" && fileId) ids.push(fileId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

/** Kumpulkan seluruh fileId milik lamaran (CV, intro, dokumen, bot) — unik. */
function collectFileIds(app: {
  cvFileId: string | null;
  introFileId: string | null;
  extraDocs: string;
  onboardingDocs: string;
  botFiles: string;
}): string[] {
  const ids = [
    app.cvFileId,
    app.introFileId,
    ...fileIdsFromJson(app.extraDocs),
    ...fileIdsFromJson(app.onboardingDocs),
    ...fileIdsFromJson(app.botFiles),
  ].filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)];
}

/**
 * Susun bundel ekspor. `scope: "admin"` menyertakan seluruh data (termasuk
 * diskusi internal); `scope: "public"` membuang catatan internal admin.
 * Tidak pernah melempar error ke pemanggil — return null bila lamaran hilang.
 */
export async function buildDataSubjectExport(
  applicationId: string,
  scope: "admin" | "public",
): Promise<DataSubjectExport | null> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    include: {
      position: { select: { id: true, title: true, department: true } },
      cvFile: true,
      introFile: true,
      interviews: { orderBy: { scheduledAt: "asc" } },
      comments: { orderBy: { createdAt: "asc" } },
      questions: { orderBy: { createdAt: "asc" } },
      checkIns: { orderBy: { day: "asc" } },
      surveys: { orderBy: { createdAt: "asc" } },
      employeeCards: { orderBy: { issuedAt: "asc" } },
      tagLinks: { include: { tag: { select: { name: true } } } },
    },
  });
  if (!app) return null;

  // Profil lamaran: semua field profil disertakan. Versi pelamar membuang
  // catatan internal (adminNotes, rubric internal, verdict screening, dll).
  const appJson = JSON.parse(JSON.stringify(app)) as Record<string, unknown>;
  delete appJson.position; // sudah diringkas di bawah
  delete appJson.cvFile;
  delete appJson.introFile;
  delete appJson.tagLinks; // sudah diringkas menjadi tags: string[]
  if (scope === "public") {
    for (const field of INTERNAL_APP_FIELDS) delete appJson[field];
  }

  // Berkas milik subjek → url unduhan lewat /api/files/{id}.
  const fileIds = collectFileIds(app);
  const assets =
    fileIds.length > 0
      ? await db.fileAsset.findMany({
          where: { id: { in: fileIds } },
          select: { id: true, filename: true, mimeType: true, size: true },
        })
      : [];

  return {
    exportedAt: new Date().toISOString(),
    application: {
      ...appJson,
      position: app.position
        ? { id: app.position.id, title: app.position.title, department: app.position.department }
        : null,
      cvFileName: app.cvFile?.filename ?? null,
      introFileName: app.introFile?.filename ?? null,
      tags: app.tagLinks
        ? app.tagLinks.map((link) => link.tag.name)
        : [],
    },
    interviews: JSON.parse(JSON.stringify(app.interviews)) as Array<Record<string, unknown>>,
    // Komentar = diskusi internal admin — tidak disertakan pada ekspor pelamar.
    comments: scope === "admin" ? (JSON.parse(JSON.stringify(app.comments)) as Array<Record<string, unknown>>) : [],
    questions: JSON.parse(JSON.stringify(app.questions)) as Array<Record<string, unknown>>,
    checkIns: JSON.parse(JSON.stringify(app.checkIns)) as Array<Record<string, unknown>>,
    surveys: JSON.parse(JSON.stringify(app.surveys)) as Array<Record<string, unknown>>,
    cards: JSON.parse(JSON.stringify(app.employeeCards)) as Array<Record<string, unknown>>,
    files: assets.map((asset) => ({
      id: asset.id,
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: asset.size,
      url: `/api/files/${asset.id}`,
    })),
  };
}
