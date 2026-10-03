// NR-24 — Daftar tag global (untuk filter & autosuggest admin).
// GET /api/admin/tags — gabungan Setting "tagList" + semua tags yang dipakai lamaran (urut abjad).
// PUT /api/admin/tags — simpan daftar tag bawaan (OWNER/HR) body {tags: string[]}.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { parseTags } from "@/lib/seed";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const TAG_LIST_KEY = "tagList";
const TAGS_MAX_ITEMS = 30;
const TAG_MAX_CHARS = 30;

/** Baca Setting "tagList" (JSON string[]) secara aman. */
async function readTagList(): Promise<string[]> {
  const row = await db.setting.findUnique({ where: { key: TAG_LIST_KEY } });
  if (!row) return [];
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const [tagList, applications] = await Promise.all([
      readTagList(),
      db.application.findMany({ select: { tags: true } }),
    ]);

    const union = new Set<string>(tagList);
    for (const app of applications) {
      for (const tag of parseTags(app.tags)) union.add(tag);
    }
    const tags = Array.from(union).sort((a, b) => a.localeCompare(b, "id"));
    return NextResponse.json({ tags });
  } catch (error) {
    console.error("[GET /api/admin/tags]", error);
    return NextResponse.json({ error: "Gagal memuat daftar tag." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    if (!Array.isArray(data.tags)) {
      return NextResponse.json({ error: "Tags harus berupa array teks." }, { status: 400 });
    }

    // Sanitasi: trim, buang kosong, maks 30 karakter, tanpa duplikat, maks 30 item.
    const seen = new Set<string>();
    for (const item of data.tags) {
      if (typeof item !== "string") {
        return NextResponse.json({ error: "Tags harus berupa array teks." }, { status: 400 });
      }
      const tag = item.trim().slice(0, TAG_MAX_CHARS);
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      if (seen.size >= TAGS_MAX_ITEMS) break;
    }
    const tags = Array.from(seen);

    await db.setting.upsert({
      where: { key: TAG_LIST_KEY },
      create: { key: TAG_LIST_KEY, value: JSON.stringify(tags) },
      update: { value: JSON.stringify(tags) },
    });

    return NextResponse.json({ ok: true, tags });
  } catch (error) {
    console.error("[PUT /api/admin/tags]", error);
    return NextResponse.json({ error: "Gagal menyimpan daftar tag. Coba lagi nanti." }, { status: 500 });
  }
}
