"use client";

// NR38-B fitur 9 — Mode kartu daftar pelamar (tabel ↔ kartu).
// Grid kartu ringkas untuk triase cepat: checkbox pilih + avatar + nama (+badge
// "Baru") + bintang, posisi, StatusBadge dengan dot & umur tahap, skor AI,
// chip gaji, domisili, umur lamaran, dan tombol Detail. Klik area kartu membuka
// detail (klik pada kontrol tidak). Pemilihan bulk & aksi massal tetap berfungsi.

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Eye, Star } from "lucide-react";
import type { Application } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatDate, formatShortDateTime } from "./format";
import { StatusBadge, AiScoreBadge, DomisiliChip } from "./status-badge";
import { RatingStars } from "./rating-stars";
import { ApplicantAvatar } from "./applicant-avatar";
import { salaryVerdict, shortDuration } from "./stage-meta";
import { ageOf, stageAgeBasis, type ApplicationRow } from "./applicant-row-types";

/** Chip gaji vs rentang posisi — dipakai kartu & dialog bandingkan. */
export function SalaryVerdictChip({ app }: { app: ApplicationRow }) {
  const verdict = salaryVerdict(
    app.salaryExpectation,
    app.positionSalaryMin ?? null,
    app.positionSalaryMax ?? null
  );
  if (app.salaryExpectation == null) return null; // kartu: sembunyikan bila tidak diisi
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        verdict.chipClass
      )}
      title={verdict.label}
    >
      {verdict.label}
    </span>
  );
}

/** Badge "Baru" rose kecil untuk lamaran yang belum dilihat admin (NR38-B fitur 1). */
export function NewBadge() {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-400"
      title="Lamaran belum dilihat admin"
    >
      Baru
    </span>
  );
}

export function ApplicantCardGrid({
  applications,
  canMutate,
  currentUserId,
  selectedIds,
  onToggleSelect,
  onToggleStar,
  onOpenDetail,
}: {
  applications: ApplicationRow[];
  canMutate: boolean;
  currentUserId: string;
  selectedIds: Set<string>;
  onToggleSelect: (id: string, checked: boolean) => void;
  onToggleStar: (app: Application) => void;
  onOpenDetail: (app: Application) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {applications.map((app) => {
        const isSelected = selectedIds.has(app.id);
        const isStarred = app.starredBy?.includes(currentUserId) ?? false;
        const ageBasis = stageAgeBasis(app);
        const unseen = !app.adminSeenAt;
        return (
          <Card
            key={app.id}
            className={cn(
              "gap-0 cursor-pointer rounded-2xl py-0 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-md",
              isSelected && "ring-2 ring-rose-500/70"
            )}
            onClick={() => onOpenDetail(app)}
          >
            <CardContent className="flex flex-col gap-2.5 px-4 py-4">
              {/* Baris atas: kontrol + identitas */}
              <div className="flex items-start gap-2.5">
                <Checkbox
                  checked={isSelected}
                  disabled={!canMutate}
                  onCheckedChange={(checked) => onToggleSelect(app.id, checked === true)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Pilih ${app.name}`}
                  className="mt-0.5"
                />
                <ApplicantAvatar name={app.name} starred={isStarred} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span
                      className={cn(
                        "max-w-40 truncate text-sm",
                        unseen ? "font-semibold" : "font-medium"
                      )}
                    >
                      {app.name}
                    </span>
                    {unseen ? <NewBadge /> : null}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {app.positionTitle ?? "-"}
                  </p>
                </div>
                {canMutate ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 hover:text-amber-600 dark:hover:text-amber-400"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(app);
                    }}
                    aria-pressed={isStarred}
                    aria-label={
                      isStarred
                        ? `Hapus tanda penting dari ${app.name}`
                        : `Tandai penting ${app.name}`
                    }
                    title="Tandai penting"
                  >
                    <Star
                      className={cn(
                        "size-4",
                        isStarred ? "fill-amber-400 text-amber-500" : "text-muted-foreground/60"
                      )}
                      aria-hidden="true"
                    />
                  </Button>
                ) : null}
              </div>

              {/* Baris chip: status (dot + umur tahap), skor AI, rating */}
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={app.status} dot stageAgeIso={ageBasis} />
                <AiScoreBadge score={app.aiScore} />
                <RatingStars
                  value={app.rating}
                  size="size-3"
                  disabled
                  ariaLabel={`Rating ${app.name}`}
                />
              </div>

              {/* Baris gaji + domisili */}
              <div className="flex flex-wrap items-center gap-1.5">
                <SalaryVerdictChip app={app} />
                <DomisiliChip domisili={app.domisili} komuterPlan={app.komuterPlan} />
              </div>

              {/* Umur lamaran + tanggal daftar */}
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span>Daftar {shortDuration(app.createdAt)} lalu</span>
                <span aria-hidden="true">&middot;</span>
                <span title={`Tanggal daftar: ${formatDate(app.createdAt)}`}>
                  {formatShortDateTime(app.createdAt)}
                </span>
                {ageOf(app.birthDate) ? (
                  <>
                    <span aria-hidden="true">&middot;</span>
                    <span>{ageOf(app.birthDate)}</span>
                  </>
                ) : null}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="h-11 w-full sm:h-9"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDetail(app);
                }}
                aria-label={`Lihat detail lamaran ${app.name}`}
              >
                <Eye className="size-4" aria-hidden="true" />
                Detail
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
