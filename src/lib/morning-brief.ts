// SERVER-ONLY — NR49 Paket C: Brief Pagi AI (fitur 1).
// Menyusun narasi pagi (kemarin / hari ini / perlu ditindak) dari angka konteks
// rekrutmen via LLM, dengan cache harian di Setting "ai_brief_YYYY-MM-DD"
// (tanggal waktu server). Dipakai oleh:
//   - POST /api/admin/morning-brief (manual, OWNER/HR)
//   - POST /api/cron/reminders (job harian jam 07.00 waktu Bangkok)
// Narasi HANYA dibangun dari angka konteks — LLM dilarang mengarang data.
import { db } from "@/lib/db";
import { withTimeout, withZaiRetry } from "@/lib/ai";
import { withAiGate } from "@/lib/ai-control";
import { errorMessage } from "@/lib/ai-json";

export type MorningBrief = { content: string; generatedAt: string };

export type BriefContext = {
  yesterday: {
    newApplications: number;
    topPositionTitle: string | null;
    interviewsCompleted: number;
    interviewsNoShow: number;
    rejections: number;
  };
  today: {
    interviews: { time: string; name: string; positionTitle: string | null }[];
  };
  actionNeeded: {
    staleNewCount: number; // lamaran NEW belum dilihat >48 jam
    pendingOfferStale: number; // offer PENDING >7 hari sejak dikirim
    openHandoverCount: number; // catatan serah terima OPEN forDate <= hari ini
    openHandoverAuthors: string[];
  };
};

const BRIEF_MAX_CHARS = 2200; // ≈200 kata + aman
const AI_TIMEOUT_MS = 60_000;

/** Kunci tanggal "YYYY-MM-DD" menurut waktu server (lokal). */
export function dayKeyOf(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function fmtTimeId(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(value.getHours())}.${pad(value.getMinutes())}`;
}

/** Kumpulkan seluruh angka konteks untuk brief (semua kueri aman dibatasi). */
export async function gatherBriefContext(): Promise<BriefContext> {
  const now = new Date();
  const todayStart = startOfLocalDay(now);
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const staleSeenCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const staleOfferCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [newApplications, topGroups, interviewsCompleted, interviewsNoShow, rejections, todayInterviews, staleNewCount, pendingOfferStale, openHandovers] =
    await Promise.all([
      db.application.count({
        where: { createdAt: { gte: yesterdayStart, lt: todayStart }, deletedAt: null },
      }),
      db.application.groupBy({
        by: ["positionId"],
        where: {
          createdAt: { gte: yesterdayStart, lt: todayStart },
          deletedAt: null,
          positionId: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { positionId: "desc" } },
        take: 1,
      }),
      db.interview.count({ where: { completedAt: { gte: yesterdayStart, lt: todayStart } } }),
      db.interview.count({
        where: { status: "NO_SHOW", scheduledAt: { gte: yesterdayStart, lt: todayStart } },
      }),
      db.application.count({
        where: { rejectedAt: { gte: yesterdayStart, lt: todayStart }, deletedAt: null },
      }),
      db.interview.findMany({
        where: {
          status: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULE_REQUESTED"] },
          scheduledAt: { gte: todayStart, lt: todayEnd },
        },
        include: { application: { select: { name: true, position: { select: { title: true } } } } },
        orderBy: { scheduledAt: "asc" },
        take: 12,
      }),
      db.application.count({
        where: {
          status: "NEW",
          deletedAt: null,
          createdAt: { lte: staleSeenCutoff },
          OR: [{ adminSeenAt: null }, { adminSeenAt: { lte: staleSeenCutoff } }],
        },
      }),
      db.application.count({
        where: {
          offerStatus: "PENDING",
          deletedAt: null,
          offerSentAt: { lte: staleOfferCutoff },
        },
      }),
      db.handoverNote.findMany({
        where: { status: "OPEN", forDate: { lte: dayKeyOf(now) } },
        select: { authorName: true },
        take: 50,
      }),
    ]);

  let topPositionTitle: string | null = null;
  const topPositionId = topGroups[0]?.positionId ?? null;
  if (topPositionId) {
    const position = await db.position.findUnique({
      where: { id: topPositionId },
      select: { title: true },
    });
    topPositionTitle = position?.title ?? null;
  }

  const authors: string[] = [];
  for (const h of openHandovers) {
    const name = h.authorName.trim();
    if (name && !authors.includes(name)) authors.push(name);
  }

  return {
    yesterday: {
      newApplications,
      topPositionTitle,
      interviewsCompleted,
      interviewsNoShow,
      rejections,
    },
    today: {
      interviews: todayInterviews.map((iv) => ({
        time: fmtTimeId(iv.scheduledAt),
        name: iv.application.name,
        positionTitle: iv.application.position?.title ?? null,
      })),
    },
    actionNeeded: {
      staleNewCount,
      pendingOfferStale,
      openHandoverCount: openHandovers.length,
      openHandoverAuthors: authors.slice(0, 5),
    },
  };
}

/** Susun ringkas data konteks menjadi baris-baris fakta untuk prompt LLM. */
function buildContextLines(ctx: BriefContext): string[] {
  const lines: string[] = [];
  const y = ctx.yesterday;
  const yParts: string[] = [`${y.newApplications} lamaran baru masuk`];
  if (y.topPositionTitle) yParts.push(`posisi terbanyak: ${y.topPositionTitle}`);
  yParts.push(`${y.interviewsCompleted} wawancara selesai`);
  yParts.push(`${y.interviewsNoShow} wawancara tidak hadir`);
  yParts.push(`${y.rejections} penolakan`);
  lines.push(`Kemarin: ${yParts.join(", ")}.`);

  if (ctx.today.interviews.length === 0) {
    lines.push("Hari ini: tidak ada wawancara terjadwal.");
  } else {
    lines.push(`Hari ini: ${ctx.today.interviews.length} wawancara terjadwal (urut jam):`);
    for (const iv of ctx.today.interviews) {
      lines.push(`  - ${iv.time} ${iv.name}${iv.positionTitle ? ` (${iv.positionTitle})` : ""}`);
    }
  }

  const a = ctx.actionNeeded;
  const actParts: string[] = [];
  if (a.staleNewCount > 0) actParts.push(`${a.staleNewCount} lamaran NEW belum dilihat lebih dari 48 jam`);
  if (a.pendingOfferStale > 0) actParts.push(`${a.pendingOfferStale} offer PENDING menunggu jawaban lebih dari 7 hari`);
  if (a.openHandoverCount > 0) {
    actParts.push(
      `${a.openHandoverCount} catatan serah terima masih terbuka (penulis: ${
        a.openHandoverAuthors.join(", ") || "tidak tercatat"
      })`,
    );
  }
  lines.push(
    actParts.length > 0
      ? `Perlu ditindak: ${actParts.join("; ")}.`
      : "Perlu ditindak: tidak ada.",
  );
  return lines;
}

/** Bersihkan keluaran LLM: buang markdown heading/pembungkus dan batasi panjang. */
function cleanBriefText(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^["\u201c\u201d']+|["\u201c\u201d']+$/g, "")
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").replace(/\*\*/g, "").trimEnd())
    .join("\n")
    .trim();
  return cleaned.slice(0, BRIEF_MAX_CHARS);
}

/** Baca Setting harian menjadi MorningBrief; null bila tidak ada/rusak. */
async function readBriefSetting(key: string): Promise<MorningBrief | null> {
  try {
    const row = await db.setting.findUnique({ where: { key } });
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.content === "string" && obj.content.trim().length > 0) {
        return {
          content: obj.content,
          generatedAt: typeof obj.generatedAt === "string" ? obj.generatedAt : row.updatedAt.toISOString(),
        };
      }
    }
  } catch {
    // JSON rusak — anggap tidak ada dan buat ulang.
  }
  return null;
}

/**
 * Ambil (atau buat) brief pagi hari ini.
 * - force=false + cache hari ini ada → langsung dipakai (tanpa AI, tanpa gate).
 * - Selain itu: gate "morning_brief" (AiGateError bila diblokir) → LLM menulis
 *   narasi ≤200 kata dari angka konteks → simpan Setting "ai_brief_YYYY-MM-DD".
 */
export async function generateMorningBrief(force: boolean, actor: string | null): Promise<MorningBrief> {
  const settingKey = `ai_brief_${dayKeyOf(new Date())}`;
  if (!force) {
    const existing = await readBriefSetting(settingKey);
    if (existing) return existing;
  }

  const context = await gatherBriefContext();
  const content = await withAiGate(
    "morning_brief",
    { actor, detailOk: "Brief pagi dibuat" },
    async () => {
      const systemPrompt =
        "Kamu adalah asisten HR Lumina Studio. Tulis brief pagi Bahasa Indonesia formal " +
        "maksimal 200 kata dengan TIGA bagian, masing-masing diawali heading teks biasa " +
        'pada barisnya sendiri: "Kemarin:", "Hari ini:", dan "Perlu ditindak:". ' +
        "Gunakan HANYA angka dan fakta dari data yang diberikan — jangan mengarang, " +
        "jangan menambahkan data lain. Tanpa emoji, tanpa markdown (tanpa #, *, atau bullet " +
        "selain tanda hubung), tanpa sapaan pembuka, tanpa penutup. Bila sebuah bagian " +
        "kosong, tulis satu kalimat singkat bahwa tidak ada agenda pada bagian itu. " +
        "Balas HANYA isi brief-nya, tanpa teks lain.";
      const userPrompt = [
        "Data rekrutmen Lumina Studio untuk brief pagi:",
        ...buildContextLines(context),
        "",
        "Tulis brief pagi sesuai ketentuan.",
      ].join("\n");

      const completion = await withTimeout(
        withZaiRetry((zai) =>
          zai.chat.completions.create({
            messages: [
              { role: "assistant", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            thinking: { type: "disabled" },
          }),
        ),
        "Brief Pagi AI",
        AI_TIMEOUT_MS,
      );
      const raw = completion?.choices?.[0]?.message?.content ?? "";
      const clean = cleanBriefText(raw);
      if (!clean) {
        throw new Error("AI mengembalikan teks kosong untuk brief pagi.");
      }
      return clean;
    },
  );

  const brief: MorningBrief = { content, generatedAt: new Date().toISOString() };
  await db.setting.upsert({
    where: { key: settingKey },
    create: { key: settingKey, value: JSON.stringify(brief) },
    update: { value: JSON.stringify(brief) },
  });
  return brief;
}

/** Baca brief hari ini (tanpa membuat) — untuk tampilan kartu. */
export async function getTodayBrief(): Promise<{ brief: MorningBrief | null }> {
  try {
    const brief = await readBriefSetting(`ai_brief_${dayKeyOf(new Date())}`);
    return { brief };
  } catch (error) {
    console.error("[morning-brief] getTodayBrief", errorMessage(error));
    return { brief: null };
  }
}
