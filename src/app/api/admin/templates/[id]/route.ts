// PATCH  /api/admin/templates/[id] — ubah template (OWNER/HR): { name?, kind?, body? }.
// DELETE /api/admin/templates/[id] — hapus template (OWNER/HR).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Template tidak ditemukan." };

const TEMPLATE_KINDS = ["OFFER", "REJECT", "INVITE", "CUSTOM"] as const;
type TemplateKind = (typeof TEMPLATE_KINDS)[number];

function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

function serialize(row: {
  id: string;
  name: string;
  kind: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const data = body as Record<string, unknown>;

    const existing = await db.messageTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const update: { name?: string; kind?: TemplateKind; body?: string } = {};

    if (data.name !== undefined) {
      const name = typeof data.name === "string" ? data.name.trim() : "";
      if (name.length < 1 || name.length > 120) {
        return NextResponse.json(
          { error: "Nama template wajib diisi (maksimal 120 karakter)." },
          { status: 400 }
        );
      }
      update.name = name;
    }
    if (data.kind !== undefined) {
      if (!isTemplateKind(data.kind)) {
        return NextResponse.json(
          { error: "Jenis template harus OFFER, REJECT, INVITE, atau CUSTOM." },
          { status: 400 }
        );
      }
      update.kind = data.kind;
    }
    if (data.body !== undefined) {
      const text = typeof data.body === "string" ? data.body.trim() : "";
      if (text.length < 1 || text.length > 4000) {
        return NextResponse.json(
          { error: "Isi template wajib diisi (maksimal 4000 karakter)." },
          { status: 400 }
        );
      }
      update.body = text;
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "Tidak ada perubahan yang dikirim." },
        { status: 400 }
      );
    }

    const updated = await db.messageTemplate.update({ where: { id }, data: update });
    return NextResponse.json({ template: serialize(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/templates/[id]]", error);
    return NextResponse.json(
      { error: "Gagal mengubah template. Coba lagi nanti." },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }
    const { id } = await params;

    const existing = await db.messageTemplate.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    await db.messageTemplate.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/templates/[id]]", error);
    return NextResponse.json(
      { error: "Gagal menghapus template. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
