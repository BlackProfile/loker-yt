// POST /api/admin/login — login admin, set cookie sesi HMAC.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  ADMIN_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifyPassword,
} from "@/lib/server-auth";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await ensureSeeded(); // pastikan Setting "admin_password" sudah ada

    const body: unknown = await req.json().catch(() => null);
    const password =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).password
        : undefined;
    const passwordString = typeof password === "string" ? password : "";

    if (!passwordString) {
      return NextResponse.json({ error: "Password wajib diisi." }, { status: 400 });
    }

    const setting = await db.setting.findUnique({ where: { key: "admin_password" } });
    if (!setting || !verifyPassword(passwordString, setting.value)) {
      return NextResponse.json({ error: "Password salah" }, { status: 401 });
    }

    const token = await createSessionToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: ADMIN_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch (error) {
    console.error("[POST /api/admin/login]", error);
    return NextResponse.json({ error: "Gagal masuk. Coba lagi nanti." }, { status: 500 });
  }
}
