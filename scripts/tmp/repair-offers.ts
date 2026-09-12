import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
// Replay log: catat dulu siapa saja yang dibersihkan
const stale = await db.application.findMany({
  where: { status: "REJECTED", offerStatus: { not: null } },
  select: { id: true, name: true, offerStatus: true, trackingCode: true },
});
console.log("Stale records:", JSON.stringify(stale));
const res = await db.application.updateMany({
  where: { status: "REJECTED", offerStatus: { in: ["PENDING"] } },
  data: { offerStatus: null },
});
console.log("Repaired:", res.count);
// Log aktivitas agar jejak audit tersedia di admin
for (const app of stale.filter((s) => s.offerStatus === "PENDING")) {
  await db.activityLog.create({
    data: {
      applicationId: app.id,
      actor: "Sistem",
      action: "OFFER_CANCELLED",
      detail: "Perbaikan data: penawaran menggantung dibatalkan (lamaran sudah ditolak)",
    },
  });
}
const check = await db.application.findMany({
  where: { status: "REJECTED", offerStatus: { not: null } },
  select: { id: true, name: true, offerStatus: true },
});
console.log("Remaining REJECTED with offerStatus:", JSON.stringify(check));
await db.$disconnect();
