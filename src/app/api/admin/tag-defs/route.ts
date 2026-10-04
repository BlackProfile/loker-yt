// GET  /api/admin/tag-defs — daftar definisi tag berwarna milik tim (NR-24, fitur 3).
// PUT  /api/admin/tag-defs — simpan daftar tag (OWNER|HR). Disimpan sebagai
// Setting key "tagDefs" (value JSON TagDef[]: {name, color}).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { TAG_COLORS } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

export type TagDefPayload = { name: string; color: string };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    const setting = await db.setting.findUnique({ where: { key: "tagDefs" } });
    let defs: TagDefPayload[] = [];
    try {
      const parsed: unknown = JSON.parse(setting?.value || "[]");
      if (Array.isArray(parsed)) {
        defs = parsed
          .filter(
            (item): item is TagDefPayload =>
              Boolean(item) &&
              typeof item === "object" &&
              typeof (item as TagDefPayload).name === "string" &&
              typeof (item as TagDefPayload).color === "string"
          )
          .map((item) => ({ name: item.name.trim().slice(0, 24), color: item.color }))
          .filter((item) => item.name);
      }
    } catch {
      defs = [];
    }
    return NextResponse.json(defs);
  } catch (error) {
    console.error("[GET /api/admin/tag-defs]", error);
    return NextResponse.json(
      { error: "Gagal memuat daftar tag. Coba lagi nanti." },
      { status: 500 }
    );
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
    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: "Data tag harus berupa array {name, color}." },
        { status: 400 }
      );
    }

    // Sanitasi: nama unik 1-24 karakter, warna dari palet resmi, maksimal 20 tag.
    const seen = new Set<string>();
    const defs: TagDefPayload[] = [];
    for (const item of body) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      const color = typeof rec.color === "string" ? rec.color : "zinc";
      if (!name || name.length > 24) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      defs.push({
        name,
        color: (TAG_COLORS as readonly string[]).includes(color) ? color : "zinc",
      });
      if (defs.length >= 20) break;
    }

    await db.setting.upsert({
      where: { key: "tagDefs" },
      update: { value: JSON.stringify(defs) },
      create: { key: "tagDefs", value: JSON.stringify(defs) },
    });

    // Tag baru bisa dipakai admin lain — sinyal aplikasi agar memuat ulang daftar.
    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json(defs);
  } catch (error) {
    console.error("[PUT /api/admin/tag-defs]", error);
    return NextResponse.json(
      { error: "Gagal menyimpan daftar tag. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
