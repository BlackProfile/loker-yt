// NR49 Paket C fitur 1 — Brief Pagi AI.
// GET  /api/admin/morning-brief — semua role login: baca brief hari ini (jika ada).
// POST /api/admin/morning-brief — OWNER/HR: buat/perbarui brief hari ini.
//      body { force?: boolean } — force=true melewati cache harian dan membuat ulang.
// AiGateError (fitur dimatikan / kuota habis / Mode Hemat) → 503 { error }.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import { AiGateError } from "@/lib/ai-control";
import { generateMorningBrief, getTodayBrief } from "@/lib/morning-brief";
import { errorMessage } from "@/lib/ai-json";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { brief } = await getTodayBrief();
    return NextResponse.json({ brief });
  } catch (error) {
    console.error("[GET /api/admin/morning-brief]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat brief pagi." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "HR") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const force =
      !!body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).force === true
        : false;

    const brief = await generateMorningBrief(force, session.name);
    return NextResponse.json({ brief });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/morning-brief]", errorMessage(error));
    return NextResponse.json(
      { error: "Brief pagi gagal dibuat. Coba lagi beberapa saat." },
      { status: 500 },
    );
  }
}
