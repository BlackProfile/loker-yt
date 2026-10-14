// NR56 — POST /api/admin/files/bulk — hapus banyak berkas sekaligus (OWNER-only).
// Body: { ids: string[], confirm?: boolean }.
// Tanpa confirm=true: berkas yang MASIH dirujuk dilewati (skipped) — tidak ada
// yang dihapus separuhnya tanpa sepengetahuan pemanggil.
// Dengan confirm=true: referensi JSON/kolom non-FK dilepas dulu (detach), FK
// di-SetNull otomatis oleh Prisma, file fisik dibuang. Setiap berkas tercatat
// sebagai ActivityLog FILE_DELETED.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  collectFileRefs,
  detachFileReferences,
  isOrphan,
  unlinkAssetFiles,
  type FileRefDisplay,
} from "@/lib/file-refs";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER yang dapat mengelola berkas." };

const MAX_IDS = 500;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const body = (await req.json().catch(() => null)) as
      | { ids?: unknown; confirm?: unknown }
      | null;
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Tidak ada berkas yang dipilih." }, { status: 400 });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Maksimal ${MAX_IDS} berkas per aksi massal.` },
        { status: 400 },
      );
    }
    const confirm = body?.confirm === true;

    const [assets, refMap] = await Promise.all([
      db.fileAsset.findMany({
        where: { id: { in: ids } },
        select: { id: true, filename: true, kind: true, path: true, size: true },
      }),
      collectFileRefs(),
    ]);

    let deleted = 0;
    let freed = 0;
    const skipped: { id: string; filename: string; reason: string }[] = [];
    const missing = new Set(ids);
    const activityRows: { actor: string; action: string; detail: string }[] = [];

    for (const asset of assets) {
      missing.delete(asset.id);

      const rawRefs: FileRefDisplay | undefined = refMap.get(asset.id);
      const referenced = !isOrphan(rawRefs);
      if (referenced && !confirm) {
        skipped.push({
          id: asset.id,
          filename: asset.filename,
          reason: "Masih dipakai entri lain",
        });
        continue;
      }

      if (referenced) {
        await detachFileReferences(asset.id);
      }
      await db.fileAsset.delete({ where: { id: asset.id } });
      await unlinkAssetFiles(asset.path);
      deleted += 1;
      freed += asset.size;
      activityRows.push({
        actor: session.name,
        action: "FILE_DELETED",
        detail: `${session.name} menghapus berkas "${asset.filename}" (${asset.kind ?? "tanpa kategori"}) via aksi massal`,
      });
    }

    if (activityRows.length > 0) {
      await db.activityLog.createMany({ data: activityRows });
    }

    for (const id of missing) {
      skipped.push({ id, filename: id, reason: "Berkas tidak ditemukan" });
    }

    return NextResponse.json({ deleted, freed, skipped });
  } catch (error) {
    console.error("[POST /api/admin/files/bulk]", error);
    return NextResponse.json(
      { error: "Gagal menghapus berkas massal. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
