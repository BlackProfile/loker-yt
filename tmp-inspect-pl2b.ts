import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const positions = await db.position.findMany({ where: { deletedAt: null }, select: { id: true, title: true, slug: true, department: true, reapplyCooldownDays: true, isActive: true }, orderBy: { order: "asc" } });
console.log("== POSITIONS ==");
for (const p of positions) console.log(`${p.id} | ${p.title} | slug=${p.slug} | dept=${p.department} | cooldown=${p.reapplyCooldownDays} | active=${p.isActive}`);
const apps = await db.application.findMany({
  where: { deletedAt: null, OR: [{ status: "REJECTED" }, { holdAt: { not: null } }, { talentPool: true }] },
  select: { id: true, name: true, email: true, status: true, positionId: true, talentPool: true, holdAt: true, rejectedAt: true, doNotHire: true, archivedAt: true, aiScore: true, rating: true, tags: true },
  take: 200,
});
console.log(`\n== CANDIDATE-POOL APPS (${apps.length}) ==`);
for (const a of apps) console.log(`${a.id} | ${a.name} | ${a.email} | status=${a.status} | pos=${a.positionId} | tp=${a.talentPool} | holdAt=${a.holdAt?.toISOString() ?? null} | rejAt=${a.rejectedAt?.toISOString() ?? null} | dnh=${a.doNotHire} | arch=${a.archivedAt ? "yes" : "no"} | ai=${a.aiScore} | rate=${a.rating} | tags=${a.tags}`);
const total = await db.application.count({ where: { deletedAt: null } });
console.log(`\ntotal active applications: ${total}`);
await db.$disconnect();
