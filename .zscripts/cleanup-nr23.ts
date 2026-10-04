// NR-23 — bersihkan lamaran & posisi uji + file fisik + notifikasi.
// Jalankan: bun .zscripts/cleanup-nr23.ts
import { PrismaClient } from "@prisma/client";
import { existsSync, unlinkSync } from "node:fs";
const db = new PrismaClient();

// 1. Lamaran uji
const apps = await db.application.findMany({
  where: { email: { in: ["uji.nr23@mail.com", "uji.nr23b@mail.com"] } },
});
for (const app of apps) {
  const extras = JSON.parse(app.extraDocs ?? "[]") as { fileId: string }[];
  const fileIds = [...extras.map((e) => e.fileId), app.cvFileId, app.introFileId].filter(Boolean) as string[];
  await db.notificationItem.deleteMany({ where: { applicationId: app.id } });
  await db.application.delete({ where: { id: app.id } });
  for (const fid of fileIds) {
    const f = await db.fileAsset.findUnique({ where: { id: fid } });
    if (f) {
      try { if (existsSync(f.path)) unlinkSync(f.path); } catch {}
      await db.fileAsset.delete({ where: { id: fid } });
    }
  }
}
console.log("lamaran uji terhapus:", apps.length);

// 2. Aktivitas log terkait (applicationId null tidak ada untuk submit; bersihkan detail uji bila ada)
const logs = await db.activityLog.deleteMany({
  where: { detail: { contains: "Uji NR-23" } },
});
console.log("log aktivitas uji terhapus:", logs.count);

// 3. Posisi uji (hard delete — belum dipakai lamaran lain)
const pos = await db.position.findUnique({ where: { slug: "uji-nr23" } });
if (pos) {
  await db.position.delete({ where: { id: pos.id } });
  console.log("posisi uji terhapus:", pos.id);
} else {
  console.log("posisi uji tidak ditemukan (sudah bersih)");
}

const posCount = await db.position.count({ where: { deletedAt: null } });
const appCount = await db.application.count();
console.log("sisa: posisi", posCount, "| lamaran", appCount);
await db.$disconnect();
