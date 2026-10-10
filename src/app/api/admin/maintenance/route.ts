// NR45 — GET/PUT /api/admin/maintenance — mode perawatan situs publik.
// CATATAN KUNCI SETTING: memakai kunci "maintenance_mode" (kunci "maintenance"
// SUDAH dipakai cron auto-arsip — jangan tertukar).
// GET (OWNER/HR) -> {enabled, level, message, updatedAt}
// PUT (OWNER)    -> simpan + ActivityLog MAINTENANCE_ON/OFF + sendSystemEvent
//                   + emitRealtime site:changed (invalidasi cache konten).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { readMaintenanceConfig, writeMaintenanceConfig } from "@/lib/load-metrics";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { sendSystemEvent } from "@/lib/notify";

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
    const config = await readMaintenanceConfig();
    return NextResponse.json(config);
  } catch (error) {
    console.error("[GET /api/admin/maintenance]", error);
    return NextResponse.json(
      { error: "Gagal memuat konfigurasi mode perawatan." },
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
        { error: "Hanya OWNER dapat mengubah mode perawatan." },
        { status: 403 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const raw = body as Record<string, unknown>;
    const enabled = raw.enabled === true;
    const level = raw.level === "FULL" ? "FULL" : "APPLY_ONLY";
    const message = typeof raw.message === "string" ? raw.message.trim().slice(0, 300) : "";

    const before = await readMaintenanceConfig();
    const config = await writeMaintenanceConfig({ enabled, level, message });

    // Audit + notifikasi + realtime hanya pada perubahan nyata.
    if (before.enabled !== enabled || before.level !== level || before.message !== message) {
      try {
        await db.activityLog.create({
          data: {
            applicationId: null,
            actor: session.name || session.email,
            action: enabled ? "MAINTENANCE_ON" : "MAINTENANCE_OFF",
            detail: `Mode perawatan ${enabled ? "diaktifkan" : "dinonaktifkan"} (tingkat ${level})${message ? ` — pesan: "${message}"` : ""}.`,
          },
        });
      } catch {
        // diam
      }
      void emitRealtime(REALTIME_EVENTS.site);
      if (enabled) {
        void sendSystemEvent({
          title: "Mode Perawatan Diaktifkan",
          detail: `Tingkat: ${level === "FULL" ? "tutup seluruh situs publik" : "tutup pendaftaran saja"}. Panel admin tetap dapat diakses.`,
          action: "MAINTENANCE_ON",
          category: "SYSTEM",
        });
      }
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error("[PUT /api/admin/maintenance]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan konfigurasi mode perawatan." },
      { status: 500 },
    );
  }
}
