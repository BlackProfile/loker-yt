// SEMENTARA NR45 — verifikasi log audit uji + rekap (dihapus setelah uji).
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const actions = ["SLOW_REQUEST", "SAVE_MODE_ON", "SAVE_MODE_OFF", "MAINTENANCE_ON"];
for (const action of actions) {
  const rows = await db.activityLog.findMany({
    where: { action, applicationId: null },
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { action: true, detail: true, actor: true, createdAt: true },
  });
  console.log(`--- ${action} (${rows.length} terakhir)`);
  for (const r of rows) console.log(`  [${r.createdAt.toISOString()}] ${r.actor}: ${r.detail}`);
}
await db.$disconnect();
