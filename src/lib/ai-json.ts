// SERVER-ONLY — helper ekstraksi JSON dari balasan LLM untuk fitur AI admin (Task 20-c).
// Sengaja dibuat sebagai file terpisah agar src/lib/ai.ts tidak perlu diubah.

/** Pesan error ringkas tanpa stack berisik. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Buang fence markdown ```json ... ``` (atau ``` biasa) di awal/akhir teks. */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fence ? fence[1] : trimmed).trim();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Ekstrak objek JSON pertama dari teks balasan LLM secara robust:
 * 1) coba JSON.parse penuh (setelah fence dibuang),
 * 2) fallback: cari blok { ... } seimbang pertama lalu parse.
 * Return null bila benar-benar tidak ada objek yang valid.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = stripJsonFence(text);
  try {
    const parsed: unknown = JSON.parse(stripped);
    if (isPlainObject(parsed)) return parsed;
  } catch {
    // lanjut ke pencarian blok seimbang
  }
  const start = stripped.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(stripped.slice(start, i + 1));
          if (isPlainObject(parsed)) return parsed;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Ambil string trim dari nilai unknown, kosongkan bila bukan string. */
export function asTrimmedString(value: unknown, maxLength = 4000): string {
  const text = typeof value === "string" ? value.trim() : "";
  return text.slice(0, maxLength);
}

/** Clamp angka ke rentang 0-100 (integer); null bila bukan angka valid. */
export function clampPercent(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.min(100, Math.max(0, Math.round(num)));
}

/** Normalisasi boolean dari nilai LLM (menerima boolean, "ya"/"tidak", "true"/"false"). */
export function asLooseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["true", "ya", "selaras", "yes", "1"].includes(v)) return true;
    if (["false", "tidak", "tidak selaras", "no", "0"].includes(v)) return false;
  }
  return null;
}
