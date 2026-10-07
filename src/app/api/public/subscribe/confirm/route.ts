// GET /api/public/subscribe/confirm?token=... — konfirmasi double opt-in (NR-41 H15).
// Token valid → confirmedAt=now (+ aktifkan kembali bila sempat unsubscribe),
// confirmToken dinonaktifkan agar tak bisa dipakai ulang → redirect 302 /?sub=ok.
// Token invalid/kedaluwarsa → redirect 302 /?sub=invalid.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  let valid = false;

  if (token) {
    try {
      const subscriber = await db.subscriber.findUnique({ where: { confirmToken: token } });
      if (subscriber) {
        await db.subscriber.update({
          where: { id: subscriber.id },
          data: {
            confirmedAt: new Date(),
            confirmToken: null, // sekali pakai
            unsubToken: subscriber.unsubToken ?? null,
            // Konfirmasi ulang = ikut membatalkan unsubscribe sebelumnya.
            unsubscribedAt: null,
          },
        });
        valid = true;
      }
    } catch (error) {
      console.error("[GET /api/public/subscribe/confirm]", error);
      return NextResponse.redirect(new URL("/?sub=invalid", req.url), 302);
    }
  }

  return NextResponse.redirect(new URL(valid ? "/?sub=ok" : "/?sub=invalid", req.url), 302);
}
