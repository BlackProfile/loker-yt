// GET  /api/admin/templates — daftar template pesan global (semua role). Query ?kind= opsional.
// POST /api/admin/templates — buat template baru (OWNER/HR): { name, kind, body }.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

const TEMPLATE_KINDS = ["OFFER", "REJECT", "INVITE", "CUSTOM"] as const;
type TemplateKind = (typeof TEMPLATE_KINDS)[number];

function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const kindParam = searchParams.get("kind");
    const kind = isTemplateKind(kindParam) ? kindParam : undefined;

    const rows = await db.messageTemplate.findMany({
      where: kind ? { kind } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
    });

    return NextResponse.json(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    console.error("[GET /api/admin/templates]", error);
    return NextResponse.json(
      { error: "Gagal memuat template. Coba lagi nanti." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
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

    const name = typeof data.name === "string" ? data.name.trim() : "";
    const rawKind = isTemplateKind(data.kind) ? data.kind : undefined;
    const text = typeof data.body === "string" ? data.body.trim() : "";

    if (name.length < 1 || name.length > 120) {
      return NextResponse.json(
        { error: "Nama template wajib diisi (maksimal 120 karakter)." },
        { status: 400 }
      );
    }
    if (!rawKind) {
      return NextResponse.json(
        { error: "Jenis template harus OFFER, REJECT, INVITE, atau CUSTOM." },
        { status: 400 }
      );
    }
    if (text.length < 1 || text.length > 4000) {
      return NextResponse.json(
        { error: "Isi template wajib diisi (maksimal 4000 karakter)." },
        { status: 400 }
      );
    }

    const created = await db.messageTemplate.create({
      data: { name, kind: rawKind, body: text },
    });

    return NextResponse.json(
      {
        template: {
          id: created.id,
          name: created.name,
          kind: created.kind,
          body: created.body,
          createdAt: created.createdAt.toISOString(),
          updatedAt: created.updatedAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/admin/templates]", error);
    return NextResponse.json(
      { error: "Gagal membuat template. Coba lagi nanti." },
      { status: 500 }
    );
  }
}
