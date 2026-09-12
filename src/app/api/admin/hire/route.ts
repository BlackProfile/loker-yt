// GET /api/admin/hire — daftar karyawan (application dengan hiredAt terisi) untuk tab Karyawan.
// Menyertakan judul posisi, rencana onboarding (JSON sudah diparse aman), dan semua CheckIn.
// dueAt cek-in yang belum ada dihitung on-the-fly di klien dari hiredAt + n hari.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

type OnboardingPlanItem = {
  id: string;
  label: string;
  owner: string | null;
  dueAt: string | null;
  done: boolean;
};

/** Parse onboardingPlan (JSON string) menjadi daftar item aman terhadap nilai rusak. */
function parseOnboardingPlan(raw: string): OnboardingPlanItem[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items: OnboardingPlanItem[] = [];
    for (let i = 0; i < parsed.length; i++) {
      const obj = parsed[i] && typeof parsed[i] === "object" && !Array.isArray(parsed[i])
        ? (parsed[i] as Record<string, unknown>)
        : {};
      const label = typeof obj.label === "string" ? obj.label.trim() : "";
      if (!label) continue;
      const dueAt =
        typeof obj.dueAt === "string" && obj.dueAt && !Number.isNaN(new Date(obj.dueAt).getTime())
          ? new Date(obj.dueAt).toISOString()
          : null;
      items.push({
        id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `item${i + 1}`,
        label,
        owner: typeof obj.owner === "string" && obj.owner.trim() ? obj.owner.trim() : null,
        dueAt,
        done: obj.done === true,
      });
    }
    return items;
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const rows = await db.application.findMany({
      where: { hiredAt: { not: null } },
      include: {
        position: { select: { title: true } },
        checkIns: { orderBy: { day: "asc" } },
      },
      orderBy: { hiredAt: "desc" },
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        trackingCode: row.trackingCode,
        positionTitle: row.position?.title ?? null,
        hiredAt: (row.hiredAt ?? new Date()).toISOString(),
        probationEnd: row.probationEnd ? row.probationEnd.toISOString() : null,
        onboardingPlan: parseOnboardingPlan(row.onboardingPlan),
        checkIns: row.checkIns.map((c) => ({
          id: c.id,
          day: c.day,
          dueAt: c.dueAt ? c.dueAt.toISOString() : null,
          rating: c.rating,
          notes: c.notes,
          completedAt: c.completedAt ? c.completedAt.toISOString() : null,
        })),
      })),
    );
  } catch (error) {
    console.error("[GET /api/admin/hire]", error);
    return NextResponse.json({ error: "Gagal memuat daftar karyawan. Coba lagi nanti." }, { status: 500 });
  }
}
