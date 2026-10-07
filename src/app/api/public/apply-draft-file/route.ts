// NR-41 J26 — unggah file draft wizard lintas perangkat (SERVER-ONLY).
// POST /api/public/apply-draft-file — multipart {token, label, file}
//   token : token ApplicationDraft yang masih berlaku (dibuat autosave teks lebih dulu)
//   label : "cv" | "intro" | "doc:<nama dokumen>" | "form:<fieldId>"
//   file  : berkas (maks 10 MB; magic bytes diverifikasi)
// FileAsset dibuat dengan kind=DRAFT lalu meta ditulis ke ApplicationDraft.files
// (replace bila label sama — unggah ulang menggantikan). Saat submit final, route
// lamaran mengadopsi fileId dari draft ini sehingga file ikut lintas perangkat.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveUpload, UploadInvalidError, MAX_UPLOAD_BYTES } from "@/lib/upload";

export const dynamic = "force-dynamic";

const RATE_MAX = 20; // unggahan per IP per jam — draft jarang lebih dari ini
const rateBuckets = new Map<string, { count: number; reset: number }>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now >= bucket.reset) {
    rateBuckets.set(ip, { count: 1, reset: now + 60 * 60 * 1000 });
    // bersihkan bucket kedaluwarsa secara ringan
    if (rateBuckets.size > 500) {
      for (const [key, value] of rateBuckets) {
        if (now >= value.reset) rateBuckets.delete(key);
      }
    }
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_MAX;
}

/** Meta file draft — sama dengan DraftFileMeta di types.ts (salinan lokal server). */
type DraftFileMetaLocal = {
  fileId: string;
  label: string;
  filename: string;
  mimeType: string;
  size: number;
};

/** Label yang diizinkan: cv | intro | doc:<teks> | form:<teks> */
function isValidLabel(label: string): boolean {
  if (label === "cv" || label === "intro") return true;
  if (label.startsWith("doc:") && label.length > 4 && label.length <= 120) return true;
  if (label.startsWith("form:") && label.length > 5 && label.length <= 120) return true;
  return false;
}

export async function POST(req: NextRequest) {
  try {
    if (isRateLimited(clientIp(req))) {
      return NextResponse.json(
        { error: "Terlalu banyak unggahan. Coba lagi nanti." },
        { status: 429 },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }

    const token = (form.get("token") as string | null)?.trim() ?? "";
    const label = (form.get("label") as string | null)?.trim() ?? "";
    const file = form.get("file");

    if (!token || !isValidLabel(label)) {
      return NextResponse.json({ error: "Data draft tidak valid." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0 || !file.name) {
      return NextResponse.json({ error: "Berkas tidak ditemukan." }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "Ukuran berkas maksimal 10 MB." },
        { status: 413 },
      );
    }

    // Draft harus ada & masih berlaku (dibuat oleh autosave teks wizard lebih dulu).
    const draft = await db.applicationDraft.findUnique({ where: { token } });
    if (!draft || draft.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Sesi draft tidak valid atau sudah kedaluwarsa." },
        { status: 404 },
      );
    }

    // Simpan berkas (magic bytes diverifikasi di dalam saveUpload; kind=DRAFT).
    const asset = await saveUpload(file, "application/octet-stream", { kind: "DRAFT" });

    // Meta file draft: replace bila label sama, else append (maks 12 entri).
    let existing: DraftFileMetaLocal[] = [];
    try {
      const parsed: unknown = JSON.parse(draft.files);
      if (Array.isArray(parsed)) {
        existing = parsed.filter(
          (item): item is DraftFileMetaLocal =>
            !!item &&
            typeof item === "object" &&
            typeof (item as DraftFileMetaLocal).fileId === "string" &&
            typeof (item as DraftFileMetaLocal).label === "string",
        );
      }
    } catch {
      existing = [];
    }
    const meta: DraftFileMetaLocal = {
      fileId: asset.id,
      label,
      filename: file.name.slice(0, 200),
      mimeType: file.type || "application/octet-stream",
      size: file.size,
    };
    const next = [...existing.filter((item) => item.label !== label), meta].slice(-12);

    await db.applicationDraft.update({
      where: { id: draft.id },
      data: { files: JSON.stringify(next) },
    });

    return NextResponse.json({ ok: true, file: meta });
  } catch (error) {
    if (error instanceof UploadInvalidError) {
      return NextResponse.json(
        { ok: false, error: "Tipe file tidak valid (berkas rusak atau palsu)." },
        { status: 400 },
      );
    }
    console.error("[POST /api/public/apply-draft-file]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan berkas draft. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
