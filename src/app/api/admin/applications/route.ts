// GET /api/admin/applications — daftar semua lamaran dengan filter & urutan opsional (semua role).
// Query: status, positionId, q, ratingMin, tag, talentPool ("1"/"true"), hasInterview ("1"),
//        starred ("1" — bintang personal admin yang login), followup ("1" — snooze terisi),
//        hold ("1" — proses ditahan), sort ("newest" default | "oldest" | "aiScore" | "followup").
// Scope & masking: HR dengan scope posisi hanya melihat lamaran pada posisi terkait;
// VIEWER menerima PII tersamar (phone & CV disembunyikan di level respons list).
// NR38-B — payload kini juga memuat adminSeenAt, snoozeUntil, positionSalaryMin/Max.
// NR-41 E1 — OPT-IN pagination: ?paginate=1&page=1&pageSize=25&sort=name:desc →
//        envelope PaginatedApplications {items,total,page,pageSize,totalPages}.
//        Tanpa paginate=1 → respons ARRAY persis seperti sebelumnya (kompatibel).
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
// NR58 (B5) — snapshot berat + header X-Load untuk polling adaptif klien.
import { memoGetHeavy, loadHintHeaders } from "@/lib/load-metrics";
import {
  APPLICATION_INCLUDE,
  maskApplicationForViewer,
  parseApplicationFilters,
  parseAssignedPositions,
  serializeApplication,
  stripApplicationForList,
} from "@/lib/seed";
import type { PaginatedApplications, Application } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

const PAGE_DEFAULT = 1;
const PAGE_SIZE_DEFAULT = 25;
const PAGE_SIZE_MAX = 100;

/** Field yang boleh dipakai sort server-side (format "field:dir"). */
const SORTABLE_FIELDS = new Set(["name", "createdAt", "updatedAt", "aiScore", "status", "stage"]);

/**
 * Parse query sort NR-41: "field:dir" (dir asc|desc, default desc).
 * Fallback "createdAt:desc" bila format/field tidak dikenal.
 * "stage" diperlakukan sebagai alias "status" (dalam model ini sama-sama kolom status).
 */
function parseSortedOrderBy(
  sortParam: string | null,
): Prisma.ApplicationOrderByWithRelationInput[] {
  const raw = (sortParam ?? "").trim();
  if (raw) {
    const [fieldRaw, dirRaw] = raw.split(":");
    const field = fieldRaw.trim();
    const dir = (dirRaw ?? "").trim().toLowerCase() === "asc" ? "asc" : "desc";
    const normalized = field === "stage" ? "status" : field;
    if (SORTABLE_FIELDS.has(field)) {
      return [{ [normalized]: dir }, { createdAt: "desc" }] as Prisma.ApplicationOrderByWithRelationInput[];
    }
  }
  return [{ createdAt: "desc" }, { id: "desc" }];
}

/**
 * NR58 (B5) — muat badan respons daftar lamaran (logika lama dipindah utuh
 * dari GET agar bisa dibungkus snapshot memoGetHeavy). Scope HR, pagination
 * opt-in, mask VIEWER — semuanya persis seperti sebelumnya.
 */
async function loadApplicationsBody(
  searchParams: URLSearchParams,
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  baseWhere: Prisma.ApplicationWhereInput,
  orderBy: Prisma.ApplicationOrderByWithRelationInput[],
): Promise<Application[] | PaginatedApplications> {
  let where = {
    ...baseWhere,
    deletedAt: null, // lamaran di tong sampah tidak tampil di daftar admin
  };

  // Scope granular HR: bila daftar posisi yang ditugaskan tidak kosong,
  // batasi hasil hanya ke posisi tersebut (kosong = semua posisi).
  if (session.role === "HR") {
    const admin = await db.adminUser.findUnique({
      where: { email: session.email },
      select: { assignedPositions: true },
    });
    const scope = parseAssignedPositions(admin?.assignedPositions);
    if (scope.length > 0) {
      where = { ...where, AND: [{ positionId: { in: scope } }] };
    }
  }

  // NR41 E1 — pagination OPT-IN: hanya aktif bila paginate=1.
  const paginate =
    searchParams.get("paginate") === "1" || searchParams.get("paginate") === "true";
  if (paginate) {
    const page = Math.max(
      PAGE_DEFAULT,
      Number.parseInt(searchParams.get("page") ?? "", 10) || PAGE_DEFAULT,
    );
    const pageSizeRaw =
      Number.parseInt(searchParams.get("pageSize") ?? "", 10) || PAGE_SIZE_DEFAULT;
    const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, pageSizeRaw));
    const paginatedOrderBy = parseSortedOrderBy(searchParams.get("sort"));

    const [total, rows] = await Promise.all([
      db.application.count({ where }),
      db.application.findMany({
        where,
        orderBy: paginatedOrderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          ...APPLICATION_INCLUDE,
          position: { select: { title: true, salaryMin: true, salaryMax: true } },
        },
      }),
    ]);

    const mapRow = (record: (typeof rows)[number]) => ({
      ...serializeApplication(record),
      adminSeenAt: record.adminSeenAt ? record.adminSeenAt.toISOString() : null,
      snoozeUntil: record.snoozeUntil ? record.snoozeUntil.toISOString() : null,
      positionSalaryMin: record.position?.salaryMin ?? null,
      positionSalaryMax: record.position?.salaryMax ?? null,
    });

    const items: Application[] = rows
      .map(mapRow)
      .map((item) => (session.role === "VIEWER" ? maskApplicationForViewer(item) : item));

    const envelope: PaginatedApplications = {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
    return envelope;
  }

  // NR38-B — include diperluas secara aditif: posisi ikut membawa rentang
  // gaji (salaryMin/salaryMax) untuk chip "gaji vs range" di tabel admin.
  // serializeApplication tetap hanya memakai position.title sehingga aman.
  const rows = await db.application.findMany({
    where,
    orderBy,
    include: {
      ...APPLICATION_INCLUDE,
      position: { select: { title: true, salaryMin: true, salaryMax: true } },
    },
  });

  // NR38-B — tambahan payload untuk triase cepat: adminSeenAt (dasar filter
  // "Belum dilihat"), snoozeUntil (panel "Perlu dihubungi hari ini"), dan
  // rentang gaji posisi. Aditif — bentuk respons lama tidak berubah.
  const data = rows.map((record) => ({
    ...serializeApplication(record),
    adminSeenAt: record.adminSeenAt ? record.adminSeenAt.toISOString() : null,
    snoozeUntil: record.snoozeUntil ? record.snoozeUntil.toISOString() : null,
    positionSalaryMin: record.position?.salaryMin ?? null,
    positionSalaryMax: record.position?.salaryMax ?? null,
  }));

  // NR59 — mode lite (?lite=1): field teks berat dipangkas (±60% payload).
  // Dipakai tab Pipeline yang memuat ribuan lamaran satu posisi sekaligus;
  // dialog detail mengambil versi utuh via GET /api/admin/applications/[id].
  const lite = searchParams.get("lite") === "1" || searchParams.get("lite") === "true";
  const shaped = lite ? data.map(stripApplicationForList) : data;

  // VIEWER: mask PII (phone & CV) hanya pada level respons list.
  return session.role === "VIEWER" ? shaped.map(maskApplicationForViewer) : shaped;
}

/**
 * NR59 — mode hitung cepat (?count=1): cukup jumlah lamaran untuk filter yang
 * diminta. Dipakai notifikasi "lamaran baru" yang polling rutin — mengganti
 * fetch daftar penuh 20 MB menjadi respons puluhan byte.
 */
async function loadApplicationsCount(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  baseWhere: Prisma.ApplicationWhereInput,
): Promise<{ count: number }> {
  let where = { ...baseWhere, deletedAt: null };
  if (session.role === "HR") {
    const admin = await db.adminUser.findUnique({
      where: { email: session.email },
      select: { assignedPositions: true },
    });
    const scope = parseAssignedPositions(admin?.assignedPositions);
    if (scope.length > 0) {
      where = { ...where, AND: [{ positionId: { in: scope } }] };
    }
  }
  const count = await db.application.count({ where });
  return { count };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    // userId diteruskan agar filter starred (bintang personal) tahu admin yang login.
    const { where: baseWhere, orderBy, valid } = parseApplicationFilters(searchParams, session.id);
    if (!valid) {
      return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
    }

    // NR59 — mode hitung cepat untuk poller notifikasi lamaran baru.
    if (searchParams.get("count") === "1") {
      const body = await loadApplicationsCount(session, baseWhere);
      return NextResponse.json(body, { headers: loadHintHeaders() });
    }

    // NR58 (B5) — SNAPSHOT BERAT: daftar lamaran adalah query termahal panel
    // (ribuan baris + include relasi). Kunci cache mencakup role+id sesi dan
    // seluruh query sehingga scope HR / mask VIEWER / filter / halaman tetap
    // terpisah sempurna. Normal: TTL 20 dtk (kolaborasi tetap segar). Mode
    // Hemat / beban KRITIS: snapshot basi (<= 10 mnt) disajikan TANPA
    // menyentuh DB, dengan header X-Data-AsOf agar UI memberi tahu umur data.
    const cacheKey = `admin:apps:${session.role}:${session.id}:${searchParams.toString()}`;
    const { value: body, stale, cachedAt } = await memoGetHeavy(
      cacheKey,
      20_000,
      10 * 60_000,
      async () => {
        return loadApplicationsBody(searchParams, session, baseWhere, orderBy);
      },
      // Respons daftar bisa ±15 MB — simpan maksimal 4 snapshot terbaru.
      { prefix: "admin:apps", maxEntries: 4 },
    );

    return NextResponse.json(body, {
      headers: {
        ...loadHintHeaders(),
        ...(stale && cachedAt
          ? { "X-Data-AsOf": new Date(cachedAt).toISOString() }
          : {}),
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/applications]", error);
    return NextResponse.json({ error: "Gagal memuat daftar lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
