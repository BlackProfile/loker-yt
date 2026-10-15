const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
(async () => {
  const total = await db.application.count();
  const byPos = await db.application.groupBy({
    by: ['positionId'],
    _count: { positionId: true },
    orderBy: { _count: { positionId: 'desc' } },
    take: 6,
  });
  const posIds = byPos.map((b) => b.positionId);
  const positions = await db.position.findMany({
    where: { id: { in: posIds } },
    select: { id: true, title: true },
  });
  const ivs = await db.interview.count();
  console.log('TOTAL applications:', total, '| interviews:', ivs);
  for (const b of byPos) {
    const p = positions.find((x) => x.id === b.positionId);
    console.log(' -', (p ? p.title : b.positionId).slice(0, 44), '=>', b._count.positionId);
  }
  const byStatus = await db.application.groupBy({ by: ['status'], _count: { status: true } });
  console.log(
    'byStatus:',
    byStatus.map((s) => `${s.status}=${s._count.status}`).join(', ')
  );
  await db.$disconnect();
})()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
