// Skrip uji & bersih-bersih tahap 2 untuk Task 4-b (dihapus setelah verifikasi).
// 1) PATCH bobot kriteria posisi via API (pass-through) -> GET parse.
// 2) Sesi wawancara sementara -> GET /api/admin/scorecard (tertimbang & fallback).
// 3) PEMULIHAN: data lamaran uji, Setting offer_approval, log & notifikasi uji.
import { createHmac } from "node:crypto";
import { Database } from "bun:sqlite";

const BASE = "http://localhost:3000";
const APP = "cmuyvi01t000dobxtuqb05zf5"; // Anisa Rahma
const POS = "cmuyvi01d0007obxt72kgl9nu"; // Penulis Naskah (bobot uji)

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function totpCode(secret: string): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(Date.now() / 1000 / 30), 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

async function jfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, headers: res.headers };
}

function out(label: string, value: unknown) {
  console.log(`\n== ${label} ==`);
  console.log(JSON.stringify(value));
}

async function main() {
  // Login OWNER
  const res = await jfetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@lumina.id", password: "admin123", totpCode: totpCode("YA2M3SYSZOXTYANFZXHHIU43ZF6Z4GVY") }),
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("admin_session="))?.split(";")[0] ?? "";
  const auth = { headers: { cookie, "Content-Type": "application/json" } };

  // 1. PATCH bobot kriteria via API posisi (pass-through) — nilai tidak wajar ikut di-clamp.
  const patchWeights = await jfetch(`/api/admin/positions/${POS}`, {
    method: "PATCH",
    ...auth,
    body: JSON.stringify({ interviewCriteriaWeights: { "Kekuatan hook": 150, "Struktur naskah": 40, "Gaya suara": -3 } }),
  });
  out("PATCH bobot (clamp 0-100, key persis)", { status: patchWeights.status, weights: (patchWeights.body as Record<string, unknown>)?.interviewCriteriaWeights });

  const patchBad = await jfetch(`/api/admin/positions/${POS}`, {
    method: "PATCH",
    ...auth,
    body: JSON.stringify({ interviewCriteriaWeights: "rusak" }),
  });
  out("PATCH bobot non-objek (harus 400)", { status: patchBad.status, body: patchBad.body });

  // 2. Sesi wawancara sementara + skor uji.
  const db = new Database("db/custom.db");
  db.run(
    `INSERT INTO Interview (id, applicationId, round, mode, platform, scheduledAt, durationMin, interviewers, status, scores, createdAt, updatedAt)
     VALUES ('tmp-sc-1', ?, 1, 'ONLINE', 'GOOGLE_MEET', datetime('now'), 45, '[]', 'COMPLETED', ?, datetime('now'), datetime('now'))`,
    [APP, JSON.stringify({ "Kekuatan hook": 5, "Struktur naskah": 3, "Gaya suara": 4 })],
  );

  const weighted = await jfetch(`/api/admin/scorecard?applicationIds=${APP}`, auth);
  out("Skor tertimbang (60/40 bobot efektif dihitung server)", weighted.body);

  // 3. Kosongkan bobot -> fallback rata merata.
  await jfetch(`/api/admin/positions/${POS}`, {
    method: "PATCH",
    ...auth,
    body: JSON.stringify({ interviewCriteriaWeights: null }),
  });
  const fallback = await jfetch(`/api/admin/scorecard?applicationIds=${APP}`, auth);
  out("Skor tanpa bobot (fallback rata merata)", fallback.body);

  // 4. Bobot sebagian (satu kriteria saja) -> tertimbang atas kriteria berbobot saja.
  await jfetch(`/api/admin/positions/${POS}`, {
    method: "PATCH",
    ...auth,
    body: JSON.stringify({ interviewCriteriaWeights: { "Gaya suara": 100 } }),
  });
  const partial = await jfetch(`/api/admin/scorecard?applicationIds=${APP}`, auth);
  out("Skor bobot sebagian (irisan kriteria berskor+berbobot)", partial.body);

  // ---- PEMULIHAN DATA ----
  db.run("DELETE FROM Interview WHERE id = 'tmp-sc-1'");
  // Kembalikan bobot posisi & kriteria scorecard seperti semula (kosong).
  await jfetch(`/api/admin/positions/${POS}`, {
    method: "PATCH",
    ...auth,
    body: JSON.stringify({ interviewCriteriaWeights: null }),
  });

  // Kembalikan lamaran uji ke keadaan awal (semua kolom offer null).
  db.run(
    `UPDATE Application SET offerStatus = NULL, offerSalary = NULL, offerType = NULL, offerStartDate = NULL,
     offerNote = NULL, offerDeadline = NULL, offerSentAt = NULL, offerRespondedAt = NULL, offerDeclineReason = NULL,
     offerApprovalState = NULL, offerRequestedBy = NULL, offerRequestedAt = NULL, offerReviewedBy = NULL,
     offerReviewedAt = NULL, offerReviewNote = NULL, updatedAt = datetime('now') WHERE id = ?`,
    [APP],
  );
  // Hapus artefak audit & notifikasi dari pengujian.
  const delLogs = db.run(
    `DELETE FROM ActivityLog WHERE applicationId = ? AND action IN ('OFFER_REQUESTED','OFFER_APPROVED','OFFER_SENT','OFFER_REJECTED') AND createdAt >= datetime('now', '-30 minutes')`,
    [APP],
  );
  const delNotes = db.run(
    `DELETE FROM NotificationItem WHERE title = 'Permintaan persetujuan offer' AND createdAt >= datetime('now', '-30 minutes')`,
  );
  // Hapus Setting offer_approval (tidak ada sebelum pengujian).
  db.run("DELETE FROM Setting WHERE key = 'offer_approval'");

  const verify = await jfetch(`/api/admin/applications/${APP}`, auth);
  const appBody = verify.body as Record<string, unknown>;
  out("Verifikasi pemulihan lamaran", {
    status: verify.status,
    offerStatus: appBody?.offerStatus,
    offerApprovalState: appBody?.offerApprovalState,
    offerSalary: appBody?.offerSalary,
  });
  out("Rows dibersihkan", { activityLogs: delLogs.changes, notifications: delNotes.changes });

  const getApproval = await jfetch("/api/admin/offer-approval", auth);
  out("GET approval setelah reset (harus enabled=false)", getApproval.body);

  db.close();
}

await main();
