// POST /api/public/track-auth — login pelamar di halaman Cek Status.
// Body: { email, code } — pasangan email + kode pelacakan harus cocok dengan
// lamaran (kode bertindak sebagai kata sandi). Sukses mengembalikan daftar
// SEMUA lamaran aktif milik email tersebut (mendukung multi-lamaran sekali login).
// Keamanan: throttle per IP + lockout 5x gagal / 15 menit (src/lib/status-gate).
// NR-15: read receipt lamaran yang cocok + statistik login harian + ringkasan
// "Apa yang Berubah" sejak kunjungan terakhir (header "x-lumina-seen").
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clearAuthFails,
  clientIp,
  isLockedOut,
  isThrottled,
  lockRemainingSec,
  recordAuthFail,
} from "@/lib/status-gate";
import { bumpStatusCheckStats } from "@/lib/status-stats";
import type { TrackAuthResponse, TrackChangeInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Aksi ActivityLog yang relevan & aman ditampilkan sebagai "Apa yang Berubah". */
const CHANGES_ACTIONS = [
  "STATUS_CHANGE",
  "OFFER_SENT",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "INTERVIEW_SCHEDULED",
  "INTERVIEW_RESCHEDULED",
  "QUESTION_ANSWERED",
];

const CHANGES_FALLBACK_LABELS: Record<string, string> = {
  OFFER_SENT: "Penawaran dikirim",
  OFFER_ACCEPTED: "Penawaran diterima",
  OFFER_DECLINED: "Penawaran ditolak",
  INTERVIEW_SCHEDULED: "Jadwal wawancara diperbarui",
  INTERVIEW_RESCHEDULED: "Jadwal wawancara diubah",
  QUESTION_ANSWERED: "Pertanyaanmu sudah dijawab tim",
};

const CHANGES_MAX_PER_CODE = 10;

/** Teks ringkas bahasa Indonesia untuk satu perubahan (detail log sudah berbahasa ID). */
function changeText(action: string, detail: string | null): string {
  const safeDetail = (detail ?? "").trim();
  if (action === "STATUS_CHANGE") {
    return safeDetail ? `Tahap berubah: ${safeDetail}` : "Tahap lamaran berubah";
  }
  if (safeDetail) return safeDetail;
  return CHANGES_FALLBACK_LABELS[action] ?? "Ada pembaruan pada lamaranmu";
}

/**
 * Parse header "x-lumina-seen" (JSON {kode: epochMs}) secara aman.
 * Kode dinormalisasi ke huruf besar; nilai invalid/kedepan diabaikan.
 */
function parseSeenHeader(raw: string | null): Record<string, number> {
  if (!raw || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const code = key.trim().toUpperCase();
      if (!code) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
      const ms = Math.floor(value);
      if (ms > Date.now() + 60_000) continue; // jam klien loncat — abaikan
      out[code] = ms;
    }
    return out;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = clientIp(req);

    if (isLockedOut(ip)) {
      const body: TrackAuthResponse = {
        ok: false,
        lockedForSec: lockRemainingSec(ip),
      };
      return NextResponse.json(body, { status: 429 });
    }
    if (isThrottled(`auth:${ip}`, 400)) {
      return NextResponse.json(
        { ok: false, error: "Terlalu cepat." } satisfies TrackAuthResponse,
        { status: 429 },
      );
    }

    const body: unknown = await req.json().catch(() => null);
    const rawEmail =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).email
        : undefined;
    const rawCode =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>).code
        : undefined;

    if (typeof rawEmail !== "string" || !/\S+@\S+\.\S+/.test(rawEmail.trim())) {
      return NextResponse.json(
        { ok: false, error: "Email wajib diisi dengan format yang benar." } satisfies TrackAuthResponse,
        { status: 400 },
      );
    }
    if (typeof rawCode !== "string" || !rawCode.trim()) {
      return NextResponse.json(
        { ok: false, error: "Kode pelacakan wajib diisi." } satisfies TrackAuthResponse,
        { status: 400 },
      );
    }

    const email = rawEmail.trim().toLowerCase();
    const code = rawCode.trim().toUpperCase();

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: { id: true, email: true, deletedAt: true },
    });

    // Respons gagal selalu identik (tidak membocorkan mana yang salah / ada tidaknya kode).
    if (!application || application.deletedAt || application.email.trim().toLowerCase() !== email) {
      recordAuthFail(ip);
      const failBody: TrackAuthResponse = { ok: false };
      return NextResponse.json(failBody, { status: 401 });
    }
    clearAuthFails(ip);

    // NR-15 (idea 5): read receipt untuk lamaran yang login-nya cocok + penghitung
    // login harian. Fire-and-forget — tidak menambah latensi respons.
    void db.application
      .update({
        where: { id: application.id },
        data: { candidateSeenAt: new Date(), candidateSeenCount: { increment: 1 } },
      })
      .catch(() => undefined);
    void bumpStatusCheckStats("logins");

    // Multi-lamaran: semua lamaran aktif (bukan tong sampah) milik email ini.
    const rows = await db.application.findMany({
      where: { email: { equals: application.email }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        trackingCode: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        position: { select: { title: true, slug: true } },
      },
    });

    // "Apa yang Berubah" (NR-15, idea 4): ActivityLog sejak kunjungan terakhir
    // per kode (header x-lumina-seen). Satu query untuk semua lamaran.
    const seen = parseSeenHeader(req.headers.get("x-lumina-seen"));
    const changes: Record<string, TrackChangeInfo[]> = {};
    const idsWithSince: { id: string; code: string; since: number }[] = [];
    for (const row of rows) {
      const rowCode = (row.trackingCode ?? "").toUpperCase();
      if (!rowCode) continue;
      const since = seen[rowCode] ?? 0;
      changes[rowCode] = [];
      if (since > 0) idsWithSince.push({ id: row.id, code: rowCode, since });
    }
    if (idsWithSince.length > 0) {
      const minSince = Math.min(...idsWithSince.map((item) => item.since));
      const logs = await db.activityLog.findMany({
        where: {
          applicationId: { in: idsWithSince.map((item) => item.id) },
          action: { in: CHANGES_ACTIONS },
          createdAt: { gt: new Date(minSince) },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      for (const log of logs) {
        if (!log.applicationId) continue;
        const match = idsWithSince.find((item) => item.id === log.applicationId);
        if (!match) continue;
        if (log.createdAt.getTime() <= match.since) continue;
        const list = changes[match.code] ?? (changes[match.code] = []);
        if (list.length >= CHANGES_MAX_PER_CODE) continue;
        list.push({
          at: log.createdAt.toISOString(),
          text: changeText(log.action, log.detail),
        });
      }
    }

    const responseBody: TrackAuthResponse = {
      ok: true,
      applications: rows.map((row) => ({
        trackingCode: row.trackingCode ?? "",
        positionTitle: row.position?.title ?? null,
        positionSlug: row.position?.slug ?? null,
        status: row.status.trim() || "NEW",
        submittedAt: row.createdAt.toISOString(),
        statusUpdatedAt: row.updatedAt.toISOString(),
      })),
      changes,
    };
    return NextResponse.json(responseBody);
  } catch (error) {
    console.error("[POST /api/public/track-auth]", error);
    return NextResponse.json(
      { ok: false, error: "Gagal masuk. Coba lagi nanti." } satisfies TrackAuthResponse,
      { status: 500 },
    );
  }
}
