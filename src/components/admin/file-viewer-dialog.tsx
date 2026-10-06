// NR-36 — Pratinjau berkas pelamar langsung di aplikasi (tanpa unduh dulu).
// Dipakai dialog detail admin: CV, audio/video intro, dokumen wajib tambahan,
// jawaban file Form Builder, dokumen onboarding/internal, dan berkas assessment.
//
// Sumber data: GET /api/files/{id}?inline=1 — param ?inline=1 membuat route
// mengirim Content-Disposition: inline sehingga PDF/gambar bisa dirender iframe
// browser. Akses tetap dijaga sesi admin di route itu sendiri.
//
// Format yang didukung viewer: PDF & teks (iframe), gambar (img), audio
// (player), video (player). Format lain (mis. .docx) memakai kotak fallback
// dengan tombol Unduh — browser tidak bisa merendernya.
//
// NR-37 — deteksi FORMAT-FIRST dari nama berkas: ekstensi yang dikenali (.pdf,
// .jpg, .mp4, dst.) langsung dirender TANPA probe HEAD sama sekali. Versi lama
// selalu probe HEAD lebih dulu — bila request itu datang tanpa cookie sesi
// (quirk proxy/edge), route menjawab 401 application/json dan viewer menuduh
// "format tidak didukung" padahal filenya PDF biasa. Kini probe HEAD hanya
// dipakai untuk ekstensi yang TIDAK dikenali, dan hasilnya hanya dipercaya
// bila HTTP 200 + content-type bukan JSON/HTML (bukan pesan error).
"use client";

import { useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Jenis pratinjau yang mampu dirender browser. */
type AdminPreviewKind = "pdf" | "image" | "audio" | "video" | "text" | "unsupported";

function kindFromMime(mime: string): AdminPreviewKind {
  const type = (mime || "").toLowerCase();
  if (type === "application/pdf" || type.includes("pdf")) return "pdf";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("text/")) return "text";
  return "unsupported";
}

/**
 * Sumber utama deteksi format: ekstensi nama berkas (NR-37).
 * Selalu tersedia di semua pemanggil (filename wajib dioper saat merender baris berkas).
 */
function kindFromName(name: string): AdminPreviewKind {
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif|bmp|svg)$/.test(lower)) return "image";
  if (/\.(mp3|wav|m4a|ogg|aac)$/.test(lower)) return "audio";
  if (/\.(mp4|webm|mov|m4v)$/.test(lower)) return "video";
  if (/\.(txt|md|csv)$/.test(lower)) return "text";
  return "unsupported";
}

/** Tombol "Lihat" + dialog pratinjau dalam satu paket — tinggal ditempel di baris berkas. */
export function AdminFileViewButton({
  fileId,
  filename,
  mimeType,
  className,
}: {
  fileId: string;
  filename?: string | null;
  /** MIME bila sudah diketahui pemanggil — melewati deteksi HEAD. */
  mimeType?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Lihat ${filename || "berkas"} di aplikasi`}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
          className,
        )}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        Lihat
      </button>
      <AdminFileViewerDialog
        open={open}
        onOpenChange={setOpen}
        fileId={fileId}
        filename={filename}
        mimeType={mimeType}
      />
    </>
  );
}

/**
 * Dialog pratinjau berkas admin.
 *
 * NR-37 — deteksi format dua lapis:
 * 1. Ekstensi nama berkas dikenali → render langsung TANPA request jaringan
 *    (lebih cepat + kebal terhadap probe yang datang tanpa cookie sesi).
 * 2. Ekstensi tidak dikenali (mis. label tanpa ekstensi) → probe HEAD ke
 *    /api/files/{id} (hemat bandwidth — tidak mengunduh isi). MIME hasil probe
 *    hanya dipercaya bila HTTP 200 dan content-type bukan JSON/HTML — respons
 *    error (401/404/500) tidak boleh dianggap sebagai tipe berkas.
 * 3. Pemanggil yang sudah tahu MIME-nya bisa mengoper `mimeType` — melewati semua.
 */
export function AdminFileViewerDialog({
  open,
  onOpenChange,
  fileId,
  filename,
  mimeType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileId: string;
  filename?: string | null;
  /** MIME bila sudah diketahui pemanggil — melewati semua deteksi. */
  mimeType?: string | null;
}) {
  // Lapis 1 — format dari ekstensi nama berkas (murni sinkron, tanpa network).
  const kindFromFilename = kindFromName(filename ?? "");

  // Lapis 2 — hasil probe HEAD untuk nama tanpa ekstensi yang dikenali.
  // null = probe selesai tetapi tidak menghasilkan tipe yang layak dirender.
  const [probedKindByKey, setProbedKindByKey] = useState<Record<string, AdminPreviewKind | null>>({});

  const probeNeeded =
    open &&
    !mimeType &&
    kindFromFilename === "unsupported" &&
    probedKindByKey[fileId] === undefined;

  useEffect(() => {
    if (!probeNeeded || !fileId) return;
    let cancelled = false;
    fetch(`/api/files/${encodeURIComponent(fileId)}?inline=1`, {
      method: "HEAD",
      credentials: "same-origin",
    })
      .then((res) => {
        if (cancelled) return;
        const ct = (res.headers.get("content-type") ?? "").toLowerCase();
        // Hanya percaya MIME dari respons sukses (200) yang bukan payload error.
        const sane = res.ok && ct !== "" && !ct.includes("json") && !ct.includes("html");
        setProbedKindByKey((prev) => ({
          ...prev,
          [fileId]: sane ? kindFromMime(ct) : null,
        }));
      })
      .catch(() => {
        if (!cancelled) setProbedKindByKey((prev) => ({ ...prev, [fileId]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [fileId, probeNeeded]);

  const kind: AdminPreviewKind = mimeType
    ? kindFromMime(mimeType)
    : kindFromFilename !== "unsupported"
      ? kindFromFilename
      : (probedKindByKey[fileId] ?? "unsupported");
  const detecting = probeNeeded;
  const inlineUrl = `/api/files/${encodeURIComponent(fileId)}?inline=1`;
  const downloadUrl = `/api/files/${encodeURIComponent(fileId)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 overflow-hidden rounded-2xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Pratinjau Berkas
          </DialogTitle>
          <DialogDescription className="truncate">
            {filename || "Berkas pelamar"}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto nice-scrollbar">
          {detecting ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Memuat pratinjau...
            </p>
          ) : kind === "pdf" || kind === "text" ? (
            <iframe
              key={fileId}
              src={inlineUrl}
              title={`${filename ?? "Berkas"} — Pratinjau`}
              className="h-[65vh] w-full rounded-lg border bg-background"
            />
          ) : kind === "image" ? (
            <img
              key={fileId}
              src={inlineUrl}
              alt={filename ?? "Berkas pelamar"}
              className="mx-auto max-h-[65vh] w-auto max-w-full rounded-lg object-contain"
            />
          ) : kind === "audio" ? (
            <audio key={fileId} controls src={inlineUrl} className="w-full" />
          ) : kind === "video" ? (
            <video
              key={fileId}
              controls
              src={inlineUrl}
              className="mx-auto max-h-[65vh] w-full rounded-lg"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="max-w-sm text-sm text-muted-foreground">
                Format berkas ini tidak dapat ditampilkan langsung di browser. Unduh
                untuk melihat isinya.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" className="h-11 gap-2 sm:h-9" asChild>
            <a href={downloadUrl} target="_blank" rel="noopener noreferrer">
              <Download className="h-4 w-4" aria-hidden="true" />
              Unduh
            </a>
          </Button>
          <Button variant="ghost" className="h-11 sm:h-9" onClick={() => onOpenChange(false)}>
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
