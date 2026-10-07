import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { PwaRegister } from "@/components/landing/pwa-register";

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
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
        {/* NR-41 J23 — daftarkan service worker /sw.js (client-only, sekali). */}
        <PwaRegister />
      </body>
    </html>
  );
}
