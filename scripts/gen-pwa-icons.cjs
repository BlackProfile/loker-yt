/* eslint-disable @typescript-eslint/no-require-imports -- skrip build standalone, bukan bagian bundle app */
// NR-41 J23 — generator ikon PWA (rasterisasi SVG -> PNG memakai sharp).
// Jalankan sekali: `node scripts/gen-pwa-icons.cjs` (atau `bun scripts/gen-pwa-icons.cjs`).
// Output di public/icons/:
//   icon.svg                 — sumber SVG (persegi rose-600, huruf "L" putih tebal)
//   icon-192.png             — any 192x192
//   icon-512.png             — any 512x512
//   icon-512-maskable.png    — maskable 512x512 (konten menyusut ke zona aman ~80%)
//   apple-touch-icon.png     — 180x180 (iOS home screen)
// Tanpa gradien — latar polos #e11d48 dan bentuk "L" dari dua persegi panjang
// (bukan teks) agar render tidak bergantung font sistem.
"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const OUT_DIR = path.join(__dirname, "..", "public", "icons");
const ROSE = "#e11d48"; // rose-600
const WHITE = "#ffffff";

// Huruf "L" blok (dua persegi panjang) di kanvas 512 — bounding box
// x 150..350, y 104..392 sehingga massa huruf nyaris tepat di tengah.
const L_PATH_SVG = [
  `<rect x="150" y="104" width="72" height="288" fill="${WHITE}"/>`,
  `<rect x="150" y="320" width="200" height="72" fill="${WHITE}"/>`,
].join("");

// Ikon any (bulat penuh oleh OS di luar — isi seluruh kanvas).
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${ROSE}"/>
  ${L_PATH_SVG}
</svg>`;

// Ikon maskable: latar penuh + konten diskalakan ke 80% di tengah
// (zona aman maskable — tepi ikon aman dipotong mask berbentuk apa pun).
const MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="${ROSE}"/>
  <g transform="translate(256 256) scale(0.8) translate(-256 -256)">
    ${L_PATH_SVG}
  </g>
</svg>`;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "icon.svg"), ICON_SVG.trim() + "\n", "utf8");

  const iconBuf = Buffer.from(ICON_SVG);
  const maskableBuf = Buffer.from(MASKABLE_SVG);

  const jobs = [
    { file: "icon-192.png", input: iconBuf, size: 192 },
    { file: "icon-512.png", input: iconBuf, size: 512 },
    { file: "icon-512-maskable.png", input: maskableBuf, size: 512 },
    { file: "apple-touch-icon.png", input: iconBuf, size: 180 },
  ];

  for (const job of jobs) {
    await sharp(job.input)
      .resize(job.size, job.size, { fit: "cover" })
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, job.file));
    console.log(`[gen-pwa-icons] ${job.file} (${job.size}x${job.size}) ditulis.`);
  }
  console.log("[gen-pwa-icons] Selesai.");
}

main().catch((error) => {
  console.error("[gen-pwa-icons] Gagal:", error);
  process.exit(1);
});
