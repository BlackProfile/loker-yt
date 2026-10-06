// Re-engagement talent pool (NR-40, butir 12) — OWNER/HR.
// GET  /api/admin/talent-pool?positionId=... — cocokkan kandidat lama (REJECTED /
//      ditahan / talent pool) untuk satu posisi target; skor kecocokan transparan.
// POST /api/admin/talent-pool {positionId, applicationIds[]} — kirim undangan
//      lamar ulang (EmailOutbox kind INVITE) + log TALENT_INVITE + notifikasi.
// Penyaringan ulang (syarat pool, do-not-hire, cooldown posisi lama) SELALU
// dijalankan ulang di server saat POST — daftar id dari klien tidak dipercaya.
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, requireRole } from "@/lib/server-auth";
import { getSiteUrl, pushNotification, queueEmail } from "@/lib/notify";
import { emitRealtime, REALTIME_EVENTS } from "@/lib/realtime-server";
import {
  findTalentMatches,
  isCandidateInCooldown,
  isTalentCandidateEligible,
  parseTalentTags,
  scoreTalentCandidate,
  TALENT_INVITE_COOLDOWN_MS,
  TALENT_POOL_MATCH_LIMIT,
  type TalentCandidateRow,
} from "@/lib/talent-match";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };

const MAX_CANDIDATE_ROWS = 500; // batas aman pemindaian kandidat lama

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Nama situs untuk salam email (Setting "site".siteName, default Lumina Studio). */
async function getSiteName(): Promise<string> {
  try {
    const setting = await db.setting.findUnique({ where: { key: "site" } });
    if (setting) {
      const parsed: unknown = JSON.parse(setting.value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const site = parsed as Record<string, unknown>;
        const siteName = typeof site.siteName === "string" ? site.siteName.trim() : "";
        if (siteName) return siteName;
      }
    }
  } catch {
    // diam — pakai default
  }
  return "Lumina Studio";
}

/** Muat baris kandidat lama (subset field untuk pencocokan) beserta posisi lamanya. */
async function loadTalentRows(): Promise<TalentCandidateRow[]> {
  const rows = await db.application.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      doNotHire: false,
      OR: [{ status: "REJECTED" }, { holdAt: { not: null } }, { talentPool: true }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      status: true,
      positionId: true,
      position: { select: { id: true, title: true, department: true, reapplyCooldownDays: true } },
      rating: true,
      tags: true,
      aiScore: true,
      rejectedAt: true,
      holdAt: true,
      talentPool: true,
      doNotHire: true,
      deletedAt: true,
      archivedAt: true,
      stageUpdatedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_CANDIDATE_ROWS,
  });
  return rows;
}

/** Tag umum posisi target (gabungan tag lamaran aktif di posisi tersebut). */
async function loadTargetTags(positionId: string): Promise<string[]> {
  const rows = await db.application.findMany({
    where: { positionId, deletedAt: null },
    select: { tags: true },
    take: 300,
  });
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const row of rows) {
    for (const tag of parseTalentTags(row.tags)) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const positionId = req.nextUrl.searchParams.get("positionId")?.trim() ?? "";
    if (!positionId) {
      return NextResponse.json({ error: "Posisi target wajib dipilih." }, { status: 400 });
    }

    const position = await db.position.findFirst({
      where: { id: positionId, deletedAt: null },
      select: { id: true, title: true, slug: true, department: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 404 });
    }

    const [candidates, targetTags] = await Promise.all([
      loadTalentRows(),
      loadTargetTags(position.id),
    ]);

    const matches = findTalentMatches({ target: position, candidates, targetTags });
    return NextResponse.json({
      position: { id: position.id, title: position.title, slug: position.slug },
      matches,
    });
  } catch (error) {
    console.error("[GET /api/admin/talent-pool]", errorMessage(error));
    return NextResponse.json({ error: "Gagal mencari kandidat talent pool. Coba lagi nanti." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER", "HR"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, {
        status: anySession ? 403 : 401,
      });
    }

    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Data tidak valid." }, { status: 400 });
    }
    const data = body as Record<string, unknown>;
    const positionId = typeof data.positionId === "string" ? data.positionId.trim() : "";
    const rawIds = Array.isArray(data.applicationIds) ? data.applicationIds : [];
    const ids: string[] = [];
    for (const item of rawIds) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (!positionId) {
      return NextResponse.json({ error: "Posisi target wajib dipilih." }, { status: 400 });
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "Pilih minimal satu kandidat untuk diundang." }, { status: 400 });
    }
    if (ids.length > TALENT_POOL_MATCH_LIMIT) {
      return NextResponse.json(
        { error: `Maksimal ${TALENT_POOL_MATCH_LIMIT} kandidat sekali kirim.` },
        { status: 400 },
      );
    }

    const position = await db.position.findFirst({
      where: { id: positionId, deletedAt: null },
      select: { id: true, title: true, slug: true, department: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Posisi tidak ditemukan." }, { status: 404 });
    }

    const now = new Date();
    // Muat apa adanya (tanpa filter pool) agar alasan skip per kandidat akurat;
    // penyaringan penuh dilakukan manual di bawah.
    const rows = await db.application.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        positionId: true,
        position: { select: { id: true, title: true, department: true, reapplyCooldownDays: true } },
        rating: true,
        tags: true,
        aiScore: true,
        rejectedAt: true,
        holdAt: true,
        talentPool: true,
        doNotHire: true,
        deletedAt: true,
        archivedAt: true,
        stageUpdatedAt: true,
        createdAt: true,
      },
      take: ids.length,
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const targetTags = await loadTargetTags(position.id);

    const siteName = await getSiteName();
    const siteUrl = getSiteUrl();
    const applyUrl = position.slug
      ? `${siteUrl}/?posisi=${encodeURIComponent(position.slug)}`
      : siteUrl;

    const skipped: { applicationId: string; name: string; reason: string }[] = [];
    let sent = 0;

    for (const id of ids) {
      const row = rowById.get(id);
      if (!row) {
        skipped.push({ applicationId: id, name: "-", reason: "Lamaran tidak ditemukan" });
        continue;
      }
      // Penyaringan ulang di server — tidak memercayai daftar dari klien.
      if (row.doNotHire) {
        skipped.push({ applicationId: id, name: row.name, reason: "Kandidat ditandai do-not-hire" });
        continue;
      }
      if (row.deletedAt || row.archivedAt) {
        skipped.push({ applicationId: id, name: row.name, reason: "Lamaran sudah diarsip atau dihapus" });
        continue;
      }
      if (!isTalentCandidateEligible(row)) {
        skipped.push({ applicationId: id, name: row.name, reason: "Tidak memenuhi syarat talent pool" });
        continue;
      }
      if (isCandidateInCooldown(row, now)) {
        skipped.push({
          applicationId: id,
          name: row.name,
          reason: "Masih dalam masa jeda lamar ulang posisi lamanya",
        });
        continue;
      }
      // Idempoten ringan: undangan kurang dari 7 hari terakhir dilewati.
      const lastInvite = await db.activityLog.findFirst({
        where: { applicationId: id, action: "TALENT_INVITE" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastInvite && now.getTime() - lastInvite.createdAt.getTime() < TALENT_INVITE_COOLDOWN_MS) {
        skipped.push({
          applicationId: id,
          name: row.name,
          reason: "Sudah diundang kurang dari 7 hari terakhir",
        });
        continue;
      }

      const { reasons } = scoreTalentCandidate(row, position, targetTags);
      const reasonText =
        reasons.length > 0
          ? reasons.join(", ")
          : "profil kamu relevan dengan kebutuhan posisi ini";
      const positionTitle = row.position?.title ?? "posisi sebelumnya";

      await queueEmail({
        toEmail: row.email,
        subject: `Ada kesempatan baru untuk kamu — ${position.title} di ${siteName}`,
        body:
          `Halo ${row.name},\n\n` +
          `Kami di ${siteName} kembali membuka posisi ${position.title} dan profil kamu ` +
          `masih kami ingat dari lamaran sebelumnya (${positionTitle}).\n\n` +
          `Alasan kami menghubungi kamu: ${reasonText}.\n\n` +
          `Kalau kamu berminat, silakan lamar ulang melalui tautan berikut:\n${applyUrl}\n\n` +
          `Tautan membawa kamu langsung ke lowongan tersebut. Kami menantikan kabar baik dari kamu.\n\n` +
          `Salam hangat,\nTim Rekrutmen ${siteName}`,
        kind: "INVITE",
        applicationId: id,
      });

      try {
        await db.activityLog.create({
          data: {
            applicationId: id,
            actor: session.name,
            action: "TALENT_INVITE",
            detail: `Undangan talent pool dikirim ke ${row.email} untuk posisi ${position.title}`,
          },
        });
      } catch (logError) {
        console.error("[POST /api/admin/talent-pool] gagal menulis log:", errorMessage(logError));
      }
      sent += 1;
    }

    if (sent > 0) {
      await pushNotification({
        title: `Undangan talent pool terkirim (${sent} kandidat)`,
        body: `Posisi target: ${position.title}.`,
        category: "APPLICATION",
      });
      void emitRealtime(REALTIME_EVENTS.applications);
    }

    return NextResponse.json({ sent, skipped });
  } catch (error) {
    console.error("[POST /api/admin/talent-pool]", errorMessage(error));
    return NextResponse.json({ error: "Gagal mengirim undangan talent pool. Coba lagi nanti." }, { status: 500 });
  }
}
