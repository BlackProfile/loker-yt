// POST /api/admin/restore — pulihkan database dari file backup .db (OWNER saja).
// Logika inti (validasi header SQLite, baca tabel backup, transaksi DELETE+INSERT)
// ada di src/lib/restore-db.ts — dipakai bersama POST /api/admin/backups (restore
// dari galeri backup otomatis). Route ini hanya menangani auth, unggah multipart,
// pemanggilan restoreDatabaseFromBuffer(buffer), sinyal realtime, dan pemetaan error.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import { RestoreValidationError, restoreDatabaseFromBuffer } from "@/lib/restore-db";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Hanya OWNER yang boleh memulihkan database." };

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(UNAUTHORIZED, { status: 401 });
  }
  if (session.role !== "OWNER") {
    return NextResponse.json(FORBIDDEN, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Body harus multipart/form-data dengan field 'file'." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "File backup (.db) wajib diunggah pada field 'file'." },
      { status: 400 },
    );
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "File backup kosong." }, { status: 400 });
  }
  if (file.size > 200 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Ukuran file backup melebihi batas 200 MB." },
      { status: 400 },
    );
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const { restored } = await restoreDatabaseFromBuffer(bytes);

    // Segarkan seluruh klien (publik & admin) setelah isi database berganti.
    void emitRealtime(
      REALTIME_EVENTS.positions,
      REALTIME_EVENTS.applications,
      REALTIME_EVENTS.interviews,
      REALTIME_EVENTS.site,
    );

    return NextResponse.json({ ok: true, restored });
  } catch (error) {
    if (error instanceof RestoreValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[POST /api/admin/restore]", error);
    return NextResponse.json(
      {
        error: `Gagal memulihkan database: ${message}. Tidak ada perubahan yang disimpan (transaksi dibatalkan otomatis).`,
      },
      { status: 500 },
    );
  }
}
