// SEMENTARA NR45 — hitung kode TOTP OWNER saat ini (dihapus setelah uji).
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

const user = await db.adminUser.findFirst({ where: { email: "admin@lumina.id" } });
if (!user?.totpSecret) {
  console.error("NO_TOTP_SECRET");
  process.exit(1);
}

// Base32 decode (RFC 4648, tanpa padding).
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const secret = base32Decode(user.totpSecret);
const counter = Math.floor(Date.now() / 30000);
const buf = Buffer.alloc(8);
buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
buf.writeUInt32BE(counter % 2 ** 32, 4);
const hmac = createHmac("sha1", secret).update(buf).digest();
const offset = hmac[hmac.length - 1] & 0x0f;
const code =
  (((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3]) %
  1_000_000;
console.log(String(code).padStart(6, "0"));
await db.$disconnect();
