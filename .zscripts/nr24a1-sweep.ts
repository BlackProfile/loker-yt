// NR-24-a1 — sweep final: hapus SEMUA lamaran uji (email mengandung nr24a1, case-insensitive)
// beserta notifikasinya; pastikan Setting doNotHire hilang.
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const apps = await db.application.findMany({
    where: { email: { contains: "nr24a1" } },
    select: { id: true, email: true },
  });
  for (const app of apps) {
    const n = await db.notificationItem.deleteMany({ where: { applicationId: app.id } });
    await db.application.delete({ where: { id: app.id } });
    console.log(`hapus ${app.email} (${app.id}) notif=${n.count}`);
  }
  const s = await db.setting.deleteMany({ where: { key: "doNotHire" } });
  console.log(`setting doNotHire x${s.count}`);
  const remain = await db.application.count({ where: { email: { contains: "nr24a1" } } });
  const logs = await db.activityLog.count({ where: { action: "DNH_WARNING" } });
  const followupLogs = await db.activityLog.count({ where: { action: "FOLLOWUP_REMIND" } });
  console.log(`sisa lamaran uji=${remain}, sisa log DNH=${logs}, sisa log FOLLOWUP_REMIND=${followupLogs}`);
}
main().catch((e)=>{console.error(e);process.exit(1);}).finally(()=>db.$disconnect());
