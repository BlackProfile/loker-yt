import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const apps = await db.application.findMany({
  select: { name: true, trackingCode: true, status: true, offerStatus: true },
});
console.log(JSON.stringify(apps, null, 1));
await db.$disconnect();
