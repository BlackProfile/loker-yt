// GET /api/admin/positions/[id]/form-export — unduh XLSX 2 sheet (Task 33-d, tab Jawaban).
//   Sheet "Jawaban": satu baris per lamaran (terbaru dulu) — Nama, Email, WhatsApp,
//     Status, Tanggal Lamaran, [Skor Formulir bila ada field berskor], lalu satu kolom
//     per pertanyaan skema berjudul "{judul bagian} — {label}" (urut bagian → field).
//   Sheet "Ringkasan": satu baris per pertanyaan — Bagian, Pertanyaan, Tipe, Terisi,
//     lalu Rata-rata/Min/Maks (rating & angka) dan count per opsi (pilihan, dinamis).
// Read-only, semua admin termasuk VIEWER. SERVER-ONLY.
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  FORM_FIELD_TYPE_LABELS,
  FORM_LIMITS,
  computeFormScore,
  computeFormScoreMax,
  formatAnswerValue,
  isChoiceType,
  normalizeFormSchema,
  parseFormAnswers,
  parseFormSchema,
  type FormAnswerValue,
  type FormField,
  type FormSchema,
} from "@/lib/form-schema";
import { STATUS_LABELS, type ApplicationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

// Zona tetap WIB agar nama file dan kolom tanggal deterministik di server mana pun.
const TIME_ZONE = "Asia/Jakarta";

const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

// en-CA menghasilkan YYYY-MM-DD — dipakai untuk stempel tanggal nama file.
const fileDateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

type ExportAppRow = {
  name: string;
  email: string;
  phone: string;
  status: string;
  createdAt: Date;
  answers: Record<string, FormAnswerValue>;
};

/** Urutan kolom: pertanyaan aktif per bagian, lalu pertanyaan yatim (data rusak). */
function orderedFields(schema: FormSchema): FormField[] {
  const bySection = schema.sections
    .map((section) => schema.fields.filter((f) => f.sectionId === section.id))
    .flat();
  const known = new Set(bySection.map((f) => f.id));
  const orphans = schema.fields.filter((f) => !known.has(f.id));
  return [...bySection, ...orphans];
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status as ApplicationStatus] ?? status;
}

function sectionTitleOf(schema: FormSchema, field: FormField): string {
  return schema.sections.find((s) => s.id === field.sectionId)?.title ?? "Tanpa Bagian";
}

/** Apakah satu nilai jawaban dianggap terisi (baris/checkbox kosong tidak dihitung). */
function isAnswered(value: FormAnswerValue | undefined): boolean {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Boolean(value.fileId);
  if (typeof value === "string") return value.trim() !== "";
  return true; // number
}

/** Slug aman untuk nama file: huruf/angka/tanda hubung saja. */
function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "posisi";
}

function choiceStats(field: FormField, rows: ExportAppRow[]): { filled: number; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  for (const option of field.options) counts.set(option, 0);
  let filled = 0;
  for (const row of rows) {
    const value = row.answers[field.id];
    if (!isAnswered(value)) continue;
    filled += 1;
    const items = (Array.isArray(value) ? value : [value]).filter(
      (item): item is string => typeof item === "string",
    );
    for (const item of items) {
      if (counts.has(item)) counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  return { filled, counts };
}

function numericStats(
  field: FormField,
  rows: ExportAppRow[],
): { filled: number; avg: number | null; min: number | null; max: number | null } {
  const scale = field.type === "rating" ? field.max ?? FORM_LIMITS.ratingMaxDefault : null;
  let filled = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (const row of rows) {
    const value = row.answers[field.id];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (scale != null && (value < 1 || value > scale)) continue;
    filled += 1;
    sum += value;
    min = min == null ? value : Math.min(min, value);
    max = max == null ? value : Math.max(max, value);
  }
  return { filled, avg: filled > 0 ? Math.round((sum / filled) * 10) / 10 : null, min, max };
}

function filledCount(field: FormField, rows: ExportAppRow[]): number {
  let filled = 0;
  for (const row of rows) if (isAnswered(row.answers[field.id])) filled += 1;
  return filled;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const schema = normalizeFormSchema(parseFormSchema(position.formSchema));
    if (!schema) {
      return NextResponse.json({ error: "Posisi ini belum memakai Form Builder." }, { status: 400 });
    }

    const fields = orderedFields(schema);
    const dbRows = await db.application.findMany({
      where: { positionId: id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        formAnswers: true,
      },
      take: 2000,
    });
    const rows: ExportAppRow[] = dbRows.map((row) => ({
      name: row.name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      createdAt: row.createdAt,
      answers: parseFormAnswers(row.formAnswers) ?? {},
    }));

    // --------------------------- Sheet "Jawaban" ---------------------------
    const scoreMax = computeFormScoreMax(schema);
    const jawabanHeader: string[] = ["Nama", "Email", "WhatsApp", "Status", "Tanggal Lamaran"];
    if (scoreMax != null) jawabanHeader.push("Skor Formulir");
    for (const field of fields) {
      jawabanHeader.push(`${sectionTitleOf(schema, field)} — ${field.label}`);
    }

    const jawabanAoa: (string | number)[][] = [jawabanHeader];
    for (const row of rows) {
      const line: (string | number)[] = [
        row.name,
        row.email,
        row.phone,
        statusLabel(row.status),
        dateTimeFmt.format(row.createdAt),
      ];
      if (scoreMax != null) {
        const score = computeFormScore(schema, row.answers);
        line.push(score == null ? "" : score);
      }
      for (const field of fields) {
        line.push(formatAnswerValue(row.answers[field.id]));
      }
      jawabanAoa.push(line);
    }

    // -------------------------- Sheet "Ringkasan" --------------------------
    // Kolom dinamis opsi: satu kolom per opsi per field pilihan; bila label kolom
    // bentrok antar field, difokuskan dengan label pertanyaannya.
    const optionColumns: string[] = [];
    const usedHeaders = new Set<string>();
    const columnsByField = new Map<string, string[]>();
    for (const field of fields) {
      if (!isChoiceType(field.type)) continue;
      const cols: string[] = [];
      for (const option of field.options) {
        let header = `Opsi: ${option}`;
        if (usedHeaders.has(header)) header = `Opsi: ${option} — ${field.label}`;
        if (usedHeaders.has(header)) header = `${header} #${cols.length + 1}`;
        usedHeaders.add(header);
        optionColumns.push(header);
        cols.push(header);
      }
      columnsByField.set(field.id, cols);
    }
    const ringkasanHeader: string[] = [
      "Bagian",
      "Pertanyaan",
      "Tipe",
      "Terisi",
      "Rata-rata",
      "Min",
      "Maks",
      ...optionColumns,
    ];

    const ringkasanAoa: (string | number)[][] = [ringkasanHeader];
    for (const field of fields) {
      const base: (string | number)[] = [
        sectionTitleOf(schema, field),
        field.label,
        FORM_FIELD_TYPE_LABELS[field.type],
      ];
      const num: (string | number)[] = ["", "", ""];
      const optionCells: (string | number)[] = optionColumns.map(() => "");
      if (isChoiceType(field.type)) {
        const stats = choiceStats(field, rows);
        base.push(stats.filled);
        const counts = columnsByField.get(field.id) ?? [];
        counts.forEach((header, index) => {
          const count = stats.counts.get(field.options[index]) ?? 0;
          optionCells[optionColumns.indexOf(header)] = count;
        });
      } else if (field.type === "rating" || field.type === "number") {
        const stats = numericStats(field, rows);
        base.push(stats.filled);
        num[0] = stats.avg ?? "";
        num[1] = stats.min ?? "";
        num[2] = stats.max ?? "";
      } else {
        base.push(filledCount(field, rows));
      }
      ringkasanAoa.push([...base, ...num, ...optionCells]);
    }

    // ------------------------------ Tulis file ------------------------------
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(jawabanAoa), "Jawaban");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(ringkasanAoa), "Ringkasan");
    const buffer: Buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    const filename = `form-${slugify(position.slug || position.title)}-${fileDateFmt.format(new Date())}.xlsx`;
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/positions/[id]/form-export]", error);
    return NextResponse.json(
      { error: "Gagal membuat berkas XLSX. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
