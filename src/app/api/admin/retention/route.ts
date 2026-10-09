// GET  /api/admin/retention — baca pengaturan retensi data (privasi) & arsip otomatis (OWNER).
// PUT  /api/admin/retention — simpan salah satu dari:
//   { enabled: boolean, days: number }                  -> Setting "retention" (hapus otomatis)
//   { autoArchiveEnabled: boolean, autoArchiveDays: number } -> Setting "maintenance" (arsip otomatis)
// POST /api/admin/retention — { mode: "preview", days: number } -> PRATINJAU (dry-run)
//   dampak job retensi {count, samples, cutoffDate} TANPA menghapus/mengubah apa pun.
//   POST tanpa mode:"preview" diteruskan ke logika simpan yang sama dengan PUT.
// Dipakai oleh tab Pengaturan (Retensi Data) dan tab Data (Arsip Otomatis + Pusat Privasi).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { retentionPreview } from "@/lib/privacy-center";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const DEFAULT_RETENTION = { enabled: false, days: 365 };
const DEFAULT_MAINTENANCE = { autoArchiveEnabled: false, autoArchiveDays: 90 };

async function readJsonSetting(key: string): Promise<Record<string, unknown>> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return {};
    const parsed: unknown = JSON.parse(row.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const [retentionRaw, maintenanceRaw] = await Promise.all([
      readJsonSetting("retention"),
      readJsonSetting("maintenance"),
    ]);

    const enabled = typeof retentionRaw.enabled === "boolean" ? retentionRaw.enabled : DEFAULT_RETENTION.enabled;
    const daysRaw = Number(retentionRaw.days);
    const days = Number.isFinite(daysRaw) ? daysRaw : DEFAULT_RETENTION.days;

    const autoArchiveEnabled =
      typeof maintenanceRaw.autoArchiveEnabled === "boolean"
        ? maintenanceRaw.autoArchiveEnabled
        : DEFAULT_MAINTENANCE.autoArchiveEnabled;
    const autoArchiveDaysRaw = Number(maintenanceRaw.autoArchiveDays);
    const autoArchiveDays = Number.isFinite(autoArchiveDaysRaw)
      ? autoArchiveDaysRaw
      : DEFAULT_MAINTENANCE.autoArchiveDays;

    return NextResponse.json({
      retention: { enabled, days },
      maintenance: { autoArchiveEnabled, autoArchiveDays },
    });
  } catch (error) {
    console.error("[GET /api/admin/retention]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan retensi." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    // Mode pratinjau (dry-run): kriteria identik dengan job retensi cron —
    // TIDAK mengubah pengaturan dan TIDAK menghapus apa pun.
    if (data.mode === "preview") {
      const daysRaw = Number(data.days);
      if (!Number.isInteger(daysRaw) || daysRaw < 1 || daysRaw > 3650) {
        return NextResponse.json(
          { error: "Jumlah hari pratinjau harus angka bulat 1 sampai 3650." },
          { status: 400 },
        );
      }
      const preview = await retentionPreview(daysRaw);
      return NextResponse.json({
        count: preview.count,
        samples: preview.samples,
        cutoffDate: preview.cutoffDate,
      });
    }

    // Tanpa mode pratinjau -> perlakuan sama dengan PUT (simpan pengaturan).
    return handleSettingsWrite(data);
  } catch (error) {
    console.error("[POST /api/admin/retention]", error);
    return NextResponse.json({ error: "Gagal memproses permintaan retensi." }, { status: 500 });
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
    return handleSettingsWrite(body as Record<string, unknown>);
  } catch (error) {
    console.error("[PUT /api/admin/retention]", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan retensi." }, { status: 500 });
  }
}

/** Logika simpan pengaturan (dipakai PUT dan POST non-preview). */
async function handleSettingsWrite(data: Record<string, unknown>) {
  try {
    if ("enabled" in data || "days" in data) {
      const enabled = data.enabled === true;
      const days = Number(data.days);
      if (!Number.isInteger(days) || days < 30 || days > 3650) {
        return NextResponse.json({ error: "Jumlah hari harus angka bulat 30 sampai 3650." }, { status: 400 });
      }
      await db.setting.upsert({
        where: { key: "retention" },
        update: { value: JSON.stringify({ enabled, days }) },
        create: { key: "retention", value: JSON.stringify({ enabled, days }) },
      });
      return NextResponse.json({ ok: true, retention: { enabled, days } });
    }

    if ("autoArchiveEnabled" in data || "autoArchiveDays" in data) {
      const autoArchiveEnabled = data.autoArchiveEnabled === true;
      const autoArchiveDays = Number(data.autoArchiveDays);
      if (!Number.isInteger(autoArchiveDays) || autoArchiveDays < 7 || autoArchiveDays > 365) {
        return NextResponse.json(
          { error: "Jumlah hari arsip otomatis harus angka bulat 7 sampai 365." },
          { status: 400 },
        );
      }
      await db.setting.upsert({
        where: { key: "maintenance" },
        update: { value: JSON.stringify({ autoArchiveEnabled, autoArchiveDays }) },
        create: { key: "maintenance", value: JSON.stringify({ autoArchiveEnabled, autoArchiveDays }) },
      });
      return NextResponse.json({ ok: true, maintenance: { autoArchiveEnabled, autoArchiveDays } });
    }

    return NextResponse.json(
      { error: "Kirim field retention (enabled/days) atau maintenance (autoArchiveEnabled/autoArchiveDays)." },
      { status: 400 },
    );
  } catch (error) {
    console.error("[retention] handleSettingsWrite", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan retensi." }, { status: 500 });
  }
}
