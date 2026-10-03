import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const rows = await db.position.findMany({ where: { deletedAt: null }, select: { title: true, order: true, featured: true, urgent: true }, orderBy: { order: "asc" } });
await Bun.write("/tmp/order.json", JSON.stringify(rows, null, 2));
await db.$disconnect();
console.log("OK");
