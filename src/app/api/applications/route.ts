// POST /api/applications — kirim lamaran dari form publik.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asOptionalString(value: unknown): string | null {
  const trimmed = asTrimmedString(value);
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data lamaran tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const name = asTrimmedString(data.name);
    const email = asTrimmedString(data.email);
    const phone = asTrimmedString(data.phone);
    const positionId = asTrimmedString(data.positionId);
    const portfolioUrl = asOptionalString(data.portfolioUrl);
    const socialLinks = asOptionalString(data.socialLinks);
    const experience = asTrimmedString(data.experience);
    const motivation = asTrimmedString(data.motivation);

    if (name.length < 3) {
      return NextResponse.json({ error: "Nama minimal 3 karakter." }, { status: 400 });
    }
    if (!EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Format email tidak valid." }, { status: 400 });
    }
    if (phone.replace(/\D/g, "").length < 8) {
      return NextResponse.json({ error: "Nomor telepon/WhatsApp minimal 8 digit." }, { status: 400 });
    }
    if (!positionId) {
      return NextResponse.json({ error: "Posisi wajib dipilih." }, { status: 400 });
    }
    const position = await db.position.findUnique({ where: { id: positionId } });
    if (!position || !position.isActive) {
      return NextResponse.json({ error: "Posisi tidak ditemukan atau sudah ditutup" }, { status: 400 });
    }
    if (experience.length < 10) {
      return NextResponse.json({ error: "Ceritakan pengalamanmu minimal 10 karakter." }, { status: 400 });
    }
    if (motivation.length < 10) {
      return NextResponse.json({ error: "Ceritakan motivasimu minimal 10 karakter." }, { status: 400 });
    }

    const created = await db.application.create({
      data: {
        name,
        email,
        phone,
        positionId,
        portfolioUrl,
        socialLinks,
        experience,
        motivation,
      },
    });

    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/applications]", error);
    return NextResponse.json({ error: "Gagal mengirim lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
