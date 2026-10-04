import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const positions = await db.position.findMany({
  select: { id: true, title: true, department: true, workMode: true, city: true, isActive: true, applyOpen: true, urgent: true, salaryText: true, shiftSystem: true },
  orderBy: { order: "asc" },
});
const counts = await db.application.groupBy({ by: ["positionId"], _count: { _all: true } });
await Bun.write("/tmp/positions-out.json", JSON.stringify({ positions, counts }, null, 2));
await db.$disconnect();
console.log("OK");
