// GET /api/admin/dashboard-bundle — SATU permintaan untuk seluruh data awal
// Dashboard (NR58 B6): overview + statistik posisi + item tindakan + SLA +
// pengumuman. Sebelumnya tab Dashboard menembak 5 endpoint paralel di setiap
// mount; dengan bundle, 5 round-trip menjadi 1 (menguntungkan di jaringan
// lambat/server sibuk: koneksi per permintaan lebih mahal daripada query-nya).
//
// Implementasi: memanggil handler GET kelima endpoint secara langsung dalam
// konteks permintaan yang sama (auth cookie dibaca getSession() dari konteks,
// bukan dari parameter) lalu mengemas hasilnya. Kegagalan satu bagian tidak
// menggagalkan keseluruhan — bagian gagal dikirim null dan klien memakai
// loader per bagian sebagai fallback.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/server-auth";
import { loadHintHeaders } from "@/lib/load-metrics";
import { GET as overviewGET } from "../overview/route";
import { GET as positionStatsGET } from "../position-stats/route";
import { GET as actionItemsGET } from "../action-items/route";
import { GET as slaGET } from "../sla/route";
import { GET as announcementsGET } from "../announcements/route";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

/** Jalankan sub-handler dan kembalikan JSON-nya; gagal → null (per bagian). */
async function part(
  promise: Promise<Response>,
): Promise<unknown | null> {
  try {
    const res = await promise;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }

  const [overview, positionStats, actionItems, sla, announcements] =
    await Promise.all([
      part(overviewGET()),
      part(positionStatsGET()),
      part(actionItemsGET()),
      part(slaGET(req)),
      part(announcementsGET()),
    ]);

  return NextResponse.json(
    { overview, positionStats, actionItems, sla, announcements },
    { headers: loadHintHeaders() },
  );
}
