const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");
const db = new PrismaClient();
const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function totpNow(secret) {
  let bits = "";
  for (const c of secret) { const v = A.indexOf(c); if (v < 0) return "?"; bits += v.toString(2).padStart(5, "0"); }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const buf = Buffer.from(bytes);
  const ctr = Math.floor(Date.now() / 30000);
  const cbuf = Buffer.alloc(8);
  cbuf.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0); cbuf.writeUInt32BE(ctr >>> 0, 4);
  const h = crypto.createHmac("sha1", buf).update(cbuf).digest();
  const o = h[19] & 0x0f;
  const code = ((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000;
  return code.toString().padStart(6, "0");
}
(async () => {
  const admin = await db.adminUser.findFirst({ where: { email: "admin@lumina.id" } });
  const row = await db.setting.findUnique({ where: { key: `pending_2fa_secret:${admin.id}` } });
  if (!row) { console.log("NO_SECRET"); return; }
  const { secret } = JSON.parse(row.value);
  console.log(JSON.stringify({ secret, code: totpNow(secret) }));
})().finally(() => db.$disconnect());
