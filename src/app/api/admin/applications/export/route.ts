// GET /api/admin/applications/export — unduh daftar lamaran sebagai CSV (OWNER/HR).
// Filter sama dengan GET /api/admin/applications.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { APPLICATION_INCLUDE, parseApplicationFilters } from "@/lib/seed";
import {
  AI_RECOMMENDATION_LABELS,
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type AiRecommendation,
  type ApplicationStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function formatDateId(value: Date | null): string {
  if (!value) return "";
  return value.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
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
    const { where, orderBy, valid } = parseApplicationFilters(searchParams);
    if (!valid) {
      return NextResponse.json({ error: "Status tidak valid." }, { status: 400 });
    }

    const rows = await db.application.findMany({
      where,
      orderBy,
      include: APPLICATION_INCLUDE,
    });

    const header = [
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

    const lines = [header.map(csvCell).join(",")];
    for (const row of rows) {
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
      const cells = [
        row.trackingCode ?? "",
        row.name,
        row.email,
        row.phone,
        row.position?.title ?? "",
        STATUS_LABELS[(APPLICATION_STATUSES as string[]).includes(row.status)
          ? (row.status as ApplicationStatus)
          : "NEW"],
        row.aiScore === null ? "" : String(row.aiScore),
        recommendation,
        String(row.rating),
        tags,
        row.talentPool ? "Ya" : "Tidak",
        formatDateId(row.interviewAt),
        row.portfolioUrl ?? "",
        formatDateId(row.createdAt),
      ];
      lines.push(cells.map(csvCell).join(","));
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
