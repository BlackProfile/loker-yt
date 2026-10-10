// NR45 — GET/POST /api/admin/server-health — kesehatan & beban server real-time.
// GET (OWNER/HR)  -> ServerLoadSnapshot (src/lib/types.ts) — tiap pemanggilan
//                    juga menggerakkan streak Mode Hemat AUTO + alert Telegram.
// POST (OWNER)    -> aksi panel: clearCache | saveModeOn | saveModeOff |
//                    demoSlow | demoQueue (semua aman, untuk kartu dashboard).
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import {
  activateSaveMode,
  deactivateSaveMode,
  enqueueAiJob,
  getServerLoadSnapshot,
  memoClear,
  memoStats,
  recordSlowRequest,
  sleep,
} from "@/lib/load-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "HR") {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const snapshot = await getServerLoadSnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("[GET /api/admin/server-health]", error);
    return NextResponse.json(
      { error: "Gagal memeriksa kesehatan server." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(
        { error: "Hanya OWNER dapat mengubah pengaturan beban server." },
        { status: 403 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const action =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).action
        : undefined;

    switch (action) {
      // Bersihkan seluruh memo cache bacaan panas.
      case "clearCache": {
        memoClear();
        return NextResponse.json({ ok: true, message: "Cache memori dibersihkan.", cache: memoStats() });
      }

      // Mode Hemat manual.
      case "saveModeOn": {
        const reason =
          typeof (body as Record<string, unknown>).reason === "string"
            ? ((body as Record<string, unknown>).reason as string).slice(0, 200)
            : "Diaktifkan manual dari panel Kesehatan Server";
        await activateSaveMode("MANUAL", reason);
        return NextResponse.json({ ok: true, message: "Mode Hemat diaktifkan (manual)." });
      }
      case "saveModeOff": {
        await deactivateSaveMode("Dinonaktifkan manual dari panel Kesehatan Server");
        return NextResponse.json({ ok: true, message: "Mode Hemat dinonaktifkan." });
      }

      // DEMO: permintaan lambat buatan (~0,9 dtk) -> SLOW_REQUEST tercatat.
      case "demoSlow": {
        const t0 = Date.now();
        await sleep(900);
        const ms = Date.now() - t0;
        recordSlowRequest("demo-panel", ms);
        return NextResponse.json({
          ok: true,
          ms,
          message: `Permintaan lambat demo tercatat (${ms} ms) — lihat tab Log.`,
        });
      }

      // DEMO: 6 tugas dummy masuk antrean (maks 2 paralel) -> angka antrean naik lalu turun.
      case "demoQueue": {
        const stamp = Date.now();
        for (let i = 1; i <= 6; i += 1) {
          enqueueAiJob(`demo-${stamp}-${i}`, async () => {
            await sleep(2000);
          });
        }
        return NextResponse.json({
          ok: true,
          queued: 6,
          message: "6 tugas demo masuk antrean AI — pantau angka Antrean AI naik lalu turun.",
        });
      }

      default:
        return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
    }
  } catch (error) {
    console.error("[POST /api/admin/server-health]", error);
    return NextResponse.json({ error: "Gagal menjalankan aksi." }, { status: 500 });
  }
}
