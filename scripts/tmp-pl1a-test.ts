// Skrip uji sementara PL-1a — buat 2 lamaran TEMP, uji bulk schedule-interview
// via HTTP, lalu data sementara DIBERSIHKAN. Jalankan: bun scripts/tmp-pl1a-test.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:81";

async function main() {
  // 1. Ambil posisi pertama untuk tempat uji.
  const position = await db.position.findFirst({ where: { deletedAt: null } });
  if (!position) throw new Error("Tidak ada posisi");

  // 2. Buat 2 lamaran sementara.
  const now = new Date();
  const app1 = await db.application.create({
    data: {
      name: "TEMP PL-1A Satu",
      email: "temp-pl1a-1@example.com",
      phone: "+628000000001",
      positionId: position.id,
      status: "NEW",
      trackingCode: "TEMP-PL1A1",
      experience: "-",
      motivation: "-",
      createdAt: now,
      stageUpdatedAt: new Date(now.getTime() - 9 * 86_400_000), // umur 9 hari -> rose
    },
  });
  const app2 = await db.application.create({
    data: {
      name: "TEMP PL-1A Dua",
      email: "temp-pl1a-2@example.com",
      phone: "+628000000002",
      positionId: position.id,
      status: "REVIEWED",
      trackingCode: "TEMP-PL1A2",
      experience: "-",
      motivation: "-",
      createdAt: now,
      stageUpdatedAt: new Date(now.getTime() - 2 * 86_400_000), // umur 2 hari -> hijau
    },
  });
  console.log("TEMP ids:", app1.id, app2.id);

  // 3. Login untuk cookie sesi.
  const loginRes = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "admin123" }),
  });
  const cookie = loginRes.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  console.log("login:", loginRes.status, (await loginRes.json()).ok);

  const post = async (body: unknown) =>
    fetch(`${BASE}/api/admin/applications/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });

  // 4. Uji validasi: scheduledAt tidak valid -> 400.
  const badRes = await post({ ids: [app1.id], action: "schedule-interview", scheduledAt: "bukan-tanggal" });
  console.log("invalid date ->", badRes.status, await badRes.json());

  // 5. Uji link tidak valid -> 400.
  const badLink = await post({
    ids: [app1.id],
    action: "schedule-interview",
    scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    meetingLink: "zoom.us/j/xxx",
  });
  console.log("invalid link ->", badLink.status, await badLink.json());

  // 6. Uji aksi valid ONLINE dua lamaran.
  const okRes = await post({
    ids: [app1.id, app2.id],
    action: "schedule-interview",
    scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    mode: "ONLINE",
    platform: "ZOOM",
    durationMin: 30,
    meetingLink: "https://zoom.us/j/test-pl1a",
    interviewers: "Rani, Dimas",
  });
  console.log("bulk online ->", okRes.status, await okRes.json());

  const iv1 = await db.interview.findMany({ where: { applicationId: { in: [app1.id, app2.id] } }, orderBy: { round: "asc" } });
  console.log("interviews:", iv1.map((i) => ({ app: i.applicationId.slice(-4), round: i.round, status: i.status, platform: i.platform, interviewers: i.interviewers })));

  const appsAfter = await db.application.findMany({ where: { id: { in: [app1.id, app2.id] } }, select: { id: true, interviewAt: true } });
  console.log("interviewAt set:", appsAfter.every((a) => a.interviewAt !== null));

  // 7. Uji ronde berikutnya: jalankan ulang -> round 2.
  const okRes2 = await post({
    ids: [app1.id],
    action: "schedule-interview",
    scheduledAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    mode: "ONSITE",
    address: "Kantor Uji PL-1A",
  });
  console.log("bulk onsite round2 ->", okRes2.status, await okRes2.json());
  const iv2 = await db.interview.findMany({ where: { applicationId: app1.id }, orderBy: { round: "asc" } });
  console.log("app1 rounds:", iv2.map((i) => ({ round: i.round, mode: i.mode, address: i.address })));

  // 8. Cek log & email undangan.
  const logs = await db.activityLog.findMany({ where: { applicationId: { in: [app1.id, app2.id] }, action: "INTERVIEW_SCHEDULED" } });
  console.log("activityLogs:", logs.length);
  const bulkLog = await db.activityLog.findFirst({ where: { action: "BULK_SCHEDULE_INTERVIEW" }, orderBy: { createdAt: "desc" } });
  console.log("bulkLog:", bulkLog?.detail);
  const emails = await db.emailOutbox.findMany({ where: { applicationId: { in: [app1.id, app2.id] }, kind: "INVITE" }, select: { toEmail: true, subject: true, kind: true, status: true } });
  console.log("invite emails:", emails);

  // 9. Bersihkan semua data sementara (interview, log, email, lamaran).
  await db.interview.deleteMany({ where: { applicationId: { in: [app1.id, app2.id] } } });
  await db.activityLog.deleteMany({ where: { applicationId: { in: [app1.id, app2.id] } } });
  await db.emailOutbox.deleteMany({ where: { applicationId: { in: [app1.id, app2.id] } } });
  await db.application.deleteMany({ where: { id: { in: [app1.id, app2.id] } } });
  await db.activityLog.deleteMany({ where: { action: "BULK_SCHEDULE_INTERVIEW", applicationId: null } });
  console.log("CLEANUP OK");
}

main()
  .catch((e) => {
    console.error("TEST ERROR:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
