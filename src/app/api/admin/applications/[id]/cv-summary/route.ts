// POST /api/admin/applications/[id]/cv-summary — ringkasan CV otomatis (NR38-C fitur 5).
// Menjalankan LLM atas Application.cvText (hasil "Baca CV dengan OCR") lalu
// menyimpan JSON {bullets, generatedAt} ke Application.cvSummary + cvSummaryAt.
// Pola AI mengikuti route /ai: requireRole OWNER/HR, withZaiRetry + withTimeout,
// parsing JSON via helper ai-json. Gagal LLM -> 502 dengan pesan Indonesia.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { extractJsonObject } from "@/lib/ai-json";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

// Batas panjang teks CV yang dikirim ke LLM (hemat token, CV 3-5 halaman cukup).
const CV_TEXT_MAX = 12_000;
const BULLETS_MAX = 6;
const BULLET_MAX_CHARS = 200;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }
    const { id } = await params;

    const application = await db.application.findUnique({
      where: { id },
      select: { id: true, name: true, cvText: true, position: { select: { title: true } } },
    });
    if (!application) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const cvText = (application.cvText ?? "").trim();
    if (!cvText) {
      return NextResponse.json(
        { error: "Jalankan 'Baca CV dengan OCR' terlebih dahulu." },
        { status: 400 }
      );
    }

    const systemPrompt =
      "Kamu adalah asisten HR untuk studio konten kreator. Ringkas CV secara faktual. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      `Ringkas CV berikut untuk kandidat ${application.name}${
        application.position?.title ? ` (posisi dilamar: ${application.position.title})` : ""
      }.`,
      "Tulis 4-6 butir Bahasa Indonesia yang mencakup: pengalaman inti kandidat, lama bekerja di posisi terakhir, lisensi/sertifikat yang relevan, dan catatan khusus atau red flag bila ada.",
      "Setiap butir maksimal 18 kata, gaya netral untuk admin rekrutmen, tanpa nomor urut.",
      "",
      "CV:",
      cvText.slice(0, CV_TEXT_MAX),
      "",
      "Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain) dengan format:",
      '{"bullets": ["butir 1", "butir 2", "butir 3", "butir 4"]}',
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
      "Ringkasan CV",
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";

    const parsed = extractJsonObject(raw);
    const rawBullets = parsed && Array.isArray(parsed.bullets) ? parsed.bullets : null;
    const bullets = (rawBullets ?? [])
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().replace(/^[-*•\d.)\s]+/, "").slice(0, BULLET_MAX_CHARS))
      .filter((item) => item.length > 0)
      .slice(0, BULLETS_MAX);

    if (bullets.length === 0) {
      console.error("[POST cv-summary] hasil LLM tidak bisa diparse:", raw.slice(0, 200));
      return NextResponse.json(
        { error: "AI gagal membuat ringkasan CV. Coba lagi beberapa saat." },
        { status: 502 }
      );
    }

    const generatedAt = new Date().toISOString();
    await db.application.update({
      where: { id },
      data: {
        cvSummary: JSON.stringify({ bullets, generatedAt }),
        cvSummaryAt: new Date(),
      },
    });
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: "AI",
        action: "CV_SUMMARY",
        detail: `Ringkasan CV dibuat (${bullets.length} butir)`,
      },
    });

    // Realtime: data lamaran berubah — segarkan panel admin yang terbuka.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, summary: { bullets, generatedAt } });
  } catch (error) {
    console.error("[POST /api/admin/applications/[id]/cv-summary]", errorMessage(error));
    return NextResponse.json(
      { error: "Ringkasan CV gagal dibuat. Coba lagi beberapa saat." },
      { status: 502 }
    );
  }
}
