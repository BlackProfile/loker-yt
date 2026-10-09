// NR45 — GET/PUT /api/admin/quiet-hours — "Jendela Tenang": jangkauan jam saat
// tugas cron berat (auto-arsip & retensi) diizinkan berjalan. Di luar jendela,
// cron /api/cron/maintenance menunda tugas berat dan mencatat QUIET_SKIP.
// Setting key: "quiet_hours" {enabled, startHour 0-23, endHour 0-23}.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import { readQuietHoursConfig, writeQuietHoursConfig } from "@/lib/load-metrics";

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
    const config = await readQuietHoursConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[GET /api/admin/quiet-hours]", error);
    return NextResponse.json(
      { error: "Gagal memuat konfigurasi jendela tenang." },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(
        { error: "Hanya OWNER dapat mengubah jendela tenang." },
        { status: 403 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;
    const enabled = raw.enabled === true;

    const toHour = (value: unknown, fallback: number): number | null => {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      return Math.min(23, Math.max(0, Math.round(n)));
    };
    const startHour = toHour(raw.startHour, 2);
    const endHour = toHour(raw.endHour, 5);
    if (startHour == null || endHour == null) {
      return NextResponse.json(
        { error: "Jam mulai dan jam selesai wajib angka 0-23." },
        { status: 400 },
      );
    }

    const config = await writeQuietHoursConfig({ enabled, startHour, endHour });
    return NextResponse.json(config);
  } catch (error) {
    console.error("[PUT /api/admin/quiet-hours]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan konfigurasi jendela tenang." },
      { status: 500 },
    );
  }
}
