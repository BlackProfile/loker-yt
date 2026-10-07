// NR-41 J23 — Service Worker Lumina Studio.
// NR42-HMRSW — REVISI TOTAL setelah insiden "module factory is not available".
//
// Akar masalah versi v1: cache-first untuk /_next/static/ dengan
// caches.match(request, { ignoreSearch: true }). Di mode dev Turbopack versi
// chunk dibedakan lewat query URL, sehingga ignoreSearch membuat SW menyajikan
// chunk LAMA walaupun server sudah menghasilkan grafik modul baru — modul
// lama dirujuk tapi pabriknya sudah tidak ada → overlay error pada setiap
// reload normal (hanya Ctrl+Shift+R sembuh karena mem-bypass service worker).
//
// Prinsip baru (v2):
//   1. SEMUA permintaan network-first — saat online tidak pernah ada respons
//      basi, termasuk chunk /_next/static.
//   2. Cache hanya cadangan offline (fallback saat network gagal).
//   3. Tidak ada ignoreSearch — URL harus cocok persis.
//   4. skipWaiting + clients.claim; activate menghapus semua cache versi lama
//      (cache beracun v1 otomatis bersih di browser yang sudah terpasang).
const VERSION = "v2";
const STATIC_CACHE = `lumina-static-${VERSION}`;
const NAV_CACHE = `lumina-nav-${VERSION}`;
const KEEP = new Set([STATIC_CACHE, NAV_CACHE]);

// Batas entri cache (FIFO ringan) supaya tidak tumbuh tanpa batas di mode dev.
const NAV_CACHE_MAX = 5;
const STATIC_CACHE_MAX = 80;

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
      // Bersihkan SEMUA cache dari versi service worker sebelumnya
      // (termasuk cache beracun v1 berisi chunk basi).
      const names = await caches.keys();
      await Promise.all(
        names.map((name) => (KEEP.has(name) ? null : caches.delete(name))),
      );
      await self.clients.claim();
    })(),
  );
});

/** Potong cache FIFO bila melebihi batas. */
async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    for (let i = 0; i < keys.length - max; i++) {
      await cache.delete(keys[i]).catch(() => {});
    }
  } catch {
    // pemangkasan gagal — biarkan, tidak fatal.
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Selain GET tidak pernah disentuh.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1) Navigasi halaman: SELALU network; simpan clone HTML sukses untuk
  //    fallback offline; gagal total -> halaman tersimpan terakhir / layar offline.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response && response.ok && response.type === "basic") {
            const cache = await caches.open(NAV_CACHE);
            await cache.put(request, response.clone()).catch(() => {});
            await trimCache(NAV_CACHE, NAV_CACHE_MAX);
          }
          return response;
        } catch {
          const cache = await caches.open(NAV_CACHE);
          const offline = await cache.match(request);
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

  // 2) Aset & data lain (chunk JS, ikon, manifest, RSC, kecuali /api/*):
  //    network-first — jawaban sukses ikut disimpan sebagai cadangan offline.
  //    /api/* tidak pernah di-cache supaya data tidak basi.
  const isApi = url.pathname.startsWith("/api/");
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (!isApi && response && response.ok && response.type === "basic") {
          const cache = await caches.open(STATIC_CACHE);
          cache.put(request, response.clone()).catch(() => {});
          await trimCache(STATIC_CACHE, STATIC_CACHE_MAX);
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })(),
  );
});
