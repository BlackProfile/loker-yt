// Webhook keluar generik (SERVER-ONLY) — kirim event ke endpoint eksternal yang
// didaftarkan admin dengan tanda tangan HMAC-SHA256 pada header X-Lumina-Signature.
// Fire-and-forget: kegagalan delivery tidak pernah melempar error ke pemanggil.
import crypto from "crypto";
import { db } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/types";

const TIMEOUT_MS = 5000;

/** Nama event mengikuti sumber tunggal WEBHOOK_EVENTS di types.ts (termasuk offer.sent, interview.scheduled, interview.completed). */
export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

/** Ringkasan percobaan pengiriman satu event (untuk route uji / logging). */
export type WebhookDelivery = {
  event: WebhookEventName;
  /** URL endpoint yang DICOBANI dikirimi event (termasuk yang akhirnya gagal). */
  targets: string[];
};

function sign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Kirim event ke semua endpoint aktif yang berlangganan event tersebut.
 * Aman dipanggil dari route mana pun — seluruh kesalahan ditelan dan dicatat.
 * Selalu mengembalikan ringkasan target yang dicoba (tidak pernah melempar).
 */
export async function emitWebhook(event: WebhookEventName, payload: Record<string, unknown>): Promise<WebhookDelivery> {
  const delivery: WebhookDelivery = { event, targets: [] };
  try {
    const endpoints = await db.webhookEndpoint.findMany({ where: { active: true } });
    const targets = endpoints.filter((ep) => {
      try {
        const events = JSON.parse(ep.events) as string[];
        return Array.isArray(events) && (events.includes("*") || events.includes(event));
      } catch {
        return false;
      }
    });
    if (targets.length === 0) return delivery;

    const body = JSON.stringify({
      event,
      sentAt: new Date().toISOString(),
      data: payload,
    });

    await Promise.all(
      targets.map(async (ep) => {
        delivery.targets.push(ep.url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        let status: number | null = null;
        try {
          const timestamp = Math.floor(Date.now() / 1000).toString();
          const res = await fetch(ep.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Lumina-Event": event,
              "X-Lumina-Timestamp": timestamp,
              "X-Lumina-Signature": sign(ep.secret, timestamp, body),
            },
            body,
            signal: controller.signal,
          });
          status = res.status;
        } catch {
          status = null;
        } finally {
          clearTimeout(timer);
        }
        // Observabilitas: setiap percobaan delivery dicatat (status null = gagal jaringan/timeout).
        if (status !== null && status >= 200 && status < 300) {
          console.log(`[webhooks] ${event} -> ${ep.url} (HTTP ${status})`);
        } else {
          console.log(`[webhooks] ${event} -> ${ep.url} (status ${status === null ? "null — gagal jaringan/timeout" : status})`);
        }
        try {
          await db.webhookEndpoint.update({
            where: { id: ep.id },
            data: {
              lastStatus: status,
              lastFiredAt: new Date(),
              failCount: status && status >= 200 && status < 300 ? 0 : { increment: 1 },
            },
          });
        } catch {
          // catatan status gagal disimpan — abaikan
        }
      }),
    );
  } catch (error) {
    console.error("[webhooks] emitWebhook gagal:", error);
  }
  return delivery;
}
