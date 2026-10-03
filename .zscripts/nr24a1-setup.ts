// NR-24-a1 — setup uji: pasang Setting "doNotHire" berisi email & nomor uji.
// Dibersihkan lagi oleh cleanup-nr24a1.ts.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const value = JSON.stringify({
    "nr24a1@test.lumina": { reason: "uji nr24", by: "Pemilik Studio", at: "2026-01-01T00:00:00.000Z" },
    "6281299900011": { reason: "uji nr24 telepon", by: "Pemilik Studio", at: "2026-01-01T00:00:00.000Z" },
  });
  await db.setting.upsert({
    where: { key: "doNotHire" },
    update: { value },
    create: { key: "doNotHire", value },
  });
  console.log("Setting doNotHire terpasang (email nr24a1@test.lumina + telepon 6281299900011)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
