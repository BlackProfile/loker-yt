import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const outbox = await db.emailOutbox.findMany({ where: { toEmail: "fajar.nugroho@mail.com" }, orderBy: { createdAt: "desc" }, take: 3 });
for (const o of outbox) console.log(`OUTBOX ${o.id} | kind=${o.kind} | status=${o.status} | app=${o.applicationId} | subj=${o.subject.slice(0,60)} | body[${o.body.length}]\n---\n${o.body.slice(0, 420)}\n---`);
const logs = await db.activityLog.findMany({ where: { applicationId: "cmuw6wyjg000jjay4dntdec4p", action: "TALENT_INVITE" }, orderBy: { createdAt: "desc" } });
for (const l of logs) console.log(`LOG ${l.id} | actor=${l.actor} | action=${l.action} | ${l.detail}`);
const notif = await db.notificationItem.findMany({ where: { title: { contains: "Undangan talent pool" } }, orderBy: { createdAt: "desc" }, take: 3 });
for (const n of notif) console.log(`NOTIF ${n.id} | ${n.title} | body=${n.body} | category=${n.category}`);
await db.$disconnect();
