// SKRIP SEKALI PAKAI (Task 20-f) — cek asumsi data untuk laporan. Hapus setelah dipakai.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const total = await db.application.count();
  const logs = await db.activityLog.findMany({
    where: { action: "STATUS_CHANGE" },
    select: { detail: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: 400,
  });
  const withArrow = logs.filter((l) => (l.detail ?? "").includes("→")).length;
  const noArrow = logs.filter((l) => !(l.detail ?? "").includes("→"));
  console.log(JSON.stringify({ total, statusLogSamples: logs.length, withArrow, noArrowSamples: noArrow.slice(0, 6).map((l) => l.detail) }, null, 1));

  const statuses = await db.application.groupBy({ by: ["status"], _count: { _all: true } });
  console.log("statuses:", JSON.stringify(statuses.map((s) => ({ s: s.status, n: s._count._all }))));

  const src = await db.application.findMany({
    select: { source: true, utmSource: true, utmCampaign: true, referrer: true, aiScore: true, status: true },
  });
  console.log("source samples:", JSON.stringify(src.slice(0, 5).map((r) => ({ s: r.source, u: r.utmSource, c: r.utmCampaign, r: r.referrer }))));
  console.log(
    "aiScore final:",
    JSON.stringify({
      scored: src.filter((r) => r.aiScore != null).length,
      accepted: src.filter((r) => r.aiScore != null && r.status === "ACCEPTED").length,
      rejected: src.filter((r) => r.aiScore != null && r.status === "REJECTED").length,
    })
  );
}

main().finally(() => db.$disconnect());
