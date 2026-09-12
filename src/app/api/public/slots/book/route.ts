// POST /api/public/slots/book — pelamar memilih slot jadwal wawancara self-service.
// Body: { code: "LM-XXX", slotId }. Slot diklaim atomik (hanya bila masih kosong),
// lalu sesi Interview baru dibuat dari data slot (ronde otomatis = jumlah sesi + 1).
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pushNotification } from "@/lib/notify";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";

export const dynamic = "force-dynamic";

// Rate limit sederhana per kode: 1 permintaan / detik.
const rateMap = new Map<string, number>();
const RATE_MS = 1000;

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;

    const code = typeof data.code === "string" ? data.code.trim().toUpperCase() : "";
    const slotId = typeof data.slotId === "string" ? data.slotId.trim() : "";
    if (!code || !slotId) {
      return NextResponse.json({ error: "Kode pelacakan dan slot wajib dipilih." }, { status: 400 });
    }

    const now = Date.now();
    const last = rateMap.get(code) ?? 0;
    if (now - last < RATE_MS) {
      return NextResponse.json({ error: "Terlalu sering. Coba beberapa detik lagi." }, { status: 429 });
    }
    rateMap.set(code, now);
    if (rateMap.size > 500) {
      for (const [key, ts] of rateMap) {
        if (now - ts > 60_000) rateMap.delete(key);
      }
    }

    const application = await db.application.findUnique({
      where: { trackingCode: code },
      select: { id: true, name: true, status: true, positionId: true, position: { select: { title: true } } },
    });
    if (!application) {
      return NextResponse.json({ error: "Kode pelacakan tidak ditemukan." }, { status: 404 });
    }

    const status = (application.status || "NEW").trim();
    if (status === "ACCEPTED" || status === "REJECTED") {
      return NextResponse.json({ error: "Lamaran sudah berakhir; slot tidak bisa dipilih." }, { status: 400 });
    }

    const slot = await db.interviewSlot.findUnique({ where: { id: slotId } });
    if (!slot) {
      return NextResponse.json({ error: "Slot tidak ditemukan." }, { status: 404 });
    }
    if (slot.positionId && slot.positionId !== application.positionId) {
      return NextResponse.json({ error: "Slot bukan untuk posisi lamaran ini." }, { status: 400 });
    }
    if (slot.scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "Slot sudah terlewat; pilih jadwal lain." }, { status: 400 });
    }

    // Klaim atomik: update hanya berhasil bila slot masih kosong (anti tabrakan antar pelamar).
    const claimed = await db.interviewSlot.updateMany({
      where: { id: slot.id, bookedByApplicationId: null },
      data: { bookedByApplicationId: application.id, bookedAt: new Date() },
    });
    if (claimed.count === 0) {
      return NextResponse.json(
        { error: "Slot ini baru saja dipilih pelamar lain. Silakan pilih jadwal lain." },
        { status: 409 },
      );
    }

    // Ronde otomatis: jumlah sesi existing + 1 (pola sama dengan POST /api/admin/interviews).
    const lastRound = await db.interview.findFirst({
      where: { applicationId: application.id },
      orderBy: { round: "desc" },
      select: { round: true },
    });

    const interviewers = (() => {
      try {
        const parsed: unknown = JSON.parse(slot.interviewers || "[]");
        return Array.isArray(parsed)
          ? parsed.filter((n): n is string => typeof n === "string" && n.trim().length > 0)
          : [];
      } catch {
        return [];
      }
    })();

    const created = await db.interview.create({
      data: {
        applicationId: application.id,
        round: (lastRound?.round ?? 0) + 1,
        mode: slot.mode,
        platform: slot.platform,
        meetingLink: slot.meetingLink,
        address: slot.address,
        scheduledAt: slot.scheduledAt,
        durationMin: slot.durationMin,
        interviewers: JSON.stringify(interviewers),
        status: "SCHEDULED",
        slotId: slot.id,
      },
    });

    // Sinkronkan kolom interviewAt lama (dipakai kalender/overview).
    await db.application.update({
      where: { id: application.id },
      data: { interviewAt: slot.scheduledAt },
    });

    const when = slot.scheduledAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    await db.activityLog.create({
      data: {
        applicationId: application.id,
        actor: "Pelamar",
        action: "INTERVIEW_SCHEDULED",
        detail: `Pelamar memilih slot wawancara ronde ${created.round}: ${when}`,
      },
    });

    void pushNotification({
      title: "Slot wawancara dipilih",
      body: `${application.name} memilih slot ${when} untuk posisi ${application.position?.title ?? "-"} (ronde ${created.round}).`,
      category: "INTERVIEW",
      applicationId: application.id,
    });

    void emitRealtime(REALTIME_EVENTS.applications, REALTIME_EVENTS.interviews);

    return NextResponse.json({
      ok: true,
      round: created.round,
      scheduledAt: slot.scheduledAt.toISOString(),
    });
  } catch (error) {
    console.error("[POST /api/public/slots/book]", error);
    return NextResponse.json({ error: "Gagal memilih slot. Coba lagi nanti." }, { status: 500 });
  }
}
