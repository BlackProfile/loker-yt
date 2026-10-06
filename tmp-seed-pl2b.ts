import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const now = new Date();
// 1. Kandidat do-not-hire (REJECTED, posisi Video Editor)
const dnh = await db.application.create({ data: {
  name: "Uji DoNotHire PL2B", email: "uji.dnh.pl2b@mail.com", phone: "081000000001",
  positionId: "cmuw6wyir0005jay4shqf8s0o", experience: "-", motivation: "-", status: "REJECTED",
  rejectedAt: new Date(now.getTime() - 10 * 86400000), talentPool: true, doNotHire: true,
  doNotHireReason: "LAINNYA", doNotHireNoteTest: undefined as never,
}});
// perbaiki: schema tidak punya doNotHireNoteTest
console.log("dnh", dnh.id);
// 2. Kandidat cooldown (REJECTED 1 hari lalu dari Video Editor, talentPool)
const cd = await db.application.create({ data: {
  name: "Uji Cooldown PL2B", email: "uji.cd.pl2b@mail.com", phone: "081000000002",
  positionId: "cmuw6wyir0005jay4shqf8s0o", experience: "-", motivation: "-", status: "REJECTED",
  rejectedAt: new Date(now.getTime() - 1 * 86400000), talentPool: true,
}});
console.log("cd", cd.id);
// 3. Kandidat HOLD (INTERVIEW + holdAt, posisi Thumbnail Designer)
const hd = await db.application.create({ data: {
  name: "Uji Hold PL2B", email: "uji.hold.pl2b@mail.com", phone: "081000000003",
  positionId: "cmuw6wyiv0006jay4ngxf3qf8", experience: "-", motivation: "-", status: "INTERVIEW",
  holdAt: new Date(now.getTime() - 2 * 86400000), holdReason: "SLOT_PENUH",
}});
console.log("hold", hd.id);
// Cooldown Video Editor 14 hari (SEMENTARA — dipulihkan ke 0 setelah uji)
await db.position.update({ where: { id: "cmuw6wyir0005jay4shqf8s0o" }, data: { reapplyCooldownDays: 14 } });
console.log("cooldown Video Editor -> 14 (sementara)");
await db.$disconnect();
