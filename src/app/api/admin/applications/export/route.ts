// GET /api/admin/applications/export — unduh daftar lamaran (OWNER/HR).
//   default   -> CSV (perilaku lama, tidak berubah)
//   ?format=xlsx -> workbook Excel 2 sheet (NR-19-b):
//       "Lamaran"   : kolom CSV + kolom "Status Offer" (data identik, PII sama)
//       "Ringkasan" : rekap per status (label + jumlah) & per posisi
//                     (judul + jumlah lamaran + diterima)
// Filter sama dengan GET /api/admin/applications.
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseApplicationFilters } from "@/lib/seed";
import { stageLabel } from "@/lib/stages";
import {
  AI_RECOMMENDATION_LABELS,
  OFFER_STATUS_LABELS,
  type AiRecommendation,
  type OfferStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type ExportApplication = Prisma.ApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDateId(value: Date | null): string {
  if (!value) return "";
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

/** Tanggal lokal hari ini YYYY-MM-DD (untuk nama file unduhan). */
function todayFileStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Label status offer atau kosong bila belum ada offer. */
function offerStatusLabel(status: string | null): string {
  if (!status) return "";
  return (OFFER_STATUS_LABELS as Record<string, string>)[status] ?? status;
}

/** Header kolom dasar — identik dengan CSV lama. */
function buildHeader(): string[] {
  return [
    "Kode",
    "Nama",
    "Email",
    "WhatsApp",
    "Posisi",
    "Status",
    "Skor AI",
    "Rekomendasi AI",
    "Rating",
    "Tags",
    "Talent Pool",
    "Jadwal Wawancara",
    "Link Portofolio",
    "Tanggal Daftar",
  ];
}

/** Sel satu baris lamaran — perlakuan PII identik dengan CSV lama (reuse logika). */
function buildCells(row: ExportApplication): string[] {
  const recommendation =
    row.aiRecommendation && row.aiRecommendation in AI_RECOMMENDATION_LABELS
      ? AI_RECOMMENDATION_LABELS[row.aiRecommendation as AiRecommendation]
      : "";
  const tags = (() => {
    try {
      const parsed: unknown = JSON.parse(row.tags);
      return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string").join("; ") : "";
    } catch {
      return "";
    }
  })();
  return [
    row.trackingCode ?? "",
    row.name,
    row.email,
    row.phone,
    row.position?.title ?? "",
    stageLabel(row.status.trim() || "NEW"),
    row.aiScore === null ? "" : String(row.aiScore),
    recommendation,
    String(row.rating),
    tags,
    row.talentPool ? "Ya" : "Tidak",
    formatDateId(row.interviewAt),
    row.portfolioUrl ?? "",
    formatDateId(row.createdAt),
  ];
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") ?? "csv").toLowerCase();
    // userId diteruskan agar filter starred (bintang personal) tahu admin yang login.
    const { where, orderBy, valid } = parseApplicationFilters(searchParams, session.id);
    if (!valid) {
      return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
    }

    const rows = await db.application.findMany({
      where,
      orderBy,
      include: APPLICATION_INCLUDE,
    });

    /* ----------------------------- Mode XLSX ----------------------------- */
    if (format === "xlsx") {
      const baseHeader = buildHeader();
      const dataHeader = [...baseHeader, "Status Offer"];
      const dataAoa: (string | number)[][] = [dataHeader];
      for (const row of rows) {
        dataAoa.push([...buildCells(row), offerStatusLabel(row.offerStatus)]);
      }
      const sheetLamaran = XLSX.utils.aoa_to_sheet(dataAoa);
      sheetLamaran["!cols"] = dataHeader.map((title, index) => ({
        wch: index === 0 ? 14 : Math.max(12, Math.min(42, title.length + 6)),
      }));

      // Sheet "Ringkasan": rekap per status + per posisi (dari data yang diekspor).
      const statusCounts = new Map<string, number>();
      const positionStats = new Map<string, { total: number; accepted: number }>();
      for (const row of rows) {
        const statusName = stageLabel(row.status.trim() || "NEW");
        statusCounts.set(statusName, (statusCounts.get(statusName) ?? 0) + 1);
        const positionTitle = row.position?.title ?? "(tanpa posisi)";
        const stat = positionStats.get(positionTitle) ?? { total: 0, accepted: 0 };
        stat.total += 1;
        if (row.status === "ACCEPTED") stat.accepted += 1;
        positionStats.set(positionTitle, stat);
      }

      const summaryAoa: (string | number)[][] = [["Rekap per Status"], ["Status", "Jumlah"]];
      for (const [statusName, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
        summaryAoa.push([statusName, count]);
      }
      summaryAoa.push(["Total", rows.length]);
      summaryAoa.push([]);
      summaryAoa.push(["Rekap per Posisi"], ["Posisi", "Jumlah Lamaran", "Diterima"]);
      for (const [positionTitle, stat] of [...positionStats.entries()].sort((a, b) => b[1].total - a[1].total)) {
        summaryAoa.push([positionTitle, stat.total, stat.accepted]);
      }
      const sheetRingkasan = XLSX.utils.aoa_to_sheet(summaryAoa);
      sheetRingkasan["!cols"] = [{ wch: 34 }, { wch: 16 }, { wch: 12 }];

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheetLamaran, "Lamaran");
      XLSX.utils.book_append_sheet(workbook, sheetRingkasan, "Ringkasan");

      const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const fileName = `lamaran-lumina-${todayFileStamp(new Date())}.xlsx`;
      return new Response(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": XLSX_MIME,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    /* ------------------------------ Mode CSV ------------------------------ */
    const lines = [buildHeader().map(csvCell).join(",")];
    for (const row of rows) {
      lines.push(buildCells(row).map(csvCell).join(","));
    }

    const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lamaran-lumina.csv"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/applications/export]", error);
    return NextResponse.json({ error: "Gagal mengekspor lamaran. Coba lagi nanti." }, { status: 500 });
  }
}
