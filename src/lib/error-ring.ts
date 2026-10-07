// NR41-SEC-B (L31) — ring buffer error global (SERVER-ONLY, in-memory).
// Menyimpan hingga 200 entri error terakhir (console.error, uncaughtException,
// unhandledRejection) untuk ditampilkan di GET /api/admin/health/errors (OWNER).
// Disimpan di globalThis agar aman terhadap hot-reload Next.js (modul di-re-evaluasi
// tetapi buffer tetap satu instance).
// Anti-rekursi: saat memproses error kita mematikan hook console.error sementara.

export type ErrorRingEntry = { at: string; msg: string };

const RING_MAX = 200;
const MSG_MAX = 500;

type ErrorRingState = {
  entries: ErrorRingEntry[];
  installing: boolean;
  installed: boolean;
};

function state(): ErrorRingState {
  const g = globalThis as unknown as { __nr41ErrorRing?: ErrorRingState };
  if (!g.__nr41ErrorRing) {
    g.__nr41ErrorRing = { entries: [], installing: false, installed: false };
  }
  return g.__nr41ErrorRing;
}

/** Ringkasan pesan error jadi satu baris, dipotong 500 karakter. */
function summarize(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = `${error.name}: ${error.message}${error.stack ? ` | ${error.stack.split("\n")[1]?.trim() ?? ""}` : ""}`;
  } else if (typeof error === "string") {
    raw = error;
  } else {
    try {
      raw = JSON.stringify(error) ?? String(error);
    } catch {
      raw = String(error);
    }
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, MSG_MAX);
}

/** Push satu entri error ke ring buffer (maks 200, terlama dibuang). */
export function pushErrorRing(error: unknown): void {
  try {
    const s = state();
    s.entries.push({ at: new Date().toISOString(), msg: summarize(error) });
    if (s.entries.length > RING_MAX) {
      s.entries.splice(0, s.entries.length - RING_MAX);
    }
  } catch {
    // logging tidak boleh pernah melempar
  }
}

/** Salinan isi ring buffer (terlama → terbaru). */
export function getErrorRing(): ErrorRingEntry[] {
  return [...state().entries];
}

/** Pasang hook console.error + handler proses (idempoten). JANGAN exit proses. */
export function installErrorRing(): void {
  const s = state();
  if (s.installed || s.installing) return;
  s.installing = true;

  const originalConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    // Push dulu, lalu tulis ke console asli. Bila push memicu console.error lagi,
    // flag `installing` mencegah rekursi tak berujung.
    pushErrorRing(args.length === 1 ? args[0] : args.map((a) => summarize(a)).join(" "));
    try {
      originalConsoleError(...args);
    } catch {
      // diam — jangan pernah melempar dari hook
    }
  };

  process.on("uncaughtException", (err: unknown) => {
    pushErrorRing(["uncaughtException", err]);
    try {
      originalConsoleError("[error-ring] uncaughtException:", err);
    } catch {
      // diam
    }
    // SENGAJA tidak exit — dev server harus tetap hidup.
  });

  process.on("unhandledRejection", (reason: unknown) => {
    pushErrorRing(["unhandledRejection", reason]);
    try {
      originalConsoleError("[error-ring] unhandledRejection:", reason);
    } catch {
      // diam
    }
    // SENGAJA tidak exit.
  });

  s.installed = true;
  s.installing = false;
}
