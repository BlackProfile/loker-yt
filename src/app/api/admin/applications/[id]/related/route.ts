// /api/admin/applications/[id]/related — riwayat melamar & peringatan duplikat
// (NR-24, fitur 7 + 12 + 15). Respons RelatedApplicationsResponse:
//   - previous         : lamaran lain dengan email sama ATAU nomor WA sama
//                        (normalisasi nomor = digit saja), urut createdAt asc, maks 10.
//   - doNotHireWarning : lamaran lain do-not-hire dengan email/WA sama (terbaru).
//   - duplicateSuspects: lamaran lain dengan nama sama (case-insensitive) DAN nomor
//                        WA sama, belum digabungkan — tersangka duplikat, maks 5.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { RelatedApplicationsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan." };

const PREVIOUS_MAX = 10;
const SUSPECTS_MAX = 5;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;
    const current = await db.application.findUnique({
      where: { id },
      select: { id: true, email: true, phone: true, name: true },
    });
    if (!current) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const currentEmail = current.email.trim().toLowerCase();
    const currentPhoneDigits = current.phone.replace(/[^0-9]/g, "");
    const currentNameKey = current.name.trim().toLowerCase();

    const candidates = await db.application.findMany({
      where: { id: { not: id }, deletedAt: null },
      select: {
        id: true,
        trackingCode: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        doNotHire: true,
        doNotHireReason: true,
        mergedIntoId: true,
        position: { select: { title: true } },
      },
    });

    const sameContact = candidates.filter((row) => {
      const emailMatch =
        currentEmail.length > 0 && row.email.trim().toLowerCase() === currentEmail;
      const phoneDigits = row.phone.replace(/[^0-9]/g, "");
      const phoneMatch = currentPhoneDigits.length > 0 && phoneDigits === currentPhoneDigits;
      return emailMatch || phoneMatch;
    });

    const previous: RelatedApplicationsResponse["previous"] = sameContact
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, PREVIOUS_MAX)
      .map((row) => ({
        id: row.id,
        trackingCode: row.trackingCode ?? "",
        name: row.name,
        status: row.status,
        positionTitle: row.position?.title ?? null,
        createdAt: row.createdAt.toISOString(),
        doNotHire: row.doNotHire,
        mergedIntoId: row.mergedIntoId,
      }));

    const warningRow = sameContact
      .filter((row) => row.doNotHire)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    const doNotHireWarning: RelatedApplicationsResponse["doNotHireWarning"] = warningRow
      ? {
          id: warningRow.id,
          reason: warningRow.doNotHireReason,
          createdAt: warningRow.createdAt.toISOString(),
        }
      : null;

    const duplicateSuspects: RelatedApplicationsResponse["duplicateSuspects"] = candidates
      .filter((row) => {
        if (row.mergedIntoId) return false;
        const nameMatch =
          currentNameKey.length > 0 && row.name.trim().toLowerCase() === currentNameKey;
        const phoneDigits = row.phone.replace(/[^0-9]/g, "");
        const phoneMatch = currentPhoneDigits.length > 0 && phoneDigits === currentPhoneDigits;
        return nameMatch && phoneMatch;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, SUSPECTS_MAX)
      .map((row) => ({
        id: row.id,
        trackingCode: row.trackingCode ?? "",
        name: row.name,
        status: row.status,
        positionTitle: row.position?.title ?? null,
        createdAt: row.createdAt.toISOString(),
      }));

    const body: RelatedApplicationsResponse = { previous, doNotHireWarning, duplicateSuspects };
    return NextResponse.json(body);
  } catch (error) {
    console.error("[GET /api/admin/applications/[id]/related]", error);
    return NextResponse.json(
      { error: "Gagal memuat riwayat lamaran terkait. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
