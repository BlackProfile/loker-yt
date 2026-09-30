// GET    /api/admin/webhooks — daftar endpoint webhook keluar (OWNER). Secret TIDAK dikirim balik,
//                             hanya 4 karakter awal + "…" sebagai penanda.
// POST   /api/admin/webhooks — daftarkan endpoint baru (OWNER). Secret penuh dikembalikan
//                             SEKALI pada respons POST ini — simpan segera.
// DELETE /api/admin/webhooks?id=... — hapus endpoint (OWNER).
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { WEBHOOK_EVENTS } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };

function parseEvents(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return ["*"];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return ["*"];
  }
}

/** Validasi langganan event: ["*"] atau subset WEBHOOK_EVENTS. */
function sanitizeEvents(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const values = input.filter((v): v is string => typeof v === "string");
  if (values.length === 0) return null;
  if (values.includes("*")) return ["*"];
  const allowed = new Set<string>(WEBHOOK_EVENTS);
  const filtered = Array.from(new Set(values)).filter((v) => allowed.has(v));
  return filtered.length > 0 ? filtered : null;
}

function maskSecret(secret: string): string {
  return `${secret.slice(0, 4)}…`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const rows = await db.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" } });
    return NextResponse.json(
      rows.map((ep) => ({
        id: ep.id,
        url: ep.url,
        events: parseEvents(ep.events),
        active: ep.active,
        lastStatus: ep.lastStatus,
        lastFiredAt: ep.lastFiredAt?.toISOString() ?? null,
        failCount: ep.failCount,
        createdAt: ep.createdAt.toISOString(),
        secretPreview: maskSecret(ep.secret),
      })),
    );
  } catch (error) {
    console.error("[GET /api/admin/webhooks]", error);
    return NextResponse.json({ error: "Gagal memuat daftar webhook. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const url = typeof data.url === "string" ? data.url.trim() : "";
    if (!url) {
      return NextResponse.json({ error: "URL webhook wajib diisi." }, { status: 400 });
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "URL tidak valid." }, { status: 400 });
    }
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return NextResponse.json({ error: "URL harus diawali http:// atau https://." }, { status: 400 });
    }

    const events = sanitizeEvents(data.events);
    if (!events) {
      return NextResponse.json(
        { error: "Pilih minimal satu event, atau gunakan opsi Semua event." },
        { status: 400 },
      );
    }

    const customSecret = typeof data.secret === "string" ? data.secret.trim() : "";
    const secret = customSecret.length >= 8 ? customSecret : randomUUID();

    const created = await db.webhookEndpoint.create({
      data: {
        url: parsedUrl.toString(),
        secret,
        events: JSON.stringify(events),
        active: true,
      },
    });

    // Secret penuh hanya dikirim SEKALI pada respons create — simpan segera.
    return NextResponse.json(
      {
        endpoint: {
          id: created.id,
          url: created.url,
          events: parseEvents(created.events),
          active: created.active,
          lastStatus: created.lastStatus,
          lastFiredAt: created.lastFiredAt?.toISOString() ?? null,
          failCount: created.failCount,
          createdAt: created.createdAt.toISOString(),
          secretPreview: maskSecret(created.secret),
        },
        secret,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[POST /api/admin/webhooks]", error);
    return NextResponse.json({ error: "Gagal membuat endpoint webhook. Coba lagi nanti." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(UNAUTHORIZED, { status: 401 });
    }
    if (session.role !== "OWNER") {
      return NextResponse.json(FORBIDDEN, { status: 403 });
    }

    const id = (new URL(req.url).searchParams.get("id") ?? "").trim();
    if (!id) {
      return NextResponse.json({ error: "Parameter id wajib diisi." }, { status: 400 });
    }

    const existing = await db.webhookEndpoint.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Endpoint webhook tidak ditemukan." }, { status: 404 });
    }

    await db.webhookEndpoint.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/webhooks]", error);
    return NextResponse.json({ error: "Gagal menghapus endpoint webhook. Coba lagi nanti." }, { status: 500 });
  }
}
