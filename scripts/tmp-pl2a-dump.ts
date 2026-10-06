import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
async function main() {
  const rina = await db.application.findFirst({ where: { name: { contains: "Rina Nugroho" } } });
  if (rina) {
    console.log("RINA:", JSON.stringify({
      id: rina.id, code: rina.trackingCode, status: rina.status, offerStatus: rina.offerStatus,
      hiredAt: rina.hiredAt, probationEnd: rina.probationEnd, permanentAt: rina.permanentAt, exitAt: rina.exitAt,
      onboardingPlan: rina.onboardingPlan, offboardingPlan: rina.offboardingPlan, onboardingDocs: rina.onboardingDocs.slice(0, 80),
    }, null, 1));
  }
  const cards = await db.employeeCard.findMany({ include: { application: { select: { name: true } } } });
  for (const c of cards) console.log("CARD:", c.cardNumber, c.status, c.application?.name, "checklist:", c.checklistState);
  const wl = await db.positionWaitlist.findMany({ include: { position: { select: { title: true } } } });
  console.log("WAITLIST:", JSON.stringify(wl.map(w => ({ id: w.id, email: w.email, pos: w.position?.title ?? null, at: w.createdAt.toISOString() })), null, 1));
  const positions = await db.position.findMany({ where: { deletedAt: null }, select: { id: true, title: true, onboardingTemplate: true, agingWarnDays: true } });
  for (const p of positions) console.log("POS:", p.title, "| tmpl:", p.onboardingTemplate, "| aging:", p.agingWarnDays);
}
main().finally(() => process.exit(0));
