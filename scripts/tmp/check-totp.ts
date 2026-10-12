import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const users = await db.adminUser.findMany({
  select: { email: true, role: true, isActive: true, totpEnabled: true, totpSecret: true },
  orderBy: { createdAt: "asc" },
});
for (const u of users) {
  console.log(JSON.stringify({ email: u.email, role: u.role, isActive: u.isActive, totpEnabled: u.totpEnabled, secretAda: !!u.totpSecret }));
}
const since = new Date(Date.now() - 30 * 60 * 1000);
const audits = await db.loginAudit.findMany({
  where: { createdAt: { gte: since } },
  orderBy: { createdAt: "desc" },
  take: 30,
  select: { email: true, success: true, reason: true, createdAt: true },
});
console.log("--- audit login 30 menit terakhir ---");
for (const a of audits) console.log(`${a.createdAt.toISOString()} ${a.email} ${a.success ? "OK" : "GAGAL"} ${a.reason ?? "-"}`);
await db.$disconnect();
