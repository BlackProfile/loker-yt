// POST /api/admin/announcements/draft — draf pengumuman lowongan via LLM (NR49 Paket D).
// Body { positionId }. OWNER/HR (pola rute /api/admin/announcements). AI HANYA
// mengusulkan draf — pengumuman tetap dibuat admin lewat POST /api/admin/announcements.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, asTrimmedString } from "@/lib/ai-json";
import { withAiGate, AiGateError } from "@/lib/ai-control";
import { parseRequirements } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };

const AI_TIMEOUT_MS = 90_000;
const TITLE_MAX = 60;
const BODY_MAX = 400;

function workModeLabel(mode: string): string {
  if (mode === "ONSITE") return "tatap muka di kantor";
  if (mode === "HYBRID") return "hibrida (kantor & remote)";
  return "remote";
}

function safeTruncate(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function stripDisallowed(text: string): string {
  // Buang markdown sederhana dan emoji agar sesuai gaya papan pengumuman.
  return text
    .replace(/[*_`#>]/g, "")
    .replace(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
      "",
    )
    .trim();
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
        ? asTrimmedString((body as Record<string, unknown>).positionId, 64)
        : "";
    if (!positionId) {
      return NextResponse.json({ error: "positionId wajib diisi." }, { status: 400 });
    }

    const position = await db.position.findUnique({ where: { id: positionId } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const requirements = parseRequirements(position.requirements).slice(0, 5);
    let facilities: string[] = [];
    try {
      const parsed: unknown = JSON.parse(position.facilities);
      if (Array.isArray(parsed)) {
        facilities = parsed
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 6);
      }
    } catch {
      facilities = [];
    }

    const draft = await withAiGate(
      "announcement_draft",
      { actor: session.name, detailOk: `Posisi: ${position.title}` },
      async () => {
        const systemPrompt =
          "Kamu adalah spesialis komunikasi rekrutmen studio konten kreator Lumina Studio. " +
          "Tulis pengumuman lowongan berbahasa Indonesia formal yang menarik, TANPA emoji, " +
          "TANPA markdown, dan TANPA mengarang data di luar yang diberikan. Jawab HANYA JSON valid.";
        const userPrompt = [
          "Susun draf pengumuman lowongan untuk papan internal tim dan kanal rekrutmen.",
          "",
          `Posisi: ${position.title}`,
          `Departemen: ${position.department}`,
          `Jenis: ${position.type}`,
          `Lokasi: ${position.location} (mode kerja ${workModeLabel(position.workMode)})`,
          position.workHours ? `Jam kerja: ${position.workHours}` : "",
          facilities.length ? `Fasilitas: ${facilities.join(", ")}` : "",
          requirements.length ? `Persyaratan utama: ${requirements.join("; ")}` : "",
          `Deskripsi posisi: ${position.description.slice(0, 800)}`,
          position.salaryVisible && position.salaryText
            ? `Gaji (boleh disebut): ${position.salaryText}`
            : "Gaji: JANGAN disebut (tidak ditampilkan publik).",
          position.urgent ? "Kebutuhan: posisi urgent (sebut halus bahwa pendaftaran diprioritaskan)." : "",
          "",
          "Aturan output:",
          "- Bahasa Indonesia formal namun menarik, tanpa emoji, tanpa markdown.",
          `- title: judul pengumuman menarik, MAKSIMAL ${TITLE_MAX} karakter.`,
          `- body: maksimal ${BODY_MAX} karakter; muat siapa yang dicari, keunggulan/` +
            "jam kerja/fasilitas bila ada, dan cara lamar: buka panel karier Lumina Studio.",
          "- HANYA gunakan data posisi di atas; jangan mengarang angka gaji atau benefit lain.",
          'Balas HANYA JSON valid satu baris: {"title": "...", "body": "..."}',
        ]
          .filter(Boolean)
          .join("\n");

        const completion = await withTimeout(
          withZaiRetry((zai) =>
            zai.chat.completions.create({
              messages: [
                { role: "assistant", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              thinking: { type: "disabled" },
            }),
          ),
          "Pembuatan draf pengumuman",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJsonObject(raw);
        if (!parsed) {
          throw new Error("AI tidak menghasilkan draf yang valid.");
        }
        return {
          title: stripDisallowed(asTrimmedString(parsed.title, TITLE_MAX + 80)),
          body: stripDisallowed(asTrimmedString(parsed.body, BODY_MAX + 200)),
        };
      },
    );

    if (!draft.title || !draft.body) {
      return NextResponse.json(
        { error: "AI tidak menghasilkan draf yang lengkap. Coba lagi sebentar." },
        { status: 502 },
      );
    }

    // Potong dengan aman agar selalu lolos validasi form pengumuman (3-80 / 1-600).
    return NextResponse.json({
      title: safeTruncate(draft.title, Math.min(TITLE_MAX, 80)),
      body: safeTruncate(draft.body, BODY_MAX),
    });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/announcements/draft]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal membuat draf pengumuman. Coba lagi sebentar." },
      { status: 502 },
    );
  }
}
