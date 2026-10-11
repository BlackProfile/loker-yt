// GET   /api/admin/handover — catatan serah terima (NR46, semua role admin).
//       ?days=7 (bawaan) — daftar catatan terbaru + apakah hari ini sudah mencatat.
// POST  /api/admin/handover — simpan catatan hari ini (satu catatan per penulis per
//       tanggal; menulis ulang memperbarui catatan hari ini milik penulis yang sama).
// PATCH /api/admin/handover — { id, action: "acknowledge" } tandai sudah ditindak
//       (OWNER/HR; tidak boleh menandai catatan sendiri-sendiri boleh? boleh, tetapi
//       penandai dicatat untuk jejak).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import type { HandoverNoteView } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };

const MAX_FIELD = 2000;

function todayKey(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toView(row: Awaited<ReturnType<typeof db.handoverNote.findMany>>[number]): HandoverNoteView {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    forDate: row.forDate,
    needsAction: row.needsAction,
    risks: row.risks,
    notes: row.notes,
    status: row.status as HandoverNoteView["status"],
    acknowledgedByName: row.acknowledgedByName,
    acknowledgedAt: row.acknowledgedAt ? row.acknowledgedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });

    const { searchParams } = new URL(req.url);
    const daysRaw = Number(searchParams.get("days"));
    const days = Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 30 ? Math.round(daysRaw) : 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const sinceKey = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, "0")}-${String(
      since.getDate(),
    ).padStart(2, "0")}`;

    const [rows, mineToday] = await Promise.all([
      db.handoverNote.findMany({
        where: { forDate: { gte: sinceKey } },
        orderBy: [{ forDate: "desc" }, { createdAt: "desc" }],
        take: 60,
      }),
      db.handoverNote.findFirst({
        where: { forDate: todayKey(), authorId: session.id },
      }),
    ]);

    return NextResponse.json({
      notes: rows.map(toView),
      mineToday: mineToday ? toView(mineToday) : null,
      today: todayKey(),
    });
  } catch (error) {
    console.error("[GET /api/admin/handover]", error);
    return NextResponse.json({ error: "Gagal memuat catatan serah terima." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Pengamat tidak dapat menulis catatan serah terima." }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const clean = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, MAX_FIELD) : "");
    const needsAction = clean(data.needsAction);
    const risks = clean(data.risks);
    const notes = clean(data.notes);
    if (!needsAction && !risks && !notes) {
      return NextResponse.json({ error: "Isi minimal satu bagian catatan." }, { status: 400 });
    }

    const forDate = todayKey();
    const existing = await db.handoverNote.findFirst({
      where: { forDate, authorId: session.id },
    });

    const row = existing
      ? await db.handoverNote.update({
          where: { id: existing.id },
          data: { needsAction, risks, notes, status: "OPEN", acknowledgedAt: null, acknowledgedById: null, acknowledgedByName: null },
        })
      : await db.handoverNote.create({
          data: { authorId: session.id, authorName: session.name, forDate, needsAction, risks, notes },
        });

    await db.activityLog
      .create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "HANDOVER_SAVED",
          detail: `Catatan serah terima ${forDate} disimpan oleh ${session.name}`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, note: toView(row) }, { status: existing ? 200 : 201 });
  } catch (error) {
    console.error("[POST /api/admin/handover]", error);
    return NextResponse.json({ error: "Gagal menyimpan catatan serah terima." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Hanya OWNER/HR dapat menandai catatan." }, { status: 403 });
    }

    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const id = typeof data.id === "string" ? data.id.trim() : "";
    if (data.action !== "acknowledge" || !id) {
      return NextResponse.json({ error: "Kirim { id, action: \"acknowledge\" }." }, { status: 400 });
    }

    const row = await db.handoverNote.findUnique({ where: { id } });
    if (!row) return NextResponse.json({ error: "Catatan tidak ditemukan." }, { status: 404 });

    const updated = await db.handoverNote.update({
      where: { id },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedById: session.id,
        acknowledgedByName: session.name,
        acknowledgedAt: new Date(),
      },
    });

    await db.activityLog
      .create({
        data: {
          applicationId: null,
          actor: session.name,
          action: "HANDOVER_ACKNOWLEDGED",
          detail: `Catatan serah terima ${row.forDate} (${row.authorName}) ditandai sudah ditindak`,
        },
      })
      .catch(() => undefined);

    return NextResponse.json({ ok: true, note: toView(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/handover]", error);
    return NextResponse.json({ error: "Gagal memperbarui catatan." }, { status: 500 });
  }
}
