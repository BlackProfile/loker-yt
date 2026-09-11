// POST /api/public/subscribe — simpan email pelanggan notifikasi posisi baru.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    const email =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;

    if (typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    const normalized = email.trim().toLowerCase();

    await db.subscriber.upsert({
      where: { email: normalized },
      update: {},
      create: { email: normalized },
    });

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/public/subscribe]", error);
    return NextResponse.json({ error: "Gagal berlangganan. Coba lagi nanti." }, { status: 500 });
  }
}
