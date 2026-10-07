import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

// NR42-HMRSW — script inline tahan-gagal modul (dijalankan SEBELUM bundle Next
// dievaluasi, sehingga tetap hidup walau modul halaman gagal dimuat).
// Tugas: (1) daftarkan /sw.js — SW v2 network-first; (2) reload otomatis SATU
// kali saat SW baru mengambil kendali (menyembuhkan tab berisi chunk basi);
// (3) pemulihan otomatis error HMR Turbopack "module factory is not
// available" dengan guard anti-loop (maks 2x per 30 detik, cache-bust URL).
const RECOVERY_SCRIPT = `(function(){
  try {
    var hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    try { sessionStorage.removeItem("lumina-sw-cc"); } catch (e) {}
    if ("serviceWorker" in navigator) {
      var swRegister = function () {
        navigator.serviceWorker.register("/sw.js").catch(function () {});
      };
      if (document.readyState === "complete") swRegister();
      else window.addEventListener("load", swRegister, { once: true });
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        try {
          if (!hadController) return;
          if (sessionStorage.getItem("lumina-sw-cc")) return;
          sessionStorage.setItem("lumina-sw-cc", "1");
          window.location.reload();
        } catch (e) {}
      });
    }
    var KEY = "lumina_hmr_recovery_v1";
    var BAD = "module factory is not available";
    var readState = function () {
      try { return JSON.parse(sessionStorage.getItem(KEY) || "null") || { n: 0, t: 0 }; }
      catch (e) { return { n: 0, t: 0 }; }
    };
    var recover = function (msg) {
      try {
        if (typeof msg !== "string" || msg.indexOf(BAD) === -1) return;
        var now = Date.now();
        var s = readState();
        if (now - s.t > 30000) s = { n: 0, t: now };
        if (s.n >= 2) return;
        s.n += 1; s.t = now;
        sessionStorage.setItem(KEY, JSON.stringify(s));
        var p = new URLSearchParams(window.location.search);
        p.delete("lumina_recover");
        p.set("lumina_recover", String(now));
        window.location.replace(window.location.pathname + "?" + p.toString() + window.location.hash);
      } catch (e) {}
    };
    window.addEventListener("error", function (e) {
      recover((e && (e.message || (e.error && e.error.message))) || "");
    }, true);
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      recover((r && (r.message || String(r))) || "");
    });
  } catch (e) {}
})();`;

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// NR-41 J24 — metadataBase supaya URL kanonik & OpenGraph relatif ter-resolve.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Lumina Studio — Rekrutmen Tim Kreatif",
  description:
    "Halaman rekrutmen resmi Lumina Studio. Bergabunglah dengan tim kreatif konten digital: video editor, desainer thumbnail, penulis naskah, dan lainnya. Remote, on-site, dan hybrid — fleksibel.",
  keywords: ["rekrutmen", "lowongan kerja", "konten kreator", "tim kreatif", "video editor", "remote", "on-site", "hybrid"],
  icons: {
    icon: "/logo.svg",
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Lumina",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "Rekrutmen Tim Kreatif — Lumina Studio",
    description: "Bergabung dengan tim kreatif konten digital. Remote, on-site, dan hybrid — fleksibel, penuh peluang bertumbuh.",
    siteName: "Lumina Studio",
    type: "website",
  },
};

// NR-41 J23 — warna tema PWA (bilah browser Android / iOS Safari).
export const viewport: Viewport = {
  themeColor: "#e11d48",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {/* NR42-HMRSW — registrasi SW + pemulihan otomatis HMR, tahan-gagal modul. */}
        <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
