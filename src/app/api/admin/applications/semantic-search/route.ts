// POST /api/admin/applications/semantic-search — pencarian semantik kandidat
// dengan kueri bebas. Ambil maks 100 lamaran terbaru (lengkap dengan experience,
// motivation, cvText, aiScore), LLM menskor 0-100 kecocokan + alasan 1 kalimat,
// kembalikan top 10 (JSON ketat, tervalidasi terhadap id nyata).
import { NextRequest, NextResponse } from "next/server";
import { semanticSearchCandidates } from "@/lib/ai";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const query = typeof (body as Record<string, unknown>).query === "string"
      ? (body as Record<string, unknown>).query.trim()
      : "";
    if (query.length < 3) {
      return NextResponse.json({ error: "Tulis kueri minimal 3 karakter." }, { status: 400 });
    }
    if (query.length > 300) {
      return NextResponse.json({ error: "Kueri maksimal 300 karakter." }, { status: 400 });
    }

    const results = await semanticSearchCandidates(query);
    if (results === null) {
      return NextResponse.json({ error: "Pencarian AI gagal, coba lagi." }, { status: 502 });
    }
    return NextResponse.json({ query, results });
  } catch (error) {
    console.error("[POST /api/admin/applications/semantic-search]", errorMessage(error));
    return NextResponse.json({ error: "Pencarian AI gagal, coba lagi." }, { status: 502 });
  }
}
