// Uji UNIT emitWebhook (Task NR-19-e) — tanpa jaringan eksternal.
// Men stub globalThis.fetch untuk menangkap setiap percobaan pengiriman, lalu
// memverifikasi:
//   1) event baru (offer.sent / interview.scheduled / interview.completed) tersalurkan
//      ke endpoint yang BERLANGGanan event itu saja (filter per-event dari kolom events);
//   2) amplop payload { event, sentAt, data } + header HMAC X-Lumina-* benar;
//   3) payload offer.sent TIDAK membawa gaji (salary null), interview TIDAK membawa
//      link meeting / alamat;
//   4) endpoint yang tidak berlangganan TIDAK menerima apa pun.
// Jalankan: bun run .zscripts/test-nr19e-webhook-unit.ts
import { db } from "../src/lib/db";
import { emitWebhook } from "../src/lib/webhooks";

type CapturedCall = { url: string; headers: Record<string, string>; body: string };

const captured: CapturedCall[] = [];
const realFetch = globalThis.fetch;
// Mock fetch: tangkap (URL, header, body), balas HTTP 200 — tidak ada panggilan jaringan nyata.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers as Record<string, string>)) headers[k] = v;
  }
  captured.push({
    url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    headers,
    body: typeof init?.body === "string" ? init.body : "",
  });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

function assert(cond: boolean, label: string): void {
  const mark = cond ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${label}`);
  if (!cond) process.exitCode = 1;
}

const URL_A = "http://127.0.0.1:59999/hook-a"; // berlangganan 3 event baru
const URL_B = "http://127.0.0.1:59999/hook-b"; // berlangganan event lama saja (negatif)

async function main() {
  const epA = await db.webhookEndpoint.create({
    data: {
      url: URL_A,
      secret: "secret-uji-nr19e-aaaaaaaaaaaa",
      events: JSON.stringify(["offer.sent", "interview.scheduled", "interview.completed"]),
      active: true,
    },
  });
  const epB = await db.webhookEndpoint.create({
    data: {
      url: URL_B,
      secret: "secret-uji-nr19e-bbbbbbbbbbbb",
      events: JSON.stringify(["application.created"]),
      active: true,
    },
  });

  try {
    console.log("== emitWebhook: 3 event baru ==");
    captured.length = 0;

    await emitWebhook("offer.sent", {
      applicationId: "app-uji",
      trackingCode: "LM-UJI0001",
      positionTitle: "Video Editor",
      type: "Full-time",
      salary: null,
      sentAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 3 * 864e5).toISOString(),
    });
    await emitWebhook("interview.scheduled", {
      interviewId: "iv-uji",
      applicationId: "app-uji",
      trackingCode: "LM-UJI0001",
      positionTitle: "Video Editor",
      scheduledAt: new Date(Date.now() + 864e5).toISOString(),
      mode: "ONLINE",
      platform: "ZOOM",
      actor: "Pemilik Studio",
      createdAt: new Date().toISOString(),
    });
    await emitWebhook("interview.completed", {
      interviewId: "iv-uji",
      applicationId: "app-uji",
      trackingCode: "LM-UJI0001",
      positionTitle: "Video Editor",
      recommendation: null,
      completedAt: new Date().toISOString(),
      actor: "Pemilik Studio",
    });

    const byUrl = (u: string) => captured.filter((c) => c.url === u);
    const gotA = byUrl(URL_A);
    const gotB = byUrl(URL_B);

    console.log(`Tertangkap: ${captured.length} panggilan fetch (A=${gotA.length}, B=${gotB.length})`);

    assert(gotA.length === 3, "1. Endpoint berlangganan menerima TEPAT 3 event baru");
    assert(gotB.length === 0, "2. Endpoint TIDAK berlangganan (application.created saja) menerima 0 panggilan");

    const events = gotA.map((c) => JSON.parse(c.body).event);
    assert(
      events.includes("offer.sent") && events.includes("interview.scheduled") && events.includes("interview.completed"),
      `3. Ketiga event sampai ke endpoint berlangganan: ${events.join(", ")}`,
    );

    // Amplop + header HMAC
    for (const c of gotA) {
      const parsed = JSON.parse(c.body) as { event: string; sentAt: string; data: Record<string, unknown> };
      assert(typeof parsed.sentAt === "string" && !!parsed.data, `4. Amplop {event, sentAt, data} benar untuk ${parsed.event}`);
      assert(
        c.headers["X-Lumina-Event"] === parsed.event &&
          typeof c.headers["X-Lumina-Signature"] === "string" &&
          c.headers["X-Lumina-Signature"].length === 64 &&
          typeof c.headers["X-Lumina-Timestamp"] === "string",
        `5. Header X-Lumina-Event/Timestamp/Signature(HMAC-SHA256 hex) lengkap untuk ${parsed.event}`,
      );
      assert(c.headers["Content-Type"] === "application/json", `6. Content-Type application/json untuk ${parsed.event}`);
    }

    // Sensitive payload check
    const offer = gotA.map((c) => JSON.parse(c.body)).find((p) => p.event === "offer.sent");
    assert(offer && offer.data.salary === null, "7. offer.sent: salary === null (gaji TIDAK dikirim)");
    assert(offer && !("offerSalary" in offer.data) && !JSON.stringify(offer.data).includes("Rp"), "8. offer.sent: tidak ada nilai gaji terselubung");

    const sched = gotA.map((c) => JSON.parse(c.body)).find((p) => p.event === "interview.scheduled");
    assert(sched && !("meetingLink" in sched.data) && !("address" in sched.data), "9. interview.scheduled: TANPA meetingLink/address (link tidak bocor)");
    assert(sched && sched.data.mode === "ONLINE" && sched.data.platform === "ZOOM", "10. interview.scheduled: mode+platform terkirim");
    assert(sched && typeof sched.data.actor === "string", "11. interview.scheduled: actor terkirim");

    const done = gotA.map((c) => JSON.parse(c.body)).find((p) => p.event === "interview.completed");
    assert(done && "recommendation" in done.data && done.data.recommendation === null, "12. interview.completed: recommendation null bila belum dinilai");
    assert(done && typeof done.data.completedAt === "string", "13. interview.completed: completedAt terkirim");

    // Tampilkan payload tercatat untuk bukti
    console.log("\n== Payload tercatat (mock fetch) ==");
    for (const c of gotA) {
      const sig = String(c.headers["X-Lumina-Signature"] ?? "");
      console.log(`- ${c.url} | X-Lumina-Event=${c.headers["X-Lumina-Event"]} | sig=${sig.slice(0, 12)}…`);
      console.log(`  body=${c.body}`);
    }
  } finally {
    await db.webhookEndpoint.delete({ where: { id: epA.id } });
    await db.webhookEndpoint.delete({ where: { id: epB.id } });
    globalThis.fetch = realFetch;
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error("Unit test gagal:", err);
  process.exit(1);
});
