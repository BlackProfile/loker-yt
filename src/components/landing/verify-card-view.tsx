"use client";

/**
 * Halaman verifikasi kartu karyawan — PUBLIK (tanpa login).
 * Dipakai siapa pun (security gedung, klien, dsb.) untuk memeriksa keaslian
 * kartu ID digital karyawan: lewat QR (#verifikasi?t=token) atau ketik nomor.
 * Hanya menampilkan nama, posisi, nomor kartu & status — TANPA data pribadi
 * (NIK, kontak, gaji tidak pernah dikirim server pada endpoint publik ini).
 */

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  AlertCircle,
  Loader2,
  Lock,
  ScanLine,
  SearchX,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { EMPLOYEE_CARD_STATUS_LABELS, type VerifyCardResponse } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FALLBACK_SITE_NAME = "Lumina Studio";

// Formatter tanggal Indonesia — dibuat sekali di level modul.
const dateFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : dateFmt.format(d);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : dateTimeFmt.format(d);
}

/** Keadaan hasil verifikasi yang ditampilkan di layar. */
type VerifyOutcome =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "result"; res: VerifyCardResponse };

/**
 * Panggil endpoint verifikasi publik (halaman publik — fetch biasa + try/catch).
 * Mengembalikan outcome siap-render; TIDAK menyentuh state React.
 */
async function requestVerify(params: { token?: string; nomor?: string }): Promise<VerifyOutcome> {
  const qs = params.token
    ? `t=${encodeURIComponent(params.token)}`
    : `nomor=${encodeURIComponent((params.nomor ?? "").trim())}`;
  try {
    const res = await fetch(`/api/public/verify-card?${qs}`, { cache: "no-store" });
    const data = (await res.json().catch(() => null)) as VerifyCardResponse | null;
    if (!res.ok || !data) {
      return {
        kind: "error",
        message: "Gagal memeriksa kartu. Periksa koneksi internet, lalu coba lagi.",
      };
    }
    return { kind: "result", res: data };
  } catch {
    return {
      kind: "error",
      message: "Gagal terhubung ke server. Periksa koneksi internet, lalu coba lagi.",
    };
  }
}

export function VerifyCardView({ initialToken }: { initialToken: string | null }) {
  const [siteName, setSiteName] = useState(FALLBACK_SITE_NAME);
  const [nomor, setNomor] = useState("");
  // Jalur QR: mulai dalam keadaan loading agar hasil tidak "berkedip" kosong.
  const [outcome, setOutcome] = useState<VerifyOutcome>(() =>
    initialToken ? { kind: "loading" } : { kind: "idle" }
  );
  const autoVerifyRef = useRef(false);
  // Komponen ini hanya ter-mount via hash routing di klien — aman dari mismatch SSR.
  const year = new Date().getFullYear();

  // Nama studio untuk header/footer — fetch sekali; gagal -> fallback tetap rapi.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/public/content", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) as
          | { site?: { siteName?: string } }
          | null;
        const name = data?.site?.siteName?.trim();
        if (alive && name) setSiteName(name);
      } catch {
        // Biarkan fallback.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Jalur QR: verifikasi otomatis SEKALI saat halaman dibuka dengan #verifikasi?t=...
  // (keadaan loading sudah disiapkan dari initial state — tidak ada setState sinkron).
  useEffect(() => {
    if (autoVerifyRef.current || !initialToken) return;
    autoVerifyRef.current = true;
    let alive = true;
    (async () => {
      const result = await requestVerify({ token: initialToken });
      if (alive) setOutcome(result);
    })();
    return () => {
      alive = false;
    };
  }, [initialToken]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (outcome.kind === "loading") return;
    const clean = nomor.trim().toUpperCase();
    if (!clean) return;
    setOutcome({ kind: "loading" });
    void (async () => {
      const result = await requestVerify({ nomor: clean });
      setOutcome(result);
    })();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header ringkas — identitas studio + penanda halaman resmi */}
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <span className="text-sm font-black tracking-tight sm:text-base">{siteName}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Verifikasi resmi
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {/* Intro */}
        <div className="text-center">
          <span className="inline-flex size-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            <ScanLine className="size-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-black tracking-tight sm:text-3xl">
            Verifikasi Kartu Karyawan
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Masukkan nomor kartu di bawah untuk memastikan kartu terbitan {siteName} sah
            dan aktif. Hasil tampil langsung, tanpa perlu masuk ke akun mana pun.
          </p>
        </div>

        {/* Form manual — selalu tersedia, termasuk setelah verifikasi QR */}
        <form
          onSubmit={onSubmit}
          className="mt-8 rounded-2xl border bg-card p-4 shadow-sm sm:p-6"
        >
          <label htmlFor="verify-card-number" className="sr-only">
            Nomor kartu karyawan
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              id="verify-card-number"
              name="nomor"
              value={nomor}
              onChange={(e) => setNomor(e.target.value.toUpperCase())}
              placeholder="LUM-EMP-0001"
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby="verify-card-help"
              className="min-h-11 flex-1 font-mono uppercase placeholder:normal-case"
            />
            <Button type="submit" className="min-h-11 sm:w-auto" disabled={outcome.kind === "loading"}>
              {outcome.kind === "loading" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              {outcome.kind === "loading" ? "Memeriksa..." : "Verifikasi Kartu"}
            </Button>
          </div>
          <p id="verify-card-help" className="mt-2 text-xs text-muted-foreground">
            Nomor kartu tercetak di sisi depan kartu, contoh: LUM-EMP-0001.
          </p>
        </form>

        {/* Hasil — diumumkan ke pembaca layar */}
        <div aria-live="polite" role="status" className="mt-6">
          {outcome.kind === "loading" ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border bg-card px-6 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Memeriksa kartu...
            </div>
          ) : outcome.kind === "error" ? (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-5 dark:border-rose-500/30 dark:bg-rose-500/5">
              <AlertCircle className="mt-0.5 size-5 shrink-0 text-rose-500" aria-hidden="true" />
              <p className="text-sm font-medium text-rose-800 dark:text-rose-300">
                {outcome.message}
              </p>
            </div>
          ) : outcome.kind === "result" ? (
            <VerifyResult res={outcome.res} />
          ) : null}
        </div>

        {/* Panel privasi — selalu tampil di bawah hasil */}
        <div className="mt-6 flex items-start gap-3 rounded-2xl border bg-muted/40 p-4">
          <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Verifikasi hanya menampilkan nama, posisi, dan status kartu. Data pribadi
            (NIK, kontak, gaji) tidak pernah ditampilkan.
          </p>
        </div>
      </main>

      {/* Footer sticky — wrapper min-h-screen flex-col + footer mt-auto */}
      <footer className="mt-auto border-t py-6">
        <p className="text-center text-xs text-muted-foreground">
          {siteName} — verifikasi kartu karyawan · {year}
        </p>
      </footer>
    </div>
  );
}

/** Kartu besar hasil verifikasi: VALID / TIDAK BERLAKU / TIDAK DITEMUKAN. */
function VerifyResult({ res }: { res: VerifyCardResponse }) {
  const card = res.card;

  // Tidak ditemukan (nomor salah) atau token QR rusak/palsu.
  if (!res.found && (!card || res.reason !== "TIDAK_AKTIF")) {
    return (
      <div className="rounded-3xl border bg-card p-8 text-center shadow-sm">
        <span className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          <SearchX className="size-9" aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-xl font-black tracking-[0.14em] text-zinc-800 sm:text-2xl dark:text-zinc-200">
          KARTU TIDAK DITEMUKAN
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Periksa nomor kartu atau minta kartu asli. Tautan QR yang rusak juga
          menghasilkan pesan ini.
        </p>
        <p className="mt-4 text-xs text-muted-foreground">
          Diverifikasi {formatDateTime(res.verifiedAt)}
        </p>
      </div>
    );
  }

  // Kartu ada tetapi tidak aktif (PENDING/SUSPENDED/REVOKED/LEAVE).
  if (!res.found && card) {
    return (
      <div className="overflow-hidden rounded-3xl border border-rose-200 bg-rose-50/60 shadow-sm dark:border-rose-500/30 dark:bg-rose-500/5">
        <div className="flex flex-col items-center gap-3 px-6 pt-8 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
            <ShieldX className="size-9" aria-hidden="true" />
          </span>
          <h2 className="text-xl font-black tracking-[0.14em] text-rose-800 sm:text-2xl dark:text-rose-300">
            KARTU TIDAK BERLAKU
          </h2>
          <Badge
            variant="outline"
            className="border-rose-200 bg-background text-rose-700 dark:border-rose-500/30 dark:text-rose-300"
          >
            {EMPLOYEE_CARD_STATUS_LABELS[card.status]}
          </Badge>
        </div>
        <dl className="mt-6 grid gap-4 border-t border-rose-200/70 px-6 py-6 text-left sm:grid-cols-2 dark:border-rose-500/20">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nama
            </dt>
            <dd className="mt-1 text-base font-bold">{card.name}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nomor Kartu
            </dt>
            <dd className="mt-1 font-mono text-sm font-semibold tracking-wider">
              {card.cardNumber}
            </dd>
          </div>
        </dl>
        <div className="border-t border-rose-200/70 px-6 py-5 text-center dark:border-rose-500/20">
          <p className="text-sm text-muted-foreground">
            {card.status === "PENDING"
              ? "Kartu belum diaktifkan admin."
              : "Kartu dinonaktifkan atau dicabut."}{" "}
            Kartu ini tidak dapat dipakai sebagai bukti kepegawaian yang sah.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Diverifikasi {formatDateTime(res.verifiedAt)}
          </p>
        </div>
      </div>
    );
  }

  // Valid: ACTIVE (badge emerald) atau PROBATION (badge amber + batas waktu).
  if (!card) return null;
  const isProbation = card.status === "PROBATION";
  return (
    <div className="overflow-hidden rounded-3xl border border-emerald-200 bg-emerald-50/60 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/5">
      <div className="flex flex-col items-center gap-3 px-6 pt-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
          <ShieldCheck className="size-9" aria-hidden="true" />
        </span>
        <h2 className="text-xl font-black tracking-[0.14em] text-emerald-800 sm:text-2xl dark:text-emerald-300">
          KARTU VALID
        </h2>
        {isProbation ? (
          <Badge className="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300">
            Masa Percobaan
          </Badge>
        ) : (
          <Badge className="border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
            Aktif
          </Badge>
        )}
      </div>
      <dl className="mt-6 grid gap-4 border-t border-emerald-200/70 px-6 py-6 text-left sm:grid-cols-2 dark:border-emerald-500/20">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nama
          </dt>
          <dd className="mt-1 text-base font-bold">{card.name}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Posisi
          </dt>
          <dd className="mt-1 text-sm font-medium">{card.positionTitle ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Nomor Kartu
          </dt>
          <dd className="mt-1 font-mono text-sm font-semibold tracking-wider">
            {card.cardNumber}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Aktif sejak
          </dt>
          <dd className="mt-1 text-sm font-medium">{formatDate(card.issuedAt)}</dd>
        </div>
        {isProbation && card.probationUntil ? (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Masa percobaan berlaku s/d
            </dt>
            <dd className="mt-1 text-sm font-medium">{formatDate(card.probationUntil)}</dd>
          </div>
        ) : null}
      </dl>
      <p className="border-t border-emerald-200/70 px-6 py-3 text-center text-xs text-emerald-800/80 dark:border-emerald-500/20 dark:text-emerald-300/80">
        Diverifikasi {formatDateTime(res.verifiedAt)}
      </p>
    </div>
  );
}
