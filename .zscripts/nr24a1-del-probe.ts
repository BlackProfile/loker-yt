import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const r = await db.application.deleteMany({ where: { email: { in: ["probe24@test.lumina", "probe-prisma@test.lumina"] } } });
  console.log("hapus probe:", r.count);
}
main().finally(() => db.$disconnect());
