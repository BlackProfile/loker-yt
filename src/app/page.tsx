// Halaman utama (server component): satu-satunya route /.
// Metadata SEO & OpenGraph dinamis per posisi lowongan (?posisi=slug) digenerate di sini,
// sedangkan seluruh interaksi (landing/admin/embed) berjalan di client (HomeView).
import type { Metadata } from "next";
import { db } from "@/lib/db";
import type { MaintenancePublicInfo } from "@/lib/types";
import { HomeView } from "@/components/home-view";
import { PreviewBanner } from "@/components/landing/preview-banner";

export const dynamic = "force-dynamic";

type SearchParams = { posisi?: string | string[]; preview?: string | string[] };

function firstSlug(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim();
  return slug.length > 0 ? slug.slice(0, 80) : null;
}

// NR45 — baca Setting "maintenance" (JSON toleran) untuk snapshot mode perawatan
// yang dikirim ke klien sebelum konten publik siap: situs yang ditutup FULL
// tampil sebagai layar perawatan tanpa berkedip terbuka. Gagal baca = undefined
// (mode perawatan dianggap tidak aktif — halaman publik tidak boleh gagal keras).
async function readInitialMaintenance(): Promise<MaintenancePublicInfo | undefined> {
  try {
    const row = await db.setting.findUnique({ where: { key: "maintenance" } });
    if (!row) return undefined;
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const obj = parsed as Record<string, unknown>;
    const enabled = obj.enabled === true;
    const level = obj.level === "APPLY_ONLY" ? "APPLY_ONLY" : "FULL";
    const message = typeof obj.message === "string" ? obj.message.slice(0, 300) : "";
    return { enabled, level, message };
  } catch {
    return undefined;
  }
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const params = await searchParams;
  const slug = firstSlug(params.posisi);
  if (!slug) {
    // NR-41 J24 — kanonik & varian bahasa untuk landing (basis) — pola URL
    // bahasa: / (ID, bawaan) dan /?lang=en (EN).
    return {
      alternates: {
        canonical: "/",
        languages: { id: "/", en: "/?lang=en" },
      },
    };
  }

  try {
    const position = await db.position.findUnique({ where: { slug } });
    if (!position || !position.isActive) {
      return {
        alternates: {
          canonical: "/",
          languages: { id: "/", en: "/?lang=en" },
        },
      };
    }

    const description =
      position.description.length > 155
        ? `${position.description.slice(0, 152)}...`
        : position.description;
    const title = `Lowongan ${position.title} — Lumina Studio`;
    const images = position.coverFileId
      ? [{ url: `/api/files/${position.coverFileId}`, width: 1344, height: 768 }]
      : [{ url: `/api/og?posisi=${slug}`, width: 1200, height: 630 }];
    // NR-41 J24 — kanonik & varian bahasa mengikuti pola URL posisi (?posisi=slug).
    const positionUrl = `/?posisi=${encodeURIComponent(slug)}`;

    return {
      title,
      description,
      alternates: {
        canonical: positionUrl,
        languages: {
          id: positionUrl,
          en: `${positionUrl}&lang=en`,
        },
      },
      openGraph: {
        title,
        description,
        siteName: "Lumina Studio",
        type: "article",
        ...(images ? { images } : {}),
      },
      twitter: { card: "summary_large_image", title, description },
    };
  } catch {
    return {};
  }
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const initialPosisiSlug = firstSlug(params.posisi);
  const initialMaintenance = await readInitialMaintenance();
  return (
    <>
      <PreviewBanner enabled={params.preview === "1"} />
      <HomeView
        initialPosisiSlug={initialPosisiSlug}
        initialMaintenance={initialMaintenance}
      />
    </>
  );
}
