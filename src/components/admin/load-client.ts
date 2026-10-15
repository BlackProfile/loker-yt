"use client";

// NR58 (B4/D10/D11) — sinyal beban server untuk klien admin.
// Server menempelkan header pada respons admin:
//   X-Load: OK | WARN | CRIT | SAVE        (sinyal beban, dari load-metrics)
//   X-Data-AsOf: <ISO>                     (respons menyajikan snapshot basi)
// apiFetch() melaporkan setiap respons ke modul ini; semua poller & UI membaca:
//   getPollMs(base)      → polling adaptif (OK 1×, WARN 2×, CRIT 4×, SAVE 5×)
//   useLoadInfo()        → badge "Mode Hemat" di header + chip "data lama"
//   peekCachedJson()     → cache stale-first untuk tabel berat (dari apiGet)

let state: {
  mode: "OK" | "WARN" | "CRIT" | "SAVE";
  dataAsOf: number | null;
  updatedAt: number;
} = { mode: "OK", dataAsOf: null, updatedAt: 0 };

// NR58 — objek info HARUS stabil antar panggilan getSnapshot
// (useSyncExternalStore): objek baru setiap panggilan memicu loop render
// tak terbatas. Dibuat ulang HANYA saat state benar-benar berubah.
let info: LoadInfo = { mode: "OK", saveActive: false, dataAgeSec: null };

function recomputeInfo(): void {
  info = {
    mode: state.mode,
    saveActive: state.mode === "SAVE",
    dataAgeSec:
      state.dataAsOf != null
        ? Math.max(0, Math.round((Date.now() - state.dataAsOf) / 1000))
        : null,
  };
}
recomputeInfo();

const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // pendengar mati tidak boleh menjatuhkan yang lain
    }
  }
}

/** Kelipatan polling menurut sinyal beban terakhir. */
export function getLoadMultiplier(): number {
  switch (state.mode) {
    case "SAVE":
      return 5;
    case "CRIT":
      return 4;
    case "WARN":
      return 2;
    default:
      return 1;
  }
}

/** Interval polling adaptif: base × kelipatan, dibatasi maksimum 5 menit. */
export function getPollMs(baseMs: number): number {
  return Math.min(baseMs * getLoadMultiplier(), 5 * 60_000);
}

/** Laporkan satu respons fetch admin (dipanggil dari apiFetch). */
export function noteLoadResponse(res: Response): void {
  try {
    const raw = res.headers.get("x-load");
    const asOf = res.headers.get("x-data-asof");
    const mode =
      raw === "SAVE" || raw === "CRIT" || raw === "WARN" || raw === "OK"
        ? raw
        : null;
    if (mode === null && asOf === null) return;
    const asOfMs = asOf ? Date.parse(asOf) : NaN;
    // Respons rute sadar-beban (punya X-Load) TANPA X-Data-AsOf berarti data
    // segar — chip "data lama" dibersihkan otomatis saat server pulih.
    state = {
      mode: mode ?? state.mode,
      dataAsOf:
        mode !== null ? (Number.isNaN(asOfMs) ? null : asOfMs) : state.dataAsOf,
      updatedAt: Date.now(),
    };
    recomputeInfo();
    emit();
  } catch {
    // header tidak ada / parse gagal — abaikan
  }
}

export type LoadInfo = {
  mode: "OK" | "WARN" | "CRIT" | "SAVE";
  saveActive: boolean;
  /** Umur data (detik) bila respons terakhir adalah snapshot basi. */
  dataAgeSec: number | null;
};

function snapshotInfo(): LoadInfo {
  return info;
}

/** Langganan perubahan sinyal beban (untuk useSyncExternalStore). */
export function subscribeLoad(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Nilai saat ini untuk useSyncExternalStore (getSnapshot harus stabil). */
export function getLoadSnapshotValue(): LoadInfo {
  return snapshotInfo();
}

// ---------------------------------------------------------------------------
// D10 — cache stale-first sederhana (memori tab): hasil GET admin terakhir
// per URL. Tabel berat menampilkan ini segera saat mount, lalu segarkan di
// latar — tab terasa instan walau server sedang berat.
// ---------------------------------------------------------------------------

const CACHE_MAX = 40;
const jsonCache = new Map<string, { at: number; body: unknown }>();

export function peekCachedJson<T>(url: string): T | null {
  const hit = jsonCache.get(url);
  return hit ? (hit.body as T) : null;
}

export function peekCachedAgeSec(url: string): number | null {
  const hit = jsonCache.get(url);
  if (!hit) return null;
  return Math.max(0, Math.round((Date.now() - hit.at) / 1000));
}

export function rememberJson(url: string, body: unknown): void {
  try {
    // NR59 — jangan simpan array raksasa di memori tab (daftar lite posisi
    // viral bisa ±3 MB, daftar penuh ±20 MB); cache stale-first tetap aktif
    // untuk respons normal (halaman paginate, posisi kecil, dsb.).
    if (Array.isArray(body) && body.length > 1500) return;
    jsonCache.set(url, { at: Date.now(), body });
    if (jsonCache.size > CACHE_MAX) {
      const oldest = [...jsonCache.entries()].sort((a, b) => a[1].at - b[1].at);
      for (let i = 0; i < oldest.length - CACHE_MAX; i++) {
        jsonCache.delete(oldest[i][0]);
      }
    }
  } catch {
    // diam — cache adalah optimasi, bukan kebutuhan korrektnya
  }
}
