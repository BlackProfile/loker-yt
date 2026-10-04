import { PrismaClient } from "@prisma/client";
import { unlinkSync, existsSync } from "node:fs";
const db = new PrismaClient();
const app = await db.application.findFirst({ where: { email: "uji.supir@mail.com" }, include: { cvFile: true, introFile: true } });
if (!app) { console.log("tidak ada lamaran uji"); process.exit(0); }

// kumpulkan FileAsset dari extraDocs
const extras = JSON.parse(app.extraDocs ?? "[]") as { fileId: string }[];
const fileIds = [...extras.map(e => e.fileId), app.cvFileId, app.introFileId].filter(Boolean) as string[];

// notifikasi terkait
const notif = await db.notificationItem.deleteMany({ where: { applicationId: app.id } });
// hapus lamaran (cascade: ActivityLog, Comment, Interview, Question, CheckIn)
await db.application.delete({ where: { id: app.id } });
// hapus file assets + file fisik
for (const fid of fileIds) {
  const f = await db.fileAsset.findUnique({ where: { id: fid } });
  if (f) { try { if (existsSync(f.path)) unlinkSync(f.path); } catch {} await db.fileAsset.delete({ where: { id: fid } }); }
}
console.log("terhapus:", app.name, "| files:", fileIds.length, "| notif:", notif.count);
const pos = await db.position.count({ where: { deletedAt: null } });
const apps = await db.application.count();
console.log("sisa: posisi", pos, "| lamaran", apps);
await db.$disconnect();
