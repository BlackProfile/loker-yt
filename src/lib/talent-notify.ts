// NR68 — Notifikasi talent pool otomatis saat posisi dibuka/dibuat (SERVER-ONLY).
// Mengekstrak logika POST /api/admin/talent-pool agar bisa dipanggil fire-and-forget
// dari hook posisi create/update. Idempoten per-posisi lewat Position.talentNotifiedAt
// + cooldown 7 hari per kandidat lewat ActivityLog TALENT_INVITE.

import { db } from "@/lib/db";
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

const MAX_CANDIDATE_ROWS = 500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

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

/**
* Kirim undangan lamar ulang ke kandidat talent pool yang cocok dengan posisi target.
* Aman dipanggil fire-and-forget. Idempoten: bila Position.talentNotifiedAt sudah terisi,
* tidak melakukan apa pun. Setelah selesai, menandai Position.talentNotifiedAt.
*
* @returns jumlah undangan terkirim (0 bila posisi tak ditemukan / sudah dinotifikasi / tak ada match).
*/
export async function notifyTalentPoolForPosition(
  positionId: string,
  actor = "Sistem (talent pool)",
): Promise<{ sent: number; skipped: number }> {
  try {
    const position = await db.position.findFirst({
      where: { id: positionId, deletedAt: null },
      select: {
        id: true,
        title: true,
        slug: true,
        department: true,
        isActive: true,
        applyOpen: true,
        talentNotifiedAt: true,
      },
    });
    if (!position) return { sent: 0, skipped: 0 };
    // Hanya posisi aktif & form terbuka yang layak diumumkan ke talent pool.
    if (!position.isActive || !position.applyOpen) return { sent: 0, skipped: 0 };
    // Idempoten: sudah diumumkan sebelumnya — jangan spam.
    if (position.talentNotifiedAt) return { sent: 0, skipped: 0 };

    const [candidates, targetTags] = await Promise.all([
      loadTalentRows(),
      loadTargetTags(position.id),
    ]);
    const matches = findTalentMatches({
      target: {
        id: position.id,
        title: position.title,
        slug: position.slug,
        department: position.department,
      },
      candidates,
      targetTags,
      limit: TALENT_POOL_MATCH_LIMIT,
    });
    if (matches.length === 0) {
      await db.position.update({
        where: { id: position.id },
        data: { talentNotifiedAt: new Date() },
      });
      return { sent: 0, skipped: 0 };
    }

    const now = new Date();
    const siteName = await getSiteName();
    const siteUrl = getSiteUrl();
    const applyUrl = position.slug
      ? `${siteUrl}/?posisi=${encodeURIComponent(position.slug)}`
      : siteUrl;

    let sent = 0;
    let skipped = 0;
    for (const m of matches) {
      const row = candidates.find((c) => c.id === m.applicationId);
      if (!row) {
        skipped += 1;
        continue;
      }
      if (!isTalentCandidateEligible(row)) {
        skipped += 1;
        continue;
      }
      if (isCandidateInCooldown(row, now)) {
        skipped += 1;
        continue;
      }
      // Cooldown 7 hari per kandidat (undangan manual admin baru-baru ini).
      const lastInvite = await db.activityLog.findFirst({
        where: { applicationId: m.applicationId, action: "TALENT_INVITE" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (lastInvite && now.getTime() - lastInvite.createdAt.getTime() < TALENT_INVITE_COOLDOWN_MS) {
        skipped += 1;
        continue;
      }

      const { reasons } = scoreTalentCandidate(
        row,
        { id: position.id, title: position.title, slug: position.slug, department: position.department },
        targetTags,
      );
      const reasonText =
        reasons.length > 0
          ? reasons.join(", ")
          : "profil kamu relevan dengan kebutuhan posisi ini";
      const positionTitle = row.position?.title ?? "posisi sebelumnya";

      await queueEmail({
        toEmail: m.email,
        subject: `Ada kesempatan baru untuk kamu — ${position.title} di ${siteName}`,
        body:
          `Halo ${m.name},\n\n` +
          `Kami di ${siteName} kembali membuka posisi ${position.title} dan profil kamu ` +
          `masih kami ingat dari lamaran sebelumnya (${positionTitle}).\n\n` +
          `Alasan kami menghubungi kamu: ${reasonText}.\n\n` +
          `Kalau kamu berminat, silakan lamar ulang melalui tautan berikut:\n${applyUrl}\n\n` +
          `Tautan membawa kamu langsung ke lowongan tersebut. Kami menantikan kabar baik dari kamu.\n\n` +
          `Salam hangat,\nTim Rekrutmen ${siteName}`,
        kind: "INVITE",
        applicationId: m.applicationId,
      });

      try {
        await db.activityLog.create({
          data: {
            applicationId: m.applicationId,
            actor,
            action: "TALENT_INVITE",
            detail: `Undangan otomatis talent pool untuk posisi ${position.title}`,
          },
        });
      } catch (logError) {
        console.error("[talent-notify] gagal menulis log:", errorMessage(logError));
      }
      sent += 1;
    }

    // Tandai posisi sudah diumumkan (idempoten) — walau 0 terkirim, agar tidak berulang.
    await db.position.update({
      where: { id: position.id },
      data: { talentNotifiedAt: now },
    });

    if (sent > 0) {
      await pushNotification({
        title: `Undangan otomatis talent pool terkirim (${sent} kandidat)`,
        body: `Posisi: ${position.title}.`,
        category: "APPLICATION",
      });
      void emitRealtime(REALTIME_EVENTS.applications);
    }
    return { sent, skipped };
  } catch (error) {
    console.error("[talent-notify] gagal:", errorMessage(error));
    return { sent: 0, skipped: 0 };
  }
}
