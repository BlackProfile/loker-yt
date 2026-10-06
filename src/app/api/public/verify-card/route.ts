// GET /api/public/verify-card — verifikasi kartu karyawan PUBLIK (tanpa login).
// ?t={token.hmac}  — jalur QR (token 192-bit acak + tanda tangan HMAC).
// ?nomor=LUM-EMP-0001 — jalur ketik nomor kartu.
// Hanya data minimal (nama, posisi, status, tanggal) — TANPA NIK/HP/gaji demi privasi.
// Kartu PENDING/SUSPENDED/REVOKED tetap ditemukan tapi diberi reason TIDAK_AKTIF.
// Setiap kecocokan tercatat (verifyCount/lastVerifiedAt) untuk audit pemindaian.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { effectiveStatus, verifyCardSignature } from "@/lib/employee-cards";
import type { VerifyCardResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function fail(reason: "TIDAK_ADA" | "TOKEN_SALAH" | "TIDAK_AKTIF", extra?: Partial<VerifyCardResponse>): NextResponse {
  const body: VerifyCardResponse = { found: false, reason, verifiedAt: new Date().toISOString(), ...extra };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const signed = sp.get("t");
    const nomor = sp.get("nomor");

    let card = null as null | Awaited<ReturnType<typeof db.employeeCard.findFirst>>;

    if (signed) {
      const token = await verifyCardSignature(signed);
      if (!token) {
        return fail("TOKEN_SALAH");
      }
      card = await db.employeeCard.findUnique({ where: { token } });
    } else if (nomor) {
      const clean = nomor.trim().toUpperCase().slice(0, 40);
      card = await db.employeeCard.findUnique({ where: { cardNumber: clean } });
    } else {
      return fail("TIDAK_ADA");
    }

    if (!card) return fail(signed ? "TOKEN_SALAH" : "TIDAK_ADA");

    const owner = await db.application.findUnique({
      where: { id: card.applicationId },
      select: { name: true, deletedAt: true, position: { select: { title: true } } },
    });
    if (!owner || owner.deletedAt) return fail("TIDAK_ADA");

    const status = effectiveStatus(card);
    const aktif = status === "ACTIVE" || status === "PROBATION";
    if (!aktif) {
      return fail("TIDAK_AKTIF", {
        card: {
          cardNumber: card.cardNumber,
          name: owner.name,
          positionTitle: owner.position?.title ?? null,
          status,
          issuedAt: card.issuedAt.toISOString(),
          probationUntil: card.probationUntil ? card.probationUntil.toISOString() : null,
        },
      });
    }

    // Audit pemindaian — kegagalan tulis tidak menggagalkan verifikasi.
    await db.employeeCard
      .update({
        where: { id: card.id },
        data: { verifyCount: { increment: 1 }, lastVerifiedAt: new Date() },
      })
      .catch(() => undefined);

    const body: VerifyCardResponse = {
      found: true,
      verifiedAt: new Date().toISOString(),
      card: {
        cardNumber: card.cardNumber,
        name: owner.name,
        positionTitle: owner.position?.title ?? null,
        status,
        issuedAt: card.issuedAt.toISOString(),
        probationUntil: card.probationUntil ? card.probationUntil.toISOString() : null,
      },
    };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[GET /api/public/verify-card]", error);
    return NextResponse.json({ error: "Gagal memverifikasi kartu." }, { status: 500 });
  }
}
