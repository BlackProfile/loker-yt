// NR-41 H17 — GET /api/public/track-export?code=&email= — pelamar mengunduh
// salinan data miliknya dari halaman Cek Status (portabilitas data).
// Validasi identik dengan /api/public/track (login ganda kode+email, throttle
// per IP, lockout gagal beruntun via status-gate). Respons TIDAK memuat catatan
// internal admin (adminNotes, internalDocs, rubrik internal, verdict screening).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { clientIp, isLockedOut, isThrottled, clearAuthFails, recordAuthFail } from "@/lib/status-gate";
import { buildDataSubjectExport } from "@/lib/export-subject";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const ip = clientIp(req);
    if (isLockedOut(ip)) {
      return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, { status: 429 });
    }
    if (isThrottled("track-export:" + ip, 600)) {
      return NextResponse.json({ error: "Terlalu cepat." }, { status: 429 });
    }

    const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase() ?? "";
    const email = req.nextUrl.searchParams.get("email")?.trim().toLowerCase() ?? "";
    if (!code) {
      return NextResponse.json({ error: "Kode pelacakan wajib diisi." }, { status: 400 });
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      return NextResponse.json({ error: "Email wajib diisi dengan format yang benar." }, { status: 400 });
    }

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: { id: true, email: true, deletedAt: true },
    });
    // Login ganda: email harus cocok; lamaran di tong sampah tidak dihitung.
    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      return NextResponse.json({ error: "Kode pelacakan atau email tidak cocok." }, { status: 404 });
    }
    clearAuthFails(ip);

    const bundle = await buildDataSubjectExport(application.id, "public");
    if (!bundle) {
      return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
    }

    const filename = `data-saya-${code}.json`;
    return new Response(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/public/track-export]", error);
    return NextResponse.json({ error: "Gagal mengekspor data. Coba lagi nanti." }, { status: 500 });
  }
}
