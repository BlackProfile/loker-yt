// NR-24-a1 — cleanup penuh data uji: lamaran uji, notifikasi, Setting doNotHire,
// dan log terkait (log lamaran ikut terhapus via onDelete: Cascade).
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const TEST_EMAILS = ["nr24a1@test.lumina", "nr24a1+2@test.lumina"];

async function main() {
  const apps = await db.application.findMany({
    where: { OR: [{ email: { in: TEST_EMAILS } }, { email: "nr24a1@test.lumina" }] },
    select: { id: true, email: true, name: true },
  });
  for (const app of apps) {
    // NotificationItem tidak punya FK — hapus manual.
    const notif = await db.notificationItem.deleteMany({ where: { applicationId: app.id } });
    // FileAsset lamaran uji (bila ada) ikut dibersihkan.
    const record = await db.application.findUnique({
      where: { id: app.id },
      select: { cvFileId: true, introFileId: true, extraDocs: true },
    });
    const fileIds = new Set<string>();
    if (record?.cvFileId) fileIds.add(record.cvFileId);
    if (record?.introFileId) fileIds.add(record.introFileId);
    try {
      const extras: unknown = JSON.parse(record?.extraDocs ?? "[]");
      if (Array.isArray(extras)) {
        for (const item of extras as Record<string, unknown>[]) {
          if (typeof item?.fileId === "string") fileIds.add(item.fileId);
        }
      }
    } catch { /* abaikan */ }
    const deleted = await db.application.delete({ where: { id: app.id } });
    let files = 0;
    for (const fileId of fileIds) {
      const r = await db.fileAsset.deleteMany({ where: { id: fileId } });
      files += r.count;
    }
    console.log(`hapus lamaran ${app.email} (${deleted.id}) notif=${notif.count} files=${files}`);
  }

  const setting = await db.setting.deleteMany({ where: { key: "doNotHire" } });
  console.log(`hapus Setting doNotHire x${setting.count}`);

  // Bersihan log mingguan/kron uji lain TIDAK disentuh — hanya jejak lamaran uji.
  const remain = await db.application.count({ where: { email: { in: TEST_EMAILS } } });
  console.log(`sisa lamaran uji: ${remain}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
