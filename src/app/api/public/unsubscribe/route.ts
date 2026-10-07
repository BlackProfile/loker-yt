// GET /api/public/unsubscribe?token=... — berhenti berlangganan (NR-41 H15).
// Token valid → unsubscribedAt=now (blast tidak akan mengirim lagi) → redirect 302 /?sub=unsub.
// Token invalid → redirect 302 /?sub=unsub-invalid.
// Tautan ini ditanam di footer email newsletter/konfirmasi.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  let valid = false;

  if (token) {
    try {
      const subscriber = await db.subscriber.findUnique({ where: { unsubToken: token } });
      if (subscriber) {
        await db.subscriber.update({
          where: { id: subscriber.id },
          data: { unsubscribedAt: new Date() },
        });
        valid = true;
      }
    } catch (error) {
      console.error("[GET /api/public/unsubscribe]", error);
      return NextResponse.redirect(new URL("/?sub=unsub-invalid", req.url), 302);
    }
  }

  return NextResponse.redirect(new URL(valid ? "/?sub=unsub" : "/?sub=unsub-invalid", req.url), 302);
}
