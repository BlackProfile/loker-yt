// NR-24-a2 — pulihkan keadaan demo pasca uji (baca .zscripts/nr24a2-snapshot.json).
// Me-reset field lamaran yang disentuh, menghapus seluruh jejak uji (lamaran uji, komentar,
// pertanyaan, panggilan, asesmen, dokumen internal, log, email, survei, Setting, file fisik),
// lalu memverifikasi 5 lamaran demo tetap hidup & sehat.
import { unlink } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const SNAP_PATH = path.join(process.cwd(), ".zscripts", "nr24a2-snapshot.json");

async function main() {
  if (!existsSync(SNAP_PATH)) throw new Error("Snapshot tidak ditemukan — jalankan nr24a2-setup.ts dulu.");
  const snap = JSON.parse(await (await import("node:fs/promises")).readFile(SNAP_PATH, "utf8"));
  const testStart = new Date(snap.testStart);
  const touchedIds: string[] = snap.apps.map((a: { id: string }) => a.id);
  const tempId: string | null = snap.tempAppId ?? null;

  // 1. Hapus lamaran uji (cascade: komentar, log, dll). EmailOutbox ikut SetNull — hapus manual.
  if (tempId) {
    const outbox = await db.emailOutbox.deleteMany({ where: { applicationId: tempId } });
    await db.application.delete({ where: { id: tempId } });
    console.log(`hapus lamaran uji ${tempId} (outbox=${outbox.count})`);
  }

  // 2. Pulihkan field lamaran demo yang disentuh dari snapshot.
  for (const app of snap.apps) {
    await db.application.update({
      where: { id: app.id },
      data: {
        status: app.status,
        rejectionReason: app.rejectionReason,
        rejectionNote: app.rejectionNote,
        rejectedAt: app.rejectedAt ? new Date(app.rejectedAt) : null,
        mergedIntoId: app.mergedIntoId,
        isDuplicate: app.isDuplicate,
        tags: app.tags,
        cvFileId: app.cvFileId,
        introFileId: app.introFileId,
        extraDocs: app.extraDocs,
        botFiles: app.botFiles,
        docExpiries: app.docExpiries,
        offerStatus: app.offerStatus,
        stageHistory: app.stageHistory,
        stageUpdatedAt: app.stageUpdatedAt ? new Date(app.stageUpdatedAt) : null,
      },
    });
  }
  console.log(`pulihkan ${snap.apps.length} lamaran demo dari snapshot`);

  // 3. Hapus data uji per lamaran (dibuat sejak testStart).
  const delComments = await db.comment.deleteMany({
    where: { id: { in: snap.testCommentIds } },
  });
  const delQuestion = snap.testQuestionId
    ? await db.applicationQuestion.deleteMany({ where: { id: snap.testQuestionId } })
    : { count: 0 };
  const delCalls = await db.applicationCall.deleteMany({
    where: { applicationId: { in: touchedIds }, createdAt: { gte: testStart } },
  });
  const delAssess = await db.applicationAssessment.deleteMany({
    where: { applicationId: { in: touchedIds }, createdAt: { gte: testStart } },
  });
  // Dokumen internal: catat FileAsset-nya dulu agar baris + file fisik bisa dihapus.
  const testDocs = await db.applicationInternalDoc.findMany({
    where: { applicationId: { in: touchedIds }, createdAt: { gte: testStart } },
    select: { id: true, fileId: true },
  });
  const delDocs = await db.applicationInternalDoc.deleteMany({
    where: { id: { in: testDocs.map((d) => d.id) } },
  });
  const delLogs = await db.activityLog.deleteMany({
    where: { applicationId: { in: [...touchedIds, ...(tempId ? [tempId] : [])] }, createdAt: { gte: testStart } },
  });
  const delEmails = await db.emailOutbox.deleteMany({
    where: { applicationId: { in: touchedIds }, createdAt: { gte: testStart } },
  });
  const delSurveys = await db.candidateSurvey.deleteMany({
    where: { applicationId: { in: touchedIds }, createdAt: { gte: testStart } },
  });
  console.log(
    `hapus uji: komentar=${delComments.count} pertanyaan=${delQuestion.count} panggilan=${delCalls.count} ` +
      `asesmen=${delAssess.count} dokumen=${delDocs.count} log=${delLogs.count} email=${delEmails.count} survei=${delSurveys.count}`
  );

  // 4. FileAsset uji + file fisik.
  let filesDeleted = 0;
  if (snap.testFileAssetId) {
    const asset = await db.fileAsset.findUnique({ where: { id: snap.testFileAssetId } });
    if (asset) {
      await db.fileAsset.delete({ where: { id: asset.id } });
      try {
        await unlink(path.join(process.cwd(), asset.path));
        filesDeleted++;
      } catch {
        /* file fisik mungkin sudah tidak ada */
      }
    }
  }
  // File fisik sisa dokumen internal uji (baris FileAsset sudah terhapus via cascade API).
  const uploadsDir = path.join(process.cwd(), "uploads");
  for (const suffix of ["nr24a2-doc.txt", "nr24a2-test-cv.txt"]) {
    try {
      const files = await (await import("node:fs/promises")).readdir(uploadsDir);
      for (const f of files) {
        if (f.includes(suffix)) {
          await unlink(path.join(uploadsDir, f));
          filesDeleted++;
        }
      }
    } catch {
      /* uploads/ mungkin tidak ada */
    }
  }
  console.log(`hapus FileAsset uji + file fisik: ${filesDeleted}`);

  // 5. Pulihkan Setting doNotHire & tagList sesuai snapshot.
  const snapKeys = new Set(snap.settings.map((s: { key: string }) => s.key));
  for (const key of ["doNotHire", "tagList"]) {
    if (snapKeys.has(key)) {
      const original = snap.settings.find((s: { key: string }) => s.key === key);
      await db.setting.upsert({
        where: { key },
        create: { key, value: original.value },
        update: { value: original.value },
      });
    } else {
      const removed = await db.setting.deleteMany({ where: { key } });
      if (removed.count) console.log(`hapus Setting ${key} x${removed.count}`);
    }
  }

  // 6. Verifikasi akhir: 5 lamaran demo hidup + tanpa sisa data uji.
  const live = await db.application.count({ where: { deletedAt: null } });
  const remainTemp = await db.application.count({ where: { name: "Uji NR24A2" } });
  const remainChildren = await db.applicationCall.count({ where: { applicationId: { in: touchedIds } } });
  const remainAssess = await db.applicationAssessment.count({ where: { applicationId: { in: touchedIds } } });
  const remainDocs = await db.applicationInternalDoc.count({ where: { applicationId: { in: touchedIds } } });
  const remainQ = await db.applicationQuestion.count({ where: { applicationId: { in: touchedIds } } });
  const settingsLeft = await db.setting.findMany({ where: { key: { in: ["doNotHire", "tagList"] } } });
  console.log(
    `VERIFIKASI: live=${live} (harus 5) sisaLamaranUji=${remainTemp} panggilan=${remainChildren} asesmen=${remainAssess} dokumen=${remainDocs} pertanyaan=${remainQ} settings=${settingsLeft.length} (harus 0)`
  );
  if (live !== 5 || remainTemp !== 0) {
    console.error("GAGAL: keadaan demo tidak pulih!");
    process.exit(1);
  }
  console.log("CLEANUP OK");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
