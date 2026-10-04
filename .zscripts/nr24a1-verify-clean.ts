import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const apps = await db.application.count();
  const positions = await db.position.count({ where: { deletedAt: null } });
  const notifIds = await db.notificationItem.findMany({ where: { applicationId: { not: null } }, select: { applicationId: true } });
  const appIds = new Set((await db.application.findMany({ select: { id: true } })).map((a) => a.id));
  const orphans = notifIds.filter((n) => !appIds.has(n.applicationId as string)).length;
  const models = {
    calls: await db.applicationCall.count(),
    assessments: await db.applicationAssessment.count(),
    internalDocs: await db.applicationInternalDoc.count(),
  };
  const dnh = await db.setting.count({ where: { key: "doNotHire" } });
  const holds = await db.application.count({ where: { holdReason: { not: null } } });
  const starred = await db.application.count({ where: { starredBy: { not: "[]" } } });
  console.log({ apps, positions, orphans, models, dnh, holds, starred });
}
main().finally(() => db.$disconnect());
