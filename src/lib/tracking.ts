// Helper kode pelacakan lamaran (SERVER-ONLY — memakai db).
// Format: "LM-" + 6 karakter A-Z0-9, unik terhadap kolom Application.trackingCode.
import { db } from "@/lib/db";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 50;

/** Kode acak "LM-XXXXXX" (belum dicek keunikan). */
export function generateTrackingCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return `LM-${code}`;
}

/** Kode acak yang dijamin belum dipakai (dicek ke DB). */
export async function generateUniqueTrackingCode(): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const code = generateTrackingCode();
    const existing = await db.application.findUnique({
      where: { trackingCode: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  // Fallback berbasis waktu — praktis tak mungkin tabrakan setelah 50 percobaan gagal.
  return `LM-${Date.now().toString(36).toUpperCase().slice(-6).padStart(6, "0")}`;
}
