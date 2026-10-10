// GET  /api/admin/approvals — daftar permintaan persetujuan ganda (empat mata, NR46).
//      OWNER saja. Respons menyertakan status fitur { enabled }.
// POST /api/admin/approvals — { id, action: "approve" | "reject" | "cancel", note? } (OWNER).
//      approve  : eksekusi permintaan PENDING (bukan milik sendiri).
//      reject   : tolak permintaan PENDING (bukan milik sendiri).
//      cancel   : pengaju membatalkan permintaan PENDING miliknya.
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/server-auth";
import {
  approveAndExecute,
  cancelApproval,
  dualControlEnabled,
  listApprovalRequests,
  rejectApproval,
} from "@/lib/dual-control";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER dapat mengakses persetujuan ganda." };

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const [requests, enabled] = await Promise.all([
      listApprovalRequests(session.id),
      dualControlEnabled(),
    ]);
    return NextResponse.json({ enabled, requests });
  } catch (error) {
    console.error("[GET /api/admin/approvals]", error);
    return NextResponse.json({ error: "Gagal memuat daftar persetujuan." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json(UNAUTHORIZED, { status: 401 });
    if (session.role !== "OWNER") return NextResponse.json(FORBIDDEN, { status: 403 });

    const body: unknown = await req.json().catch(() => null);
    const data =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const id = typeof data.id === "string" ? data.id.trim() : "";
    const action = typeof data.action === "string" ? data.action : "";
    const note = typeof data.note === "string" ? data.note : undefined;
    if (!id || !["approve", "reject", "cancel"].includes(action)) {
      return NextResponse.json(
        { error: "Kirim { id, action: approve|reject|cancel, note? }." },
        { status: 400 },
      );
    }

    if (action === "approve") {
      const result = await approveAndExecute({ requestId: id, session, note });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
      }
      return NextResponse.json({ ok: true, message: result.result });
    }
    if (action === "reject") {
      const result = await rejectApproval({ requestId: id, session, note });
      if (!result.ok) {
        return NextResponse.json({ error: result.error ?? "Gagal menolak." }, { status: result.status ?? 500 });
      }
      return NextResponse.json({ ok: true, message: "Permintaan ditolak." });
    }
    const result = await cancelApproval({ requestId: id, session });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Gagal membatalkan." }, { status: result.status ?? 500 });
    }
    return NextResponse.json({ ok: true, message: "Permintaan dibatalkan." });
  } catch (error) {
    console.error("[POST /api/admin/approvals]", error);
    return NextResponse.json({ error: "Gagal memproses persetujuan." }, { status: 500 });
  }
}
