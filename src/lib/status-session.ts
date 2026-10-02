// Sesi pelamar untuk halaman Cek Status (#status) — disimpan di perangkat.
// - "Ingat saya" dicentang  -> localStorage (tetap masuk saat kembali, lintas tab).
// - Tidak dicentang         -> sessionStorage (hilang saat tab ditutup).
// - Peta "terakhir dilihat" per kode lamaran selalu localStorage (bukan data sensitif)
//   untuk badge "Ada pembaruan" di daftar multi-lamaran.
export type StatusSession = { email: string; code: string };

const SESSION_KEY = "lumina.status.session";
const SEEN_KEY = "lumina.status.seen";

function safeStorage(kind: "local" | "session"): Storage | null {
  try {
    const storage = kind === "local" ? window.localStorage : window.sessionStorage;
    return storage;
  } catch {
    return null; // storage diblokir (mis. private mode ketat) — sesi tidak diingat
  }
}

/** Baca sesi tersimpan: localStorage dulu, lalu sessionStorage. Null bila tidak ada. */
export function loadSession(): (StatusSession & { remember: boolean }) | null {
  const local = safeStorage("local");
  if (local) {
    const raw = local.getItem(SESSION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StatusSession>;
        if (typeof parsed.email === "string" && typeof parsed.code === "string") {
          return { email: parsed.email, code: parsed.code, remember: true };
        }
      } catch {
        local.removeItem(SESSION_KEY);
      }
    }
  }
  const session = safeStorage("session");
  if (session) {
    const raw = session.getItem(SESSION_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<StatusSession>;
        if (typeof parsed.email === "string" && typeof parsed.code === "string") {
          return { email: parsed.email, code: parsed.code, remember: false };
        }
      } catch {
        session.removeItem(SESSION_KEY);
      }
    }
  }
  return null;
}

/** Simpan sesi ke storage sesuai pilihan "ingat saya". */
export function saveSession(session: StatusSession, remember: boolean): void {
  const payload = JSON.stringify(session);
  clearSession();
  const storage = safeStorage(remember ? "local" : "session");
  try {
    storage?.setItem(SESSION_KEY, payload);
  } catch {
    // abaikan — sesi hanya tidak diingat
  }
}

/** Hapus sesi dari kedua storage (logout / sesi tidak valid). */
export function clearSession(): void {
  try {
    safeStorage("local")?.removeItem(SESSION_KEY);
  } catch {}
  try {
    safeStorage("session")?.removeItem(SESSION_KEY);
  } catch {}
}

function readSeenMap(): Record<string, number> {
  const local = safeStorage("local");
  if (!local) return {};
  const raw = local.getItem(SEEN_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, number> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
      }
      return out;
    }
  } catch {
    local.removeItem(SEEN_KEY);
  }
  return {};
}

/** Waktu terakhir lamaran (kode) dilihat pelamar, epoch ms — 0 bila belum pernah. */
export function loadSeenAt(code: string): number {
  return readSeenMap()[code] ?? 0;
}

/** Tandai lamaran (kode) sebagai baru saja dilihat. */
export function markSeen(code: string): void {
  const local = safeStorage("local");
  if (!local) return;
  const map = readSeenMap();
  map[code] = Date.now();
  // Batasi ukuran: simpan maksimal 50 kode terbaru.
  const entries = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50);
  try {
    local.setItem(SEEN_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // abaikan
  }
}
