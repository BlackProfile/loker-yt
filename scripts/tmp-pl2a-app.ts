import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const posId = process.argv[2] ?? "";
  // Bersihkan sisa uji sebelumnya (aman diulang)
  await db.application.deleteMany({ where: { email: "pelamar@uji-pl2a.test" } });
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(0, 0, 0, 0); // 09.00 lokal bebas — pakai tengah malam UTC
  const app = await db.application.create({
    data: {
      name: "Uji PL2A Pelamar",
      email: "pelamar@uji-pl2a.test",
      phone: "081200000000",
      positionId: posId,
      experience: "Uji otomatis NR-40",
      motivation: "Uji otomatis NR-40",
      status: "INTERVIEW",
      trackingCode: "LM-PL2A01",
      offerStatus: "PENDING",
      offerSalary: "Rp 5.000.000/bulan",
      offerType: "Full-time",
      offerStartDate: start,
      offerNote: "Uji template onboarding",
      offerSentAt: new Date(),
      offerDeadline: new Date(Date.now() + 7 * 86400000),
      stageUpdatedAt: new Date(),
    },
  });
  console.log("APP id:", app.id, "| kode:", app.trackingCode, "| offerStartDate:", app.offerStartDate?.toISOString());
}
main().finally(() => process.exit(0));
