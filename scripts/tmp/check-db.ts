import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const apps = await db.application.findMany({
  where: { OR: [{ offerStatus: { not: null } }, { status: "REJECTED" }] },
  select: {
    id: true, name: true, status: true, offerStatus: true,
    offerSentAt: true, rejectedAt: true, rejectionReason: true,
    updatedAt: true, position: { select: { title: true } },
  },
  orderBy: { updatedAt: "desc" },
  take: 12,
});
console.log(JSON.stringify(apps, null, 1));
const logs = await db.activityLog.findMany({
  where: { application: { offerStatus: { not: null } } },
  orderBy: { createdAt: "desc" }, take: 30,
  select: { applicationId: true, actor: true, action: true, detail: true, createdAt: true },
});
console.log("--- LOGS ---");
console.log(JSON.stringify(logs, null, 1));
await db.$disconnect();
