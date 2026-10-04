import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const app = await db.application.findFirst({
  where: { email: "uji.supir@mail.com" },
  select: { id: true, name: true, status: true, aiScore: true, aiSummary: true, aiRecommendation: true, screeningAnswers: true, domisili: true, komuterPlan: true, shiftPref: true, extraDocs: true, trackingCode: true },
});
const logs = app ? await db.activityLog.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" }, select: { actor: true, action: true, detail: true } }) : [];
await Bun.write("/tmp/app-check.json", JSON.stringify({ app, logs }, null, 2));
await db.$disconnect();
