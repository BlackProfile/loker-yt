// GET /api/files/[id] — unduh/pratinjau aset file (CV, audio intro, cover posisi).
// Cover posisi (dipakai sebagai relasi coverFile di Position) bersifat PUBLIK agar
// gambar banner tampil di landing & metadata OG tanpa login. Berkas lain butuh login admin.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const asset = await db.fileAsset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }

    // File cover posisi bersifat publik (dipakai landing & OpenGraph); lainnya butuh sesi admin.
    const isCover = await db.position.findFirst({
      where: { coverFileId: asset.id },
      select: { id: true },
    });
    if (!isCover) {
      const session = await getSession();
      if (!session) {
        return NextResponse.json(UNAUTHORIZED, { status: 401 });
      }
    }

    const absolutePath = path.join(process.cwd(), asset.path);
    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch {
      return NextResponse.json({ error: "File tidak ditemukan di server" }, { status: 404 });
    }

    const isInline = asset.mimeType.startsWith("audio/") || asset.mimeType.startsWith("image/");
    const disposition = isInline ? "inline" : "attachment";
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Disposition": `${disposition}; filename="${asciiFilename(asset.filename)}"`,
        "Content-Length": String(buffer.byteLength),
      },
    });
  } catch (error) {
    console.error("[GET /api/files/[id]]", error);
    return NextResponse.json({ error: "Gagal memuat file. Coba lagi nanti." }, { status: 500 });
  }
}
