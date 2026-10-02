import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const posCount = await db.position.count();
  const aktif = await db.position.count({ where: { isActive: true } });
  const appCount = await db.application.count();
  const users = await db.user.count();
  const byStatus = await db.application.groupBy({ by: ["status"], _count: true });
  const statusLine = byStatus.map(s => `${s.status}=${s._count}`).join(", ");
  await Bun.write("/tmp/db-counts.txt", `pos=${posCount} aktif=${aktif} nonaktif=${posCount - aktif} apps=${appCount} users=${users}\n${statusLine}\n`);
}
main().finally(() => process.exit(0));
