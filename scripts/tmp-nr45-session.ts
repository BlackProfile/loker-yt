// SEMENTARA NR45 — mint cookie sesi OWNER untuk uji curl (dihapus setelah uji).
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const SECRET = process.env.ADMIN_SECRET ?? "lumina-studio-secret-key";

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

const user = await db.adminUser.findFirst({ where: { email: "admin@lumina.id" } });
if (!user) {
  console.error("USER_NOT_FOUND");
  process.exit(1);
}
const expMs = (Date.now() + 60 * 60 * 1000).toString();
const payload = `${user.id}.${expMs}`;
console.log(`admin_session=${payload}.${sign(payload)}`);
await db.$disconnect();
