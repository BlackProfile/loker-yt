// Pusat Privasi (SERVER-ONLY) — Task 4-c CARE.
// Tiga fungsi inti untuk fitur privasi di tab Data:
//   1. retentionPreview(days)     — pratinjau (dry-run) dampak job retensi data.
//   2. describeEraseTarget(id)    — ringkasan data kandidat yang akan dihapus (UI konfirmasi).
//   3. eraseCandidateData(id, actor) — hapus permanen data kandidat dalam SATU transaksi.
// Kriteria retensi DIDUPlikasi PERSIS dari /api/cron/maintenance job "RETENSI":
//   deletedAt null AND createdAt < now - days AND (status REJECTED OR archivedAt terisi).
// File fisik unggahan (FileAsset.path "uploads/<nama>") dihapus best-effort setelah
// transaksi DB berhasil — kegagalan hapus file tidak menggagalkan erase.
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

const RETENTION_SAMPLE_LIMIT = 20; // maks baris sampel pratinjau
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 365; // sama dengan cron maintenance & purge-archive

/* ----------------------------- Pratinjau retensi ----------------------------- */

export type RetentionSample = {
  id: string;
  name: string;
  trackingCode: string | null;
  positionTitle: string | null;
  status: string;
  ageDays: number;
  archivedAt: string | null;
};

export type RetentionPreviewResult = {
  count: number; // total lamaran yang AKAN terhapus bila retensi dijalankan
  samples: RetentionSample[]; // maks 20 baris terlama
  cutoffDate: string; // batas tanggal (ISO) — lamaran dibuat sebelum tanggal ini
  days: number;
};

/**
 * Hitung lamaran yang AKAN terkena retensi memakai kriteria IDENTIK dengan job
 * "RETENSI" di /api/cron/maintenance (REJECTED atau archivedAt terisi, dibuat
 * lebih tua dari `days`, deletedAt null). TIDAK menghapus apa pun.
 */
export async function retentionPreview(
  days: number,
  now: Date = new Date(),
): Promise<RetentionPreviewResult> {
  const safeDays =
    Number.isFinite(days) && days > 0 ? Math.floor(days) : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - safeDays * DAY_MS);

  // Kriteria persis sama dengan cron maintenance (bandingkan baris per baris):
  //   where: { deletedAt: null, createdAt: { lt: cutoff },
  //            OR: [{ status: "REJECTED" }, { archivedAt: { not: null } }] }
  const where = {
    deletedAt: null,
    createdAt: { lt: cutoff },
    OR: [{ status: "REJECTED" }, { archivedAt: { not: null } }],
  } as const;

  const [count, rows] = await Promise.all([
    db.application.count({ where }),
    db.application.findMany({
      where,
      select: {
        id: true,
        name: true,
        trackingCode: true,
        status: true,
        createdAt: true,
        archivedAt: true,
        position: { select: { title: true } },
      },
      orderBy: { createdAt: "asc" }, // tampilkan yang paling tua dulu
      take: RETENTION_SAMPLE_LIMIT,
    }),
  ]);

  const samples: RetentionSample[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    trackingCode: row.trackingCode,
    positionTitle: row.position?.title ?? null,
    status: row.status,
    ageDays: Math.max(0, Math.floor((now.getTime() - row.createdAt.getTime()) / DAY_MS)),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }));

  return { count, samples, cutoffDate: cutoff.toISOString(), days: safeDays };
}

/* --------------------------- Ringkasan target erase --------------------------- */

export type EraseTargetApplication = {
  id: string;
  trackingCode: string | null;
  positionTitle: string | null;
  status: string;
  createdAt: string;
};

export type EraseTargetSummary = {
  applicationId: string; // lamaran yang diketik/dipilih admin (titik masuk)
  name: string;
  email: string;
  phone: string;
  trackingCode: string | null;
  candidateId: string | null;
  scope: "CANDIDATE" | "APPLICATION"; // CANDIDATE = semua lamaran se-kandidat ikut dihapus
  applicationCount: number;
  interviewCount: number;
  fileCount: number;
  cardCount: number;
  applications: EraseTargetApplication[];
};

/** Ambil daftar id Application dalam lingkup erase: satu lamaran ATAU semua se-kandidat. */
async function resolveScopeApplicationIds(
  applicationId: string,
): Promise<{ ids: string[]; candidateId: string | null } | null> {
  const anchor = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, candidateId: true },
  });
  if (!anchor) return null;
  if (anchor.candidateId) {
    const rows = await db.application.findMany({
      where: { candidateId: anchor.candidateId },
      select: { id: true },
    });
    return { ids: rows.map((row) => row.id), candidateId: anchor.candidateId };
  }
  return { ids: [anchor.id], candidateId: null };
}

/** Ambil id FileAsset yang dirujuk lamaran-lamaran dalam lingkup (CV, intro, dokumen). */
function fileIdsFromJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const ids: string[] = [];
    for (const entry of parsed) {
      if (entry && typeof entry === "object" && "fileId" in entry) {
        const fileId = (entry as { fileId: unknown }).fileId;
        if (typeof fileId === "string" && fileId.length > 0) ids.push(fileId);
      }
    }
    return ids;
  } catch {
    return [];
  }
}

async function collectFileIds(applicationIds: string[]): Promise<string[]> {
  if (applicationIds.length === 0) return [];
  const [apps, assessments, internalDocs] = await Promise.all([
    db.application.findMany({
      where: { id: { in: applicationIds } },
      select: { cvFileId: true, introFileId: true, extraDocs: true, onboardingDocs: true },
    }),
    db.assessment.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { submittedFileId: true },
    }),
    db.internalDoc.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { fileId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const app of apps) {
    if (app.cvFileId) ids.add(app.cvFileId);
    if (app.introFileId) ids.add(app.introFileId);
    for (const fileId of [...fileIdsFromJson(app.extraDocs), ...fileIdsFromJson(app.onboardingDocs)]) {
      ids.add(fileId);
    }
  }
  for (const item of assessments) {
    if (item.submittedFileId) ids.add(item.submittedFileId);
  }
  for (const doc of internalDocs) {
    if (doc.fileId) ids.add(doc.fileId);
  }
  return [...ids];
}

/**
 * Muat ringkasan target erase untuk dialog konfirmasi UI.
 * Return null bila lamaran tidak ditemukan. TIDAK mengubah apa pun.
 */
export async function describeEraseTarget(
  applicationId: string,
): Promise<EraseTargetSummary | null> {
  const scope = await resolveScopeApplicationIds(applicationId);
  if (!scope) return null;

  const anchor = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, name: true, email: true, phone: true, trackingCode: true, candidateId: true },
  });
  if (!anchor) return null;

  const [applications, interviewCount, fileIds, cardCount] = await Promise.all([
    db.application.findMany({
      where: { id: { in: scope.ids } },
      select: {
        id: true,
        trackingCode: true,
        status: true,
        createdAt: true,
        position: { select: { title: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    db.interview.count({ where: { applicationId: { in: scope.ids } } }),
    collectFileIds(scope.ids),
    db.employeeCard.count({ where: { applicationId: { in: scope.ids } } }),
  ]);

  return {
    applicationId: anchor.id,
    name: anchor.name,
    email: anchor.email,
    phone: anchor.phone,
    trackingCode: anchor.trackingCode,
    candidateId: scope.candidateId,
    scope: scope.candidateId ? "CANDIDATE" : "APPLICATION",
    applicationCount: applications.length,
    interviewCount,
    fileCount: fileIds.length,
    cardCount,
    applications: applications.map((app) => ({
      id: app.id,
      trackingCode: app.trackingCode,
      positionTitle: app.position?.title ?? null,
      status: app.status,
      createdAt: app.createdAt.toISOString(),
    })),
  };
}

/* ------------------------------ Hapus permanen ------------------------------ */

export type EraseResult = {
  deletedApplications: number;
  deletedInterviews: number;
  deletedComments: number;
  deletedEmails: number;
  deletedCards: number;
  deletedFiles: number; // baris FileAsset yang berhasil dihapus (file fisik best-effort)
  deletedCandidate: boolean; // Candidate ikut terhapus bila yatim
};

/**
 * Hapus FileAsset + file fisik uploads/ milik kandidat secara best-effort.
 * Aset yang MASIH dirujuk baris lain (lamaran lain, cover posisi, assessment/
 * internalDoc di luar lingkup) DIKECUALIKAN demi keamanan. Return jumlah baris
 * FileAsset yang terhapus. Tidak pernah melempar error.
 */
async function deleteFileAssetsBestEffort(fileIds: string[]): Promise<number> {
  if (fileIds.length === 0) return 0;
  try {
    const [apps, assessments, internalDocs, positions] = await Promise.all([
      db.application.findMany({
        where: { OR: [{ cvFileId: { in: fileIds } }, { introFileId: { in: fileIds } }] },
        select: { cvFileId: true, introFileId: true },
      }),
      db.assessment.findMany({ where: { submittedFileId: { in: fileIds } }, select: { submittedFileId: true } }),
      db.internalDoc.findMany({ where: { fileId: { in: fileIds } }, select: { fileId: true } }),
      db.position.findMany({ where: { coverFileId: { in: fileIds } }, select: { coverFileId: true } }),
    ]);
    const stillReferenced = new Set<string>();
    for (const app of apps) {
      if (app.cvFileId) stillReferenced.add(app.cvFileId);
      if (app.introFileId) stillReferenced.add(app.introFileId);
    }
    for (const item of assessments) {
      if (item.submittedFileId) stillReferenced.add(item.submittedFileId);
    }
    for (const doc of internalDocs) {
      if (doc.fileId) stillReferenced.add(doc.fileId);
    }
    for (const pos of positions) {
      if (pos.coverFileId) stillReferenced.add(pos.coverFileId);
    }
    const deletable = fileIds.filter((id) => !stillReferenced.has(id));
    if (deletable.length === 0) return 0;

    const assets = await db.fileAsset.findMany({
      where: { id: { in: deletable } },
      select: { id: true, path: true },
    });
    await db.fileAsset.deleteMany({ where: { id: { in: deletable } } });

    // File fisik: path tersimpan relatif ke project root ("uploads/<nama>").
    const uploadsRoot = path.resolve(process.cwd(), "uploads");
    for (const asset of assets) {
      try {
        const absolute = path.resolve(process.cwd(), asset.path);
        if (!absolute.startsWith(uploadsRoot + path.sep)) continue; // cegah path traversal
        if (existsSync(absolute)) unlinkSync(absolute);
        const webpVariant = `${absolute}.webp`; // varian WebP cover (bila ada)
        if (existsSync(webpVariant)) {
          try {
            unlinkSync(webpVariant);
          } catch {
            // best-effort
          }
        }
      } catch {
        // gagal hapus satu file fisik — lanjut yang lain (best-effort)
      }
    }
    return assets.length;
  } catch (error) {
    console.error("[privacy-center] deleteFileAssetsBestEffort gagal:", error);
    return 0;
  }
}

/**
 * Hapus PERMANEN seluruh data kandidat dari satu lamaran (atau seluruh lamaran
 * se-kandidat bila lamaran tertaut Candidate). Semua penghapusan baris DB
 * berlangsung dalam SATU transaksi Prisma — error apa pun mengembalikan
 * (rollback) seluruh perubahan dan melempar pesan Indonesia yang jelas.
 *
 * Urutan anak dulu:
 *   - Eksplisit (relasi TIDAK cascade / tanpa FK): EmailOutbox, CandidateSurvey,
 *     NotificationItem — supaya tidak menyisakan data pribadi di baris yatim.
 *   - Eksplisit (cascade di schema, dihapus eksplisit demi hitungan deterministik):
 *     Interview, Comment, ApplicationQuestion, ActivityLog, CheckIn, EmployeeCard,
 *     ApplicationTag, Assessment, CallLog, InternalDoc.
 *   - Application lalu Candidate yatim (tidak punya Application lain).
 * FileAsset + file fisik ditangani best-effort SETELAH transaksi sukses.
 * Jejak audit PRIVACY_ERASE ditulis dengan applicationId null (log yang menempel
 * Application ikut terhapus oleh cascade).
 */
export async function eraseCandidateData(
  applicationId: string,
  sessionActor: string,
): Promise<EraseResult> {
  // VERIFIKASI ulang di luar transaksi: target harus ada & tentukan lingkup.
  const scope = await resolveScopeApplicationIds(applicationId);
  if (!scope) {
    throw new Error("Lamaran tidak ditemukan. Muat ulang halaman lalu coba lagi.");
  }
  const anchor = await db.application.findUnique({
    where: { id: applicationId },
    select: { id: true, name: true, trackingCode: true },
  });
  if (!anchor) {
    throw new Error("Lamaran tidak ditemukan. Muat ulang halaman lalu coba lagi.");
  }
  const scopeIds = scope.ids;
  const candidateId = scope.candidateId;
  const fileIds = await collectFileIds(scopeIds);

  try {
    const counts = await db.$transaction(async (tx) => {
      // 1) Anak eksplisit — relasi tanpa onDelete: Cascade.
      const emails = await tx.emailOutbox.deleteMany({
        where: { applicationId: { in: scopeIds } }, // onDelete: SetNull — data pribadi harus hilang
      });
      await tx.candidateSurvey.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.notificationItem.deleteMany({ where: { applicationId: { in: scopeIds } } }); // tanpa FK

      // 2) Anak cascade — dihapus eksplisit agar jumlah tercatat deterministik.
      const interviews = await tx.interview.deleteMany({ where: { applicationId: { in: scopeIds } } });
      const comments = await tx.comment.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.applicationQuestion.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.activityLog.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.checkIn.deleteMany({ where: { applicationId: { in: scopeIds } } });
      const cards = await tx.employeeCard.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.applicationTag.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.assessment.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.callLog.deleteMany({ where: { applicationId: { in: scopeIds } } });
      await tx.internalDoc.deleteMany({ where: { applicationId: { in: scopeIds } } });

      // 3) Lamaran itu sendiri.
      const applications = await tx.application.deleteMany({ where: { id: { in: scopeIds } } });

      // 4) Candidate yatim — hapus bila tidak punya Application lain.
      let deletedCandidate = false;
      if (candidateId) {
        const remaining = await tx.application.count({ where: { candidateId } });
        if (remaining === 0) {
          await tx.candidate.delete({ where: { id: candidateId } });
          deletedCandidate = true;
        }
      }

      return {
        deletedApplications: applications.count,
        deletedInterviews: interviews.count,
        deletedComments: comments.count,
        deletedEmails: emails.count,
        deletedCards: cards.count,
        deletedCandidate,
      };
    });

    // 5) FileAsset + file fisik uploads/ — best-effort setelah commit.
    const deletedFiles = await deleteFileAssetsBestEffort(fileIds);

    // 6) Jejak audit dengan applicationId null (baris log yang menempel
    //    Application sudah ikut terhapus di transaksi).
    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: sessionActor,
        action: "PRIVACY_ERASE",
        detail: `Hapus permanen kandidat ${anchor.name} (${counts.deletedApplications} lamaran, ${deletedFiles} file)`,
      },
    });

    return { ...counts, deletedFiles };
  } catch (error) {
    console.error("[privacy-center] eraseCandidateData gagal (rollback):", error);
    throw new Error(
      "Gagal menghapus data kandidat secara permanen. Tidak ada data yang berubah — coba lagi beberapa saat.",
    );
  }
}
