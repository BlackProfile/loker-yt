// Cleanup data uji NR-19-e — kembalikan DB persis ke kondisi sebelum uji.
// Membaca /tmp/nr19e-before.json (state awal pelamar) + /tmp/nr19e-test-ids.json (ID uji).
// Membersihkan: interview uji, slot uji, webhook endpoint uji, activity log & notification
// uji (sejak waktu mulai), serta mengembalikan field offer*/interviewAt pelamar target.
// Jalankan: bun run .zscripts/test-nr19e-cleanup.ts
import { db } from "../src/lib/db";
import { readFileSync } from "fs";

const before = JSON.parse(readFileSync("/tmp/nr19e-before.json", "utf8")) as {
  rizky: Record<string, unknown>;
  bagas: Record<string, unknown>;
};
const ids = JSON.parse(readFileSync("/tmp/nr19e-test-ids.json", "utf8")) as {
  epA: string; epB: string; interviews: string[]; slotId: string; apps: string[]; startedAt: string;
};
const startedAt = new Date(ids.startedAt);

// 1. Hapus sesi wawancara uji (admin + dari slot booking)
let delIv = 0;
for (const ivId of ids.interviews) {
  if (ivId && ivId !== "null") {
    await db.interview.deleteMany({ where: { id: ivId } });
    delIv++;
  }
}
console.log(`interview uji dihapus: ${delIv}`);

// 2. Hapus slot uji (bila masih ada)
const delSlot = await db.interviewSlot.deleteMany({ where: { id: ids.slotId } });
console.log(`slot uji dihapus: ${delSlot.count}`);

// 3. Hapus webhook endpoint uji
const delEp = await db.webhookEndpoint.deleteMany({ where: { id: { in: [ids.epA, ids.epB] } } });
console.log(`webhook endpoint uji dihapus: ${delEp.count}`);

// 4. Hapus activity log & notification uji (hanya yang dibuat sejak mulai uji, milik aplikasi target)
const delLogs = await db.activityLog.deleteMany({
  where: { applicationId: { in: ids.apps }, createdAt: { gte: startedAt } },
});
// Log tanpa applicationId dari pembukaan slot uji (action SLOT_CREATED).
const delLogsSlot = await db.activityLog.deleteMany({
  where: { applicationId: null, action: "SLOT_CREATED", createdAt: { gte: startedAt } },
});
const delNotes = await db.notificationItem.deleteMany({
  where: { applicationId: { in: ids.apps }, createdAt: { gte: startedAt } },
});
console.log(`activityLog uji dihapus: ${delLogs.count + delLogsSlot.count}; notificationItem uji dihapus: ${delNotes.count}`);

// 5. Pulihkan field offer*/interviewAt pelamar target ke nilai awal
type AppBefore = {
  id: string; offerStatus: string | null; offerType: string | null; offerSalary: string | null;
  offerStartDate: Date | null; offerNote: string | null; offerDeadline: Date | null;
  offerSentAt: Date | null; offerRespondedAt: Date | null; offerDeclineReason: string | null; interviewAt: Date | null;
};
for (const b of [before.rizky, before.bagas] as AppBefore[]) {
  await db.application.update({
    where: { id: b.id },
    data: {
      offerStatus: b.offerStatus,
      offerType: b.offerType,
      offerSalary: b.offerSalary,
      offerStartDate: b.offerStartDate,
      offerNote: b.offerNote,
      offerDeadline: b.offerDeadline,
      offerSentAt: b.offerSentAt,
      offerRespondedAt: b.offerRespondedAt,
      offerDeclineReason: b.offerDeclineReason,
      interviewAt: b.interviewAt,
    },
  });
}
console.log("field offer*/interviewAt pelamar dipulihkan ke nilai awal");

// 6. Verifikasi akhir
const rizky = await db.application.findUnique({ where: { id: before.rizky.id as string } });
const bagas = await db.application.findUnique({ where: { id: before.bagas.id as string } });
const ivLeft = await db.interview.count();
const slotLeft = await db.interviewSlot.count();
const epLeft = await db.webhookEndpoint.count();
const logLeft = await db.activityLog.count();
const noteLeft = await db.notificationItem.count();
console.log("\n== VERIFIKASI AKHIR ==");
console.log(`rizky: offerStatus=${rizky?.offerStatus} offerSalary=${rizky?.offerSalary} offerSentAt=${rizky?.offerSentAt}`);
console.log(`bagas: offerStatus=${bagas?.offerStatus} interviewAt=${bagas?.interviewAt?.toISOString()}`);
console.log(`sisa: interviews=${ivLeft} slots=${slotLeft} webhookEndpoints=${epLeft} activityLogs=${logLeft} notifications=${noteLeft}`);
process.exit(0);
