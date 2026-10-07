const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();
(async () => {
  const rows = await db.loginAudit.findMany({ orderBy: { createdAt: "desc" }, take: 12 });
  for (const r of rows) {
    console.log(`${r.createdAt.toISOString()} | ${r.email} | ok=${r.success} | reason=${r.reason || "-"} | ip=${r.ip || "-"}`);
  }
})().finally(() => db.$disconnect());
