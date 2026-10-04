// NR-24-a1 — probe prisma client: create + baca + hapus lamaran uji (proses segar).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const pos = await db.position.findFirst({ where: { deletedAt: null }, select: { id: true } });
  if (!pos) throw new Error("tidak ada posisi");
  const created = await db.application.create({
    data: {
      name: "Probe Prisma NR24",
      email: "probe-prisma@test.lumina",
      phone: "0800",
      positionId: pos.id,
      experience: "probe",
      motivation: "probe",
      trackingCode: "LM-PROBENR24",
      expectedSalary: 3500000,
    },
  });
  const read = await db.application.findUnique({ where: { id: created.id }, select: { expectedSalary: true, starredBy: true, holdReason: true } });
  console.log("CREATE OK", created.id, JSON.stringify(read));
  const call = await db.applicationCall.create({
    data: { applicationId: created.id, result: "DIANGGAT", summary: "probe", actor: "Probe" },
  });
  const assessment = await db.applicationAssessment.create({
    data: { applicationId: created.id, title: "probe", dueAt: new Date() },
  });
  console.log("SUBMODEL OK", call.id, assessment.id);
  await db.application.delete({ where: { id: created.id } });
  console.log("DELETE OK");
}

main()
  .catch((e) => {
    console.error("PROBE FAIL:", e.message.slice(0, 300));
    process.exit(1);
  })
  .finally(() => db.$disconnect());
