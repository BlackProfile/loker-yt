// SKRIP SEKALI PAKAI (Task 20-f) — uji end-to-end handler route reports tanpa dev server:
// mock cookies() dari next/headers dengan sesi valid, lalu panggil GET asli.
// Hapus setelah dipakai.
import { createHmac } from "node:crypto";
import { mock } from "bun:test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function makeToken(): Promise<string> {
  const owner = await db.adminUser.findFirst({
    where: { role: "OWNER", isActive: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("Tidak ada OWNER aktif");
  const secret = process.env.ADMIN_SECRET ?? "lumina-studio-secret-key";
  const expMs = (Date.now() + 60_000).toString();
  const payload = `${owner.id}.${expMs}`;
  const sign = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}.${sign}`;
}

const token = await makeToken();

mock.module("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => ({ name, value: token }),
  }),
}));

const { GET: funnelGET } = await import("../src/app/api/admin/reports/funnel/route.ts");
const { GET: sourcesGET } = await import("../src/app/api/admin/reports/sources/route.ts");
const { GET: aiGET } = await import("../src/app/api/admin/reports/ai-validation/route.ts");
const { NextRequest } = await import("next/server");

async function show(label: string, res: Response) {
  const body = await res.json();
  console.log(`\n=== ${label} (HTTP ${res.status}) ===`);
  console.log(JSON.stringify(body, null, 1));
}

const positions = await db.position.findMany({ select: { id: true, title: true } });

await show("funnel: semua posisi", await funnelGET(new NextRequest("http://localhost/api/admin/reports/funnel")));
for (const p of positions) {
  await show(`funnel: ${p.title}`, await funnelGET(new NextRequest(`http://localhost/api/admin/reports/funnel?positionId=${p.id}`)));
}
await show("sumber", await sourcesGET(new NextRequest("http://localhost/api/admin/reports/sources")));
await show("ai-validation", await aiGET(new NextRequest("http://localhost/api/admin/reports/ai-validation")));

// Cek 401 tanpa cookie
mock.module("next/headers", () => ({
  cookies: () => ({ get: () => undefined }),
}));
const mod401 = await import("../src/app/api/admin/reports/funnel/route.ts");
const res401 = await mod401.GET(new NextRequest("http://localhost/api/admin/reports/funnel"));
console.log(`\ntanpa sesi -> HTTP ${res401.status} (harap 401)`);

await db.$disconnect();
