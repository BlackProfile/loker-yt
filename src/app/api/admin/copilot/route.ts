// POST /api/admin/copilot — Copilot Admin (NR49 Paket B).
// Mengumpulkan snapshot konteks rekrutmen (lib/copilot-context) lalu meminta LLM
// menjawab pertanyaan admin DAN (bila relevan) mengusulkan aksi panel dari
// KATALOG TERBATAS (3 tipe). Respons diparse ketat via extractJsonObject dengan
// whitelist type/risk/params — bila gagal, fallback reply teks mentah + actions [].
//
// Semua role yang login boleh bertanya (VIEWER pun), tetapi usulan aksi untuk
// VIEWER di-strip di server (eksekusi tetap dilarang di /copilot/execute).
import { NextRequest, NextResponse } from "next/server";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { asTrimmedString, errorMessage, extractJsonObject } from "@/lib/ai-json";
import { AiGateError, withAiGate } from "@/lib/ai-control";
import type { CopilotActionType, CopilotProposedAction } from "@/lib/ai-features";
import { formatCopilotContext, gatherCopilotContext } from "@/lib/copilot-context";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const AI_TIMEOUT_MS = 90_000;
const MAX_QUESTION_LENGTH = 500;
const MIN_QUESTION_LENGTH = 3;
const MAX_ACTIONS = 3;
const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

const COPILOT_ACTION_TYPES: CopilotActionType[] = [
  "set_application_status",
  "toggle_position",
  "bulk_reject_stale",
];
const ACTION_TYPE_SET = new Set<string>(COPILOT_ACTION_TYPES);

/** Risiko bawaan per tipe aksi — dipakai bila LLM tidak mengirim risk yang sah. */
const DEFAULT_RISK: Record<CopilotActionType, "low" | "medium" | "high"> = {
  set_application_status: "low",
  toggle_position: "medium",
  bulk_reject_stale: "high",
};

const DEFAULT_LABEL: Record<CopilotActionType, string> = {
  set_application_status: "Ubah status lamaran",
  toggle_position: "Buka/tutup posisi",
  bulk_reject_stale: "Tolak massal lamaran lama",
};

const RISK_VALUES = new Set(["low", "medium", "high"]);

/** Validasi ketat daftar aksi usulan LLM: whitelist type/risk/params, maks 3. */
function validateActions(raw: unknown): CopilotProposedAction[] {
  if (!Array.isArray(raw)) return [];
  const out: CopilotProposedAction[] = [];
  for (const item of raw) {
    if (out.length >= MAX_ACTIONS) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type;
    if (typeof type !== "string" || !ACTION_TYPE_SET.has(type)) continue;

    const params: Record<string, string | number> = {};
    const rawParams = obj.params;
    if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
      for (const [key, value] of Object.entries(rawParams as Record<string, unknown>)) {
        const cleanKey = key.trim().slice(0, 40);
        if (!cleanKey) continue;
        if (typeof value === "string") {
          params[cleanKey] = value.slice(0, 200);
        } else if (typeof value === "number" && Number.isFinite(value)) {
          params[cleanKey] = value;
        } else if (typeof value === "boolean") {
          // Normalisasi boolean (mis. active) menjadi 1/0 agar sesuai kontrak UI.
          params[cleanKey] = value ? 1 : 0;
        }
      }
    }

    const actionType = type as CopilotActionType;
    const risk =
      typeof obj.risk === "string" && RISK_VALUES.has(obj.risk)
        ? (obj.risk as CopilotProposedAction["risk"])
        : DEFAULT_RISK[actionType];
    const label = asTrimmedString(obj.label, 120) || DEFAULT_LABEL[actionType];

    out.push({ type: actionType, label, risk, params });
  }
  return out.slice(0, MAX_ACTIONS);
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const body: unknown = await req.json().catch(() => null);
    const question =
      body && typeof body === "object" && typeof (body as { question?: unknown }).question === "string"
        ? (body as { question: string }).question.trim()
        : "";
    if (question.length < MIN_QUESTION_LENGTH) {
      return NextResponse.json({ error: "Pertanyaan terlalu pendek." }, { status: 400 });
    }
    if (question.length > MAX_QUESTION_LENGTH) {
      return NextResponse.json(
        { error: `Pertanyaan maksimal ${MAX_QUESTION_LENGTH} karakter.` },
        { status: 400 }
      );
    }

    const contextText = formatCopilotContext(await gatherCopilotContext());

    const systemPrompt = [
      "Kamu adalah Copilot Admin panel rekrutmen studio konten kreator.",
      "ATURAN JAWAB:",
      "- HANYA gunakan data pada blok KONTEKS di bawah. Jangan mengarang angka, nama, atau id.",
      "- Bahasa Indonesia formal, ringkas, MAKSIMAL 150 kata.",
      "- Bila data tidak tersedia untuk menjawab, katakan jujur bahwa datanya tidak tersedia.",
      "",
      "KATALOG AKSI PANEL (satu-satunya aksi yang boleh kamu usulkan):",
      "1) set_application_status { applicationId, status } — ubah status satu lamaran. risk: \"low\".",
      "2) toggle_position { positionId, active } — buka (active: true) atau tutup (active: false) satu posisi. risk: \"medium\".",
      "3) bulk_reject_stale { days, positionId? } — tolak massal lamaran berstatus Baru yang BELUM PERNAH dilihat admin dan lebih tua dari N hari (N dijepit 14-120, maks 200 lamaran, hanya yang rating 0 dan tidak dibintangi). risk: \"high\".",
      "",
      "ATURAN MENUSULKAN AKSI:",
      "- Bila pertanyaan pengguna bisa diselesaikan dengan aksi di atas, usulkan MAKSIMAL 3 aksi.",
      "- Untuk setiap aksi sertakan: type, label bahasa manusia singkat, risk (\"low\"/\"medium\"/\"high\"), dan params.",
      "- Gunakan id PERSIS seperti yang tertulis di KONTEKS. Bila tidak yakin applicationId/positionId yang dimaksud, JANGAN mengarang id — tanyakan kejelasan di reply dan kirim actions kosong.",
      "- Untuk set_application_status, status harus salah satu tahap sah milik posisi lamaran tersebut (lihat kolom \"tahap sah\" di konteks).",
      "- Aksi berisiko tinggi (massal) hanya diusulkan bila pengguna memintanya secara eksplisit atau konteksnya jelas.",
      "",
      "FORMAT BALASAN (WAJIB satu objek JSON tanpa teks lain):",
      '{"reply": "<jawaban bahasa Indonesia>", "actions": [{"type": "set_application_status", "label": "...", "risk": "low", "params": {"applicationId": "...", "status": "REJECTED"}}]}',
      "Bila tidak ada aksi yang relevan, kirim \"actions\": [].",
      "",
      "KONTEKS:",
      contextText,
    ].join("\n");

    const result = await withAiGate("copilot", { actor: session.name }, async () => {
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
        "Copilot Admin",
        AI_TIMEOUT_MS,
      );
      const rawText = (completion?.choices?.[0]?.message?.content ?? "").trim();
      if (!rawText) {
        throw new Error("Balasan LLM kosong");
      }

      // Parse JSON ketat; gagal -> fallback reply teks mentah tanpa aksi.
      const parsed = extractJsonObject(rawText);
      let reply = asTrimmedString(parsed?.reply, 4000);
      let actions = validateActions(parsed?.actions);
      if (!reply) reply = rawText.slice(0, 2000);

      // VIEWER: server strip seluruh aksi + tambahkan catatan pada reply.
      if (session.role === "VIEWER" && actions.length > 0) {
        actions = [];
        reply +=
          "\n\nCatatan: usulan aksi tidak dapat dijalankan karena Anda masuk sebagai Pengamat (VIEWER).";
      }

      return { reply, actions };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AiGateError) {
      // Pusat Kendali AI memblokir fitur (dimatikan/kuota habis) — 503 dengan pesan gate.
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    console.error("[POST /api/admin/copilot]", errorMessage(error));
    return NextResponse.json(
      { error: "Copilot gagal menjawab. Coba lagi sebentar." },
      { status: 502 }
    );
  }
}
