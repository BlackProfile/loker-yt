// GET /api/admin/backup — unduh salinan biner file database SQLite (OWNER saja).
// Membaca db file dari DATABASE_URL (mis. "file:/home/z/my-project/db/custom.db")
// dan mengembalikannya sebagai attachment lumina-backup-YYYYMMDD-HHmmss.db.
import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER yang boleh mengunduh backup database." };

/** Resolusi path file SQLite dari DATABASE_URL env (format Prisma "file:..."). */
function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? "";
  const raw = url.startsWith("file:") ? url.slice("file:".length) : url;
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  }
  // Fallback lokasi baku proyek ini.
  return path.join(process.cwd(), "db", "custom.db");
}

/** Nama file backup: lumina-backup-YYYYMMDD-HHmmss.db (waktu lokal). */
function backupFileName(): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date();
  return `lumina-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
    d.getDate(),
  )}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.db`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const dbPath = resolveDbPath();
    let buffer: Buffer;
    try {
      buffer = await readFile(dbPath);
    } catch {
      return NextResponse.json(
        { error: "File database tidak ditemukan atau tidak bisa dibaca." },
        { status: 500 },
      );
    }

    const filename = backupFileName();
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buffer.byteLength),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/backup]", error);
    return NextResponse.json(
      { error: "Gagal membuat backup database. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
