// POST /api/admin/privacy — Pusat Privasi (OWNER saja, tidak ada GET publik).
// Body: { action: "describe", applicationId? , trackingCode? }
//       -> ringkasan data kandidat yang akan terhapus (untuk dialog konfirmasi UI).
//       { action: "erase", applicationId? | trackingCode?, confirmTrackingCode }
//       -> hapus permanen (WAJIB confirmTrackingCode sama persis dengan kode target).
// Identifikasi target boleh via applicationId ATAU trackingCode (mis. "LM-XXXXXX")
// karena UI memakai input kode pelacakan. Auth: getSession OWNER (pola route admin lain).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { createApprovalRequest, shouldRouteToApproval } from "@/lib/dual-control";
import { describeEraseTarget, eraseCandidateData } from "@/lib/privacy-center";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

/** Cari id lamaran target dari applicationId ATAU trackingCode pada body. */
async function resolveTargetId(data: Record<string, unknown>): Promise<string | null> {
  const applicationId = typeof data.applicationId === "string" ? data.applicationId.trim() : "";
  if (applicationId) {
    const found = await db.application.findUnique({
      where: { id: applicationId },
      select: { id: true },
    });
    return found?.id ?? null;
  }
  const trackingCode = typeof data.trackingCode === "string" ? data.trackingCode.trim() : "";
  if (trackingCode) {
    const found = await db.application.findUnique({
      where: { trackingCode },
      select: { id: true },
    });
    return found?.id ?? null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const action = data.action === "describe" || data.action === "erase" ? data.action : null;
    if (!action) {
      return NextResponse.json(
        { error: "action wajib diisi: \"describe\" atau \"erase\"." },
        { status: 400 },
      );
    }

    const targetId = await resolveTargetId(data);
    if (!targetId) {
      return NextResponse.json(
        { error: "Lamaran dengan id/kode pelacakan tersebut tidak ditemukan." },
        { status: 404 },
      );
    }

    if (action === "describe") {
      const summary = await describeEraseTarget(targetId);
      if (!summary) {
        return NextResponse.json({ error: "Lamaran tidak ditemukan." }, { status: 404 });
      }
      return NextResponse.json({ target: summary });
    }

    // action === "erase" — konfirmasi kode pelacakan WAJIB sama persis.
    const confirmTrackingCode =
      typeof data.confirmTrackingCode === "string" ? data.confirmTrackingCode.trim() : "";
    const anchor = await db.application.findUnique({
      where: { id: targetId },
      select: { trackingCode: true, name: true },
    });
    if (!anchor?.trackingCode || confirmTrackingCode !== anchor.trackingCode) {
      return NextResponse.json({ error: "Kode konfirmasi tidak cocok" }, { status: 400 });
    }

    // NR46 — empat mata: hapus data kandidat lewat persetujuan OWNER lain.
    if (await shouldRouteToApproval()) {
      const requestId = await createApprovalRequest({
        kind: "PRIVACY_ERASE",
        payload: { applicationId: targetId },
        summary: `Hapus seluruh data kandidat ${anchor.name ?? ""} (${anchor.trackingCode})`,
        session,
      });
      return NextResponse.json(
        {
          approvalRequired: true,
          requestId,
          message: `Permintaan penghapusan data ${anchor.name ?? anchor.trackingCode} dikirim — menunggu persetujuan OWNER lain.`,
        },
        { status: 202 },
      );
    }

    const result = await eraseCandidateData(targetId, session.name);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Gagal memproses permintaan privasi. Coba lagi nanti.";
    console.error("[POST /api/admin/privacy]", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
