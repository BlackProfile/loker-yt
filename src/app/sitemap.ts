// Sitemap dinamis: landing page + semua posisi aktif (/?posisi=<slug>).
// Di-query langsung dari database agar slug & tanggal selalu mutakhir.
import type { MetadataRoute } from "next";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

function getBaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  if (!raw) return "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getBaseUrl();
  const landingEntry: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];

  try {
    const positions = await db.position.findMany({
      where: { isActive: true, deletedAt: null, slug: { not: null } },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });

    const positionEntries: MetadataRoute.Sitemap = positions
      .filter((p): p is { slug: string; updatedAt: Date } => typeof p.slug === "string" && p.slug.length > 0)
      .map((p) => ({
        url: `${base}/?posisi=${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: "weekly",
        priority: 0.8,
      }));

    return [...landingEntry, ...positionEntries];
  } catch {
    // Bila database gagal dijangkau, sitemap tetap valid dengan landing saja.
    return landingEntry;
  }
}
