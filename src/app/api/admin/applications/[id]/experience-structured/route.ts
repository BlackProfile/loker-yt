// NR50 fitur 5 — Uraian Pengalaman Terstruktur (AI).
// POST /api/admin/applications/[id]/experience-structured — semua role login (aksi ringan);
//      LLM membaca teks CV (fallback: ringkasan pengalaman klasik) lalu mengekstrak
//      daftar pengalaman kerja menjadi tabel {company, position, period}.
//      Hasil disimpan ke Application.experienceStructured (JSON {items, generatedAt}).
// GET  /api/admin/applications/[id]/experience-structured — semua role login:
//      kembalikan hasil tersimpan bila ada → { experience | null }.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { asTrimmedString, errorMessage, extractJsonObject } from "@/lib/ai-json";
import type { StructuredExperienceItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const AI_TIMEOUT_MS = 90_000;
const SOURCE_MAX_CHARS = 8000; // batas teks yang dikirim ke LLM
const MAX_ITEMS = 30; // batas baris pengalaman tersimpan
const PERIOD_MAX = 60; // batas teks periode per baris

/** Baca hasil terstruktur tersimpan; null bila tidak ada/rusak. */
async function readStoredExperience(
  applicationId: string,
): Promise<{ items: StructuredExperienceItem[]; generatedAt: string } | null> {
  const app = await db.application.findUnique({
    where: { id: applicationId },
    select: { experienceStructured: true },
  });
  if (!app?.experienceStructured) return null;
  try {
    const parsed: unknown = JSON.parse(app.experienceStructured);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.items) || obj.items.length === 0) return null;
    const items: StructuredExperienceItem[] = [];
    for (const item of obj.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const o = item as Record<string, unknown>;
      const company = typeof o.company === "string" ? o.company.trim() : "";
      const position = typeof o.position === "string" ? o.position.trim() : "";
      const period = typeof o.period === "string" ? o.period.trim() : "";
      if (!company && !position) continue;
      items.push({ company, position, period });
    }
    if (items.length === 0) return null;
    return {
      items: items.slice(0, MAX_ITEMS),
      generatedAt: typeof obj.generatedAt === "string" ? obj.generatedAt : "",
    };
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;
    const experience = await readStoredExperience(id);
    return NextResponse.json({ experience });
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/experience-structured]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat pengalaman terstruktur." }, { status: 500 });
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      select: { id: true, name: true, cvText: true, experience: true },
    });
    if (!application) {
      return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
    }

    // Prioritas teks CV hasil OCR; fallback ke isian pengalaman klasik.
    const source = (application.cvText?.trim() || application.experience.trim() || "").slice(
      0,
      SOURCE_MAX_CHARS,
    );
    if (!source) {
      return NextResponse.json(
        { error: "Belum ada teks CV maupun isian pengalaman untuk dianalisis." },
        { status: 400 },
      );
    }

    const items = await withAiGate(
      "experience_structured",
      { actor: session.name, detailOk: "Pengalaman terstruktur" },
      async () => {
        const systemPrompt =
          "Kamu adalah asisten rekrutmen Lumina Studio. Diberi teks CV/isian pengalaman milik " +
          "satu kandidat. Tugasmu: ekstrak SEMUA pengalaman kerja/magang/organisasi yang tercantum " +
          "menjadi daftar terstruktur urut dari yang TERBARU ke TERLAMA. Untuk tiap baris isi: " +
          "company = nama perusahaan/organisasi (atau \"Proyek/Freelance\" bila tidak bekerja di perusahaan), " +
          "position = jabatan/peran, period = teks periode apa adunya (mis. \"Jan 2022 - Mar 2024\" atau \"2 tahun\"). " +
          "JANGAN mengarang data yang tidak ada di teks. Abaikan pendidikan/sertifikasi. " +
          "Bila teks tidak memuat pengalaman kerja apa pun, kembalikan items kosong. " +
          'Balas HANYA JSON valid: {"items": [{"company": "...", "position": "...", "period": "..."}]}';

        const userPrompt = [
          `Teks milik kandidat ${application.name}:`,
          '"""',
          source,
          '"""',
          "",
          'Balas HANYA JSON: {"items": [...]}',
        ].join("\n");

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
          "Pengalaman Terstruktur",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJsonObject(raw);
        if (!parsed || !Array.isArray((parsed as Record<string, unknown>).items)) {
          throw new Error("AI gagal mengekstrak pengalaman dari teks ini.");
        }
        const out: StructuredExperienceItem[] = [];
        for (const item of (parsed as Record<string, unknown>).items as unknown[]) {
          if (!item || typeof item !== "object" || Array.isArray(item)) continue;
          const o = item as Record<string, unknown>;
          const company = asTrimmedString(o.company, 120);
          const position = asTrimmedString(o.position, 120);
          const period = asTrimmedString(o.period, PERIOD_MAX);
          if (!company && !position) continue;
          out.push({ company, position, period });
        }
        return out.slice(0, MAX_ITEMS);
      },
    );

    if (items.length === 0) {
      return NextResponse.json({
        items: [],
        message: "Tidak ditemukan pengalaman kerja pada teks sumber.",
      });
    }

    const generatedAt = new Date().toISOString();
    await db.application.update({
      where: { id },
      data: { experienceStructured: JSON.stringify({ items, generatedAt }) },
    });
    return NextResponse.json({ items, generatedAt });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/applications/[id]/experience-structured]", errorMessage(error));
    return NextResponse.json(
      { error: "Analisis pengalaman gagal. Coba lagi beberapa saat." },
      { status: 500 },
    );
  }
}
