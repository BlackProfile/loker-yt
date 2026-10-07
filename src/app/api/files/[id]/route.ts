// GET /api/files/[id] — unduh/pratinjau aset file (CV, audio intro, cover posisi).
// Cover posisi (dipakai sebagai relasi coverFile di Position) bersifat PUBLIK agar
// gambar banner tampil di landing & metadata OG tanpa login. Berkas lain butuh login admin.
// NR41-SEC-B (E3):
// - Streaming (fs.createReadStream → Web ReadableStream) — tidak lagi memuat seluruh
//   berkas ke memori sebelum dikirim.
// - ETag `${size}-${mtimeMs}` + penanganan If-None-Match → 304 (hemat bandwidth).
// - Cache-Control: cover publik "public, max-age=86400"; dokumen privat (CV/dokumen)
//   "private, max-age=300".
// - Varian WebP: bila berkas punya varian `${path}.webp` di disk dan request Accept
//   mendukung WebP → kirim varian (ukuran content-length varian). Asli tidak berubah.
// - Content-Disposition: inline utk gambar/PDF/audio (+ ?inline=1), attachment lainnya.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

function asciiFilename(name: string): string {
  return name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
}

/** Browser mendukung WebP? (header Accept mengandung image/webp) */
function acceptsWebp(req: NextRequest): boolean {
  return (req.headers.get("accept") ?? "").toLowerCase().includes("image/webp");
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // E3 — negosiasi varian WebP: bila ada `${path}.webp` di disk & browser dukung → varian.
    const absolutePath = path.join(process.cwd(), asset.path);
    const webpVariantPath = `${absolutePath}.webp`;
    let servedPath = absolutePath;
    let servedMime = asset.mimeType;
    if (acceptsWebp(req) && isCover) {
      try {
        const webpStat = await stat(webpVariantPath);
        if (webpStat.isFile() && webpStat.size > 0) {
          servedPath = webpVariantPath;
          servedMime = "image/webp";
        }
      } catch {
        // Varian belum ada — pakai berkas asli.
      }
    }

    let fileStat;
    try {
      fileStat = await stat(servedPath);
    } catch {
      return NextResponse.json({ error: "File tidak ditemukan di server" }, { status: 404 });
    }
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "File tidak ditemukan di server" }, { status: 404 });
    }

    // E3 — ETag dari size + mtime; If-None-Match cocok → 304 tanpa body.
    const etag = `"${fileStat.size.toString(16)}-${Math.floor(fileStat.mtimeMs).toString(16)}"`;
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch.split(",").map((t) => t.trim()).includes(etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": isCover ? "public, max-age=86400" : "private, max-age=300",
        },
      });
    }

    // NR-36 — ?inline=1 memaksa pratinjau langsung di aplikasi (iframe dialog
    // admin "Lihat"). Default tetap attachment agar tombol Unduh tidak berubah;
    // audio & image memang selalu inline sejak awal; PDF juga inline (pratinjau).
    const forceInline = req.nextUrl.searchParams.get("inline") === "1";
    const isInline =
      forceInline ||
      servedMime.startsWith("audio/") ||
      servedMime.startsWith("image/") ||
      servedMime === "application/pdf";
    const disposition = isInline ? "inline" : "attachment";

    // E3 — streaming: Node Readable → Web ReadableStream (tanpa buffer penuh di memori).
    const nodeStream = createReadStream(servedPath);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": servedMime,
        "Content-Disposition": `${disposition}; filename="${asciiFilename(asset.filename)}"`,
        "Content-Length": String(fileStat.size),
        ETag: etag,
        // Cover publik boleh di-cache agresif; dokumen privat hanya 5 menit + privat.
        "Cache-Control": isCover ? "public, max-age=86400" : "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("[GET /api/files/[id]]", error);
    return NextResponse.json({ error: "Gagal memuat file. Coba lagi nanti." }, { status: 500 });
  }
}
