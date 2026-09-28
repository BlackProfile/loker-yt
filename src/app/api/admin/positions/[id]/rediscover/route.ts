// POST /api/admin/positions/[id]/rediscover — talent rediscovery berbasis AI (OWNER/HR).
// Kumpulan kandidat: talentPool=true ATAU status REJECTED (maks 150, kecuali yang ditolak
// dari posisi yang sama dalam 30 hari terakhir). LLM memberi skor kecocokan terhadap
// deskripsi + persyaratan posisi, lalu ambil 5 teratas.
// Helper ZAI sendiri (pola withZaiRetry) — sengaja tidak menyentuh src/lib/ai.ts.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";
import { parseRequirements } from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };

const AI_TIMEOUT_MS = 90_000;
const MAX_CANDIDATES = 150;
const TOP_N = 5;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ------------------------- Helper ZAI lokal (pola ai.ts) ------------------------- */

type ZaiInstance = Awaited<ReturnType<typeof ZAI.create>>;

let zaiInstance: ZaiInstance | null = null;

async function getZai(): Promise<ZaiInstance> {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
  }
  return zaiInstance;
}

function resetZai(): void {
  zaiInstance = null;
}

/** Operasi SDK dengan 1x percobaan ulang memakai instance segar + batas waktu. */
async function withZaiRetryLocal<T>(operation: (zai: ZaiInstance) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const zai = await getZai();
    try {
      return await Promise.race([
        operation(zai),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Analisis AI melebihi batas waktu")), AI_TIMEOUT_MS),
        ),
      ]);
    } catch (error) {
      lastError = error;
      console.error("[rediscover] request SDK gagal (percobaan " + (attempt + 1) + "):", errorMessage(error));
      resetZai();
    }
  }
  throw lastError;
}

/* ------------------------------ Parsing hasil LLM ------------------------------ */

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fence ? fence[1] : trimmed).trim();
}

/** Cari blok array JSON pertama dalam teks bebas (fallback bila JSON.parse gagal). */
function extractJsonArray(text: string): unknown[] | null {
  const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type RawScore = { id: string; skor: number; alasan: string };

/** Parse balasan LLM menjadi daftar skor; null bila benar-benar gagal. */
function parseRediscoverResult(raw: string): RawScore[] | null {
  const text = stripMarkdownFence(raw);
  let list: unknown[] | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) list = parsed;
    else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const inner = obj.results ?? obj.candidates ?? obj.top;
      if (Array.isArray(inner)) list = inner;
    }
  } catch {
    list = extractJsonArray(text);
  }
  if (!list) return null;

  const scores: RawScore[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const obj = entry as Record<string, unknown>;
    const id = typeof obj.id === "string" ? obj.id.trim() : "";
    if (!id) continue;
    const rawSkor = typeof obj.skor === "number" ? obj.skor : Number(obj.skor);
    const skor = Number.isFinite(rawSkor) ? Math.min(100, Math.max(0, Math.round(rawSkor))) : 0;
    const alasan = typeof obj.alasan === "string" ? obj.alasan.trim().slice(0, 300) : "";
    scores.push({ id, skor, alasan });
  }
  return scores.length > 0 ? scores : null;
}

/* ---------------------------------- Handler ---------------------------------- */

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }
    const { id } = await params;

    const position = await db.position.findUnique({ where: { id } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    // Kandidat: talent pool ATAU ditolak; buang yang sudah diterima kerja, dan
    // jangan ganggu yang baru saja ditolak dari posisi ini (30 hari terakhir).
    const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const candidates = await db.application.findMany({
      where: {
        OR: [{ talentPool: true }, { status: "REJECTED" }],
        hiredAt: null,
        NOT: [{ positionId: position.id, rejectedAt: { gte: cutoff30d } }],
      },
      include: { position: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
      take: MAX_CANDIDATES,
    });

    if (candidates.length === 0) {
      return NextResponse.json({ total: 0, results: [] });
    }

    const requirements = parseRequirements(position.requirements);
    const requirementLines = requirements.length > 0 ? requirements.map((r) => `- ${r}`).join("\n") : "- (tidak dirinci)";
    const candidateLines = candidates
      .map((c, i) => {
        const parts = [
          `${i + 1}. id: ${c.id}`,
          `nama: ${c.name}`,
          `posisi sebelumnya: ${c.position?.title ?? "-"}`,
          `status: ${c.talentPool ? "talent pool" : "ditolak"}`,
          `pengalaman: ${c.experience.slice(0, 400) || "-"}`,
          `alasan melamar: ${c.motivation.slice(0, 200) || "-"}`,
          c.aiScore != null ? `skor screening lama: ${c.aiScore}/100` : "skor screening lama: belum ada",
        ];
        return parts.join(" | ");
      })
      .join("\n");

    const systemPrompt =
      "Kamu adalah talent acquisition assistant untuk studio konten kreator. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      `Tugasmu: rediscovery talent — pilih maksimal ${TOP_N} kandidat lama yang paling cocok untuk posisi berikut.`,
      "",
      `Posisi: ${position.title}`,
      `Departemen: ${position.department}`,
      `Jenis: ${position.type} — Lokasi: ${position.location}`,
      `Deskripsi: ${position.description}`,
      "Persyaratan:",
      requirementLines,
      position.aiCriteria?.trim() ? `Kriteria khusus posisi ini: ${position.aiCriteria.trim()}` : "",
      "",
      `Daftar kandidat (${candidates.length} orang):`,
      candidateLines,
      "",
      "Aturan:",
      "- Nilai kecocokan tiap kandidat terhadap posisi (skor 0-100 integer).",
      "- alasan: 1-2 kalimat bahasa Indonesia yang spesifik (sebut kekuatan/kesenjangan utamanya).",
      `- Pilih hanya maksimal ${TOP_N} kandidat terbaik, urut dari skor tertinggi.`,
      "- Gunakan id kandidat persis seperti daftar.",
      "",
      "Balas HANYA JSON valid dengan format:",
      `{"results": [{"id": "<id kandidat>", "skor": <0-100>, "alasan": "<alasan singkat>"}]}`,
    ]
      .filter(Boolean)
      .join("\n");

    let parsed: RawScore[] | null;
    try {
      const completion = await withZaiRetryLocal((zai) =>
        zai.chat.completions.create({
          messages: [
            { role: "assistant", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          thinking: { type: "disabled" },
        }),
      );
      const raw = completion?.choices?.[0]?.message?.content ?? "";
      parsed = parseRediscoverResult(raw);
    } catch (error) {
      console.error("[POST /api/admin/positions/[id]/rediscover] LLM gagal:", errorMessage(error));
      return NextResponse.json({ error: "Analisis AI gagal, coba lagi." }, { status: 502 });
    }

    if (!parsed) {
      return NextResponse.json({ error: "Hasil AI tidak bisa dibaca, coba lagi." }, { status: 502 });
    }

    // Petakan skor ke data kandidat asli (id, fallback nama) lalu ambil 5 teratas.
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const byName = new Map(candidates.map((c) => [c.name.trim().toLowerCase(), c]));
    const results = parsed
      .map((score) => {
        const candidate = byId.get(score.id) ?? byName.get(score.id.trim().toLowerCase());
        if (!candidate) return null;
        return {
          id: candidate.id,
          name: candidate.name,
          skor: score.skor,
          alasan: score.alasan,
          appliedAt: candidate.createdAt.toISOString(),
          priorTitle: candidate.position?.title ?? null,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => b.skor - a.skor)
      .slice(0, TOP_N);

    // Realtime: tidak ada mutasi data, tapi tab lain boleh ikut segarkan ringkasan.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ total: candidates.length, results });
  } catch (error) {
    console.error("[POST /api/admin/positions/[id]/rediscover]", error);
    return NextResponse.json({ error: "Gagal mencari talent lama. Coba lagi nanti." }, { status: 500 });
  }
}
