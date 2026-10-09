// Skrip uji E2E sementara untuk Task 4-b (dihapus setelah verifikasi).
// Alur: offer-approval GET/PUT + persetujuan offer dua lapis + scorecard endpoint.
import { createHmac } from "node:crypto";

const BASE = "http://localhost:3000";

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

function totpCode(secret: string, step: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(step / 1000 / 30), 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const bin =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

const TOTP_SECRET = "YA2M3SYSZOXTYANFZXHHIU43ZF6Z4GVY";
const code = totpCode(TOTP_SECRET, Date.now());

async function jfetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {}
  return { status: res.status, body, headers: res.headers };
}

function cookieOf(res: { headers: Headers }): string {
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const full = setCookie.find((c) => c.startsWith("admin_session="));
  return full ? full.split(";")[0] : "";
}

function out(label: string, value: unknown) {
  console.log(`\n== ${label} ==`);
  console.log(typeof value === "string" ? value : JSON.stringify(value));
}

async function main() {
  // 1. Tanpa sesi -> 403
  const anon = await jfetch("/api/admin/offer-approval");
  out("GET approval tanpa sesi", { status: anon.status, body: anon.body });

  // 2. Login OWNER + HR
  const ownerRes = await jfetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@lumina.id", password: "admin123", totpCode: code }),
  });
  const ownerCookie = cookieOf(ownerRes);
  out("Login OWNER", { status: ownerRes.status, hasCookie: Boolean(ownerCookie) });

  const hrRes = await jfetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "hr@lumina.id", password: "admin123" }),
  });
  const hrCookie = cookieOf(hrRes);
  out("Login HR", { status: hrRes.status, hasCookie: Boolean(hrCookie) });

  // 3. PUT invalid (HR -> 403, OWNER non-boolean -> 400)
  const putHr = await jfetch("/api/admin/offer-approval", {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: hrCookie },
    body: JSON.stringify({ enabled: true }),
  });
  out("PUT approval sebagai HR (harus 403)", { status: putHr.status, body: putHr.body });

  const putBad = await jfetch("/api/admin/offer-approval", {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ enabled: "ya" }),
  });
  out("PUT approval enabled='ya' (harus 400)", { status: putBad.status, body: putBad.body });

  // 4. PUT true + GET
  const putTrue = await jfetch("/api/admin/offer-approval", {
    method: "PUT",
    headers: { "Content-Type": "application/json", cookie: ownerCookie },
    body: JSON.stringify({ enabled: true }),
  });
  const getTrue = await jfetch("/api/admin/offer-approval", { headers: { cookie: hrCookie } });
  out("PUT true + GET (HR membaca)", { put: putTrue, get: getTrue.body });

  const APP = "cmuyvi01t000dobxtuqb05zf5"; // Anisa Rahma — tanpa offer
  const offerHeaders = { "Content-Type": "application/json" };

  // 5. HR ajukan offer -> approvalRequired
  const hrPost = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "POST",
    headers: { ...offerHeaders, cookie: hrCookie },
    body: JSON.stringify({ salary: "Rp 4.000.000/bulan", type: "Part-time", startDate: "2026-11-02", deadlineDays: 5, note: "Uji alur persetujuan" }),
  });
  const hrPostBody = hrPost.body as Record<string, unknown>;
  out("HR POST offer (harus approvalRequired)", {
    status: hrPost.status,
    approvalRequired: hrPostBody?.approvalRequired,
    offerApprovalState: (hrPostBody?.application as Record<string, unknown>)?.offerApprovalState,
    offerStatus: (hrPostBody?.application as Record<string, unknown>)?.offerStatus,
    offerSentAt: (hrPostBody?.application as Record<string, unknown>)?.offerSentAt,
    offerRequestedBy: (hrPostBody?.application as Record<string, unknown>)?.offerRequestedBy,
    offerSalary: (hrPostBody?.application as Record<string, unknown>)?.offerSalary,
  });

  // 6. HR POST ulang saat PENDING -> harus diblok
  const hrPost2 = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "POST",
    headers: { ...offerHeaders, cookie: hrCookie },
    body: JSON.stringify({ salary: "Rp 9.000.000/bulan" }),
  });
  out("HR POST ulang saat PENDING (harus 400)", { status: hrPost2.status, body: hrPost2.body });

  // 7. HR coba reject -> 403
  const hrReject = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "PATCH",
    headers: { ...offerHeaders, cookie: hrCookie },
    body: JSON.stringify({ action: "reject", note: "x" }),
  });
  out("HR reject (harus 403)", { status: hrReject.status, body: hrReject.body });

  // 8. OWNER reject tanpa catatan -> 400
  const ownerRejectNoNote = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "PATCH",
    headers: { ...offerHeaders, cookie: ownerCookie },
    body: JSON.stringify({ action: "reject" }),
  });
  out("OWNER reject tanpa catatan (harus 400)", { status: ownerRejectNoNote.status, body: ownerRejectNoNote.body });

  // 9. OWNER reject dengan catatan -> REJECTED, draft tetap
  const ownerReject = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "PATCH",
    headers: { ...offerHeaders, cookie: ownerCookie },
    body: JSON.stringify({ action: "reject", note: "Gaji di luar rentang posisi, mohon disesuaikan." }),
  });
  const rejBody = ownerReject.body as Record<string, unknown>;
  out("OWNER reject dengan catatan", {
    status: ownerReject.status,
    state: (rejBody?.application as Record<string, unknown>)?.offerApprovalState,
    note: (rejBody?.application as Record<string, unknown>)?.offerReviewNote,
    draftSalary: (rejBody?.application as Record<string, unknown>)?.offerSalary,
    offerStatus: (rejBody?.application as Record<string, unknown>)?.offerStatus,
  });

  // 10. HR ajukan ulang -> PENDING lagi
  const hrResubmit = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "POST",
    headers: { ...offerHeaders, cookie: hrCookie },
    body: JSON.stringify({ salary: "Rp 4.500.000/bulan", type: "Part-time", deadlineDays: 5 }),
  });
  const resubBody = hrResubmit.body as Record<string, unknown>;
  out("HR ajukan ulang setelah reject", {
    status: hrResubmit.status,
    approvalRequired: resubBody?.approvalRequired,
    state: (resubBody?.application as Record<string, unknown>)?.offerApprovalState,
    requestedAt: (resubBody?.application as Record<string, unknown>)?.offerRequestedAt,
  });

  // 11. OWNER approve -> jalur kirim lama
  const ownerApprove = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "PATCH",
    headers: { ...offerHeaders, cookie: ownerCookie },
    body: JSON.stringify({ action: "approve", note: "Disetujui." }),
  });
  const apprBody = ownerApprove.body as Record<string, unknown>;
  const apprApp = apprBody?.application as Record<string, unknown> | undefined;
  out("OWNER approve (jalur kirim lama)", {
    status: ownerApprove.status,
    state: apprApp?.offerApprovalState,
    offerStatus: apprApp?.offerStatus,
    offerSentAt: apprApp?.offerSentAt,
    reviewedBy: apprApp?.offerReviewedBy,
    reviewNote: apprApp?.offerReviewNote,
    hasMessage: typeof apprBody?.message === "string",
  });

  // 12. Approve ulang (sudah tidak PENDING) -> 400
  const doubleApprove = await jfetch(`/api/admin/applications/${APP}/offer`, {
    method: "PATCH",
    headers: { ...offerHeaders, cookie: ownerCookie },
    body: JSON.stringify({ action: "approve" }),
  });
  out("Approve tanpa permintaan PENDING (harus 400)", { status: doubleApprove.status, body: doubleApprove.body });

  // 13. Scorecard endpoint — bobot posisi + sesi uji sementara dikerjakan lewat skrip DB terpisah.
  const score = await jfetch(`/api/admin/scorecard?applicationIds=${APP}`, { headers: { cookie: ownerCookie } });
  out("GET scorecard (tanpa sesi wawancara)", { status: score.status, body: score.body });

  const scoreAnon = await fetch(`${BASE}/api/admin/scorecard?applicationIds=${APP}`);
  out("GET scorecard tanpa sesi (harus 401)", { status: scoreAnon.status });
}

await main();
