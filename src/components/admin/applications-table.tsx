"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye, MessageCircle, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Application } from "@/lib/types";
import { apiGet } from "./api";
import { formatDate, initialsOf } from "./format";
import { StatusBadge, AiScoreBadge } from "./status-badge";
import { RatingStars } from "./rating-stars";

// Baris template dari /api/admin/templates (dipakai untuk pesan WhatsApp).
type TemplateRow = {
  id: string;
  name: string;
  kind: string;
  body: string;
};

// Pesan default bila belum ada template OFFER di pustaka.
const WA_FALLBACK_TEMPLATE =
  "Halo {nama}, kami dari Lumina Studio terkait lamaran {posisi} kamu.";

/**
 * Normalisasi nomor WhatsApp ke format internasional tanpa "+" (basis 62):
 * strip non-digit; awalan "0" diganti "62"; awalan "8" diberi "62";
 * selain itu dibiarkan (mis. sudah 62... atau kode negara lain).
 */
function normalizeWaNumber(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

/** Isi variabel {nama} / {posisi} pada template; variabel lain dibiarkan. */
function fillWaTemplate(template: string, app: Application): string {
  return template
    .split("{nama}")
    .join(app.name)
    .split("{posisi}")
    .join(app.positionTitle ?? "posisi");
}

/** Badge "Duplikat" kecil (amber) untuk lamaran ganda. */
function DuplicateBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400"
      title="Lamaran ganda terdeteksi (email/CV sama)"
    >
      Duplikat
    </span>
  );
}

export function ApplicationsTable({
  applications,
  canMutate,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  compareIds,
  onToggleCompare,
  onOpenDetail,
  onDeleteRequest,
  onRate,
}: {
  applications: Application[];
  canMutate: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleSelectAll: (checked: boolean) => void;
  compareIds: string[];
  onToggleCompare: (app: Application) => void;
  onOpenDetail: (app: Application) => void;
  onDeleteRequest: (app: Application) => void;
  onRate: (app: Application, rating: number) => void;
}) {
  // Cache pesan WhatsApp (body template OFFER pertama) — dimuat sekali saat pertama dipakai.
  const waTemplateRef = useRef<string | null>(null);

  const allSelected =
    applications.length > 0 &&
    applications.every((a) => selectedIds.has(a.id));

  function tagsPreview(tags: string[]): string[] {
    return tags.slice(0, 2);
  }

  /** Muat (sekali, lalu cache) body template OFFER pertama dari pustaka template. */
  async function loadWaTemplate(): Promise<string> {
    if (waTemplateRef.current !== null) return waTemplateRef.current;
    try {
      const rows = await apiGet<TemplateRow[]>("/api/admin/templates");
      const firstOffer = rows.find((t) => t.kind === "OFFER");
      waTemplateRef.current = firstOffer?.body ?? "";
    } catch {
      waTemplateRef.current = "";
    }
    return waTemplateRef.current;
  }

  /** Buka WhatsApp dengan pesan dari template OFFER (variabel ringkas diisi). */
  async function handleWhatsApp(app: Application) {
    const normalized = normalizeWaNumber(app.phone ?? "");
    if (!normalized) {
      toast.error("Nomor WhatsApp pelamar tidak valid.");
      return;
    }
    const template = (await loadWaTemplate()) || WA_FALLBACK_TEMPLATE;
    const message = fillWaTemplate(template, app);
    const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      {/* Desktop: table */}
      <Card className="hidden gap-0 overflow-hidden rounded-2xl py-0 md:block">
        <Table className="min-w-[1020px]">
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead className="w-10 px-4 py-3">
                <Checkbox
                  checked={allSelected}
                  disabled={!canMutate}
                  onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
                  aria-label="Pilih semua pelamar"
                />
              </TableHead>
              <TableHead className="w-10 px-2 py-3 text-center text-xs">
                Bandingkan
              </TableHead>
              <TableHead className="px-4 py-3">Pelamar</TableHead>
              <TableHead className="px-4 py-3">Posisi</TableHead>
              <TableHead className="px-4 py-3">Sumber</TableHead>
              <TableHead className="px-4 py-3">Skor AI</TableHead>
              <TableHead className="px-4 py-3">Rating</TableHead>
              <TableHead className="px-4 py-3">Tags</TableHead>
              <TableHead className="px-4 py-3">Tanggal</TableHead>
              <TableHead className="px-4 py-3">Status</TableHead>
              <TableHead className="px-4 py-3 text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {applications.map((app) => {
              const isSelected = selectedIds.has(app.id);
              const isCompared = compareIds.includes(app.id);
              return (
                <TableRow key={app.id} data-state={isSelected ? "selected" : undefined}>
                  <TableCell className="px-4 py-3">
                    <Checkbox
                      checked={isSelected}
                      disabled={!canMutate}
                      onCheckedChange={(checked) =>
                        onToggleSelect(app.id, checked === true)
                      }
                      aria-label={`Pilih ${app.name}`}
                    />
                  </TableCell>
                  <TableCell className="px-2 py-3">
                    <div className="flex justify-center">
                      <Checkbox
                        checked={isCompared}
                        onCheckedChange={() => onToggleCompare(app)}
                        aria-label={`Bandingkan ${app.name}`}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="max-w-56 px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                        {initialsOf(app.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                          <span className="truncate">{app.name}</span>
                          {app.isDuplicate === true ? <DuplicateBadge /> : null}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {app.email}
                          {app.phone ? ` · ${app.phone}` : ""}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-36 px-4 py-3 text-sm">
                    {app.positionTitle ?? "-"}
                  </TableCell>
                  <TableCell className="max-w-32 px-4 py-3">
                    {app.source ? (
                      <span
                        className="inline-flex max-w-28 items-center gap-1.5 text-xs text-muted-foreground"
                        title={`Sumber: ${app.source}`}
                      >
                        <Share2 className="size-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{app.source}</span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <AiScoreBadge score={app.aiScore} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <RatingStars
                      value={app.rating}
                      size="size-3.5"
                      onChange={canMutate ? (n) => onRate(app, n) : undefined}
                      disabled={!canMutate}
                      ariaLabel={`Rating ${app.name}`}
                    />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {tagsPreview(app.tags).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                        >
                          {tag}
                        </span>
                      ))}
                      {app.tags.length > 2 ? (
                        <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                          +{app.tags.length - 2}
                        </span>
                      ) : null}
                      {app.tags.length === 0 ? (
                        <span className="text-xs text-muted-foreground">-</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="px-4 py-3 text-sm whitespace-nowrap text-muted-foreground">
                    {formatDate(app.createdAt)}
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <StatusBadge status={app.status} />
                  </TableCell>
                  <TableCell className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9"
                        onClick={() => onOpenDetail(app)}
                        aria-label={`Lihat detail lamaran ${app.name}`}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                        Detail
                      </Button>
                      {app.phone?.trim() ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                          onClick={() => void handleWhatsApp(app)}
                          aria-label={`Kirim WhatsApp ke ${app.name}`}
                          title="Kirim WhatsApp"
                        >
                          <MessageCircle className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                      {canMutate ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950"
                          onClick={() => onDeleteRequest(app)}
                          aria-label={`Hapus lamaran ${app.name}`}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Mobile: daftar card */}
      <div className="flex flex-col gap-3 md:hidden">
        {applications.map((app) => {
          const isSelected = selectedIds.has(app.id);
          const isCompared = compareIds.includes(app.id);
          return (
            <Card
              key={app.id}
              className="gap-0 rounded-2xl p-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <CardContent className="px-0">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    disabled={!canMutate}
                    onCheckedChange={(checked) =>
                      onToggleSelect(app.id, checked === true)
                    }
                    aria-label={`Pilih ${app.name}`}
                    className="mt-1"
                  />
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400">
                    {initialsOf(app.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      <span className="truncate">{app.name}</span>
                      {app.isDuplicate === true ? <DuplicateBadge /> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {app.email}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {app.positionTitle ?? "-"} · {formatDate(app.createdAt)}
                    </p>
                    {app.source ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Share2 className="size-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{app.source}</span>
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge status={app.status} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <AiScoreBadge score={app.aiScore} />
                  <RatingStars
                    value={app.rating}
                    size="size-3.5"
                    onChange={canMutate ? (n) => onRate(app, n) : undefined}
                    disabled={!canMutate}
                    ariaLabel={`Rating ${app.name}`}
                  />
                  {app.tags.slice(0, 2).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 border-t pt-3">
                  <label className="flex flex-1 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={isCompared}
                      onCheckedChange={() => onToggleCompare(app)}
                      aria-label={`Bandingkan ${app.name}`}
                    />
                    Bandingkan
                  </label>
                  {app.phone?.trim() ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 sm:h-10 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      onClick={() => void handleWhatsApp(app)}
                    >
                      <MessageCircle className="size-4" aria-hidden="true" />
                      WhatsApp
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 sm:h-10"
                    onClick={() => onOpenDetail(app)}
                  >
                    <Eye className="size-4" aria-hidden="true" />
                    Detail
                  </Button>
                  {canMutate ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-10 dark:hover:bg-rose-950"
                      onClick={() => onDeleteRequest(app)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Hapus
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
