// POST /api/admin/positions/[id]/poster — generate poster lowongan via AI (NR49 Paket D).
// Body { style: "minimalis" | "berani" | "hangat" }. OWNER/HR dengan can(kelola_posisi)
// (pola rute PATCH /api/admin/positions/[id]). Proses 30-120 detik — tanpa timeout
// route; withTimeout lib dijaga 170 dtk agar respons selalu < 180 detik.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { can } from "@/lib/permissions";
import { withAiGate, AiGateError } from "@/lib/ai-control";
import { errorMessage } from "@/lib/ai-json";
import { generatePoster, savePosterFile, POSTER_STYLES, type PosterStyle } from "@/lib/position-poster";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    // NR46 — matriks izin: kelola posisi.
    if (!(await can(session.role, "kelola_posisi"))) {
      return NextResponse.json(
        { error: "Aksi ini tidak diizinkan untuk role Anda — lihat Matriks Izin di Pengaturan." },
        { status: 403 },
      );
    }

    const { id } = await params;
    const body: unknown = await req.json().catch(() => null);
    const styleRaw =
      body && typeof body === "object" && !Array.isArray(body)
        ? typeof (body as Record<string, unknown>).style === "string"
          ? ((body as Record<string, unknown>).style as string).trim()
          : ""
        : "";
    if (!(POSTER_STYLES as string[]).includes(styleRaw)) {
      return NextResponse.json(
        { error: "Gaya poster tidak valid. Pilih minimalis, berani, atau hangat." },
        { status: 400 },
      );
    }
    const style = styleRaw as PosterStyle;

    const position = await db.position.findUnique({ where: { id } });
    if (!position || position.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const poster = await withAiGate(
      "poster",
      { actor: session.name, detailOk: `Posisi: ${position.title} (${style})` },
      async () => {
        const buffer = await generatePoster(position, style);
        return savePosterFile(buffer, position.title);
      },
    );

    return NextResponse.json({ url: poster.url, fileId: poster.id, filename: poster.filename });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/positions/[id]/poster]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal membuat poster. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}
