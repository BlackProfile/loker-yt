import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const u = await db.adminUser.deleteMany({ where: { email: "qa.nr19@lumina.id" } });
const o = await db.emailOutbox.deleteMany({ where: { toEmail: "qa.nr19@lumina.id" } });
console.log("deleted user:", u.count, "outbox:", o.count);
await db.$disconnect();
