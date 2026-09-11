import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lumina Studio — Rekrutmen Tim Kreatif",
  description:
    "Halaman rekrutmen resmi Lumina Studio. Bergabunglah dengan tim kreatif konten digital: video editor, desainer thumbnail, penulis naskah, dan lainnya. Remote dan fleksibel.",
  keywords: ["rekrutmen", "lowongan kerja", "konten kreator", "tim kreatif", "video editor", "remote"],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Rekrutmen Tim Kreatif — Lumina Studio",
    description: "Bergabung dengan tim kreatif konten digital. Remote, fleksibel, penuh peluang bertumbuh.",
    siteName: "Lumina Studio",
    type: "website",
  },
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
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
