/**
 * NR-24 cleanup — hapus seluruh jejak uji "fitur per pelamar":
 * - Lamaran uji (LM-F9E77B, LM-K83O9S, LM-N6FQP4) + relasi cascade
 * - FileAsset milik extraDocs/internalDocs + berkas fisik di uploads/
 * - EmailOutbox uji (tujuan uji.nr24@mail.com / uji.cekkolom@mail.com)
 * - Pastikan Setting doNotHire kosong & tagList tanpa "uji-nr24"
 */
import { PrismaClient } from "@prisma/client";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const db = new PrismaClient();
const CODES = ["LM-F9E77B", "LM-K83O9S", "LM-N6FQP4"];
const TEST_EMAILS = ["uji.nr24@mail.com", "uji.cekkolom@mail.com"];

function filePathOf(asset: { path: string }): string | null {
  // path di DB berupa "/uploads/xxx" atau "uploads/xxx" atau "xxx"
  const rel = asset.path.replace(/^\//, "");
  const candidates = [
    join(process.cwd(), rel),
    join(process.cwd(), "public", rel),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function main() {
  const apps = await db.application.findMany({
    where: { trackingCode: { in: CODES } },
    include: { internalDocs: true },
  });
  console.log("Lamaran uji ditemukan:", apps.map((a) => a.trackingCode).join(", "));

  // Kumpulkan fileId dari extraDocs sebelum hapus
  const fileIds = new Set<string>();
  for (const app of apps) {
    for (const doc of app.internalDocs) fileIds.add(doc.fileId);
    try {
      const extra = JSON.parse(app.extraDocs ?? "[]") as { fileId?: string }[];
      for (const e of extra) if (e.fileId) fileIds.add(e.fileId);
    } catch {
      /* abaikan */
    }
    if (app.cvFileId) fileIds.add(app.cvFileId);
    if (app.introFileId) fileIds.add(app.introFileId);
  }

  // Hapus lamaran (cascade: calls, assessments, internalDocs, comments, questions,
  // activityLogs, checkIns, interviews, botFiles ikut kolom)
  for (const app of apps) {
    await db.application.delete({ where: { id: app.id } });
    console.log("Terhapus:", app.trackingCode, app.name);
  }

  // Hapus FileAsset + berkas fisik
  for (const fid of fileIds) {
    const asset = await db.fileAsset.findUnique({ where: { id: fid } });
    if (!asset) continue;
    const p = filePathOf(asset);
    if (p) {
      try {
        unlinkSync(p);
        console.log("Berkas fisik dihapus:", p);
      } catch {
        console.log("Berkas fisik tidak ketemu:", p);
      }
    }
    await db.fileAsset.delete({ where: { id: fid } });
    console.log("FileAsset dihapus:", asset.filename);
  }

  // Email uji (applicationId sudah SetNull setelah delete lamaran)
  const mails = await db.emailOutbox.deleteMany({
    where: { toEmail: { in: TEST_EMAILS } },
  });
  console.log("EmailOutbox uji dihapus:", mails.count);

  // Notifikasi uji yang menunjuk lamaran terhapus (applicationId null, teks uji)
  const notifs = await db.notificationItem.deleteMany({
    where: { OR: [{ title: { contains: "uji.nr24" } }, { body: { contains: "uji.nr24" } }, { body: { contains: "Uji NR-24" } }] },
  });
  console.log("NotificationItem uji dihapus:", notifs.count);

  // Setting doNotHire → kosongkan entri uji
  const dnh = await db.setting.findUnique({ where: { key: "doNotHire" } });
  if (dnh) {
    const map = JSON.parse(dnh.value) as Record<string, unknown>;
    let changed = false;
    for (const k of Object.keys(map)) {
      if (TEST_EMAILS.some((e) => k.includes(e.split("@")[0])) || k.includes("628199990001") || k.includes("628188880002")) {
        delete map[k];
        changed = true;
      }
    }
    if (changed) {
      await db.setting.update({ where: { key: "doNotHire" }, data: { value: JSON.stringify(map) } });
      console.log("doNotHire dibersihkan");
    }
  }

  // tagList → buang tag uji
  const tags = await db.setting.findUnique({ where: { key: "tagList" } });
  if (tags) {
    const list = (JSON.parse(tags.value) as string[]).filter((t) => t !== "uji-nr24");
    await db.setting.update({ where: { key: "tagList" }, data: { value: JSON.stringify(list) } });
    console.log("tagList dibersihkan:", list.join(", "));
  }

  // Verifikasi akhir
  const remaining = await db.application.count({ where: { deletedAt: null } });
  const positions = await db.position.count({ where: { deletedAt: null, isActive: true } });
  const assets = await db.fileAsset.count();
  console.log(`Sisa lamaran aktif: ${remaining} (harap 5) | posisi aktif: ${positions} (harap 8/9) | fileAsset: ${assets}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
