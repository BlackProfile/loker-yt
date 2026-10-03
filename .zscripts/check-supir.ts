import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
const p = await db.position.findUnique({ where: { slug: "supir-armada-operasional" } });
if (!p) {
  await Bun.write("/tmp/supir-check.json", "NOT_FOUND");
} else {
  const appCount = await db.application.count({ where: { positionId: p.id } });
  await Bun.write("/tmp/supir-check.json", JSON.stringify({
    id: p.id, title: p.title, workMode: p.workMode, city: p.city, shiftSystem: p.shiftSystem,
    salaryText: p.salaryText, salaryVisible: p.salaryVisible, salaryMin: p.salaryMin, salaryMax: p.salaryMax,
    urgent: p.urgent, featured: p.featured, applyOpen: p.applyOpen, isActive: p.isActive, order: p.order,
    nReq: JSON.parse(p.requirements).length, nFacilities: JSON.parse(p.facilities).length,
    nScreening: JSON.parse(p.screeningQuestions).length, nCustomDocs: JSON.parse(p.customDocs).length,
    stages: JSON.parse(p.stages), stageCategories: JSON.parse(p.stageCategories),
    nStageNotes: Object.keys(JSON.parse(p.stageNotes ?? "{}")).length,
    nRubric: JSON.parse(p.rubricCriteria).length, nChecklist: JSON.parse(p.checklistTemplate).length,
    nOnboardingDocs: JSON.parse(p.onboardingDocs).length, dailySlotQuota: p.dailySlotQuota,
    interviewMode: p.interviewMode, interviewDuration: p.interviewDuration,
    nRoundPlan: JSON.parse(p.roundPlan).length, autoShortlistScore: p.autoShortlistScore,
    autoShortlistStage: p.autoShortlistStage, nAI: (p.aiCriteria ?? "").length,
    hasApplyTpl: !!p.applyTemplate, hasInviteTpl: !!p.interviewInviteTemplate, hasOfferTpl: !!p.offerTemplate, hasWelcomeTpl: !!p.welcomeTemplate,
    hasTitleEn: !!p.titleEn, hasDescEn: !!p.descriptionEn, nReqEn: JSON.parse(p.requirementsEn).length,
    nMaps: !!p.mapsUrl, nAddr: !!p.address, workHours: p.workHours, appCount, probMonths: p.probationMonths,
  }, null, 2));
}
await db.$disconnect();
