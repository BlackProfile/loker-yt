// GET  /api/admin/positions/[id]/form — ambil skema formulir posisi (Form Builder).
//        Bila posisi masih mode klasik (formSchema null), dikembalikan juga `derived`:
//        skema awal hasil migrasi otomatis dari screeningQuestions + customDocs,
//        siap diedit di builder tapi BELUM tersimpan sampai admin menekan Simpan.
// PUT  /api/admin/positions/[id]/form — simpan skema formulir (OWNER/HR).
//        Field lama yang hilang otomatis dipindah ke retiredFields agar jawaban
//        lamaran yang sudah masuk tetap bisa dirender di tab Jawaban.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { serializePosition } from "@/lib/seed";
import {
  buildDefaultSchema,
  filesConfigFromSchema,
  normalizeFormSchema,
  parseFormSchema,
  sanitizeFormSchemaInput,
  type FormSchema,
} from "@/lib/form-schema";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Posisi tidak ditemukan" };

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

    // Skema tersimpan (null = mode klasik) + skema bawaan hasil migrasi otomatis.
    // Keduanya dinormalisasi ke v2; konfigurasi berkas draf mengikuti kolom posisi.
    let derived: FormSchema | null = null;
    if (!position.formSchema) {
      derived = buildDefaultSchema({
        screeningQuestions: parseScreeningQuestionsSafe(position.screeningQuestions),
        customDocs: parseStringArraySafe(position.customDocs),
        requireCv: position.requireCv,
        requireIntro: position.requireIntro,
        requirePortfolio: position.requirePortfolio,
      });
    }

    const filesFallback = {
      requireCv: position.requireCv,
      requireIntro: position.requireIntro,
      requirePortfolio: position.requirePortfolio,
    };
    return NextResponse.json({
      schema: position.formSchema
        ? normalizeFormSchema(parseFormSchema(position.formSchema), filesFallback)
        : null,
      derived,
    });
  } catch (error) {
    console.error("[GET /api/admin/positions/[id]/form]", error);
    return NextResponse.json({ error: "Gagal memuat formulir. Coba lagi nanti." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const schemaInput = (body as Record<string, unknown>).schema;

    const existing = await db.position.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const sanitized = sanitizeFormSchemaInput(schemaInput, {
      previousSchemaRaw: existing.formSchema,
    });
    if (!sanitized.ok) {
      return NextResponse.json({ error: sanitized.error }, { status: 400 });
    }
    if (sanitized.value === undefined) {
      return NextResponse.json({ error: "Skema formulir wajib dikirim." }, { status: 400 });
    }

    // v2: kolom berkas selalu mengikuti konfigurasi bagian Berkas di skema agar
    // fitur lama (kartu Ketentuan publik, prompt AI) tetap konsisten.
    // Kembali ke mode klasik (null) TIDAK mengubah kolom berkas yang ada.
    const savedSchema = sanitized.value ? parseFormSchema(sanitized.value) : null;
    const filesSync = savedSchema
      ? filesConfigFromSchema(normalizeFormSchema(savedSchema) ?? savedSchema)
      : null;

    const updated = await db.position.update({
      where: { id },
      data: {
        formSchema: sanitized.value,
        ...(filesSync
          ? {
              requireCv: filesSync.requireCv,
              requireIntro: filesSync.requireIntro,
              requirePortfolio: filesSync.requirePortfolio,
            }
          : {}),
      },
    });

    await db.activityLog.create({
      data: {
        applicationId: null,
        actor: session.name,
        action: "FORM_SCHEMA_SAVED",
        detail: `Formulir lamaran posisi "${existing.title}" diperbarui (Form Builder)`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.positions);
    return NextResponse.json({
      schema: updated.formSchema
        ? normalizeFormSchema(parseFormSchema(updated.formSchema))
        : null,
      position: serializePosition(updated),
    });
  } catch (error) {
    console.error("[PUT /api/admin/positions/[id]/form]", error);
    return NextResponse.json({ error: "Gagal menyimpan formulir. Coba lagi nanti." }, { status: 500 });
  }
}

/** Parse JSON aman untuk kolom skema (null bila rusak). */
function parseJsonSafe(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Daftar pertanyaan screening dari kolom klasik — toleran data rusak. */
function parseScreeningQuestionsSafe(raw: string): { id: string; label: string; required: boolean }[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((q): q is Record<string, unknown> => Boolean(q) && typeof q === "object")
      .filter((q) => typeof q.label === "string" && q.label.trim())
      .map((q) => ({
        id: typeof q.id === "string" ? q.id : "",
        label: (q.label as string).trim(),
        required: q.required === true,
      }));
  } catch {
    return [];
  }
}

/** Daftar label dokumen tambahan dari kolom klasik — toleran data rusak. */
function parseStringArraySafe(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d): d is string => typeof d === "string" && d.trim().length > 0);
  } catch {
    return [];
  }
}
