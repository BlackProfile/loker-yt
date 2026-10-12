// NR49 Paket C fitur 2 — Penjelasan Risiko (POST, semua role login).
// body { kind: "interview" | "offer", id } — kumpulkan sinyal & fakta mentah
// (angka) yang sama dengan heuristik skor risiko, lalu LLM menerjemahkannya
// menjadi { reason: "≤80 kata penyebab risiko", suggestion: "≤40 kata saran" }.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { asTrimmedString, errorMessage, extractJsonObject } from "@/lib/ai-json";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const AI_TIMEOUT_MS = 60_000;

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
    const data = body as Record<string, unknown>;
    const kind = data.kind === "offer" ? "offer" : data.kind === "interview" ? "interview" : null;
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (!kind || !id) {
      return NextResponse.json({ error: "kind dan id wajib diisi." }, { status: 400 });
    }

    const now = new Date();
    const DAY_MS = 24 * 60 * 60 * 1000;

    // Kumpulkan fakta mentah + sinyal yang sama dengan heuristik skor risiko.
    let facts: Record<string, unknown> | null = null;
    if (kind === "interview") {
      const iv = await db.interview.findUnique({
        where: { id },
        include: {
          application: {
            select: {
              name: true,
              createdAt: true,
              candidateSeenCount: true,
              position: { select: { title: true } },
            },
          },
        },
      });
      if (!iv) {
        return NextResponse.json({ error: "Sesi wawancara tidak ditemukan." }, { status: 404 });
      }
      const hoursUntil = Math.round(((iv.scheduledAt.getTime() - now.getTime()) / 3_600_000) * 10) / 10;
      const appAgeDays = Math.round(((now.getTime() - iv.application.createdAt.getTime()) / DAY_MS) * 10) / 10;
      facts = {
        jenis: "wawancara",
        nama: iv.application.name,
        posisi: iv.application.position?.title ?? null,
        status_wawancara: iv.status,
        ronde: iv.round,
        jadwal: iv.scheduledAt.toISOString(),
        jam_lagi: hoursUntil,
        reschedule_diminta: iv.status === "RESCHEDULE_REQUESTED",
        alasan_reschedule: iv.rescheduleReason ?? null,
        usulan_jadwal_baru: iv.rescheduleProposedAt?.toISOString() ?? null,
        jumlah_pembukaan_status_lamaran: iv.application.candidateSeenCount,
        umur_lamaran_hari: appAgeDays,
      };
    } else {
      const app = await db.application.findUnique({
        where: { id },
        select: {
          name: true,
          createdAt: true,
          candidateSeenCount: true,
          offerSentAt: true,
          offerDeadline: true,
          offerRespondedAt: true,
          offerSalary: true,
          position: { select: { title: true } },
        },
      });
      if (!app) {
        return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
      }
      const daysPending =
        app.offerSentAt != null
          ? Math.round(((now.getTime() - app.offerSentAt.getTime()) / DAY_MS) * 10) / 10
          : null;
      const daysToDeadline =
        app.offerDeadline != null
          ? Math.round(((app.offerDeadline.getTime() - now.getTime()) / DAY_MS) * 10) / 10
          : null;
      facts = {
        jenis: "offer",
        nama: app.name,
        posisi: app.position?.title ?? null,
        status_offer: "PENDING",
        dikirim: app.offerSentAt?.toISOString() ?? null,
        hari_menunggu: daysPending,
        batas_jawaban: app.offerDeadline?.toISOString() ?? null,
        hari_menuju_batas: daysToDeadline,
        sudah_menjawab: app.offerRespondedAt != null,
        jumlah_pembukaan_status_lamaran: app.candidateSeenCount,
      };
    }

    const result = await withAiGate(
      "risk_explain",
      { actor: session.name, detailOk: `Penjelasan risiko ${kind}` },
      async () => {
        const systemPrompt =
          "Kamu adalah analis rekrutmen Lumina Studio. Diberi fakta mentah satu kandidat " +
          "berisiko (wawancara berpotensi tidak hadir atau offer tak kunjung dijawab). " +
          "Jelaskan penyebab risikonya dan beri saran konkret untuk admin. " +
          "Bahasa Indonesia formal, tanpa emoji, hanya dari fakta yang diberikan. " +
          'Balas HANYA JSON valid: {"reason": "<maksimal 80 kata penyebab risiko>", ' +
          '"suggestion": "<maksimal 40 kata saran konkret>"}';
        const userPrompt = `Fakta kandidat (JSON):\n${JSON.stringify(facts, null, 2)}\n\nBalas HANYA JSON dengan kunci "reason" dan "suggestion".`;
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
          "Penjelasan Risiko",
          AI_TIMEOUT_MS,
        );
        const raw = completion?.choices?.[0]?.message?.content ?? "";
        const parsed = extractJsonObject(raw);
        const reason = parsed ? asTrimmedString(parsed.reason, 600) : "";
        const suggestion = parsed ? asTrimmedString(parsed.suggestion, 400) : "";
        if (!reason) {
          throw new Error("AI gagal menjelaskan risiko kandidat ini.");
        }
        return { reason, suggestion: suggestion || "Hubungi kandidat untuk memastikan keputusannya." };
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiGateError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/risk-explain]", errorMessage(error));
    return NextResponse.json(
      { error: "Penjelasan risiko gagal dibuat. Coba lagi beberapa saat." },
      { status: 500 },
    );
  }
}
