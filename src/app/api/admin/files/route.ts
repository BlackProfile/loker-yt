// NR56 — GET /api/admin/files — daftar seluruh FileAsset untuk Pusat Kelola Berkas.
// Semua role admin boleh melihat (VIEWER pun), mutasi ada di route terpisah.
// Setiap item disertai referensi pemakaiannya (lamaran/posisi/tugas uji/dokumen
// internal/draft/rekaman) + flag orphan (tidak dirujuk & bukan arsip OFFER_PDF).
// Client yang melakukan filter/sort/pencarian — route ini mengirim data mentah
// (maks 1000 berkas terbaru) agar UI responsif tanpa round-trip.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { collectFileRefs, isOrphan } from "@/lib/file-refs";
import type { AdminFileItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

const MAX_ITEMS = 1000;

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const [assets, refMap] = await Promise.all([
      db.fileAsset.findMany({
        orderBy: { createdAt: "desc" },
        take: MAX_ITEMS,
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          kind: true,
          createdAt: true,
        },
      }),
      collectFileRefs(),
    ]);

    const items: AdminFileItem[] = assets.map((asset) => {
      const refs = refMap.get(asset.id);
      const orphan = asset.kind === "OFFER_PDF" ? false : isOrphan(refs);
      return {
        id: asset.id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size,
        kind: asset.kind,
        createdAt: asset.createdAt.toISOString(),
        orphan,
        refs: refs
          ? {
              applications: refs.applications,
              positions: refs.positions,
              assessments: refs.assessments,
              internalDocs: refs.internalDocs,
              drafts: refs.drafts,
              interviews: refs.interviews,
            }
          : {
              applications: [],
              positions: [],
              assessments: [],
              internalDocs: [],
              drafts: [],
              interviews: 0,
            },
      };
    });

    return NextResponse.json({ items });
  } catch (error) {
    console.error("[GET /api/admin/files]", error);
    return NextResponse.json(
      { error: "Gagal memuat daftar berkas. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
