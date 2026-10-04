// NR-23 — posisi uji untuk Form Builder tanpa "bawaan" + kunci anti-hapus.
// Idempoten: perbarui bila slug sudah ada. Jalankan: bun .zscripts/add-nr23.ts
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const data = {
  title: "Uji NR-23",
  slug: "uji-nr23",
  department: "Uji",
  type: "FULL_TIME",
  location: "Jakarta",
  workMode: "REMOTE",
  workHours: "Senin-Jumat 09.00-17.00",
  shiftSystem: "NONE",
  description: "Posisi uji NR-23 — form builder tanpa bagian bawaan.",
  requirements: JSON.stringify(["Bersedia jadi kelinci uji"]),
  facilities: JSON.stringify([]),
  salaryText: "Rp 1 - 1 jt",
  salaryVisible: true,
  order: 99,
  isActive: true,
  applyOpen: true,
  screeningQuestions: JSON.stringify([]),
  customDocs: JSON.stringify([]),
  requireCv: false,
  requireIntro: false,
  requirePortfolio: false,
};

const existing = await db.position.findUnique({ where: { slug: "uji-nr23" } });
if (existing) {
  await db.position.update({ where: { slug: "uji-nr23" }, data });
  console.log("diperbarui:", existing.id);
} else {
  const created = await db.position.create({ data });
  console.log("dibuat:", created.id);
}
const total = await db.position.count({ where: { deletedAt: null } });
console.log("total posisi aktif:", total);
await db.$disconnect();
