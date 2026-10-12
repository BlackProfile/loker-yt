// NR49 Paket C fitur 3 — Analisis Alasan Penolakan.
// GET  /api/admin/rejection-analysis — semua role login: statistik penolakan
//      90 hari terakhir (jumlah per alasan, sampel catatan, distribusi posisi)
//      + insight AI tersimpan (cache Setting "rejection_insight") bila ada.
// POST /api/admin/rejection-analysis — OWNER/HR: LLM menganalisis statistik
//      menjadi "3 tren utama" + "2 saran perbaikan" (≤160 kata) lalu disimpan.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { REJECTION_REASON_LABELS, type RejectionReason } from "@/lib/types";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage } from "@/lib/ai-json";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const INSIGHT_KEY = "rejection_insight";
const AI_TIMEOUT_MS = 60_000;

export type RejectionStats = {
  total: number;
  perReason: { key: string; label: string; count: number }[];
  samples: { name: string; note: string; at: string }[];
  perPosition: { title: string; count: number }[];
  insight: { content: string; generatedAt: string } | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Baca cache insight dari Setting; null bila tidak ada/rusak. */
async function readInsight(): Promise<{ content: string; generatedAt: string } | null> {
  try {
    const row = await db.setting.findUnique({ where: { key: INSIGHT_KEY } });
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.content === "string" && obj.content.trim().length > 0) {
        return {
          content: obj.content,
          generatedAt:
            typeof obj.generatedAt === "string" ? obj.generatedAt : row.updatedAt.toISOString(),
        };
      }
    }
  } catch {
    // JSON rusak — anggap tidak ada.
  }
  return null;
}

/** Hitung statistik penolakan 90 hari terakhir (dipakai GET & POST). */
async function collectStats(): Promise<Omit<RejectionStats, "insight">> {
  const since = new Date(Date.now() - 90 * DAY_MS);
  const rows = await db.application.findMany({
    where: { rejectedAt: { not: null, gte: since } },
    select: {
      name: true,
      rejectionReason: true,
      rejectionNote: true,
      rejectedAt: true,
      position: { select: { title: true } },
    },
    orderBy: { rejectedAt: "desc" },
  });

  // Jumlah per alasan — null / nilai tak dikenal masuk kategori "Alasan lain".
  const reasonCounts = new Map<string, number>();
  for (const row of rows) {
    const key = row.rejectionReason && row.rejectionReason in REJECTION_REASON_LABELS
      ? (row.rejectionReason as RejectionReason)
      : "LAINNYA";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const perReason = Array.from(reasonCounts.entries())
    .map(([key, count]) => ({
      key,
      label: REJECTION_REASON_LABELS[key as RejectionReason] ?? REJECTION_REASON_LABELS.LAINNYA,
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // 3 sampel catatan penolakan terbaru yang tidak kosong.
  const samples = rows
    .filter((row) => (row.rejectionNote ?? "").trim().length > 0)
    .slice(0, 3)
    .map((row) => ({
      name: row.name,
      note: (row.rejectionNote ?? "").trim().slice(0, 200),
      at: (row.rejectedAt ?? new Date()).toISOString(),
    }));

  // Distribusi per posisi (top 5).
  const posCounts = new Map<string, number>();
  for (const row of rows) {
    const title = row.position?.title?.trim();
    if (!title) continue;
    posCounts.set(title, (posCounts.get(title) ?? 0) + 1);
  }
  const perPosition = Array.from(posCounts.entries())
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total: rows.length, perReason, samples, perPosition };
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const [stats, insight] = await Promise.all([collectStats(), readInsight()]);
    const payload: RejectionStats = { ...stats, insight };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[GET /api/admin/rejection-analysis]", errorMessage(error));
    return NextResponse.json({ error: "Gagal memuat analisis penolakan." }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "HR") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const stats = await collectStats();
    if (stats.total === 0) {
      return NextResponse.json(
        { error: "Belum ada penolakan dalam 90 hari terakhir untuk dianalisis." },
        { status: 400 },
      );
    }

    const insight = await withAiGate(
      "rejection_insight",
      { actor: session.name, detailOk: `Insight ${stats.total} penolakan` },
      async () => {
        const systemPrompt =
          "Kamu adalah analis proses rekrutmen Lumina Studio. Diberi statistik alasan " +
          "penolakan 90 hari terakhir. Tulis analisis Bahasa Indonesia formal berisi " +
          "TIGA tren utama (awali baris dengan \"1. \", \"2. \", \"3. \") lalu DUA saran " +
          "perbaikan proses (awali dengan \"Saran 1:\", \"Saran 2:\"). Total maksimal 160 kata. " +
          "Gunakan HANYA angka dari data — jangan mengarang. Tanpa emoji, tanpa markdown " +
          "lain, tanpa sapaan. Balas HANYA isi analisisnya.";
        const userPrompt = [
          "Statistik penolakan 90 hari terakhir:",
          `Total penolakan: ${stats.total}`,
          "Per alasan: " +
            (stats.perReason.length > 0
              ? stats.perReason.map((r) => `${r.label}: ${r.count}`).join(", ")
              : "tidak ada"),
          stats.perPosition.length > 0
            ? "Per posisi (top 5): " + stats.perPosition.map((p) => `${p.title}: ${p.count}`).join(", ")
            : "",
          stats.samples.length > 0
            ? "Contoh catatan penolakan terbaru:\n" + stats.samples.map((s) => `- ${s.note}`).join("\n")
            : "",
          "",
          "Tulis analisis (3 tren utama + 2 saran perbaikan, maksimal 160 kata).",
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
          "Analisis Penolakan",
          AI_TIMEOUT_MS,
        );
        const raw = (completion?.choices?.[0]?.message?.content ?? "").trim();
        const clean = raw
          .replace(/^#{1,6}\s*/gm, "")
          .replace(/\*\*/g, "")
          .trim()
          .slice(0, 2200);
        if (!clean) {
          throw new Error("AI gagal membuat analisis penolakan.");
        }
        return clean;
      },
    );

    const payload = { content: insight, generatedAt: new Date().toISOString() };
    await db.setting.upsert({
      where: { key: INSIGHT_KEY },
      create: { key: INSIGHT_KEY, value: JSON.stringify(payload) },
      update: { value: JSON.stringify(payload) },
    });
    return NextResponse.json({ insight: payload });
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/rejection-analysis]", errorMessage(error));
    return NextResponse.json(
      { error: "Analisis penolakan gagal dibuat. Coba lagi beberapa saat." },
      { status: 500 },
    );
  }
}
