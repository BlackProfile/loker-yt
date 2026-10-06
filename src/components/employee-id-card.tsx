"use client";

// NR39-B — Kartu ID digital karyawan (komponen PRESENTASIONAL).
// Dipakai bersama oleh panel admin (dialog kelola kartu, cetak massal) dan
// halaman pelamar (kontrak ekspor dipakai agen lain — jangan diubah).
//
// Aturan desain: warna FIX (bukan token tema) agar hasil ekspor PNG / cetak
// selalu terang konsisten meski halaman berada di dark mode. Tanpa biru/indigo,
// tanpa emoji. Rasio kartu ID standar 85,6 x 54 mm (aspect-[856/540]).
//
// SKALA: akar kartu memakai `@container` (container query) dan SELURUH ukuran
// tipografi/spacing di dalamnya memakai satuan `cqw` — kartu tampil identik
// pada lebar berapa pun (dialog sempit, pratinjau admin, cetak 85,6 mm).
// Tanpa ini, teks px tetap akan overflow & terpotong saat kartu kecil.
// Catatan: satuan cqw HANYA dipakai pada elemen DI DALAM akar @container
// (elemen tidak bisa meng-query dirinya sendiri).

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2, QrCode } from "lucide-react";
import {
  EMPLOYEE_CARD_STATUS_LABELS,
  type EmployeeCardStatus,
} from "@/lib/types";
import { cn } from "@/lib/utils";

export type EmployeeIdCardProps = {
  cardNumber: string;
  name: string;
  positionTitle: string | null;
  status: EmployeeCardStatus; // dari @/lib/types
  issuedAt: string; // ISO
  probationUntil: string | null;
  nikMasked: string | null;
  verifyUrl: string; // URL lengkap untuk QR (TIDAK dicetak sebagai teks)
  siteName?: string; // default "Lumina Studio"
  contactLine?: string | null; // mis. "admin@lumina.id · 62xxxxxxxxxx"
  withIds?: boolean; // pasang id="ecard-front"/"ecard-back" untuk html-to-image
};

/* --------------------------------- Helper kecil --------------------------------- */

// Format tanggal lokal id-ID ("5 Okt 2026"). Implementasi sendiri agar file ini
// netral (tidak mengimpor components/admin yang hanya untuk panel admin).
const cardDateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatCardDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return cardDateFmt.format(d);
}

// Warna badge status FIX (terang di tema apa pun): amber utk masa percobaan,
// emerald utk aktif, rose utk dicabut/dinonaktifkan, zinc utk lainnya.
const STATUS_BADGE_FIX: Record<EmployeeCardStatus, string> = {
  PENDING: "border-amber-300 bg-amber-100 text-amber-900",
  PROBATION: "border-amber-500 bg-amber-500 text-zinc-950",
  ACTIVE: "border-emerald-600 bg-emerald-600 text-white",
  LEAVE: "border-zinc-300 bg-zinc-200 text-zinc-700",
  SUSPENDED: "border-rose-300 bg-rose-100 text-rose-900",
  REVOKED: "border-rose-600 bg-rose-600 text-white",
};

/* ------------------------------------ SISI DEPAN ------------------------------------ */

export function EmployeeIdCardFront(props: EmployeeIdCardProps) {
  const {
    cardNumber,
    name,
    positionTitle,
    status,
    issuedAt,
    probationUntil,
    nikMasked,
    siteName = "Lumina Studio",
    withIds = false,
  } = props;
  const initial = (name.trim().charAt(0) || "?").toUpperCase();

  return (
    <div
      id={withIds ? "ecard-front" : undefined}
      className="@container flex aspect-[856/540] w-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm"
    >
      {/* Bar aksen atas: nama situs + jenis kartu */}
      <div className="flex items-center justify-between gap-[2cqw] bg-rose-600 px-[4cqw] py-[2.2cqw] text-white">
        <span className="text-[2.9cqw] font-bold uppercase leading-tight tracking-[0.18em]">
          {siteName}
        </span>
        <span className="shrink-0 text-[2.6cqw] font-semibold tracking-[0.22em]">
          KARTU KARYAWAN
        </span>
      </div>

      {/* Identitas — vertikal di tengah agar seimbang pada lebar berapa pun */}
      <div className="flex min-h-0 flex-1 items-center gap-[3.2cqw] px-[4.2cqw] py-[3cqw]">
        <span
          aria-hidden="true"
          className="flex size-[15cqw] shrink-0 items-center justify-center rounded-full bg-rose-100 text-[5.5cqw] font-bold text-rose-600"
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="break-words text-[5.8cqw] font-bold leading-[1.15]">{name}</p>
          <p className="mt-[0.8cqw] break-words text-[3.4cqw] leading-snug text-zinc-600">
            {positionTitle ?? "Karyawan"}
          </p>
          <div className="mt-[1.6cqw] flex flex-wrap items-center gap-x-[2cqw] gap-y-[1cqw]">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-[2.2cqw] py-[0.7cqw] text-[2.5cqw] font-bold uppercase tracking-wide",
                STATUS_BADGE_FIX[status]
              )}
            >
              {EMPLOYEE_CARD_STATUS_LABELS[status]}
            </span>
            {probationUntil ? (
              <span className="text-[2.5cqw] leading-snug text-zinc-500">
                Masa percobaan s.d. {formatCardDate(probationUntil)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {/* Baris data bawah */}
      <div className="grid grid-cols-3 gap-[2cqw] border-t border-zinc-200 bg-zinc-50 px-[4.2cqw] py-[2.4cqw]">
        <div className="min-w-0">
          <p className="text-[2.2cqw] font-semibold uppercase tracking-wide text-zinc-500">
            Bergabung
          </p>
          <p className="mt-[0.3cqw] truncate text-[2.9cqw] font-semibold">
            {formatCardDate(issuedAt)}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[2.2cqw] font-semibold uppercase tracking-wide text-zinc-500">
            NIK
          </p>
          <p className="mt-[0.3cqw] truncate font-mono text-[2.8cqw] font-semibold">
            {nikMasked ?? "NIK belum diisi"}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[2.2cqw] font-semibold uppercase tracking-wide text-zinc-500">
            No. Kartu
          </p>
          <p className="mt-[0.3cqw] truncate font-mono text-[2.8cqw] font-bold">
            {cardNumber}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------- SISI BELAKANG ----------------------------------- */

type QrResult = { url: string; dataUrl: string | null; error: boolean };

function QrPlaceholder({ message }: { message: string }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-[1cqw] text-zinc-400">
      <QrCode className="size-[6cqw]" aria-hidden="true" />
      <p className="px-[1cqw] text-center text-[2.4cqw] leading-snug">{message}</p>
    </div>
  );
}

export function EmployeeIdCardBack(props: EmployeeIdCardProps) {
  const {
    cardNumber,
    name,
    verifyUrl,
    siteName = "Lumina Studio",
    contactLine,
    withIds = false,
  } = props;

  // Hasil QR disimpan per URL; "loading" diturunkan (bukan state) sehingga
  // effect tidak memanggil setState secara sinkron.
  const [qr, setQr] = useState<QrResult | null>(null);

  // QR dibuat dari verifyUrl via qrcode.toDataURL — setState hanya di callback
  // async (bukan sinkron di body effect) agar aman terhadap StrictMode.
  // Lebar 512 px agar QR tetap tajam pada ekspor PNG pixelRatio tinggi.
  useEffect(() => {
    if (!verifyUrl) return;
    let cancelled = false;
    QRCode.toDataURL(verifyUrl, { width: 512, margin: 1 })
      .then((dataUrl) => {
        if (cancelled) return;
        setQr({ url: verifyUrl, dataUrl, error: false });
      })
      .catch(() => {
        if (!cancelled) setQr({ url: verifyUrl, dataUrl: null, error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [verifyUrl]);

  // Keadaan tampilan QR diturunkan dari prop + hasil generate terakhir.
  const qrView = (() => {
    if (!verifyUrl) return { kind: "empty" as const };
    if (!qr || qr.url !== verifyUrl) return { kind: "loading" as const };
    if (qr.error || !qr.dataUrl) return { kind: "error" as const };
    return { kind: "ready" as const, dataUrl: qr.dataUrl };
  })();

  return (
    <div
      id={withIds ? "ecard-back" : undefined}
      className="@container flex aspect-[856/540] w-full overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-sm"
    >
      {/* Kolom QR — URL lengkap TIDAK dicetak sebagai teks (URL pratinjau
          panjang merusak tata letak); fallback manual memakai No. Kartu yang
          memang diterima halaman verifikasi publik. */}
      <div className="flex w-[42%] shrink-0 flex-col items-center justify-center gap-[1.6cqw] border-r border-zinc-200 bg-zinc-50 p-[3cqw]">
        <div className="flex aspect-square w-[30cqw] items-center justify-center rounded-[2.5cqw] border-2 border-zinc-300 bg-white p-[1.2cqw]">
          {qrView.kind === "loading" ? (
            <Loader2 className="size-[6cqw] animate-spin text-zinc-400" aria-hidden="true" />
          ) : qrView.kind === "ready" ? (
            <img
              src={qrView.dataUrl}
              alt={`QR verifikasi keaslian kartu ${name}`}
              className="size-full"
              width={512}
              height={512}
            />
          ) : qrView.kind === "error" ? (
            <QrPlaceholder message="QR gagal dibuat. Coba muat ulang." />
          ) : (
            <QrPlaceholder message="QR tidak tersedia untuk kartu ini." />
          )}
        </div>
        <p className="text-center text-[2.5cqw] font-semibold leading-snug text-zinc-700">
          Pindai untuk verifikasi keaslian
        </p>
        <p className="text-center text-[2.3cqw] leading-snug text-zinc-500">
          atau ketik No. Kartu di halaman verifikasi
        </p>
        <p className="font-mono text-[2.7cqw] font-bold tracking-wide text-zinc-800">
          {cardNumber}
        </p>
      </div>

      {/* Kolom informasi */}
      <div className="flex min-w-0 flex-1 flex-col gap-[2.2cqw] p-[3.6cqw]">
        <div>
          <p className="text-[3.6cqw] font-bold leading-tight">{siteName}</p>
          {contactLine ? (
            <p className="mt-[0.6cqw] break-words text-[2.5cqw] leading-snug text-zinc-600">
              {contactLine}
            </p>
          ) : null}
        </div>

        <div className="rounded-[2.2cqw] border border-rose-200 bg-rose-50 p-[2.2cqw]">
          <p className="break-words text-[2.6cqw] font-bold leading-snug text-rose-800">
            Kartu ini milik {name} — tidak dapat dipindahtangankan
          </p>
          <ul className="mt-[1.2cqw] list-disc space-y-[0.7cqw] pl-[3cqw] text-[2.3cqw] leading-snug text-zinc-600">
            <li>Tunjukkan kartu ini sebagai identitas karyawan {siteName}.</li>
            <li>
              Keaslian kartu diverifikasi dengan memindai QR atau memasukkan nomor
              kartu di halaman verifikasi resmi.
            </li>
            <li>Bila kartu hilang atau ditemukan, laporkan kepada {siteName}.</li>
          </ul>
        </div>

        <p className="mt-auto text-[2cqw] uppercase tracking-[0.2em] text-zinc-400">
          {siteName} · Kartu Karyawan Digital
        </p>
      </div>
    </div>
  );
}

/* ------------------------- Gabungan depan + belakang ------------------------- */

/** Grid depan + belakang berdampingan (stack di mobile). */
export function EmployeeIdCard(props: EmployeeIdCardProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <EmployeeIdCardFront {...props} />
      <EmployeeIdCardBack {...props} />
    </div>
  );
}
