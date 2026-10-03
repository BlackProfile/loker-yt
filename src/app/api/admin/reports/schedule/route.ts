// GET /api/admin/reports/schedule — baca jadwal laporan email terjadwal (semua role admin).
// PUT /api/admin/reports/schedule — simpan jadwal (OWNER saja):
//   { weeklyEnabled?: boolean, monthlyEnabled?: boolean }
//   -> Setting key "reportEmailSchedule" = {"weeklyEnabled": boolean, "monthlyEnabled": boolean}
// Laporan dibuat oleh cron /api/cron/reminders (Senin 08.00 & tanggal 1 07.00,
// zona waktu server) dan hanya masuk antrean EmailOutbox — pengiriman ditangani
// pipeline outbox existing. Pola mengikuti /api/admin/retention/route.ts.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const SETTING_KEY = "reportEmailSchedule";
const DEFAULT_SCHEDULE = { weeklyEnabled: true, monthlyEnabled: true };

async function readScheduleSetting(): Promise<{ weeklyEnabled: boolean; monthlyEnabled: boolean }> {
  try {
    const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...DEFAULT_SCHEDULE };
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_SCHEDULE };
    }
    const raw = parsed as Record<string, unknown>;
    return {
      weeklyEnabled: typeof raw.weeklyEnabled === "boolean" ? raw.weeklyEnabled : DEFAULT_SCHEDULE.weeklyEnabled,
      monthlyEnabled: typeof raw.monthlyEnabled === "boolean" ? raw.monthlyEnabled : DEFAULT_SCHEDULE.monthlyEnabled,
    };
  } catch {
    return { ...DEFAULT_SCHEDULE };
  }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const schedule = await readScheduleSetting();
    return NextResponse.json({ schedule });
  } catch (error) {
    console.error("[GET /api/admin/reports/schedule]", error);
    return NextResponse.json({ error: "Gagal memuat jadwal laporan email." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const hasWeekly = "weeklyEnabled" in data;
    const hasMonthly = "monthlyEnabled" in data;
    if (!hasWeekly && !hasMonthly) {
      return NextResponse.json(
        { error: "Kirim field weeklyEnabled dan/atau monthlyEnabled (boolean)." },
        { status: 400 },
      );
    }
    if (hasWeekly && typeof data.weeklyEnabled !== "boolean") {
      return NextResponse.json({ error: "weeklyEnabled harus berupa boolean." }, { status: 400 });
    }
    if (hasMonthly && typeof data.monthlyEnabled !== "boolean") {
      return NextResponse.json({ error: "monthlyEnabled harus berupa boolean." }, { status: 400 });
    }

    // Merge dengan nilai tersimpan agar toggle parsial tidak menimpa field lain.
    const current = await readScheduleSetting();
    const next = {
      weeklyEnabled: hasWeekly ? (data.weeklyEnabled as boolean) : current.weeklyEnabled,
      monthlyEnabled: hasMonthly ? (data.monthlyEnabled as boolean) : current.monthlyEnabled,
    };

    await db.setting.upsert({
      where: { key: SETTING_KEY },
      update: { value: JSON.stringify(next) },
      create: { key: SETTING_KEY, value: JSON.stringify(next) },
    });

    return NextResponse.json({ ok: true, schedule: next });
  } catch (error) {
    console.error("[PUT /api/admin/reports/schedule]", error);
    return NextResponse.json({ error: "Gagal menyimpan jadwal laporan email." }, { status: 500 });
  }
}
