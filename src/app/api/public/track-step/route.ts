// POST /api/public/track-step — pelacakan drop-off langkah wizard lamaran (Task 27).
// Tanpa auth (dipanggil dari form publik): menerima {positionId?, step, event}
// lalu menyimpan satu baris FormStepStat. Seluruh error DITELAN dan dibalas 204
// agar pelacakan tidak pernah mengganggu UX pelamar.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Rate limit ringan per IP: 1 permintaan / 300ms (pola rateMap di /api/public/slots).
const RATE_MS = 300;
const rateMap = new Map<string, number>();

const ALLOWED_EVENTS = new Set(["enter", "advance", "submit"]);

function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return noContent();
    }
    const data = body as Record<string, unknown>;

    const event = typeof data.event === "string" ? data.event : "";
    const step = typeof data.step === "number" ? Math.round(data.step) : Number.NaN;
    const positionId =
      typeof data.positionId === "string" && data.positionId.trim()
        ? data.positionId.trim().slice(0, 64)
        : null;

    // Validasi longgar: payload tak valid tetap dibalas 204 (bukan error untuk klien).
    if (!ALLOWED_EVENTS.has(event) || !Number.isInteger(step) || step < 1 || step > 12) {
      return noContent();
    }

    // Rate limit ringan per IP — permintaan terlalu cepat diabaikan diam-diam.
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded
      ? (forwarded.split(",")[0] ?? "").trim()
      : (req.headers.get("x-real-ip") ?? "").trim();
    const ipKey = ip || "unknown";

    const now = Date.now();
    const last = rateMap.get(ipKey) ?? 0;
    if (now - last < RATE_MS) return noContent();
    rateMap.set(ipKey, now);
    if (rateMap.size > 500) {
      for (const [key, ts] of rateMap) {
        if (now - ts > 60_000) rateMap.delete(key);
      }
    }

    await db.formStepStat.create({
      data: {
        positionId,
        step,
        event: event as "enter" | "advance" | "submit",
      },
    });
  } catch {
    // Seluruh error ditelan — pelacakan bersifat best-effort.
  }
  return noContent();
}
