// POST /api/public/onboarding/upload — pelamar mengunggah dokumen onboarding dari halaman status.
// Multipart: { code (tracking), docId, file }. Hanya PDF/JPG/PNG, maks 5 MB.
// Hanya untuk lamaran yang sudah diterima (hired) dan dokumen ada di checklist.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseOnboardingDocs } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIMES = ["application/pdf", "image/jpeg", "image/png"];

const EXT_MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

export async function POST(req: NextRequest) {
  try {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Data unggahan tidak valid." }, { status: 400 });
    }

    const code = String(form.get("code") ?? "").trim().toUpperCase();
    const docId = String(form.get("docId") ?? "").trim();
    const file = form.get("file");
    if (!code || !docId) {
      return NextResponse.json({ error: "Kode pelacakan dan dokumen wajib dipilih." }, { status: 400 });
    }
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "File wajib diunggah." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimal 5 MB." }, { status: 400 });
    }

    const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    const mimeType = ALLOWED_MIMES.includes(file.type)
      ? file.type
      : !file.type && ext in EXT_MIME
        ? EXT_MIME[ext]
        : null;
    if (!mimeType) {
      return NextResponse.json({ error: "Dokumen harus berformat PDF, JPG, atau PNG." }, { status: 400 });
    }

    const application = await db.application.findUnique({ where: { trackingCode: code } });
    if (!application) {
      return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }
    if (!application.hiredAt) {
      return NextResponse.json(
        { error: "Unggah dokumen hanya tersedia setelah penawaran diterima." },
        { status: 403 },
      );
    }

    const docs = parseOnboardingDocs(application.onboardingDocs);
    const doc = docs.find((d) => d.id === docId);
    if (!doc) {
      return NextResponse.json({ error: "Dokumen tidak ada di checklist onboarding." }, { status: 404 });
    }

    // Simpan file (pola sama dengan upload admin)
    const uploadsDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const storedName = `${cuidLike()}-${sanitizeFilename(file.name)}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(uploadsDir, storedName), buffer);
    const asset = await db.fileAsset.create({
      data: {
        filename: file.name,
        mimeType,
        size: file.size,
        path: `uploads/${storedName}`,
      },
      select: { id: true },
    });

    // Perbarui dokumen di JSON
    const nextDocs = docs.map((d) =>
      d.id === docId ? { ...d, done: true, fileId: asset.id } : d,
    );
    await db.application.update({
      where: { id: application.id },
      data: { onboardingDocs: JSON.stringify(nextDocs) },
    });

    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "ONBOARDING",
        detail: `Pelamar mengunggah dokumen onboarding: ${doc.label}`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, fileId: asset.id, url: `/api/files/${asset.id}` }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/public/onboarding/upload]", error);
    return NextResponse.json({ error: "Gagal mengunggah dokumen. Coba lagi nanti." }, { status: 500 });
  }
}
