// POST /api/admin/webhook-test — uji konfigurasi notifikasi Discord & Telegram (khusus OWNER).
// Telegram dikirim lewat helper terperinci agar ALASAN kegagalan ikut dilaporkan
// (mis. "Unauthorized: token is invalid") sehingga admin tahu apa yang perlu diperbaiki.
//
// Body opsional: { event: WebhookEvent } — bila diisi, route juga mengirim PAYLOAD CONTOH
// realistis untuk event webhook tersebut ke semua endpoint keluar yang berlangganan
// (melalui emitWebhook, fire-and-forget + tanda tangan HMAC). Payload contoh TIDAK
// memuat PII, link meeting, ataupun gaji.
import { NextRequest, NextResponse } from "next/server";
import {
  getAutomationSettings,
  sendDiscordNotification,
  sendTelegramMessageDetailed,
  type NotifyChannelResult,
} from "@/lib/notify";
import { getSession, requireRole } from "@/lib/server-auth";
import { emitWebhook } from "@/lib/webhooks";
import { WEBHOOK_EVENTS, type WebhookEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

const UNAUTHORIZED = { error: "Tidak diizinkan. Silakan login terlebih dahulu." };
const FORBIDDEN = { error: "Peran Anda tidak memiliki akses untuk aksi ini." };
const TEST_MESSAGE = "Tes konfigurasi notifikasi Lumina Studio - berhasil";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Payload contoh per event — realistis namun bebas dari data sensitif:
 * tanpa nama/email pelamar (PII), tanpa link meeting, dan tanpa gaji.
 * Bentuk data mengikuti payload asli yang dikirim route produksi.
 */
function samplePayloadFor(event: WebhookEvent): Record<string, unknown> {
  const now = Date.now();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const day = 24 * 60 * 60 * 1000;
  switch (event) {
    case "application.created":
      return {
        applicationId: "contoh-application-id",
        trackingCode: "LM-CONTOH01",
        positionTitle: "Video Editor",
        source: "Instagram",
      };
    case "application.stage_changed":
      return {
        applicationId: "contoh-application-id",
        trackingCode: "LM-CONTOH01",
        positionTitle: "Video Editor",
        from: "NEW",
        to: "INTERVIEW",
      };
    case "application.archived":
      return { count: 1, ids: ["contoh-application-id"] };
    case "offer.sent":
      return {
        applicationId: "contoh-application-id",
        trackingCode: "LM-CONTOH01",
        positionTitle: "Video Editor",
        type: "Full-time",
        salary: null, // gaji tidak pernah dikirim ke endpoint eksternal
        sentAt: iso(0),
        deadline: iso(3 * day),
      };
    case "offer.responded":
      return {
        applicationId: "contoh-application-id",
        trackingCode: "LM-CONTOH01",
        offerStatus: "ACCEPTED",
      };
    case "interview.scheduled":
      return {
        interviewId: "contoh-interview-id",
        applicationId: "contoh-application-id",
        trackingCode: "LM-CONTOH01",
        positionTitle: "Video Editor",
        scheduledAt: iso(day),
        mode: "ONLINE",
        platform: "ZOOM", // tanpa link meeting
        actor: "Pemilik Studio",
        createdAt: iso(0),
      };
    case "interview.completed":
      return {
        interviewId: "contoh-interview-id",
        applicationId: "contoh-application-id",
        trackingCode: "LM-CONTOH01",
        positionTitle: "Video Editor",
        recommendation: null, // atau "LANJUT" | "CADANGAN" | "TOLAK"
        completedAt: iso(0),
        actor: "Pemilik Studio",
      };
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireRole(["OWNER"]);
    if (!session) {
      const anySession = await getSession();
      return NextResponse.json(anySession ? FORBIDDEN : UNAUTHORIZED, { status: anySession ? 403 : 401 });
    }

    // Body opsional: { event } untuk menguji event webhook keluar (termasuk event baru:
    // offer.sent, interview.scheduled, interview.completed).
    const body: unknown = await req.json().catch(() => null);
    let testEvent: WebhookEvent | null = null;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const raw = (body as Record<string, unknown>).event;
      if (raw !== undefined && raw !== null && raw !== "") {
        if (typeof raw !== "string" || !(WEBHOOK_EVENTS as readonly string[]).includes(raw)) {
          return NextResponse.json(
            { error: `Event tidak dikenal. Pilihan: ${WEBHOOK_EVENTS.join(", ")}.` },
            { status: 400 },
          );
        }
        testEvent = raw as WebhookEvent;
      }
    }

    const settings = await getAutomationSettings();

    let discord: NotifyChannelResult;
    if (settings.discordWebhookUrl) {
      discord = await sendDiscordNotification(settings.discordWebhookUrl, { content: TEST_MESSAGE });
    } else {
      discord = "nonaktif";
    }

    let telegram: NotifyChannelResult;
    let telegramDetail: string | null = null;
    if (settings.telegramBotToken && settings.telegramChatId) {
      const result = await sendTelegramMessageDetailed(settings.telegramBotToken, settings.telegramChatId, TEST_MESSAGE);
      telegram = result.ok ? "ok" : "gagal";
      if (!result.ok) telegramDetail = result.description ?? null;
    } else {
      telegram = "nonaktif";
    }

    // Detail hanya ke console — JANGAN pernah me-log token.
    console.log(`[webhook-test] Discord: ${discord}; Telegram: ${telegram}${telegramDetail ? ` (${telegramDetail})` : ""}`);

    // Uji event webhook keluar: kirim payload contoh ke endpoint berlangganan.
    // emitWebhook aman (tidak pernah melempar) dan melaporkan target yang dicoba.
    let webhook: { event: WebhookEvent; sample: Record<string, unknown>; targetCount: number; targets: string[] } | null = null;
    if (testEvent) {
      const sample = samplePayloadFor(testEvent);
      const delivery = await emitWebhook(testEvent, sample);
      webhook = {
        event: testEvent,
        sample,
        targetCount: delivery.targets.length,
        targets: delivery.targets,
      };
      console.log(`[webhook-test] Event ${testEvent} dikirim ke ${delivery.targets.length} endpoint: ${delivery.targets.join(", ") || "-"}`);
    }

    return NextResponse.json({ discord, telegram, telegramDetail, webhook });
  } catch (error) {
    console.error("[POST /api/admin/webhook-test]", errorMessage(error));
    return NextResponse.json({ error: "Gagal menguji notifikasi. Coba lagi." }, { status: 500 });
  }
}
