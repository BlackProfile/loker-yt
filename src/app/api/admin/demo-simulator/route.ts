// API Simulator Pelamar Demo (Mode Demo) — SERVER-ONLY, admin-only.
//   GET    -> status simulator (running, penghitung, lamaran terakhir, error)
//   POST   -> { action: "start", intervalSec?, positionId? } | { action: "stop" }
//   DELETE -> bersihkan SEMUA lamaran demo (source "Demo Simulator") + berkasnya
// Simulator berjalan di proses server (globalThis); mati saat restart server —
// status selalu mencerminkan keadaan sebenarnya.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  cleanupDemoApplications,
  getDemoSimulatorStatus,
  startDemoSimulator,
  stopDemoSimulator,
} from "@/lib/demo-applicants";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    return NextResponse.json(getDemoSimulatorStatus());
  } catch (error) {
    console.error("[GET /api/admin/demo-simulator]", error);
    return NextResponse.json({ error: "Gagal membaca status simulator." }, { status: 500 });
  }
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
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Body tidak valid." }, { status: 400 });
    }
    const { action, intervalSec, positionId } = body as {
      action?: unknown;
      intervalSec?: unknown;
      positionId?: unknown;
    };

    if (action === "start") {
      // Validasi input ringan: interval dibatasi di lib (5-3600 detik);
      // posisi harus id yang benar-benar ada agar start gagal cepat bila salah.
      const interval = typeof intervalSec === "number" ? intervalSec : undefined;
      const position =
        typeof positionId === "string" && positionId.trim() && positionId !== "ALL"
          ? positionId.trim()
          : null;
      if (position) {
        const exists = await db.position.findUnique({
          where: { id: position },
          select: { id: true },
        });
        if (!exists) {
          return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 400 });
        }
      }
      const status = startDemoSimulator({ intervalSec: interval, positionId: position });
      return NextResponse.json({ ok: true, status });
    }

    if (action === "stop") {
      const status = stopDemoSimulator();
      return NextResponse.json({ ok: true, status });
    }

    return NextResponse.json(
      { error: "Aksi tidak dikenal. Gunakan 'start' atau 'stop'." },
      { status: 400 },
    );
  } catch (error) {
    console.error("[POST /api/admin/demo-simulator]", error);
    return NextResponse.json({ error: "Gagal mengendalikan simulator." }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { deleted } = await cleanupDemoApplications();
    return NextResponse.json({
      ok: true,
      deleted,
      status: getDemoSimulatorStatus(),
    });
  } catch (error) {
    console.error("[DELETE /api/admin/demo-simulator]", error);
    return NextResponse.json({ error: "Gagal membersihkan data demo." }, { status: 500 });
  }
}
