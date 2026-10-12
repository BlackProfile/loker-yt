// GET /api/admin/form-library — pustaka Form Builder lintas posisi (Task 33).
// Mengagregasi SEMUA skema formulir tersimpan (Position.formSchema, dinormalisasi v2) menjadi:
// - fields  : pertanyaan unik hasil dedupe kunci `${type}::${label}` + usageCount (jumlah posisi
//             unik pemakai) + maks 5 judul posisi pemakai — untuk panel "Ambil dari Pustaka".
// - sections: semua bagian kind "custom" dari tiap posisi (kecuali ?excludePositionId=, dipakai
//             panel Impor) lengkap dengan pratinjau field-nya (tanpa id lama) — untuk
//             "Salin Bagian dari Posisi Lain".
// Kontrak tipe ada di src/lib/types.ts (FormLibraryFieldEntry/FormLibrarySectionEntry); pratinjau
// field & titleEn dikirim sebagai properti tambahan yang dikonsumsi klien lewat tipe lokal.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/server-auth";
import {
  normalizeFormSchema,
  parseFormSchema,
  type FormField,
  type FormFieldType,
  type FormSchema,
} from "@/lib/form-schema";
import type { FormLibraryFieldEntry } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

/** Pratinjau satu field tanpa id lama — dikonsumsi klien (tipe lokal di builder). */
type LibraryFieldPreview = {
  type: FormFieldType;
  label: string;
  labelEn?: string;
  required: boolean;
  options: string[];
  allowOther: boolean;
  placeholder?: string;
  helpText?: string;
  maxLen?: number;
  min?: number;
  max?: number;
};

/** Entri bagian posisi lain + pratinjau field (diperkaya dari FormLibrarySectionEntry). */
type LibrarySectionEntry = {
  positionId: string;
  positionTitle: string;
  sectionId: string;
  title: string;
  titleEn?: string;
  description: string | null;
  fieldCount: number;
  fields: LibraryFieldPreview[];
};

/** Akumulator agregasi pustaka pertanyaan. */
type FieldAccumulator = {
  key: string;
  label: string;
  type: FormFieldType;
  options: string[];
  allowOther: boolean;
  placeholder: string | null;
  helpText: string | null;
  positionIds: Set<string>;
  roles: string[];
};

/** Bentuk pratinjau field: data penting saja, tanpa id lama (id baru dibuat klien saat menyalin). */
function toFieldPreview(field: FormField): LibraryFieldPreview {
  const preview: LibraryFieldPreview = {
    type: field.type,
    label: field.label,
    required: field.required,
    options: [...field.options],
    allowOther: field.allowOther,
  };
  if (field.labelEn) preview.labelEn = field.labelEn;
  if (field.placeholder) preview.placeholder = field.placeholder;
  if (field.helpText) preview.helpText = field.helpText;
  if (field.maxLen != null) preview.maxLen = field.maxLen;
  if (field.min != null) preview.min = field.min;
  if (field.max != null) preview.max = field.max;
  return preview;
}

export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    // Posisi yang dikecualikan hanya berlaku untuk daftar bagian (panel Impor);
    // agregasi pertanyaan tetap memakai SEMUA posisi agar usageCount akurat.
    const excludePositionId = req.nextUrl.searchParams.get("excludePositionId") ?? "";

    const positions = await db.position.findMany({
      where: { deletedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, formSchema: true },
    });

    // Parse + normalisasi skema sekali; posisi tanpa/rusak skema dilewati.
    const parsed = positions
      .map((position) => {
        const schema = normalizeFormSchema(parseFormSchema(position.formSchema));
        return schema ? { id: position.id, title: position.title, schema } : null;
      })
      .filter((item): item is { id: string; title: string; schema: FormSchema } => item !== null);

    /* ------------------------- Pustaka pertanyaan (fields) ------------------------- */

    const byKey = new Map<string, FieldAccumulator>();
    for (const position of parsed) {
      const seenInPosition = new Set<string>();
      for (const field of position.schema.fields) {
        const key = `${field.type}::${field.label.trim().toLowerCase()}`;
        if (seenInPosition.has(key)) continue;
        seenInPosition.add(key);
        let entry = byKey.get(key);
        if (!entry) {
          // Kemunculan pertama menentukan label/options/allowOther/placeholder/helpText.
          entry = {
            key,
            label: field.label,
            type: field.type,
            options: [...field.options],
            allowOther: field.allowOther,
            placeholder: field.placeholder ?? null,
            helpText: field.helpText ?? null,
            positionIds: new Set<string>(),
            roles: [],
          };
          byKey.set(key, entry);
        }
        if (!entry.positionIds.has(position.id)) {
          entry.positionIds.add(position.id);
          if (entry.roles.length < 5) entry.roles.push(position.title);
        }
      }
    }

    const fields: FormLibraryFieldEntry[] = [...byKey.values()]
      .map((entry) => ({
        key: entry.key,
        label: entry.label,
        type: entry.type,
        options: entry.options,
        allowOther: entry.allowOther,
        placeholder: entry.placeholder,
        helpText: entry.helpText,
        usageCount: entry.positionIds.size,
        roles: entry.roles,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.label.localeCompare(b.label));

    /* ----------------------- Bagian kustom posisi lain (sections) ----------------------- */

    const sections: LibrarySectionEntry[] = [];
    for (const position of parsed) {
      if (excludePositionId && position.id === excludePositionId) continue;
      for (const section of position.schema.sections) {
        if (section.kind !== "custom") continue;
        const previewFields = position.schema.fields
          .filter((field) => field.sectionId === section.id)
          .map(toFieldPreview);
        sections.push({
          positionId: position.id,
          positionTitle: position.title,
          sectionId: section.id,
          title: section.title,
          ...(section.titleEn ? { titleEn: section.titleEn } : {}),
          description: section.description ?? null,
          fieldCount: previewFields.length,
          fields: previewFields,
        });
      }
    }

    // Daftar posisi sumber untuk panel "Ganti Formulir" (kloning formulir penuh).
    // fieldCount = jumlah pertanyaan skema v2 tersimpan (0 = belum disusun).
    const positionEntries = parsed.map((position) => ({
      id: position.id,
      title: position.title,
      fieldCount: position.schema.fields.length,
    }));

    return NextResponse.json({ fields, sections, positions: positionEntries });
  } catch (error) {
    console.error("[GET /api/admin/form-library]", error);
    return NextResponse.json(
      { error: "Gagal memuat pustaka formulir. Coba lagi nanti." },
      { status: 500 },
    );
  }
}
