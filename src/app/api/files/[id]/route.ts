// GET /api/files/[id] — unduh/pratinjau aset file (CV, audio intro). Butuh login admin (semua role).
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
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const asset = await db.fileAsset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: "File tidak ditemukan" }, { status: 404 });
    }

    const absolutePath = path.join(process.cwd(), asset.path);
    let buffer: Buffer;
    try {
      buffer = await readFile(absolutePath);
    } catch {
      return NextResponse.json({ error: "File tidak ditemukan di server" }, { status: 404 });
    }

    const isAudio = asset.mimeType.startsWith("audio/");
    const disposition = isAudio ? "inline" : "attachment";
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
