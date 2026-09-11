// GET /api/rss — feed RSS 2.0 berisi posisi lowongan yang sedang aktif (publik, tanpa auth).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { closeExpiredPositions, ensureSeeded, parseSiteContent } from "@/lib/seed";

export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(req: NextRequest) {
  try {
    await ensureSeeded();
    await closeExpiredPositions();

    const origin = new URL(req.url).origin;
    const [positions, siteSetting] = await Promise.all([
      db.position.findMany({
        where: { isActive: true, OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }] },
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      }),
      db.setting.findUnique({ where: { key: "site" } }),
    ]);
    const site = parseSiteContent(siteSetting?.value);

    const items = positions
      .map((position) => {
        const title = escapeXml(`${position.title} — ${position.department}`);
        const description = escapeXml(position.description);
        const link = escapeXml(`${origin}/`);
        const guid = escapeXml(position.id);
        const pubDate = position.createdAt.toUTCString();
        return [
          "    <item>",
          `      <title>${title}</title>`,
          `      <description>${description}</description>`,
          `      <link>${link}</link>`,
          `      <guid isPermaLink="false">${guid}</guid>`,
          `      <pubDate>${pubDate}</pubDate>`,
          "    </item>",
        ].join("\n");
      })
      .join("\n");

    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0">',
      "  <channel>",
      `    <title>${escapeXml(`${site.siteName} — Lowongan Kerja`)}</title>`,
      `    <link>${escapeXml(`${origin}/`)}</link>`,
      `    <description>${escapeXml(site.tagline)}</description>`,
      `    <language>id-ID</language>`,
      items,
      "  </channel>",
      "</rss>",
      "",
    ].join("\n");

    return new Response(xml, {
      status: 200,
      headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
    });
  } catch (error) {
    console.error("[GET /api/rss]", error);
    return new Response("Gagal memuat feed RSS.", { status: 500 });
  }
}
