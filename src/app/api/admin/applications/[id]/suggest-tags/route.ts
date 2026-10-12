// NR49 Paket C fitur 4 — Sarankan Tag (AI).
// POST /api/admin/applications/[id]/suggest-tags — OWNER/HR (pola rute tag
// eksisting: PUT /api/admin/tags & PATCH /api/admin/applications/[id] memakai
// pemeriksaan role biasa tanpa can(), jadi pola yang sama dipakai di sini).
// Membaca CV + jawaban screening/form (dibatasi total 6000 karakter), lalu LLM
// memilih MAKSIMAL 5 tag — diutamakan tag tim yang sudah ada (case-insensitive),
// maksimal 2 tag baru bila memang penting. Usulan SELALU menunggu persetujuan
// admin (tidak pernah ditambahkan otomatis).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject } from "@/lib/ai-json";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const AI_TIMEOUT_MS = 60_000;

// Anggaran teks per sumber agar total yang dikirim ke LLM <= 6000 karakter.
const CV_BUDGET = 4000;
const SCREENING_BUDGET = 1200;
const FORM_BUDGET = 800;
const TAG_MAX = 5;
const NEW_TAG_MAX = 2;
const TAG_MAX_CHARS = 30;

function parseJsonRecord(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Ringkas rekaman jawaban menjadi baris "kunci: nilai" (nilai dipotong). */
function summarizeAnswers(record: Record<string, unknown>, budget: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const [key, value] of Object.entries(record)) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const clean = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (!clean) continue;
    const line = `${key}: ${clean}`;
    if (used + line.length > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        cvText: true,
        screeningAnswers: true,
        formAnswers: true,
        position: { select: { title: true } },
      },
    });
    if (!application) {
      return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
    }

    const existingTags = await db.tag.findMany({ select: { name: true }, orderBy: { name: "asc" } });
    const existingNames = existingTags.map((t) => t.name);
    const existingLower = new Set(existingNames.map((n) => n.toLowerCase()));

    const cvText = (application.cvText ?? "").trim();
    const screeningSummary = summarizeAnswers(parseJsonRecord(application.screeningAnswers), SCREENING_BUDGET);
    const formSummary = summarizeAnswers(parseJsonRecord(application.formAnswers), FORM_BUDGET);

    const hasAnySource = cvText || screeningSummary || formSummary;
    if (!hasAnySource) {
      return NextResponse.json(
        { error: "Belum ada CV atau jawaban formulir untuk dianalisis." },
        { status: 400 },
      );
    }

    const tags = await withAiGate(
      "auto_tag",
      { actor: session.name, detailOk: "Usulan tag kandidat" },
      async () => {
        const systemPrompt =
          "Kamu adalah asisten HR Lumina Studio. Tugasmu mengusulkan tag kandidat. " +
          "Pilih 3 sampai 5 tag paling relevan dari isi CV/jawaban (kecuali teks sangat " +
          "pendek, minimal 2). UTAMAKAN tag dari daftar tag tim yang sudah ada (cocokkan " +
          "secara makna, abaikan huruf besar/kecil) — tetapi jangan mengusulkan tag tim " +
          "yang maknanya tidak berhubungan dengan kandidat. Tag baru boleh diusulkan " +
          "HANYA bila benar-benar penting dan MAKSIMAL 2. Tag maksimal 30 karakter, " +
          "Bahasa Indonesia atau istilah teknis yang lazim, tanpa emoji. " +
          'Balas HANYA JSON valid: {"tags": ["tag 1", "tag 2"]}';
        const userPrompt = [
          `Kandidat: ${application.name}${application.position?.title ? ` — posisi: ${application.position.title}` : ""}`,
          "",
          existingNames.length > 0
            ? `Daftar tag tim yang sudah ada:\n${existingNames.map((n) => `- ${n}`).join("\n")}`
            : "Belum ada tag tim — usulkan tag yang paling berguna.",
          "",
          cvText ? `CV (potongan):\n${cvText.slice(0, CV_BUDGET)}` : "",
          screeningSummary ? `Jawaban screening:\n${screeningSummary}` : "",
          formSummary ? `Jawaban formulir:\n${formSummary}` : "",
          "",
          'Balas HANYA JSON: {"tags": ["..."]}',
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
          "Sarankan Tag",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJsonObject(raw);
        const rawTags = parsed && Array.isArray(parsed.tags) ? parsed.tags : [];
        if (rawTags.length === 0) {
          throw new Error("AI tidak mengusulkan tag apa pun.");
        }

        // Post-proses deterministik: normalisasi, utamakan tag eksisting, cap 5
        // total dan maks 2 tag baru.
        const picked: string[] = [];
        const newPicks: string[] = [];
        const seen = new Set<string>();
        for (const item of rawTags) {
          if (typeof item !== "string") continue;
          const tag = item.trim().slice(0, TAG_MAX_CHARS);
          if (!tag) continue;
          const lower = tag.toLowerCase();
          if (seen.has(lower)) continue;
          seen.add(lower);
          const existingName = existingNames.find((n) => n.toLowerCase() === lower);
          if (existingName) {
            if (picked.length >= TAG_MAX) continue;
            picked.push(existingName);
          } else {
            newPicks.push(tag);
          }
        }
        const result = [
          ...picked,
          ...newPicks.slice(0, Math.max(0, Math.min(NEW_TAG_MAX, TAG_MAX - picked.length))),
        ];
        return result.slice(0, TAG_MAX);
      },
    );

    return NextResponse.json({ tags });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/applications/[id]/suggest-tags]", errorMessage(error));
    return NextResponse.json(
      { error: "Usulan tag gagal dibuat. Coba lagi beberapa saat." },
      { status: 500 },
    );
  }
}
