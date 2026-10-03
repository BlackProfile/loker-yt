// /api/admin/backups — galeri backup otomatis harian di backups/auto (OWNER saja).
//   GET                -> daftar file backup: { ok, backups: [{ file, sizeBytes, createdAt }] }
//   GET ?download=file -> unduh file backup sebagai attachment
//   DELETE ?file=file  -> hapus satu file backup
//   POST { file }      -> pulihkan (restore) database dari file backup di galeri;
//                         memakai restoreDatabaseFromBuffer() yang sama dengan
//                         POST /api/admin/restore, lalu mencatat ActivityLog
//                         RESTORE_FROM_BACKUP + NotificationItem.
// Keamanan: hanya OWNER; nama file divalidasi ketat (regex + resolve di dalam
// backups/auto) untuk menolak path traversal; file custom.db.demo-seed.bak milik
// db-guard tidak tersentuh (berada di backups/, bukan backups/auto/).
import { NextRequest, NextResponse } from "next/server";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { restoreDatabaseFromBuffer } from "@/lib/restore-db";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER yang boleh mengelola backup otomatis." };

// Nama file backup otomatis yang sah (dibuat cron): lumina-<tanggal>.db dsb.
const BACKUP_FILE_RE = /^lumina-[A-Za-z0-9._-]+\.db$/;

/** Direktori galeri backup otomatis (relatif ke project root). */
function backupsAutoDir(): string {
  return path.resolve(process.cwd(), "backups", "auto");
}

/**
 * Validasi ketat nama file backup: harus cocok regex (tanpa slash/..) DAN setelah
 * resolve tetap berada di dalam backups/auto — menolak path traversal.
 * Mengembalikan path absolut, atau null bila tidak sah.
 */
function resolveBackupFilePath(file: unknown): string | null {
  if (typeof file !== "string") return null;
  const name = file.trim();
  if (name.length === 0 || name.length > 120) return null;
  if (!BACKUP_FILE_RE.test(name)) return null;
  const dir = backupsAutoDir();
  const resolved = path.resolve(dir, name);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return null;
  return resolved;
}

/** Pastikan sesi OWNER; mengembalikan response error bila gagal, null bila lolos. */
async function guardOwner(): Promise<NextResponse | null> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }
  if (session.role !== "OWNER") {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }
  return null;
}

/* ---------------------------------- GET ---------------------------------- */

export async function GET(req: NextRequest) {
  try {
    const denied = await guardOwner();
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const download = searchParams.get("download");

    // Mode unduh: kirim file sebagai attachment.
    if (download) {
      const filePath = resolveBackupFilePath(download);
      if (!filePath) {
        return NextResponse.json({ error: "Nama file backup tidak valid." }, { status: 400 });
      }
      if (!existsSync(filePath)) {
        return NextResponse.json({ error: "File backup tidak ditemukan." }, { status: 404 });
      }
      const bytes = await readFile(filePath);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${path.basename(filePath)}"`,
          "Content-Length": String(bytes.length),
        },
      });
    }

    // Mode daftar: kumpulkan file lumina-*.db di backups/auto (sort nama desc).
    const dir = backupsAutoDir();
    if (!existsSync(dir)) {
      return NextResponse.json({ ok: true, backups: [] });
    }
    const backups = readdirSync(dir)
      .filter((name) => BACKUP_FILE_RE.test(name))
      .sort((a, b) => b.localeCompare(a))
      .map((name) => {
        const full = path.join(dir, name);
        const stat = statSync(full);
        return {
          file: name,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      });
    return NextResponse.json({ ok: true, backups });
  } catch (error) {
    console.error("[GET /api/admin/backups]", error);
    return NextResponse.json(
      { error: "Gagal membaca daftar backup otomatis." },
      { status: 500 },
    );
  }
}

/* --------------------------------- DELETE --------------------------------- */

export async function DELETE(req: NextRequest) {
  try {
    const denied = await guardOwner();
    if (denied) return denied;

    const { searchParams } = new URL(req.url);
    const filePath = resolveBackupFilePath(searchParams.get("file"));
    if (!filePath) {
      return NextResponse.json({ error: "Nama file backup tidak valid." }, { status: 400 });
    }
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "File backup tidak ditemukan." }, { status: 404 });
    }
    unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/backups]", error);
    return NextResponse.json({ error: "Gagal menghapus file backup." }, { status: 500 });
  }
}

/* ---------------------------------- POST ---------------------------------- */

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const file =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).file
        : null;
    const filePath = resolveBackupFilePath(file);
    if (!filePath) {
      return NextResponse.json(
        { error: "Nama file backup tidak valid (wajib field 'file')." },
        { status: 400 },
      );
    }
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: "File backup tidak ditemukan." }, { status: 404 });
    }

    const fileName = path.basename(filePath);
    const buffer = await readFile(filePath);

    // Logika restore identik dengan POST /api/admin/restore (satu transaksi).
    const { restored } = await restoreDatabaseFromBuffer(buffer);
    const total = Object.values(restored).reduce((sum, n) => sum + n, 0);

    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: session.name,
        action: "RESTORE_FROM_BACKUP",
        detail: `Database dipulihkan dari backup otomatis "${fileName}" (${total} baris ditulis ulang).`,
      },
    });
    await db.notificationItem.create({
      data: {
        title: "Database dipulihkan dari backup otomatis",
        body: `File "${fileName}" berhasil dipulihkan oleh ${session.name} (${total} baris).`,
        category: "SYSTEM",
      },
    });

    // Segarkan seluruh klien (publik & admin) setelah isi database berganti.
    void emitRealtime(
      REALTIME_EVENTS.positions,
      REALTIME_EVENTS.applications,
      REALTIME_EVENTS.interviews,
      REALTIME_EVENTS.site,
    );

    return NextResponse.json({ ok: true, restored });
  } catch (error) {
    console.error("[POST /api/admin/backups]", error);
    return NextResponse.json(
      { error: "Gagal memulihkan database dari backup otomatis." },
      { status: 500 },
    );
  }
}
