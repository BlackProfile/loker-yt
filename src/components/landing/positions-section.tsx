"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Briefcase,
  Check,
  Eye,
  FolderOpen,
  MapPin,
  MessageCircle,
  SearchX,
} from "lucide-react";
import type { Position } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/components/landing/lang-context";
import { ROSE_BADGE, Container, FadeIn } from "@/components/landing/primitives";
import { formatDateId, waShareHref } from "@/components/landing/landing-utils";

function PositionCard({
  position,
  onApply,
  onOpenDetail,
}: {
  position: Position;
  onApply: (positionId: string) => void;
  onOpenDetail: (position: Position) => void;
}) {
  const { t } = useLang();

  return (
    <Card className="h-full cursor-pointer gap-4 rounded-2xl p-6" onClick={() => onOpenDetail(position)}>
      <div>
        <Badge className={ROSE_BADGE} variant="outline">
          {position.department}
        </Badge>
        <h3 className="mt-3 text-lg font-semibold">{position.title}</h3>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{position.type}</Badge>
          <Badge variant="secondary" className="gap-1">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {position.location}
          </Badge>
        </div>
      </div>

      <p className="line-clamp-3 text-sm text-muted-foreground">
        {position.description}
      </p>

      {position.requirements.length > 0 ? (
        <ul className="space-y-2">
          {position.requirements.slice(0, 3).map((requirement, index) => (
            <li
              key={`${position.id}-req-${index}`}
              className="flex items-start gap-2 text-sm text-muted-foreground"
            >
              <Check
                className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden="true"
              />
              <span>{requirement}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm italic text-muted-foreground">
          {t.positions.reqFallback}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-3 border-t pt-4">
        <span className="text-xs text-muted-foreground">
          {position.requirements.length > 0
            ? `${position.requirements.length} ${t.positions.requirementsCount}`
            : ""}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            aria-label={`${t.positions.detailAria}: ${position.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenDetail(position);
            }}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {t.positions.detail}
          </Button>
          <Button
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onApply(position.id);
            }}
          >
            {t.positions.apply}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function PositionDetailDialog({
  position,
  siteName,
  onClose,
  onApply,
}: {
  position: Position | null;
  siteName: string;
  onClose: () => void;
  onApply: (positionId: string) => void;
}) {
  const { t } = useLang();

  const shareHref = position
    ? waShareHref(
        `${t.positions.dialogShareText} ${position.title} di ${siteName}.`,
      )
    : "#";

  return (
    <Dialog open={position !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto nice-scrollbar">
        {position ? (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={ROSE_BADGE} variant="outline">
                  {position.department}
                </Badge>
                {position.closesAt ? (
                  <Badge
                    variant="outline"
                    className="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400"
                  >
                    {t.positions.closesPrefix}: {formatDateId(position.closesAt)}
                  </Badge>
                ) : null}
              </div>
              <DialogTitle className="text-left text-2xl">
                {position.title}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge variant="secondary">{position.type}</Badge>
                  <Badge variant="secondary" className="gap-1">
                    <MapPin className="h-3 w-3" aria-hidden="true" />
                    {position.location}
                  </Badge>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.positions.dialogDescTitle}
                </h4>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed">
                  {position.description}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  {t.positions.dialogReqTitle}
                </h4>
                {position.requirements.length > 0 ? (
                  <ul className="mt-2 space-y-2">
                    {position.requirements.map((requirement, index) => (
                      <li
                        key={`${position.id}-detail-req-${index}`}
                        className="flex items-start gap-2 text-sm"
                      >
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                          aria-hidden="true"
                        />
                        <span>{requirement}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm italic text-muted-foreground">
                    {t.positions.reqFallback}
                  </p>
                )}
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" asChild>
                <a href={shareHref} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {t.positions.dialogShare}
                </a>
              </Button>
              <DialogClose asChild>
                <Button onClick={() => onApply(position.id)}>
                  {t.positions.apply}
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  active,
  children,
  onClick,
  ariaLabel,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      className="rounded-full"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function PositionsSection({
  positions,
  siteName,
  onApply,
}: {
  positions: Position[];
  siteName: string;
  onApply: (positionId: string) => void;
}) {
  const { t } = useLang();
  const [department, setDepartment] = useState<string | null>(null);
  const [jobType, setJobType] = useState<string | null>(null);
  const [detail, setDetail] = useState<Position | null>(null);

  const departments = useMemo(
    () => Array.from(new Set(positions.map((p) => p.department))).sort(),
    [positions],
  );
  const jobTypes = useMemo(
    () => Array.from(new Set(positions.map((p) => p.type))),
    [positions],
  );

  const filtered = positions.filter(
    (p) =>
      (department === null || p.department === department) &&
      (jobType === null || p.type === jobType),
  );

  const hasFilters = department !== null || jobType !== null;

  return (
    <section id="posisi" className="scroll-mt-24 bg-background py-16 md:py-24">
      <Container>
        <FadeIn className="max-w-2xl">
          <Badge variant="outline" className={ROSE_BADGE}>
            {t.positions.badge}
          </Badge>
          <h2 className="mt-4 text-3xl font-bold tracking-tight md:text-4xl">
            {t.positions.title}
          </h2>
          <p className="mt-3 text-muted-foreground">{t.positions.desc}</p>
        </FadeIn>

        {positions.length === 0 ? (
          <FadeIn className="mt-10">
            <Card className="items-center gap-3 rounded-2xl p-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                <FolderOpen className="h-6 w-6" aria-hidden="true" />
              </div>
              <p className="font-semibold">{t.positions.emptyTitle}</p>
              <p className="text-sm text-muted-foreground">
                {t.positions.emptyBody}
              </p>
            </Card>
          </FadeIn>
        ) : (
          <>
            <FadeIn className="mt-8 space-y-3">
              <div
                role="group"
                aria-label={t.positions.deptLabel}
                className="flex flex-wrap items-center gap-2"
              >
                <FilterChip
                  active={department === null}
                  onClick={() => setDepartment(null)}
                  ariaLabel={`${t.positions.deptLabel}: ${t.positions.all}`}
                >
                  {t.positions.all}
                </FilterChip>
                {departments.map((dept) => (
                  <FilterChip
                    key={dept}
                    active={department === dept}
                    onClick={() => setDepartment(department === dept ? null : dept)}
                    ariaLabel={`${t.positions.deptLabel}: ${dept}`}
                  >
                    {dept}
                  </FilterChip>
                ))}
              </div>
              <div
                role="group"
                aria-label={t.positions.typeLabel}
                className="flex flex-wrap items-center gap-2"
              >
                {jobTypes.map((type) => (
                  <FilterChip
                    key={type}
                    active={jobType === type}
                    onClick={() => setJobType(jobType === type ? null : type)}
                    ariaLabel={`${t.positions.typeLabel}: ${type}`}
                  >
                    <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                    {type}
                  </FilterChip>
                ))}
              </div>
            </FadeIn>

            {filtered.length === 0 ? (
              <FadeIn className="mt-8">
                <Card className="items-center gap-3 rounded-2xl p-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <SearchX className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <p className="font-semibold">{t.positions.filterEmptyTitle}</p>
                  <p className="text-sm text-muted-foreground">
                    {t.positions.filterEmptyBody}
                  </p>
                </Card>
              </FadeIn>
            ) : (
              <motion.div
                layout
                className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-3"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {filtered.map((position) => (
                    <motion.div
                      key={position.id}
                      layout
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={{ duration: 0.22, ease: "easeOut" }}
                    >
                      <PositionCard
                        position={position}
                        onApply={onApply}
                        onOpenDetail={setDetail}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </>
        )}
      </Container>

      <PositionDetailDialog
        position={detail}
        siteName={siteName}
        onClose={() => setDetail(null)}
        onApply={onApply}
      />
    </section>
  );
}
