import { PrismaClient } from "@prisma/client";
import { unlinkSync, existsSync } from "node:fs";
const db = new PrismaClient();
const apps = await db.application.findMany({ where: { email: { in: ["uji.sembunyi@mail.com", "uji.kreatif@mail.com"] } } });
for (const app of apps) {
  const extras = JSON.parse(app.extraDocs ?? "[]") as { fileId: string }[];
  const fileIds = [...extras.map(e => e.fileId), app.cvFileId, app.introFileId].filter(Boolean) as string[];
  await db.notificationItem.deleteMany({ where: { applicationId: app.id } });
  await db.application.delete({ where: { id: app.id } });
  for (const fid of fileIds) {
    const f = await db.fileAsset.findUnique({ where: { id: fid } });
    if (f) { try { if (existsSync(f.path)) unlinkSync(f.path); } catch {} await db.fileAsset.delete({ where: { id: fid } }); }
  }
}
console.log("terhapus:", apps.length);
const pos = await db.position.count({ where: { deletedAt: null } });
const appCount = await db.application.count();
console.log("sisa: posisi", pos, "| lamaran", appCount);
await db.$disconnect();
