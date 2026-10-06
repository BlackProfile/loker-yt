import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const apps = await db.application.findMany({
  where: { deletedAt: null },
  select: { id: true, name: true, email: true, status: true, positionId: true, talentPool: true, holdAt: true, rejectedAt: true, doNotHire: true, archivedAt: true, aiScore: true, rating: true, tags: true, trackingCode: true },
  orderBy: { createdAt: "asc" },
  take: 100,
});
console.log(`== ALL APPS (${apps.length}) ==`);
for (const a of apps) console.log(`${a.id} | ${a.name} | ${a.trackingCode} | status=${a.status} | pos=${a.positionId} | tp=${a.talentPool} | holdAt=${a.holdAt?.toISOString() ?? null} | rejAt=${a.rejectedAt?.toISOString() ?? null} | dnh=${a.doNotHire} | arch=${a.archivedAt ? "yes" : "no"} | ai=${a.aiScore} | rate=${a.rating} | tags=${a.tags}`);
await db.$disconnect();
