// NR41-SEC-B (L31) — Next.js instrumentation (register() dijalankan sekali saat
// server boot, Node runtime). Memasang ring buffer error global: hook console.error
// + uncaughtException/unhandledRejection (tanpa exit proses).
// Catatan: Next.js hanya memuat instrumentation dari root src/ (bukan src/lib/) —
// menyesuaikan kontrak gelombang yang menyebut src/lib/instrumentation.ts.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installErrorRing } = await import("@/lib/error-ring");
  installErrorRing();
}
