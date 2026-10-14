// NR56 — /api/admin/files/[id] — kelola satu FileAsset dari Pusat Kelola Berkas.
//
// PATCH  {filename}   : ganti nama tampilan berkas (metadata saja, file fisik utuh).
// POST   multipart    : ganti isi berkas (versi baru) — file fisik lama dibuang,
//                      magic bytes diverifikasi, maks 10 MB.
// DELETE ?confirm=YA  : hapus berkas. Bila masih dirujuk entri mana pun dan tanpa
//                      confirm=YA → 409 berisi daftar referensi. Dengan confirm,
//                      referensi JSON/kolom non-FK dilepas dulu, relasi FK di-SetNull
//                      otomatis oleh Prisma, file fisik (+varian .webp) dihapus.
//
// Ketiganya OWNER-only (HR/VIEWER hanya lihat & unduh — sesuai keputusan desain NR56).
// Setiap hapus & ganti isi tercatat di ActivityLog (tab Log Aktivitas).
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
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
import { MAX_UPLOAD_BYTES, sanitizeFilename } from "@/lib/upload";
import { verifyMagicBytes } from "@/lib/verify-upload";
import type { AdminFileItem, AdminFileRefs } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER yang dapat mengelola berkas." };

const NAME_MAX = 120;

function toDisplayRefs(refs: FileRefDisplay): AdminFileRefs {
  return {
    applications: refs.applications,
    positions: refs.positions,
    assessments: refs.assessments,
    internalDocs: refs.internalDocs,
    drafts: refs.drafts,
    interviews: refs.interviews,
  };
}

function hasReferences(refs: FileRefDisplay | undefined): boolean {
  return !isOrphan(refs);
}

function toAdminFileItem(
  asset: {
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    kind: string | null;
    createdAt: Date;
  },
  rawRefs: FileRefDisplay | undefined,
): AdminFileItem {
  return {
    id: asset.id,
    filename: asset.filename,
    mimeType: asset.mimeType,
    size: asset.size,
    kind: asset.kind,
    createdAt: asset.createdAt.toISOString(),
    orphan: asset.kind === "OFFER_PDF" ? false : isOrphan(rawRefs),
    refs: rawRefs
      ? toDisplayRefs(rawRefs)
      : {
          applications: [],
          positions: [],
          assessments: [],
          internalDocs: [],
          drafts: [],
          interviews: 0,
        },
  };
}

async function loadAsset(id: string) {
  return db.fileAsset.findUnique({
    where: { id },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      size: true,
      kind: true,
      createdAt: true,
      path: true,
    },
  });
}

/** Ambil peta referensi untuk satu berkas. */
async function refsFor(fileId: string): Promise<FileRefDisplay | undefined> {
  return (await collectFileRefs()).get(fileId);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { filename?: unknown } | null;
    const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
    if (!filename) {
      return NextResponse.json({ error: "Nama berkas wajib diisi." }, { status: 400 });
    }
    if (filename.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Nama berkas maksimal ${NAME_MAX} karakter.` },
        { status: 400 },
      );
    }
    if (/[\\/]/.test(filename)) {
      return NextResponse.json(
        { error: "Nama berkas tidak boleh mengandung garis miring." },
        { status: 400 },
      );
    }

    const asset = await loadAsset(id);
    if (!asset) {
      return NextResponse.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
    }

    const updated = await db.fileAsset.update({
      where: { id },
      data: { filename },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        kind: true,
        createdAt: true,
      },
    });

    const rawRefs = await refsFor(id);
    return NextResponse.json({ item: toAdminFileItem(updated, rawRefs) });
  } catch (error) {
    console.error("[PATCH /api/admin/files/[id]]", error);
    return NextResponse.json(
      { error: "Gagal mengganti nama berkas. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const { id } = await params;
    const asset = await loadAsset(id);
    if (!asset) {
      return NextResponse.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Berkas pengganti wajib dipilih." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Ukuran berkas maksimal 10 MB." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || asset.mimeType || "application/octet-stream";
    const verdict = verifyMagicBytes(buffer, mimeType);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: "Isi berkas tidak cocok dengan tipenya atau tidak didukung." },
        { status: 400 },
      );
    }

    // Tulis file fisik baru ke uploads/.
    const uploadsDir = path.join(process.cwd(), "uploads");
    const storedName = `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}-${sanitizeFilename(file.name)}`;
    const absolutePath = path.join(uploadsDir, storedName);
    await writeFile(absolutePath, buffer);

    const oldPath = asset.path;
    const updated = await db.fileAsset.update({
      where: { id },
      data: {
        filename: file.name,
        mimeType,
        size: file.size,
        path: `uploads/${storedName}`,
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        size: true,
        kind: true,
        createdAt: true,
      },
    });

    // Buang file fisik lama (setelah DB aman) + varian webp-nya.
    await unlinkAssetFiles(oldPath);

    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "FILE_REPLACED",
        detail: `${session.name} mengganti isi berkas "${asset.filename}" dengan "${file.name}"`,
      },
    });

    const rawRefs = await refsFor(id);
    return NextResponse.json({ item: toAdminFileItem(updated, rawRefs) });
  } catch (error) {
    console.error("[POST /api/admin/files/[id]]", error);
    return NextResponse.json(
      { error: "Gagal mengganti berkas. Coba lagi nanti." },
      { status: 500 },
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const { id } = await params;
    const confirm = req.nextUrl.searchParams.get("confirm") === "YA";

    const asset = await loadAsset(id);
    if (!asset) {
      return NextResponse.json({ error: "Berkas tidak ditemukan." }, { status: 404 });
    }

    const rawRefs = await refsFor(id);
    if (hasReferences(rawRefs) && !confirm) {
      return NextResponse.json(
        {
          error: "Berkas masih dipakai. Kirim confirm=YA untuk melepas referensinya lalu menghapus.",
          refs: toDisplayRefs(rawRefs),
        },
        { status: 409 },
      );
    }

    if (confirm) {
      await detachFileReferences(id);
    }

    await db.fileAsset.delete({ where: { id } });
    await unlinkAssetFiles(asset.path);

    await db.activityLog.create({
      data: {
        actor: session.name,
        action: "FILE_DELETED",
        detail: `${session.name} menghapus berkas "${asset.filename}" (${asset.kind ?? "tanpa kategori"})`,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/files/[id]]", error);
    return NextResponse.json(
      { error: "Gagal menghapus berkas. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
