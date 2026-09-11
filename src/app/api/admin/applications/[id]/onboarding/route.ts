// PATCH /api/admin/applications/[id]/onboarding — kelola checklist dokumen onboarding (OWNER/HR).
// Body: { docs: [{id?, label, required, done, fileId?}] } — daftar penuh menggantikan yang lama
// (di-merge berdasar label agar fileId pelamar tidak hilang). Bisa juga kirim { note } saja.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/server-auth";
import {
  APPLICATION_INCLUDE,
  parseOnboardingDocs,
  serializeApplication,
} from "@/lib/seed";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import type { OnboardingDoc } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Anda tidak memiliki akses untuk aksi ini." };
const NOT_FOUND = { error: "Lamaran tidak ditemukan" };

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

    const existing = await db.application.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(NOT_FOUND, { status: 404 });
    }

    const updateData: { onboardingDocs?: string; adminNotes?: string } = {};

    if (data.docs !== undefined) {
      if (!Array.isArray(data.docs)) {
        return NextResponse.json({ error: "Dokumen harus berupa array." }, { status: 400 });
      }
      if (data.docs.length > 10) {
        return NextResponse.json({ error: "Dokumen onboarding maksimal 10." }, { status: 400 });
      }

      // Merge: pertahankan done/fileId dari dokumen lama yang labelnya sama.
      const oldDocs = parseOnboardingDocs(existing.onboardingDocs);
      const docs: OnboardingDoc[] = [];
      const seenIds = new Set<string>();
      for (let i = 0; i < data.docs.length; i++) {
        const raw = (
          data.docs[i] && typeof data.docs[i] === "object" && !Array.isArray(data.docs[i]) ? data.docs[i] : {}
        ) as Record<string, unknown>;
        const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 120) : "";
        if (!label) continue;

        const old = oldDocs.find((d) => d.label === label);
        let docId = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 40) : `doc${i + 1}`;
        if (seenIds.has(docId)) docId = `doc${i + 1}-${docs.length}`;
        seenIds.add(docId);

        const fileId =
          typeof raw.fileId === "string" && raw.fileId.trim()
            ? raw.fileId.trim()
            : (old?.fileId ?? null);

        docs.push({
          id: docId,
          label,
          required: raw.required === true,
          done: raw.done === true,
          fileId,
        });
      }
      updateData.onboardingDocs = JSON.stringify(docs);
    }

    if (data.note !== undefined) {
      const merged =
        typeof data.note === "string" && data.note.trim()
          ? data.note.trim().slice(0, 1000)
          : null;
      updateData.adminNotes = merged;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const updated = await db.application.update({
      where: { id },
      data: updateData,
      include: APPLICATION_INCLUDE,
    });

    const docs = parseOnboardingDocs(updated.onboardingDocs);
    const doneCount = docs.filter((d) => d.done).length;
    await db.activityLog.create({
      data: {
        applicationId: id,
        actor: session.name,
        action: "ONBOARDING",
        detail: `Checklist onboarding diperbarui (${doneCount}/${docs.length} dokumen lengkap)`,
      },
    });

    void emitRealtime(REALTIME_EVENTS.applications);
    return NextResponse.json({ application: serializeApplication(updated) });
  } catch (error) {
    console.error("[PATCH /api/admin/applications/[id]/onboarding]", error);
    return NextResponse.json({ error: "Gagal memperbarui onboarding. Coba lagi nanti." }, { status: 500 });
  }
}
