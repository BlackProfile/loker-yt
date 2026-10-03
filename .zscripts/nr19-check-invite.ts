import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const u = await db.adminUser.findUnique({ where: { email: "qa.nr19@lumina.id" } });
const o = await db.emailOutbox.findFirst({ where: { toEmail: "qa.nr19@lumina.id" }, orderBy: { createdAt: "desc" } });
console.log("USER:", u ? `${u.email} role=${u.role} inviteToken=${u.inviteToken ? "ADA" : "null"} exp=${u.inviteExpiresAt?.toISOString()}` : "TIDAK ADA");
console.log("OUTBOX:", o ? `${o.kind} ${o.status} | ${o.subject} | link=${o.body.includes("/#admin/invite?token=")}` : "-");
