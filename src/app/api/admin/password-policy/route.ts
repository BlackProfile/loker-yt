// GET /api/admin/password-policy — kebijakan sandi aktif (semua role — untuk tampilan
//     "syarat sandi" saat mengganti sandi).
// PUT /api/admin/password-policy — simpan kebijakan (OWNER saja).
//     Body: { minLength, requireChangeFirstLogin, rotationDays, blockWeak }
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  describePasswordPolicy,
  readPasswordPolicy,
  writePasswordPolicy,
} from "@/lib/password-policy";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER dapat mengubah kebijakan sandi." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    const policy = await readPasswordPolicy();
    return NextResponse.json({ policy, description: describePasswordPolicy(policy) });
  } catch (error) {
    console.error("[GET /api/admin/password-policy]", error);
    return NextResponse.json({ error: "Gagal memuat kebijakan sandi." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const current = await readPasswordPolicy();

    const minLengthRaw = Number(data.minLength);
    const rotationRaw = Number(data.rotationDays);
    const policy = await writePasswordPolicy({
      minLength: Number.isFinite(minLengthRaw) ? minLengthRaw : current.minLength,
      requireChangeFirstLogin:
        data.requireChangeFirstLogin === undefined
          ? current.requireChangeFirstLogin
          : data.requireChangeFirstLogin === true,
      rotationDays: Number.isFinite(rotationRaw) ? rotationRaw : current.rotationDays,
      blockWeak: data.blockWeak === undefined ? current.blockWeak : data.blockWeak !== false,
    });

    await db.activityLog
      .create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "PASSWORD_POLICY_UPDATED",
          detail: `Kebijakan sandi diperbarui: min ${policy.minLength} karakter, rotasi ${policy.rotationDays} hari`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, policy, description: describePasswordPolicy(policy) });
  } catch (error) {
    console.error("[PUT /api/admin/password-policy]", error);
    return NextResponse.json({ error: "Gagal menyimpan kebijakan sandi." }, { status: 500 });
  }
}
