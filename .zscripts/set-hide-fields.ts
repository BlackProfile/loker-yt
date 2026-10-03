import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const slugs = ["supir-armada-operasional", "pembantu-operasional-studio", "pembantu-rumah-tangga"];
const res = await db.position.updateMany({
  where: { slug: { in: slugs } },
  data: { showCvField: false, showIntroField: false, showPortfolioField: false, showSocialField: false },
});
console.log("terupdate:", res.count, "posisi");
const check = await db.position.findMany({ where: { slug: { in: slugs } }, select: { title: true, showCvField: true, showIntroField: true, showPortfolioField: true, showSocialField: true } });
console.log(JSON.stringify(check));
await db.$disconnect();
