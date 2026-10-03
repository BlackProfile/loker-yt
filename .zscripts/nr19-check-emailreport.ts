import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const [outbox, logs] = await Promise.all([
  db.emailOutbox.findMany({ where: { kind: "SYSTEM", subject: { contains: "Laporan" } }, orderBy: { createdAt: "desc" }, take: 5 }),
  db.activityLog.findMany({ where: { action: { startsWith: "EMAIL_REPORT" } }, orderBy: { createdAt: "desc" }, take: 5 }),
]);
console.log("OUTBOX:", outbox.map((o) => `${o.subject} | ${o.toEmail} | ${o.status}`));
console.log("LOGS:", logs.map((l) => `${l.action} | ${l.detail?.slice(0, 60)}`));
await db.$disconnect();
