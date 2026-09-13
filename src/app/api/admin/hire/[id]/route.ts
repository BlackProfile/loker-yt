// PATCH /api/admin/hire/[id] — simpan rencana onboarding (onboardingPlan) seorang karyawan (OWNER/HR).
// Body: { onboardingPlan: string | {id,label,owner?,dueAt?,done}[] } — disanitasi sebelum disimpan.
// Setiap simpanan dicatat ke ActivityLog (ONBOARDING_PLAN) dan disebarkan realtime.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Karyawan tidak ditemukan" };

const MAX_ITEMS = 30;

type PlanItem = {
  id: string;
  label: string;
  owner: string | null;
  dueAt: string | null;
  done: boolean;
};

/** Sanitasi daftar item rencana onboarding dari input tak dikenal (array atau JSON string). */
function sanitizePlan(raw: unknown): PlanItem[] | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null; // JSON string rusak
    }
  }
  if (!Array.isArray(parsed)) return null;

  const items: PlanItem[] = [];
  const usedIds = new Set<string>();
  for (let i = 0; i < parsed.length && items.length < MAX_ITEMS; i++) {
    const obj = parsed[i] && typeof parsed[i] === "object" && !Array.isArray(parsed[i])
      ? (parsed[i] as Record<string, unknown>)
      : {};
    const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 120) : "";
    if (!label) continue;

    let id = typeof obj.id === "string" ? obj.id.trim().slice(0, 40) : "";
    if (!id || usedIds.has(id)) id = `item${Date.now().toString(36)}${i}`;
    usedIds.add(id);

    const owner = typeof obj.owner === "string" && obj.owner.trim() ? obj.owner.trim().slice(0, 60) : null;
    const dueAtRaw = typeof obj.dueAt === "string" ? obj.dueAt.trim() : "";
    const dueAt = dueAtRaw && !Number.isNaN(new Date(dueAtRaw).getTime()) ? new Date(dueAtRaw).toISOString() : null;

    items.push({ id, label, owner, dueAt, done: obj.done === true });
  }
  return items;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    if (data.onboardingPlan === undefined) {
      return NextResponse.json({ error: "Rencana onboarding tidak dikirim." }, { status: 400 });
    }
    const plan = sanitizePlan(data.onboardingPlan);
    if (plan === null) {
      return NextResponse.json(
        { error: "Rencana onboarding tidak valid (harus array item atau JSON string)." },
        { status: 400 },
      );
    }

    const existing = await db.application.findUnique({ where: { id }, select: { hiredAt: true } });
    if (!existing || !existing.hiredAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.application.update({
      where: { id },
      data: { onboardingPlan: JSON.stringify(plan) },
    });

    const doneCount = plan.filter((item) => item.done).length;
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "ONBOARDING_PLAN",
        detail: `Rencana onboarding disimpan (${plan.length} item, ${doneCount} selesai)`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ ok: true, onboardingPlan: plan });
  } catch (error) {
    console.error("[PATCH /api/admin/hire/[id]]", error);
    return NextResponse.json({ error: "Gagal menyimpan rencana onboarding. Coba lagi nanti." }, { status: 500 });
  }
}
