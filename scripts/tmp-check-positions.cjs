const { createRequire } = require("module");
const req = createRequire("/home/z/my-project/");
const { PrismaClient } = req("@prisma/client");
const p = new PrismaClient();
(async () => {
  const pos = await p.position.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, isActive: true, applyOpen: true, aiCriteria: true, minAge: true, salaryMin: true, salaryMax: true },
    orderBy: { createdAt: "asc" },
  });
  for (const x of pos)
    console.log(
      [x.title.slice(0, 38), x.isActive && x.applyOpen ? "OPEN" : "closed", "crit:" + (x.aiCriteria ? "Y" : "N"), "minAge:" + (x.minAge || "-"), "sal:" + (x.salaryMin || "-") + "-" + (x.salaryMax || "-"), x.id].join(" | ")
    );
  await p.$disconnect();
})();
