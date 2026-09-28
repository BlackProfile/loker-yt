// POST /api/admin/ask-data — chatbot data admin "Tanya Data" (Task 20-c).
// Mengumpulkan statistik rekrutmen dari DB lalu meminta LLM menjawab pertanyaan
// admin HANYA berdasarkan data tersebut (bahasa Indonesia, ringkas, jujur bila
// data tidak tersedia). Mengembalikan jawaban teks: { reply }.
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  OFFER_STATUS_LABELS,
  REJECTION_REASON_LABELS,
  STATUS_LABELS,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const MAX_QUESTION_LENGTH = 500;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const APPLICATION_STATUSES = Object.keys(STATUS_LABELS);
const REJECTION_REASONS = Object.keys(REJECTION_REASON_LABELS);
const OFFER_STATUSES = Object.keys(OFFER_STATUS_LABELS);
const INTERVIEW_STATUSES = [
  "SCHEDULED",
  "CONFIRMED",
  "RESCHEDULE_REQUESTED",
  "COMPLETED",
  "NO_SHOW",
  "CANCELLED",
];
const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  CONFIRMED: "Dikonfirmasi",
  RESCHEDULE_REQUESTED: "Minta Ubah Jadwal",
  COMPLETED: "Selesai",
  NO_SHOW: "Tidak Hadir",
  CANCELLED: "Dibatalkan",
};

/** Prisma groupBy → map {kunci: jumlah} hanya untuk kunci yang dikenal. */
function countMap(rows: { key: string | null; count: number }[], knownKeys: string[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of knownKeys) result[key] = 0;
  for (const row of rows) {
    if (row.key && knownKeys.includes(row.key)) result[row.key] += row.count;
  }
  return result;
}

async function collectStats(): Promise<string> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthLabel = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" }).format(now);

  const [statusRows, positionRows, aiScoreAgg, rejectionRows, offerRows, interviewRows, hiredAgg, positions] =
    await Promise.all([
      db.application.groupBy({ by: ["status"], _count: { _all: true } }),
      db.application.groupBy({
        by: ["positionId"],
        where: { positionId: { not: null } },
        _count: { _all: true },
      }),
      db.application.aggregate({ _avg: { aiScore: true } }),
      db.application.groupBy({
        by: ["rejectionReason"],
        where: { rejectedAt: { gte: startOfMonth } },
        _count: { _all: true },
      }),
      db.application.groupBy({
        by: ["offerStatus"],
        where: { offerStatus: { not: null } },
        _count: { _all: true },
      }),
      db.interview.groupBy({ by: ["status"], _count: { _all: true } }),
      db.application.count({ where: { hiredAt: { gte: startOfMonth } } }),
      db.position.findMany({ select: { id: true, title: true }, orderBy: { createdAt: "asc" } }),
    ]);

  const positionTitle = new Map(positions.map((p) => [p.id, p.title]));
  const perStatus = countMap(
    statusRows.map((row) => ({ key: row.status, count: row._count._all })),
    APPLICATION_STATUSES
  );
  const perRejection = countMap(
    rejectionRows.map((row) => ({ key: row.rejectionReason, count: row._count._all })),
    REJECTION_REASONS
  );
  const perOffer = countMap(
    offerRows.map((row) => ({ key: row.offerStatus, count: row._count._all })),
    OFFER_STATUSES
  );
  const perInterview = countMap(
    interviewRows.map((row) => ({ key: row.status, count: row._count._all })),
    INTERVIEW_STATUSES
  );

  const perPositionLines = positionRows
    .map((row) => {
      const title = row.positionId ? positionTitle.get(row.positionId) : null;
      return `- ${title ?? "(posisi terhapus)"}: ${row._count._all} lamaran`;
    })
    .join("\n");

  return [
    `Periode referensi: ${monthLabel}.`,
    "",
    "JUMLAH LAMARAN PER STATUS (total semua waktu):",
    ...Object.entries(perStatus).map(([key, count]) => `- ${STATUS_LABELS[key as keyof typeof STATUS_LABELS]} (${key}): ${count}`),
    "",
    "JUMLAH LAMARAN PER POSISI:",
    perPositionLines || "- (belum ada lamaran)",
    "",
    `RATA-RATA SKOR AI SCREENING: ${aiScoreAgg._avg.aiScore != null ? Math.round(aiScoreAgg._avg.aiScore) : "belum ada data"}`,
    "",
    `LAMARAN DITOLAK BULAN INI (per alasan):`,
    ...Object.entries(perRejection).map(
      ([key, count]) => `- ${REJECTION_REASON_LABELS[key as keyof typeof REJECTION_REASON_LABELS]} (${key}): ${count}`
    ),
    "",
    "PENAWARAN (OFFER) PER STATUS:",
    ...Object.entries(perOffer).map(
      ([key, count]) => `- ${OFFER_STATUS_LABELS[key as keyof typeof OFFER_STATUS_LABELS]} (${key}): ${count}`
    ),
    "",
    "WAWANCARA PER STATUS:",
    ...Object.entries(perInterview).map(([key, count]) => `- ${INTERVIEW_STATUS_LABELS[key]} (${key}): ${count}`),
    "",
    `KARYAWAN DITERIMA (hiredAt) BULAN INI: ${hiredAgg}`,
  ].join("\n");
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
    const question =
      body && typeof body === "object" && typeof (body as { question?: unknown }).question === "string"
        ? (body as { question: string }).question.trim()
        : "";
    if (question.length < 3) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { error: `Pertanyaan maksimal ${MAX_QUESTION_LENGTH} karakter.` },
        { status: 400 }
      );
    }

    const stats = await collectStats();
    const systemPrompt = [
      "Kamu adalah asisten data HR untuk panel admin studio konten kreator.",
      "Jawab pertanyaan admin BERDASARKAN data berikut saja, bahasa Indonesia, ringkas (maksimal 6 kalimat atau daftar pendek).",
      "Bila data tak tersedia atau tidak menjawab pertanyaan, katakan jujur bahwa datanya tidak tersedia.",
      "Jangan mengarang angka. Angka bulatkan seperlunya. Boleh gunakan poin singkat.",
      "",
      "DATA:",
      stats,
    ].join("\n");

    const completion = await withTimeout(
      withZaiRetry((zai) =>
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: systemPrompt },
            { role: "user", content: question },
          ],
          thinking: { type: "disabled" },
        }),
      ),
      "Tanya Data",
      AI_TIMEOUT_MS,
    );
    const reply = (completion?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) {
      console.error("[POST /api/admin/ask-data] balasan LLM kosong");
      return NextResponse.json(
        { error: "AI tidak memberikan jawaban. Coba lagi sebentar." },
        { status: 502 }
      );
    }
    return NextResponse.json({ reply });
  } catch (error) {
    console.error("[POST /api/admin/ask-data]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal menjawab pertanyaan. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
