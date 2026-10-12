import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();
// 1) Reset 2FA OWNER sesuai keinginan user (2FA dimatikan)
const updated = await db.adminUser.update({
  where: { email: "admin@lumina.id" },
  data: { totpEnabled: false, totpSecret: null },
  select: { email: true, totpEnabled: true, totpSecret: true },
});
console.log("RESET:", JSON.stringify({ email: updated.email, totpEnabled: updated.totpEnabled, secret: updated.totpSecret }));
// 2) Bersihkan audit gagal login 30 menit terakhir milik OWNER (anti lockout)
const del = await db.loginAudit.deleteMany({
  where: { email: "admin@lumina.id", success: false, createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
});
console.log("AUDIT GAGAL DIHAPUS:", del.count);
// 3) Bersihkan sisa Setting pending_2fa_setup (jika ada)
const delSet = await db.setting.deleteMany({ where: { key: { startsWith: "pending_2fa_setup:" } } });
console.log("PENDING SETUP DIHAPUS:", delSet.count);
await db.$disconnect();
