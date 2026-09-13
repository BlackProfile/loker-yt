// POST /api/admin/positions/[id]/generate-brief — generator brief tes praktik via LLM (Task 20-c).
// Body { level?: "Junior|Mid|Senior" }. LLM menghasilkan JSON { title, note }:
// note 80-150 kata dengan format brief nyata (konteks, tugas, kriteria penilaian).
// Tidak menulis ke DB — hasil diisi ke form posisi dan admin masih bisa menyunting.
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { errorMessage, extractJsonObject, asTrimmedString } from "@/lib/ai-json";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseRequirements } from "@/lib/seed";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

const LEVELS = ["Junior", "Mid", "Senior"] as const;
type Level = (typeof LEVELS)[number];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const position = await db.position.findUnique({ where: { id } });
    if (!position) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const body: unknown = await req.json().catch(() => null);
    const rawLevel = body && typeof body === "object" ? (body as { level?: unknown }).level : null;
    const level: Level = (LEVELS as readonly string[]).includes(rawLevel as string)
      ? (rawLevel as Level)
      : "Mid";

    const requirements = parseRequirements(position.requirements).slice(0, 6);

    const systemPrompt =
      "Kamu adalah desainer tes praktik rekrutmen untuk studio konten kreator. Jawab HANYA JSON valid tanpa teks lain.";
    const userPrompt = [
      "Buat brief tes praktik (tes kerja nyata) untuk pelamar posisi berikut.",
      "",
      `Posisi: ${position.title}`,
      `Departemen: ${position.department}`,
      `Jenis: ${position.type} — Lokasi: ${position.location}`,
      `Level kandidat: ${level}`,
      `Deskripsi posisi: ${position.description.slice(0, 600)}`,
      `Persyaratan: ${requirements.length ? requirements.join("; ") : "(tidak dirinci)"}`,
      "",
      "Aturan output:",
      "- Bahasa Indonesia, nada profesional.",
      "- note berisi 80-150 kata dengan struktur: 1) Konteks singkat, 2) Tugas yang harus dikerjakan, 3) Kriteria penilaian.",
      "- title singkat dan spesifik (maksimal 80 karakter), tanpa tanda kutip.",
      "- Brief harus bisa dikerjakan pelamar secara mandiri (remote-friendly).",
      'Balas HANYA dengan JSON valid (tanpa markdown, tanpa teks lain): {"title": "<judul tes>", "note": "<isi brief>"}',
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
      "Pembuatan brief tes praktik",
      AI_TIMEOUT_MS,
    );
    const raw = completion?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJsonObject(raw);
    const note = parsed ? asTrimmedString(parsed.note, 2000) : "";
    if (!parsed || note.length < 40) {
      console.error(
        "[POST /api/admin/positions/[id]/generate-brief] hasil LLM tidak bisa diparse:",
        raw.slice(0, 300)
      );
      return NextResponse.json(
        { error: "AI tidak menghasilkan brief yang valid. Coba lagi sebentar." },
        { status: 502 }
      );
    }

    const fallbackTitle = `${position.title} — Tes Praktik (${level})`;
    const title = asTrimmedString(parsed.title, 120) || fallbackTitle;
    return NextResponse.json({ title, note });
  } catch (error) {
    console.error("[POST /api/admin/positions/[id]/generate-brief]", errorMessage(error));
    return NextResponse.json(
      { error: "Gagal membuat brief tes. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
