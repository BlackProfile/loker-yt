// NR-41 J23 — Service Worker Lumina Studio (SANGAT konservatif).
// Prinsip:
//   1. Cache-first HANYA untuk aset statis yang tidak pernah berubah per versi:
//      GET same-origin dengan URL diawali /_next/static/, /icons/, atau
//      /manifest.webmanifest.
//   2. Navigasi & API (termasuk /api/*) SELALU network — tidak pernah di-cache-first.
//      Fallback offline navigasi: respons HTML sukses terakhir disimpan (clone)
//      dan dipakai hanya saat network gagal (offline).
//   3. Selain GET tidak pernah disentuh (tidak di-cache, langsung network).
//   4. skipWaiting + clients.claim di install/activate; cache lama dibersihkan
//      di activate.
const VERSION = "v1";
const STATIC_CACHE = `lumina-static-${VERSION}`;
const NAV_CACHE = `lumina-nav-${VERSION}`;
const KEEP = new Set([STATIC_CACHE, NAV_CACHE]);

// Batas jumlah entri cache navigasi offline (FIFO ringan).
const NAV_CACHE_MAX = 5;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Aset dasar terkecil — semuanya opsional; kegagalan tidak menggagalkan install.
      const cache = await caches.open(STATIC_CACHE);
      await cache
        .addAll([
          "/manifest.webmanifest",
          "/icons/icon-192.png",
          "/icons/icon-512.png",
          "/icons/icon-512-maskable.png",
        ])
        .catch(() => {});
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Bersihkan cache dari versi service worker sebelumnya.
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (KEEP.has(name) ? null : caches.delete(name))),
      );
      await self.clients.claim();
    })(),
  );
});

/** URL memenuhi syarat cache-first aset statis? (GET + same-origin + prefix) */
function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Selain GET tidak pernah di-cache — biarkan browser menangani.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // 1) Aset statis: cache-first, fallback network ( respons sukses ikut disimpan ).
  if (isCacheableStatic(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.ok) {
            const cache = await caches.open(STATIC_CACHE);
            cache.put(request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })(),
    );
    return;
  }

  // 2) Navigasi halaman: SELALU network; simpan clone HTML sukses untuk
  //    fallback offline; gagal total -> halaman tersimpan terakhir.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok && response.type === "basic") {
            const cache = await caches.open(NAV_CACHE);
            await cache.put(request, response.clone()).catch(() => {});
            // Jaga cache navigasi tetap kecil.
            const keys = await cache.keys();
            if (keys.length > NAV_CACHE_MAX) {
              await cache.delete(keys[0]).catch(() => {});
            }
          }
          return response;
        } catch {
          const cache = await caches.open(NAV_CACHE);
          const offline = await cache.match(request, { ignoreSearch: true });
          return (
            offline ||
            new Response(
              "<!doctype html><html lang=\"id\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Offline</title><body style=\"font-family:system-ui;padding:2rem;text-align:center\"><h1>Anda sedang offline</h1><p>Sambungkan kembali internet lalu muat ulang halaman.</p></body></html>",
              { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
            )
          );
        }
      })(),
    );
    return;
  }

  // 3) Selain itu (API, file, dsb.): biarkan network apa adanya — TIDAK di-cache.
});
