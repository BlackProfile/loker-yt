import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const posId = process.argv[2] ?? "";
  const vePos = await db.position.findFirst({ where: { title: "Video Editor", deletedAt: null }, select: { id: true } });
  await db.positionWaitlist.deleteMany({ where: { email: { contains: "@uji-pl2a.test" } } });
  await db.positionWaitlist.createMany({
    data: [
      { email: "satu@uji-pl2a.test", positionId: posId },
      { email: "dua@uji-pl2a.test", positionId: posId },
      { email: "tiga@uji-pl2a.test", positionId: vePos?.id ?? null },
    ],
  });
  console.log("seeded 3 entri uji");
}
main().finally(() => process.exit(0));
