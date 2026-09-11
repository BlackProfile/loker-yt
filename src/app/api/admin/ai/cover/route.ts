// POST /api/admin/ai/cover — generate banner lowongan dengan AI (OWNER/HR) lalu
// simpan sebagai FileAsset dan pasang sebagai cover posisi.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import type { AiCoverResponse } from "@/lib/types";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

/** Nama file aman: buang path, simpan karakter umum, batasi panjang. */
function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "file").trim();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (cleaned || "file").slice(-80);
}

/** ID mirip cuid untuk prefiks nama file tersimpan. */
function cuidLike(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

/** Imagery visual sesuai kata kunci judul posisi agar banner relevan. */
function imageryForTitle(title: string): string {
  const t = title.toLowerCase();
  if (/edit|montase|montage|video|motion/.test(t)) {
    return "video editing timeline, clips and color grading panels";
  }
  if (/desain|design|thumbnail|grafis|graphic|ilustr/.test(t)) {
    return "drawing pen tablet and design software workspace";
  }
  if (/writ|penulis|naskah|copy|konten tulis|script/.test(t)) {
    return "vintage typewriter and manuscript pages";
  }
  if (/sosmed|social|media officer|smm|instagram|tiktok/.test(t)) {
    return "smartphone with social media engagement icons floating around";
  }
  if (/strateg|plan|analis/.test(t)) {
    return "growth chart, roadmap board and sticky notes planning";
  }
  return "creative studio equipment like camera, microphone and ring light";
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const positionId =
      body && typeof body === "object" && !Array.isArray(body)
        ? typeof (body as Record<string, unknown>).positionId === "string"
          ? ((body as Record<string, unknown>).positionId as string).trim()
          : ""
        : "";
    if (!positionId) {
      return NextResponse.json({ ok: false, error: "positionId wajib diisi." }, { status: 400 });
    }

    const position = await db.position.findUnique({ where: { id: positionId } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const prompt = [
      `Wide horizontal recruitment banner for the role '${position.title}' (${position.department})`,
      `at a digital content creator studio. Modern, bold, energetic visual style featuring`,
      `${imageryForTitle(position.title)}, warm rose-red and amber accents on dark zinc background,`,
      `cinematic lighting, clean composition with empty space on the right for text,`,
      `high quality, no text, no words, no letters`,
    ].join(" ");

    const response = await withTimeout(
      withZaiRetry((zai) => zai.images.generations.create({ prompt, size: "1344x768" })),
      "Generate cover AI",
      120_000,
    );

    const base64 = response?.data?.[0]?.base64;
    if (!base64) {
      console.error("[POST /api/admin/ai/cover] respons AI tidak berisi gambar");
      const fail: AiCoverResponse = { ok: false, error: "Gagal membuat cover. Coba lagi." };
      return NextResponse.json(fail, { status: 502 });
    }

    // Simpan buffer gambar ke folder uploads + catat FileAsset.
    const uploadsDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadsDir, { recursive: true });
    const storedName = `${cuidLike()}-ai-cover-${sanitizeFilename(`${position.title}.png`)}`;
    const buffer = Buffer.from(base64, "base64");
    await writeFile(path.join(uploadsDir, storedName), buffer);

    const asset = await db.fileAsset.create({
      data: {
        filename: `cover-${position.title}.png`,
        mimeType: "image/png",
        size: buffer.byteLength,
        path: `uploads/${storedName}`,
      },
      select: { id: true },
    });

    await db.position.update({
      where: { id: position.id },
      data: { coverFileId: asset.id },
    });

    const result: AiCoverResponse = { ok: true, fileId: asset.id, url: `/api/files/${asset.id}` };
    // Realtime: cover posisi berubah — segarkan kartu publik & admin.
    void emitRealtime(REALTIME_EVENTS.positions);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/admin/ai/cover]", error);
    const fail: AiCoverResponse = { ok: false, error: "Gagal membuat cover. Coba lagi." };
    return NextResponse.json(fail, { status: 502 });
  }
}
