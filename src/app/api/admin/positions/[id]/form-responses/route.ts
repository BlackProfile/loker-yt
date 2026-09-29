// GET /api/admin/positions/[id]/form-responses — data tab "Jawaban" Form Builder.
//   ?format=csv  -> unduhan CSV satu baris per lamaran, satu kolom per pertanyaan.
//   tanpa param  -> JSON: statistik per pertanyaan + daftar jawaban terbaru.
// Semua admin bisa membaca (VIEWER included); tidak ada aksi perubahan di sini.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  formatAnswerValue,
  isChoiceType,
  parseFormAnswers,
  parseFormSchema,
  type FormAnswerValue,
  type FormField,
  type FormSchema,
} from "@/lib/form-schema";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

type AnswerRow = {
  id: string;
  trackingCode: string | null;
  name: string;
  email: string;
  status: string;
  createdAt: string;
  answers: Record<string, FormAnswerValue>;
};

/** Urutan kolom: pertanyaan aktif per bagian, lalu pertanyaan pensiun di belakang. */
function orderedFields(schema: FormSchema): FormField[] {
  const bySection = schema.sections
    .map((section) => schema.fields.filter((f) => f.sectionId === section.id))
    .flat();
  const known = new Set(bySection.map((f) => f.id));
  const orphans = schema.fields.filter((f) => !known.has(f.id));
  return [...bySection, ...orphans];
}

function csvEscape(value: string): string {
  if (/[",\n\r;]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const { id } = await params;
    const position = await db.position.findUnique({ where: { id } });
    if (!position || position.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }
    const schema = parseFormSchema(position.formSchema);
    if (!schema) {
      return NextResponse.json({ error: "Posisi ini belum memakai Form Builder." }, { status: 400 });
    }

    const rows = await db.application.findMany({
      where: { positionId: id, deletedAt: null, formAnswers: { not: null } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        trackingCode: true,
        name: true,
        email: true,
        status: true,
        createdAt: true,
        formAnswers: true,
      },
      take: 2000,
    });

    const answeredRows: AnswerRow[] = rows.map((row) => ({
      id: row.id,
      trackingCode: row.trackingCode,
      name: row.name,
      email: row.email,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      answers: parseFormAnswers(row.formAnswers) ?? {},
    }));

    const fields = orderedFields(schema);
    const retired = schema.retiredFields;

    // ---------- Mode CSV ----------
    const format = req.nextUrl.searchParams.get("format");
    if (format === "csv") {
      const header = [
        "Kode",
        "Nama",
        "Email",
        "Tahap",
        "Dikirim",
        ...fields.map((f) => f.label),
        ...retired.map((r) => `${r.label} (dihapus)`),
      ];
      const lines = [header.map(csvEscape).join(",")];
      for (const row of answeredRows) {
        const cells = [
          row.trackingCode ?? row.id,
          row.name,
          row.email,
          row.status,
          new Date(row.createdAt).toLocaleString("id-ID"),
          ...fields.map((f) => formatAnswerValue(row.answers[f.id])),
          ...retired.map((r) => formatAnswerValue(row.answers[r.id])),
        ];
        lines.push(cells.map(csvEscape).join(","));
      }
      // BOM agar Excel membaca UTF-8 dengan benar.
      const csv = "\uFEFF" + lines.join("\r\n");
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="jawaban-form-${position.slug || position.id}.csv"`,
        },
      });
    }

    // ---------- Mode JSON: statistik per pertanyaan ----------
    const stats = fields.map((field) => {
      if (isChoiceType(field.type)) {
        const counts: Record<string, number> = {};
        for (const option of field.options) counts[option] = 0;
        let otherCount = 0;
        let filled = 0;
        for (const row of answeredRows) {
          const value = row.answers[field.id];
          if (value == null || (Array.isArray(value) && value.length === 0)) continue;
          filled += 1;
          const items = Array.isArray(value) ? value : [value];
          for (const item of items) {
            if (field.options.includes(item)) counts[item] = (counts[item] ?? 0) + 1;
            else otherCount += 1;
          }
        }
        return { fieldId: field.id, kind: "choices" as const, filled, counts, otherCount };
      }
      if (field.type === "rating") {
        const max = field.max ?? 5;
        const counts: number[] = new Array(max).fill(0);
        let filled = 0;
        let sum = 0;
        for (const row of answeredRows) {
          const value = row.answers[field.id];
          if (typeof value !== "number") continue;
          if (value < 1 || value > max) continue;
          counts[value - 1] += 1;
          filled += 1;
          sum += value;
        }
        const avg = filled > 0 ? Math.round((sum / filled) * 10) / 10 : null;
        return { fieldId: field.id, kind: "rating" as const, filled, counts, avg };
      }
      if (field.type === "file") {
        const files: { filename: string; fileId: string; name: string }[] = [];
        for (const row of answeredRows) {
          const value = row.answers[field.id];
          if (value && typeof value === "object" && !Array.isArray(value) && "fileId" in value) {
            files.push({ filename: value.filename || "berkas", fileId: value.fileId, name: row.name });
          }
        }
        return { fieldId: field.id, kind: "files" as const, filled: files.length, files: files.slice(0, 30) };
      }
      // teks / paragraf / tanggal / angka / URL — contoh jawaban terbaru.
      const samples: { name: string; value: string; trackingCode: string | null }[] = [];
      for (const row of answeredRows) {
        const value = row.answers[field.id];
        if (value == null || (Array.isArray(value) && value.length === 0)) continue;
        const text = formatAnswerValue(value);
        if (!text) continue;
        samples.push({ name: row.name, value: text, trackingCode: row.trackingCode });
        if (samples.length >= 20) break;
      }
      const filled = answeredRows.filter((row) => {
        const value = row.answers[field.id];
        return value != null && formatAnswerValue(value) !== "";
      }).length;
      return { fieldId: field.id, kind: "text" as const, filled, samples };
    });

    return NextResponse.json({
      total: answeredRows.length,
      fields: stats,
      retired,
      recent: answeredRows.slice(0, 50).map((row) => ({
        id: row.id,
        trackingCode: row.trackingCode,
        name: row.name,
        email: row.email,
        status: row.status,
        createdAt: row.createdAt,
        answers: row.answers,
      })),
    });
  } catch (error) {
    console.error("[GET /api/admin/positions/[id]/form-responses]", error);
    return NextResponse.json({ error: "Gagal memuat jawaban. Coba lagi nanti." }, { status: 500 });
  }
}
