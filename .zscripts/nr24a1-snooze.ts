// NR-24-a1 — set snoozeUntil lamaran uji ke 60 detik lalu (uji cron followupBell).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("pemakaian: bun nr24a1-snooze.ts <applicationId>");
  const snoozeUntil = new Date(Date.now() - 60 * 1000);
  await db.application.update({ where: { id }, data: { snoozeUntil } });
  console.log(`snoozeUntil ${id} = ${snoozeUntil.toISOString()}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
