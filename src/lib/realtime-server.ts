// SERVER-ONLY — kirim sinyal realtime ke mini-service socket.io (port 3003).
// Event hanya berupa nama (tanpa payload data) sehingga aman di-broadcast;
// client yang berhak memuat ulang data lewat API terautentikasi masing-masing.
// Fire-and-forget: kegagalan service TIDAK PERNAH menggagalkan operasi utama.

const REALTIME_URL = "http://127.0.0.1:3003/emit";
const REALTIME_SECRET = process.env.REALTIME_SECRET ?? "lumina-realtime-secret";

/** Nama event bawaan (kontrak bersama client & server). */
export const REALTIME_EVENTS = {
  positions: "positions:changed",
  applications: "applications:changed",
  site: "site:changed",
} as const;

/**
 * Broadcast satu atau beberapa event realtime. Tidak pernah melempar error,
 * tidak pernah melebihi 800ms, dan aman dipanggil dari route handler mana pun.
 */
export async function emitRealtime(...events: string[]): Promise<void> {
  if (events.length === 0) return;
  try {
    await fetch(REALTIME_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: REALTIME_SECRET, events }),
      signal: AbortSignal.timeout(800),
      cache: "no-store",
    });
  } catch {
    // Realtime adalah peningkatan — jika service mati, aplikasi tetap berfungsi
    // (client juga memuat ulang saat window kembali fokus).
  }
}
