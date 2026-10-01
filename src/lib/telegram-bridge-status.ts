// Status jembatan poller Telegram (in-memory, server Next.js saja).
// Mini-service telegram-bot memanggil GET /api/telegram/config tiap 60 detik;
// route itu memanggil markPollerSeen() sehingga panel admin bisa menampilkan
// apakah service polling masih hidup (heartbeat <= 120 detik dianggap sehat).
// State disimpan di globalThis agar semua instance modul (dev mode sering
// memuat ulang modul per route) berbagi satu heartbeat yang sama.

type BridgeState = { lastPollerSeen: number };
const GLOBAL_KEY = "__luminaTelegramBridgeState";
const state: BridgeState = ((globalThis as typeof globalThis & { [GLOBAL_KEY]?: BridgeState })[GLOBAL_KEY] ??= {
  lastPollerSeen: 0,
});

export function markPollerSeen(): void {
  state.lastPollerSeen = Date.now();
}

export type PollerStatus = {
  lastSeenAt: string | null;
  secondsAgo: number | null;
  healthy: boolean;
};

export function getPollerStatus(): PollerStatus {
  if (!state.lastPollerSeen) {
    return { lastSeenAt: null, secondsAgo: null, healthy: false };
  }
  const secondsAgo = Math.max(Math.round((Date.now() - state.lastPollerSeen) / 1000), 0);
  return {
    lastSeenAt: new Date(state.lastPollerSeen).toISOString(),
    secondsAgo,
    healthy: secondsAgo <= 120,
  };
}
