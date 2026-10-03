// NR-24-a2 — probe keadaan demo sebelum uji (status, rejection, tags, hitungan anak data).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const apps = await db.application.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      rejectionReason: true,
      rejectionNote: true,
      rejectedAt: true,
      mergedIntoId: true,
      isDuplicate: true,
      tags: true,
      cvFileId: true,
      introFileId: true,
      extraDocs: true,
      botFiles: true,
      docExpiries: true,
      offerStatus: true,
      stageHistory: true,
      _count: { select: { comments: true, questions: true, calls: true, assessments: true, internalDocs: true, activityLogs: true, interviews: true, checkIns: true, emailOut: true } },
    },
  });
  for (const a of apps) {
    console.log(JSON.stringify(a));
  }
  const settings = await db.setting.findMany({ where: { key: { in: ["doNotHire", "tagList"] } } });
  for (const s of settings) console.log(`SETTING ${s.key} = ${s.value}`);
  console.log(`TOTAL live: ${apps.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
