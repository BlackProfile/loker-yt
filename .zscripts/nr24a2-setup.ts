// NR-24-a2 — persiapan uji: snapshot keadaan asli demo + buat data uji terkontrol.
// Membuat: 1 FileAsset uji (+ file fisik), 1 lamaran uji (email sama dgn Dewi, untuk
// merge & history), 2 komentar pada lamaran uji, 1 pertanyaan tanpa jawaban pada Dewi.
// Snapshot disimpan .zscripts/nr24a2-snapshot.json — dibaca oleh nr24a2-cleanup.ts.
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  // Bersihkan sisa setup sebelumnya yang gagal di tengah jalan (idempoten).
  const leftovers = await db.application.findMany({ where: { name: "Uji NR24A2" }, select: { id: true } });
  for (const row of leftovers) await db.application.delete({ where: { id: row.id } });
  await db.fileAsset.deleteMany({ where: { filename: "nr24a2-test-cv.txt" } });
  await db.applicationQuestion.deleteMany({ where: { question: { contains: "portofolio tambahan" } } });

  const dewi = await db.application.findFirst({
    where: { email: "dewi.lestari@mail.com", deletedAt: null },
    include: { _count: { select: { comments: true, questions: true } } },
  });
  if (!dewi) throw new Error("Lamaran demo Dewi tidak ditemukan");

  // 1. Snapshot field penuh lamaran yang akan disentuh + setting + timestamp mulai uji.
  const touched = await db.application.findMany({
    where: { email: { in: ["dewi.lestari@mail.com", "rizky.pratama@mail.com", "anisa.rahma@mail.com"] } },
  });
  const snapshot = {
    testStart: new Date().toISOString(),
    apps: touched.map((a) => ({
      id: a.id,
      status: a.status,
      rejectionReason: a.rejectionReason,
      rejectionNote: a.rejectionNote,
      rejectedAt: a.rejectedAt ? a.rejectedAt.toISOString() : null,
      mergedIntoId: a.mergedIntoId,
      isDuplicate: a.isDuplicate,
      tags: a.tags,
      cvFileId: a.cvFileId,
      introFileId: a.introFileId,
      extraDocs: a.extraDocs,
      botFiles: a.botFiles,
      docExpiries: a.docExpiries,
      offerStatus: a.offerStatus,
      stageHistory: a.stageHistory,
      stageUpdatedAt: a.stageUpdatedAt ? a.stageUpdatedAt.toISOString() : null,
    })),
    settings: await db.setting.findMany({ where: { key: { in: ["doNotHire", "tagList"] } } }),
    dewiComments: dewi._count.comments,
    dewiQuestions: dewi._count.questions,
    tempAppId: null as string | null,
    testFileAssetId: null as string | null,
    testQuestionId: null as string | null,
    testCommentIds: [] as string[],
  };

  // 2. FileAsset uji + file fisik (dipakai sebagai CV lamaran uji — diuji disalin saat merge).
  const uploadsDir = path.join(process.cwd(), "uploads");
  await mkdir(uploadsDir, { recursive: true });
  const physPath = path.join(uploadsDir, "nr24a2-test-cv.txt");
  await writeFile(physPath, "Isi CV uji NR-24-a2\n");
  const asset = await db.fileAsset.create({
    data: {
      filename: "nr24a2-test-cv.txt",
      mimeType: "text/plain",
      size: 22,
      path: "uploads/nr24a2-test-cv.txt",
    },
  });
  snapshot.testFileAssetId = asset.id;

  // 3. Lamaran uji (email sama dgn Dewi → riwayat & merge realistis).
  const temp = await db.application.create({
    data: {
      name: "Uji NR24A2",
      email: "dewi.lestari@mail.com",
      phone: "081200000024",
      experience: "Pengalaman uji merge lamaran NR-24-a2.",
      motivation: "Memastikan fitur merge bekerja.",
      status: "NEW",
      tags: JSON.stringify(["komunitas", "uji-nr24"]),
      cvFileId: asset.id,
      extraDocs: JSON.stringify([{ label: "KTP Uji", filename: "ktp-uji.txt", fileId: "file-uji-1" }]),
      botFiles: JSON.stringify([{ fileId: "file-bot-1", filename: "bot-uji.txt" }]),
      docExpiries: JSON.stringify({ "file-uji-1": "2030-01-01" }),
    },
  });
  snapshot.tempAppId = temp.id;

  // 4. Dua komentar pada lamaran uji (dihitung pindah saat merge).
  const c1 = await db.comment.create({
    data: { applicationId: temp.id, authorName: "Uji Setup", authorRole: "HR", body: "Komentar uji 1 — akan pindah saat merge" },
  });
  const c2 = await db.comment.create({
    data: { applicationId: temp.id, authorName: "Uji Setup", authorRole: "HR", body: "Komentar uji 2 — akan pindah saat merge" },
  });
  snapshot.testCommentIds = [c1.id, c2.id];

  // 5. Pertanyaan pelamar tanpa jawaban pada Dewi (menguji inbox unanswered).
  const q = await db.applicationQuestion.create({
    data: {
      applicationId: dewi.id,
      question: "Apakah boleh melampirkan portofolio tambahan?",
      askedBy: "Dewi Lestari",
    },
  });
  snapshot.testQuestionId = q.id;

  await writeFile(
    path.join(process.cwd(), ".zscripts", "nr24a2-snapshot.json"),
    JSON.stringify(snapshot, null, 2)
  );
  console.log("SETUP OK");
  console.log(`dewi=${dewi.id} tempApp=${temp.id} asset=${asset.id} question=${q.id}`);
  console.log(`dewiComments sebelum=${dewi._count.comments}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
