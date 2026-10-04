// /api/admin/applications/[id]/internal-docs — dokumen internal khusus admin per
// lamaran (NR-24, fitur 11): KTP, kontrak draft, hasil backcheck. Terisolasi dari
// semua respons publik — TIDAK PERNAH tampil di halaman status pelamar.
// GET    : daftar dokumen internal (urut createdAt desc).
// POST   : unggah dokumen multipart/form-data (field "file" wajib + "label" 1..60),
//          maks 10MB. File disimpan sebagai FileAsset (folder uploads/ yang sama).
// DELETE : hapus baris dokumen (?docId=) — FileAsset dibiarkan (riwayat aman).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { MAX_UPLOAD_BYTES, saveUpload } from "@/lib/upload";
import type { InternalDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const LABEL_MAX = 60;

function serializeInternalDoc(row: {
  id: string;
  applicationId: string;
  label: string;
  fileId: string;
  uploadedBy: string;
  createdAt: Date;
}): InternalDoc {
  return {
    id: row.id,
    applicationId: row.applicationId,
    label: row.label,
    fileId: row.fileId,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadDocs(applicationId: string): Promise<InternalDoc[]> {
  const rows = await db.internalDoc.findMany({
    where: { applicationId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(serializeInternalDoc);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;
    const application = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    const docs = await loadDocs(id);
    return NextResponse.json({ ok: true, docs });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/internal-docs]", error);
    return NextResponse.json({ error: "Gagal memuat dokumen internal. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({ where: { id }, select: { id: true } });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Data unggahan tidak valid." }, { status: 400 });
    }

    const labelRaw = form.get("label");
    const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
    if (label.length < 1 || label.length > LABEL_MAX) {
      return NextResponse.json(
        { error: `Label dokumen wajib diisi (maksimal ${LABEL_MAX} karakter).` },
        { status: 400 }
      );
    }

    const fileValue = form.get("file");
    if (!fileValue || typeof fileValue === "string") {
      return NextResponse.json({ error: "File dokumen wajib dipilih." }, { status: 400 });
    }
    const file = fileValue;
    if (file.size === 0 || !file.name) {
      return NextResponse.json({ error: "File dokumen wajib dipilih." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimal 10 MB." }, { status: 400 });
    }

    // Simpan berkas ke uploads/ + catat sebagai FileAsset (pola /api/admin/upload).
    const asset = await saveUpload(file, "application/octet-stream");

    await db.internalDoc.create({
      data: {
        applicationId: id,
        label,
        fileId: asset.id,
        uploadedBy: session.name,
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "INTERNAL_DOC_UPLOADED",
        detail: `Dokumen internal "${label}" diunggah`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    const docs = await loadDocs(id);
    return NextResponse.json({ ok: true, docs });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/internal-docs]", error);
    return NextResponse.json({ error: "Gagal mengunggah dokumen internal. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const docId = req.nextUrl.searchParams.get("docId")?.trim() ?? "";
    if (!docId) {
      return NextResponse.json({ error: "ID dokumen wajib diisi." }, { status: 400 });
    }
    const existing = await db.internalDoc.findFirst({
      where: { id: docId, applicationId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Dokumen internal tidak ditemukan." }, { status: 404 });
    }

    // Hanya baris InternalDoc yang dihapus — FileAsset dibiarkan (riwayat aman).
    await db.internalDoc.delete({ where: { id: docId } });

    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "INTERNAL_DOC_DELETED",
        detail: `Dokumen internal "${existing.label}" dihapus`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    const docs = await loadDocs(id);
    return NextResponse.json({ ok: true, docs });
  } catch (error) {
    console.error("[DELETE /api/admin/applications/[id]/internal-docs]", error);
    return NextResponse.json({ error: "Gagal menghapus dokumen internal. Coba lagi nanti." }, { status: 500 });
  }
}
