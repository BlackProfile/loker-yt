// NR49-A — GET  /api/admin/ai-control — tampilan Pusat Kendali AI (semua role login):
//           daftar fitur (aktif/kuota/terpakai hari ini), Prioritas Aksi Admin, status Mode Hemat.
// PUT /api/admin/ai-control — simpan pengaturan (HANYA OWNER):
//           body { features?: Record<string, { enabled?: boolean; quotaPerDay?: number | null }>,
//                  manualPriority?: boolean } → writeAiControl() → { control }.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import { getAiControlView, writeAiControl } from "@/lib/ai-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER dapat mengubah pengaturan AI." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    const control = await getAiControlView();
    return NextResponse.json({ control });
  } catch (error) {
    console.error("[GET /api/admin/ai-control]", error);
    return NextResponse.json({ error: "Gagal memuat pengaturan AI." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const body: unknown = await req.json().catch(() => null);
    const raw =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    // Validasi ringan — writeAiControl() melakukan clamp final (0..maxQuota, floor).
    const patch: Parameters<typeof writeAiControl>[0] = {};
    if (raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)) {
      const features: Record<string, { enabled?: boolean; quotaPerDay?: number | null }> = {};
      for (const [key, value] of Object.entries(raw.features as Record<string, unknown>)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const item = value as Record<string, unknown>;
        const entry: { enabled?: boolean; quotaPerDay?: number | null } = {};
        if (typeof item.enabled === "boolean") entry.enabled = item.enabled;
        if (item.quotaPerDay === null) entry.quotaPerDay = null;
        else if (typeof item.quotaPerDay === "number" && Number.isFinite(item.quotaPerDay)) {
          entry.quotaPerDay = item.quotaPerDay;
        }
        if (entry.enabled !== undefined || entry.quotaPerDay !== undefined) {
          features[key] = entry;
        }
      }
      if (Object.keys(features).length > 0) patch.features = features;
    }
    if (typeof raw.manualPriority === "boolean") patch.manualPriority = raw.manualPriority;

    const control = await writeAiControl(patch);
    return NextResponse.json({ control });
  } catch (error) {
    console.error("[PUT /api/admin/ai-control]", error);
    return NextResponse.json({ error: "Gagal menyimpan pengaturan AI." }, { status: 500 });
  }
}
