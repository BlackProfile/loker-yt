// XL-BE — Laporan Excel mingguan otomatis via Telegram.
// Setting key "weekly_report" (JSON): { enabled, chatId, lastSent }.
// runWeeklyExcelReport() dipanggil oleh cron /api/cron/reminders (realtime-service
// tiap 60 detik): jendela kirim Senin jam 08:00-08:59 waktu server (pola job
// mingguan lain), dedupe sekali per hari via lastSent (tanggal YYYY-MM-DD).
// Workbook XLSX yang dikirim (ringkasan 7 hari terakhir):
//   "Ringkasan"        — pelamar baru + rekap per tahap & per posisi
//   "Interview 7 Hari" — wawancara terjadwal 7 hari ke depan
//   "Offer Aktif"      — offer PENDING menunggu jawaban pelamar
// Chat tujuan: override chatId (Setting) bila diisi, selain itu semua chat
// admin aktif (activeChats). Bot token dari automation settings yang sudah ada.
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { activeChats, getAutomationSettings } from "@/lib/notify";
import { stageLabel } from "@/lib/stages";
import { tgSendDocument } from "@/lib/telegram-bot";

export type WeeklyReportSettings = {
  enabled: boolean;
  chatId: string; // kosong = kirim ke semua chat admin aktif
  lastSent: string; // YYYY-MM-DD terakhir terkirim (dedupe)
};

const SETTING_KEY = "weekly_report";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const INTERVIEW_MODE_LABELS: Record<string, string> = {
  ONLINE: "Daring",
  ONSITE: "On-site",
};

const INTERVIEW_PLATFORM_LABELS: Record<string, string> = {
  GOOGLE_MEET: "Google Meet",
  ZOOM: "Zoom",
  MICROSOFT_TEAMS: "Microsoft Teams",
  WHATSAPP: "WhatsApp",
  TELEPON: "Telepon",
  LAINNYA: "Lainnya",
};

const INTERVIEW_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Terjadwal",
  CONFIRMED: "Dikonfirmasi",
  COMPLETED: "Selesai",
  NO_SHOW: "Tidak Hadir",
  CANCELLED: "Dibatalkan",
};

function todayStamp(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Baca Setting "weekly_report" dengan aman (fallback: mati, tanpa chat). */
export async function getWeeklyReportSettings(): Promise<WeeklyReportSettings> {
  try {
    const setting = await db.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!setting) return { enabled: false, chatId: "", lastSent: "" };
    const parsed: unknown = JSON.parse(setting.value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { enabled: false, chatId: "", lastSent: "" };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      enabled: obj.enabled === true,
      chatId: typeof obj.chatId === "string" ? obj.chatId.trim().slice(0, 60) : "",
      lastSent: typeof obj.lastSent === "string" ? obj.lastSent.slice(0, 10) : "",
    };
  } catch {
    return { enabled: false, chatId: "", lastSent: "" };
  }
}

/** Simpan pengaturan laporan mingguan (lastSent dipertahankan). */
export async function saveWeeklyReportSettings(input: { enabled: boolean; chatId: string }): Promise<void> {
  const current = await getWeeklyReportSettings();
  const value = JSON.stringify({
    enabled: input.enabled === true,
    chatId: input.chatId.trim().slice(0, 60),
    lastSent: current.lastSent,
  });
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
}

/** Tandai sudah terkirim hari ini (dipanggil setelah pengiriman sukses). */
async function markSent(today: string): Promise<void> {
  const cfg = await getWeeklyReportSettings();
  const value = JSON.stringify({ enabled: cfg.enabled, chatId: cfg.chatId, lastSent: today });
  await db.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value },
    create: { key: SETTING_KEY, value },
  });
}

/**
 * Jalankan laporan Excel mingguan (idempoten). force=true untuk uji manual.
 * Return { sent } — jumlah chat yang sukses dikirimi dokumen.
 */
export async function runWeeklyExcelReport(force = false): Promise<{ sent: number; reason?: string }> {
  try {
    const automation = await getAutomationSettings();
    if (!automation.telegramBotToken) return { sent: 0, reason: "no-token" };

    const cfg = await getWeeklyReportSettings();
    if (!cfg.enabled && !force) return { sent: 0, reason: "disabled" };

    const now = new Date();
    const today = todayStamp(now);
    if (!force && cfg.lastSent === today) return { sent: 0, reason: "already" };
    // Jendela kirim: Senin 08:00-08:59 waktu server (konsisten job mingguan lain).
    if (!force && !(now.getDay() === 1 && now.getHours() === 8)) {
      return { sent: 0, reason: "not-monday-8" };
    }

    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const until = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fmtDate = (value: Date | null) =>
      value ? value.toLocaleDateString("id-ID", { dateStyle: "long" }) : "-";

    const newApps = await db.application.findMany({
      where: { deletedAt: null, createdAt: { gte: from } },
      select: { status: true, position: { select: { title: true } } },
    });
    const upcoming = await db.interview.findMany({
      where: {
        scheduledAt: { gte: now, lte: until },
        status: { in: ["SCHEDULED", "CONFIRMED"] },
      },
      include: { application: { select: { name: true, position: { select: { title: true } } } } },
      orderBy: { scheduledAt: "asc" },
      take: 100,
    });
    const pendingOffers = await db.application.findMany({
      where: { deletedAt: null, offerStatus: "PENDING" },
      select: {
        name: true,
        trackingCode: true,
        offerSentAt: true,
        offerDeadline: true,
        position: { select: { title: true } },
      },
      orderBy: { offerDeadline: "asc" },
      take: 100,
    });

    /* ------------------------- Sheet "Ringkasan" ------------------------- */
    const ringkasanAoa: (string | number)[][] = [
      ["Laporan Mingguan Lumina Studio"],
      ["Periode data", `${fmtDate(from)} s.d. ${fmtDate(now)}`],
      ["Dibuat", now.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })],
      [],
      ["Pelamar Baru 7 Hari Terakhir", newApps.length],
      [],
      ["Rekap per Tahap (pelamar baru)"],
      ["Tahap", "Jumlah"],
    ];
    const stageCounts = new Map<string, number>();
    const posCounts = new Map<string, number>();
    for (const app of newApps) {
      const label = stageLabel(app.status.trim() || "NEW");
      stageCounts.set(label, (stageCounts.get(label) ?? 0) + 1);
      const title = app.position?.title ?? "(tanpa posisi)";
      posCounts.set(title, (posCounts.get(title) ?? 0) + 1);
    }
    for (const [label, count] of [...stageCounts.entries()].sort((a, b) => b[1] - a[1])) {
      ringkasanAoa.push([label, count]);
    }
    ringkasanAoa.push([], ["Rekap per Posisi (pelamar baru)"], ["Posisi", "Jumlah"]);
    for (const [title, count] of [...posCounts.entries()].sort((a, b) => b[1] - a[1])) {
      ringkasanAoa.push([title, count]);
    }
    ringkasanAoa.push(
      [],
      ["Offer PENDING Aktif", pendingOffers.length],
      ["Wawancara 7 Hari ke Depan", upcoming.length],
    );
    const sheetRingkasan = XLSX.utils.aoa_to_sheet(ringkasanAoa);
    sheetRingkasan["!cols"] = [{ wch: 40 }, { wch: 14 }];

    /* ---------------------- Sheet "Interview 7 Hari" ---------------------- */
    const ivHeader = ["Kandidat", "Posisi", "Jadwal", "Mode", "Platform", "Status"];
    const ivAoa: (string | number)[][] = [ivHeader];
    for (const iv of upcoming) {
      ivAoa.push([
        iv.application?.name ?? "",
        iv.application?.position?.title ?? "(tanpa posisi)",
        iv.scheduledAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }),
        INTERVIEW_MODE_LABELS[iv.mode] ?? iv.mode,
        INTERVIEW_PLATFORM_LABELS[iv.platform] ?? iv.platform,
        INTERVIEW_STATUS_LABELS[iv.status] ?? iv.status,
      ]);
    }
    if (upcoming.length === 0) ivAoa.push(["(tidak ada wawancara terjadwal)", "", "", "", "", ""]);
    const sheetInterview = XLSX.utils.aoa_to_sheet(ivAoa);
    sheetInterview["!cols"] = [{ wch: 24 }, { wch: 26 }, { wch: 24 }, { wch: 12 }, { wch: 18 }, { wch: 16 }];

    /* ------------------------- Sheet "Offer Aktif" ------------------------- */
    const offHeader = ["Kandidat", "Kode", "Posisi", "Dikirim", "Batas Jawaban"];
    const offAoa: (string | number)[][] = [offHeader];
    for (const app of pendingOffers) {
      offAoa.push([
        app.name,
        app.trackingCode ?? "",
        app.position?.title ?? "(tanpa posisi)",
        fmtDate(app.offerSentAt),
        fmtDate(app.offerDeadline),
      ]);
    }
    if (pendingOffers.length === 0) offAoa.push(["(tidak ada offer menunggu jawaban)", "", "", "", ""]);
    const sheetOffer = XLSX.utils.aoa_to_sheet(offAoa);
    sheetOffer["!cols"] = [{ wch: 24 }, { wch: 14 }, { wch: 26 }, { wch: 18 }, { wch: 18 }];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheetRingkasan, "Ringkasan");
    XLSX.utils.book_append_sheet(workbook, sheetInterview, "Interview 7 Hari");
    XLSX.utils.book_append_sheet(workbook, sheetOffer, "Offer Aktif");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `laporan-mingguan-lumina-${todayStamp(now)}.xlsx`;
    const caption = `Laporan mingguan Lumina Studio (${fmtDate(from)} s.d. ${fmtDate(now)}): ${newApps.length} pelamar baru, ${upcoming.length} wawancara mendatang, ${pendingOffers.length} offer menunggu jawaban.`;

    const chats = cfg.chatId ? [cfg.chatId] : activeChats(automation);
    if (chats.length === 0) return { sent: 0, reason: "no-chat" };

    let sent = 0;
    for (const chat of chats) {
      const ok = await tgSendDocument(automation.telegramBotToken, chat, buffer, filename, caption);
      if (ok) sent += 1;
    }
    if (sent > 0) {
      await markSent(today);
    }
    return { sent };
  } catch (error) {
    console.error("[runWeeklyExcelReport]", error);
    return { sent: 0, reason: "error" };
  }
}
