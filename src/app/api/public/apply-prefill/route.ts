// GET /api/public/apply-prefill?email=... — prefill pelamar lama (Task 33-c).
// Tanpa auth (dipanggil dari form publik saat pelamar mengisi email): mengembalikan
// HANYA nama & nomor WhatsApp dari lamaran TERAKHIR dengan email yang sama agar
// pelamar tidak mengetik ulang. Field lain tidak pernah dikirim (tidak bocor).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// Regex email sederhana — konsisten dengan validasi wizard publik & submit lamaran.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function GET(req: NextRequest) {
  try {
    const email = (req.nextUrl.searchParams.get("email") ?? "").trim();
    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Email tidak valid." }, { status: 400 });
    }

    const application = await db.application.findFirst({
      where: { email },
      orderBy: { createdAt: "desc" },
      select: { name: true, phone: true },
    });

    // Tanpa lamaran sebelumnya: nilai null (klien memperlakukan sebagai "tidak ada prefill").
    return NextResponse.json({
      name: application?.name ?? null,
      phone: application?.phone ?? null,
    });
  } catch (error) {
    console.error("[GET /api/public/apply-prefill]", error);
    return NextResponse.json(
      { error: "Gagal memuat data. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
