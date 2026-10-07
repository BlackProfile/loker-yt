"use client";

import { useEffect } from "react";

// NR-41 J23 — pendaftar Service Worker PWA.
// Dirender dari layout root; hanya berjalan di browser, sekali per sesi halaman.
// Pendaftaran ditunda sampai window "load" agar tidak bersaing dengan hydration
// & prefetch navigasi pertama; kegagalan didiamkan (PWA tidak boleh mengganggu).

let registered = false;

export function PwaRegister() {
  useEffect(() => {
    if (registered) return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    registered = true;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Pendaftaran gagal (mis. konteks tidak aman) — diamkan saja.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
