// GET /api/admin/reports/scorecards?positionId=&days=90 — agregasi scorecard wawancara
// (NR-19-c Tugas 1a, semua role admin).
//
// Sumber data: model Interview. Bentuk data tersimpan:
//   - scores         : JSON string "{kriteria: 1..5}" (maks 8 kriteria; kunci = label
//                      kriteria scorecard posisi, atau kriteria bawaan — lihat
//                      DEFAULT_INTERVIEW_CRITERIA). Diisi lewat PATCH
//                      /api/admin/interviews/[id] (autosave scorecard 1-5 per kriteria).
//   - recommendation : "LANJUT" | "CADANGAN" | "TOLAK" | null.
//   - interviewers   : JSON string[] nama pewawancara.
//   - application -> position : relasi untuk filter posisi (PII: nama kandidat TIDAK
//                      diambil sama sekali — hanya agregat).
//
// Kontrak respons:
// { ok, generatedAt, days, positions: [{id,title}], summary: { total, filled,
//   avgOverall, recommendation: {LANJUT,CADANGAN,TOLAK,UNKNOWN} },
//   criteria: [{key,label,avg,count}], byInterviewer: [{name,count,avg}] }
//
// Semantik angka:
//   - total        : semua sesi wawancara pada periode (scheduledAt >= now-days),
//                    sesuai filter posisi.
//   - filled       : sesi yang sudah punya hasil scorecard (scores ATAU recommendation).
//   - avgOverall   : rata-rata dari skor keseluruhan per sesi (rata-rata kriteria,
//                    skala normal 1-5, dibulatkan 1 desimal) di antara sesi berskor.
//   - UNKNOWN      : total - (LANJUT+CADANGAN+TOLAK) — sesi belum punya rekomendasi.
//   - criteria[]   : agregat per kriteria dari seluruh sesi berskor (avg 1 desimal,
//                    count = jumlah sesi yang memberi nilai kriteria itu).
//   - byInterviewer[] : jumlah sesi yang diikuti + rata-rata skor keseluruhan sesi
//                    berskor yang diikutinya. (Nama pewawancara boleh tampil; bukan PII kandidat.)
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseScoreRecord } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Posisi tidak ditemukan." };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 90;
const MAX_DAYS = 3650;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

type CriteriaAgg = { sum: number; count: number };
type InterviewerAgg = { count: number; sum: number; scored: number };

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const positionId = searchParams.get("positionId")?.trim() ?? "";
    const rawDays = Number.parseInt(searchParams.get("days") ?? "", 10);
    const days =
      Number.isInteger(rawDays) && rawDays > 0 ? Math.min(rawDays, MAX_DAYS) : DEFAULT_DAYS;
    const threshold = new Date(Date.now() - days * DAY_MS);

    if (positionId) {
      const pos = await db.position.findUnique({
        where: { id: positionId },
        select: { id: true },
      });
      if (!pos) {
        return NextResponse.json(NOT_FOUND, { status: 404 });
      }
    }

    // Daftar posisi untuk filter select (semua posisi, urut judul).
    // Wawancara pada periode + filter posisi — tanpa data nama kandidat (PII).
    const [positions, interviews] = await Promise.all([
      db.position.findMany({
        select: { id: true, title: true },
        orderBy: [{ title: "asc" }],
      }),
      db.interview.findMany({
        where: {
          scheduledAt: { gte: threshold },
          ...(positionId ? { application: { positionId } } : {}),
        },
        select: {
          scores: true,
          recommendation: true,
          interviewers: true,
        },
      }),
    ]);

    const recommendation = { LANJUT: 0, CADANGAN: 0, TOLAK: 0 };
    const criteriaAgg = new Map<string, CriteriaAgg>();
    const interviewerAgg = new Map<string, InterviewerAgg>();

    let filled = 0;
    let overallSum = 0;
    let overallCount = 0;

    for (const interview of interviews) {
      // parseScoreRecord: JSON aman + normalisasi skala 1-5 (clamp & bulatkan).
      const scores = parseScoreRecord(interview.scores);
      const rec =
        interview.recommendation === "LANJUT" ||
        interview.recommendation === "CADANGAN" ||
        interview.recommendation === "TOLAK"
          ? interview.recommendation
          : null;

      const hasScores = scores !== null;
      const hasResult = hasScores || rec !== null;
      if (!hasResult) continue; // sesi tanpa hasil tidak masuk agregat isi

      filled += 1;
      if (rec) recommendation[rec] += 1;

      let overall: number | null = null;
      if (hasScores && scores) {
        const values = Object.values(scores);
        overall = values.reduce((sum, v) => sum + v, 0) / values.length;
        overallSum += overall;
        overallCount += 1;

        for (const [key, value] of Object.entries(scores)) {
          const agg = criteriaAgg.get(key) ?? { sum: 0, count: 0 };
          agg.sum += value;
          agg.count += 1;
          criteriaAgg.set(key, agg);
        }
      }

      // Pewawancara: JSON string[] nama (maks 6 per sesi).
      let names: string[] = [];
      try {
        const parsed: unknown = JSON.parse(interview.interviewers);
        if (Array.isArray(parsed)) {
          names = parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0);
        }
      } catch {
        names = [];
      }
      for (const raw of names) {
        const name = raw.trim().slice(0, 60);
        if (!name) continue;
        const agg = interviewerAgg.get(name) ?? { count: 0, sum: 0, scored: 0 };
        agg.count += 1;
        if (overall !== null) {
          agg.sum += overall;
          agg.scored += 1;
        }
        interviewerAgg.set(name, agg);
      }
    }

    const criteria = Array.from(criteriaAgg.entries())
      .map(([key, agg]) => ({
        key,
        label: key,
        avg: round1(agg.sum / agg.count),
        count: agg.count,
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "id"));

    const byInterviewer = Array.from(interviewerAgg.entries())
      .map(([name, agg]) => ({
        name,
        count: agg.count,
        avg: agg.scored > 0 ? round1(agg.sum / agg.scored) : null,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "id"));

    const total = interviews.length;
    const unknown = Math.max(0, total - (recommendation.LANJUT + recommendation.CADANGAN + recommendation.TOLAK));

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      days,
      positions: positions.map((p) => ({ id: p.id, title: p.title })),
      summary: {
        total,
        filled,
        avgOverall: overallCount > 0 ? round1(overallSum / overallCount) : null,
        recommendation: { ...recommendation, UNKNOWN: unknown },
      },
      criteria,
      byInterviewer,
    });
  } catch (error) {
    console.error("[GET /api/admin/reports/scorecards]", error);
    return NextResponse.json(
      { error: "Gagal memuat agregasi scorecard. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
