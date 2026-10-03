"use client";

// Panel wawancara halaman Cek Status (dipindah verbatim dari status-page.tsx
// pada NR-18-a): kartu sesi wawancara (konfirmasi/ubah jadwal/pindah slot/tidak
// hadir/tips) + blok pilih slot self-service. Selalu tampak (tidak dilipat).

import {
  BadgeCheck,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Loader2,
  MapPin,
  RefreshCw,
  Video,
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { fillTemplate, formatDateTimeId, safeExternalUrl } from "@/components/landing/landing-utils";
import type { Dict } from "@/components/landing/strings";
import {
  INTERVIEW_STATUS_LABELS,
  type StageKey,
  type TrackInterviewInfo,
  type TrackResponse,
  type TrackSlotInfo,
} from "@/lib/types";
import { DetailRow } from "./status-shared";
import {
  INTERVIEW_BADGE_CLASS,
  PLATFORM_LABELS,
  buildGoogleCalendarUrl,
} from "./status-types";

export function InterviewsSection({
  t,
  detail,
  selectedCode,
  interviews,
  availableSlots,
  finalStatus,
  interviewBusy,
  isInterviewBusy,
  rescheduleFor,
  setRescheduleFor,
  proposedAt,
  setProposedAt,
  rescheduleReason,
  setRescheduleReason,
  slotPanelFor,
  slotsLoading,
  slotsList,
  slotsError,
  pendingSlotId,
  setPendingSlotId,
  bookingSlotId,
  cancelOpenFor,
  setCancelOpenFor,
  cancelError,
  setCancelError,
  respondInterview,
  submitReschedule,
  openSlotPanel,
  closeSlotPanel,
  loadOpenSlots,
  moveInterviewToSlot,
  cancelAttendance,
  bookSlot,
}: {
  t: Dict;
  detail: TrackResponse;
  selectedCode: string | null;
  interviews: TrackInterviewInfo[];
  availableSlots: TrackSlotInfo[];
  finalStatus: StageKey | undefined;
  interviewBusy: string | null;
  isInterviewBusy: (interviewId: string, action: string) => boolean;
  rescheduleFor: string | null;
  setRescheduleFor: (value: string | null) => void;
  proposedAt: string;
  setProposedAt: (value: string) => void;
  rescheduleReason: string;
  setRescheduleReason: (value: string) => void;
  slotPanelFor: string | null;
  slotsLoading: boolean;
  slotsList: TrackSlotInfo[];
  slotsError: string | null;
  pendingSlotId: string | null;
  setPendingSlotId: (value: string | null) => void;
  bookingSlotId: string | null;
  cancelOpenFor: string | null;
  setCancelOpenFor: (value: string | null) => void;
  cancelError: string | null;
  setCancelError: (value: string | null) => void;
  respondInterview: (
    interviewId: string,
    action: "CONFIRM" | "RESCHEDULE" | "CANCEL_REQUEST",
    extra?: { proposedAt?: string; reason?: string },
  ) => Promise<void>;
  submitReschedule: (interviewId: string) => void;
  openSlotPanel: (interviewId: string) => Promise<void>;
  closeSlotPanel: () => void;
  loadOpenSlots: () => Promise<void>;
  moveInterviewToSlot: (interviewId: string, slotId: string) => Promise<void>;
  cancelAttendance: (interviewId: string) => Promise<void>;
  bookSlot: (slotId: string) => Promise<void>;
}) {
  return (
    <>
      {/* Jadwal wawancara — sesi aktif + riwayat, ronde terbaru paling menonjol */}
      {interviews.length > 0 ? (
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t.status.interview.title}
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {interviews.map((interview) => {
              const isOnline = interview.mode === "ONLINE";
              const platformLabel = PLATFORM_LABELS[interview.platform];
              const meetingUrl = interview.meetingLink
                ? safeExternalUrl(interview.meetingLink)
                : null;
              const icsUrl = `/api/public/interview/ics?code=${encodeURIComponent(selectedCode ?? "")}&id=${encodeURIComponent(interview.id)}`;
              const gcalUrl = buildGoogleCalendarUrl({
                title: `${fillTemplate(t.status.interview.round, { n: interview.round })} — Lumina Studio`,
                startIso: interview.scheduledAt,
                durationMin: interview.durationMin,
                details: [
                  detail.positionTitle
                    ? `${t.status.positionLabel}: ${detail.positionTitle}`
                    : null,
                  isOnline
                    ? `${t.status.interview.platformLabel}: ${platformLabel}`
                    : null,
                  interview.interviewers.length > 0
                    ? `${t.status.interview.interviewersLabel}: ${interview.interviewers.join(", ")}`
                    : null,
                ]
                  .filter(Boolean)
                  .join("\n"),
                location: isOnline
                  ? (meetingUrl ?? platformLabel)
                  : (interview.address ?? "Lumina Studio"),
              });
              const canRespond =
                interview.status === "SCHEDULED" ||
                interview.status === "RESCHEDULE_REQUESTED";
              const cardBusy = interviewBusy?.startsWith(`${interview.id}:`) ?? false;
              const rescheduleOpen = rescheduleFor === interview.id;
              // Sesi mendatang yang masih aktif: boleh pindah slot / tidak bisa hadir.
              const selfServiceUpcoming =
                new Date(interview.scheduledAt).getTime() > Date.now() &&
                (interview.status === "SCHEDULED" ||
                  interview.status === "CONFIRMED" ||
                  interview.status === "RESCHEDULE_REQUESTED");
              const slotPanelOpen = slotPanelFor === interview.id;
              const cancelConfirmOpen = cancelOpenFor === interview.id;
              const moveBusy = isInterviewBusy(interview.id, "RESLOT");
              return (
                <div
                  key={interview.id}
                  className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-500/30 dark:bg-zinc-500/5"
                >
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
                      {isOnline ? (
                        <Video className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <h4 className="text-sm font-semibold">
                      {fillTemplate(t.status.interview.round, { n: interview.round })}
                    </h4>
                    <Badge
                      variant="outline"
                      className={INTERVIEW_BADGE_CLASS[interview.status]}
                    >
                      {INTERVIEW_STATUS_LABELS[interview.status] ?? interview.status}
                    </Badge>
                  </div>

                  <div className="mt-3 grid gap-1.5">
                    <p className="text-sm">
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                        {t.status.interview.whenLabel}:{" "}
                      </span>
                      <span className="font-medium">
                        {formatDateTimeId(interview.scheduledAt)}
                      </span>
                    </p>
                    <DetailRow
                      label={t.status.interview.durationLabel}
                      value={fillTemplate(t.status.interview.durationValue, {
                        n: interview.durationMin,
                      })}
                    />
                    {isOnline ? (
                      <DetailRow
                        label={t.status.interview.platformLabel}
                        value={platformLabel}
                      />
                    ) : null}
                    {interview.interviewers.length > 0 ? (
                      <DetailRow
                        label={t.status.interview.interviewersLabel}
                        value={interview.interviewers.join(", ")}
                      />
                    ) : null}
                    {!isOnline && interview.address ? (
                      <DetailRow
                        label={t.status.interview.addressLabel}
                        value={interview.address}
                      />
                    ) : null}
                  </div>

                  {/* Link meeting & kalender (hanya ONLINE dengan link valid) */}
                  {isOnline && meetingUrl ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" className="h-11 sm:h-9" asChild>
                        <a
                          href={meetingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t.status.interview.joinAria}
                        >
                          <Video className="h-4 w-4" aria-hidden="true" />
                          {t.status.interview.join}
                        </a>
                      </Button>
                      <Button variant="outline" size="sm" className="h-11 sm:h-9" asChild>
                        <a href={icsUrl} download>
                          <Download className="h-4 w-4" aria-hidden="true" />
                          {t.status.interview.saveCalendar}
                        </a>
                      </Button>
                      {gcalUrl ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-9"
                          asChild
                        >
                          <a
                            href={gcalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={t.status.interview.gcalAria}
                          >
                            <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                            {t.status.interview.gcal}
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Aksi pelamar untuk sesi SCHEDULED / RESCHEDULE_REQUESTED */}
                  {canRespond ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="h-11 sm:h-9"
                          disabled={cardBusy}
                          onClick={() =>
                            void respondInterview(interview.id, "CONFIRM")
                          }
                        >
                          {isInterviewBusy(interview.id, "CONFIRM") ? (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                          )}
                          {t.status.interview.confirm}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-9"
                          disabled={cardBusy}
                          onClick={() => {
                            setRescheduleFor(rescheduleOpen ? null : interview.id);
                            closeSlotPanel();
                            setCancelOpenFor(null);
                          }}
                          aria-expanded={rescheduleOpen}
                        >
                          <Clock className="h-4 w-4" aria-hidden="true" />
                          {t.status.interview.requestChange}
                        </Button>
                      </div>

                      {interview.status === "RESCHEDULE_REQUESTED" &&
                      interview.rescheduleProposedAt ? (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800 dark:border-orange-500/30 dark:bg-orange-500/10 dark:text-orange-300">
                          <p>
                            {fillTemplate(t.status.interview.proposedPending, {
                              time: formatDateTimeId(interview.rescheduleProposedAt),
                            })}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-2 h-11 border-orange-300 bg-transparent text-orange-800 hover:bg-orange-100 hover:text-orange-900 sm:h-9 dark:border-orange-500/40 dark:text-orange-300 dark:hover:bg-orange-500/10 dark:hover:text-orange-200"
                            disabled={cardBusy}
                            onClick={() =>
                              void respondInterview(interview.id, "CANCEL_REQUEST")
                            }
                          >
                            {isInterviewBusy(interview.id, "CANCEL_REQUEST") ? (
                              <Loader2
                                className="h-4 w-4 animate-spin"
                                aria-hidden="true"
                              />
                            ) : (
                              <X className="h-4 w-4" aria-hidden="true" />
                            )}
                            {t.status.interview.cancelRequest}
                          </Button>
                        </div>
                      ) : null}

                      {rescheduleOpen ? (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-500/30 dark:bg-orange-500/10">
                          <Label
                            htmlFor={`reschedule-at-${interview.id}`}
                            className="text-xs font-medium text-orange-800 dark:text-orange-300"
                          >
                            {t.status.interview.proposedLabel}
                          </Label>
                          <Input
                            id={`reschedule-at-${interview.id}`}
                            type="datetime-local"
                            value={proposedAt}
                            onChange={(e) => setProposedAt(e.target.value)}
                            className="mt-1 h-11 bg-background sm:h-9"
                          />
                          <Label
                            htmlFor={`reschedule-reason-${interview.id}`}
                            className="mt-2 text-xs font-medium text-orange-800 dark:text-orange-300"
                          >
                            {t.status.interview.reasonLabel}
                          </Label>
                          <Textarea
                            id={`reschedule-reason-${interview.id}`}
                            rows={2}
                            value={rescheduleReason}
                            onChange={(e) => setRescheduleReason(e.target.value)}
                            placeholder={t.status.interview.reasonPh}
                            maxLength={500}
                            className="mt-1 bg-background text-sm"
                          />
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="h-11 sm:h-9"
                              disabled={cardBusy || !proposedAt}
                              onClick={() => void submitReschedule(interview.id)}
                            >
                              {isInterviewBusy(interview.id, "RESCHEDULE") ? (
                                <Loader2
                                  className="h-4 w-4 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                              )}
                              {t.status.interview.sendRequest}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-11 sm:h-9"
                              disabled={cardBusy}
                              onClick={() => setRescheduleFor(null)}
                            >
                              {t.status.formCancel}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : interview.status === "CONFIRMED" ? (
                    <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                      <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                      {t.status.interview.confirmDone}
                    </p>
                  ) : null}

                  {/* Aksi mandiri tambahan: pindah jadwal via slot terbuka & tidak bisa hadir */}
                  {selfServiceUpcoming ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-9"
                          disabled={cardBusy}
                          onClick={() =>
                            slotPanelOpen
                              ? closeSlotPanel()
                              : void openSlotPanel(interview.id)
                          }
                          aria-expanded={slotPanelOpen}
                        >
                          <CalendarClock className="h-4 w-4" aria-hidden="true" />
                          {t.status.interview.moveSlot}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 border-rose-200 bg-transparent text-rose-700 hover:bg-rose-50 hover:text-rose-800 sm:h-9 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                          disabled={cardBusy}
                          onClick={() => {
                            closeSlotPanel();
                            setCancelOpenFor(cancelConfirmOpen ? null : interview.id);
                            setCancelError(null);
                          }}
                          aria-expanded={cancelConfirmOpen}
                        >
                          <XCircle className="h-4 w-4" aria-hidden="true" />
                          {t.status.interview.cannotAttend}
                        </Button>
                      </div>

                      {slotPanelOpen ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                              {t.status.interview.slotPanelTitle}
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-xs text-amber-800 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
                              disabled={slotsLoading || moveBusy}
                              onClick={() => void loadOpenSlots()}
                            >
                              {slotsLoading ? (
                                <Loader2
                                  className="h-3.5 w-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              {t.status.interview.reload}
                            </Button>
                          </div>

                          {slotsError ? (
                            <div
                              role="alert"
                              className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                            >
                              {slotsError}
                            </div>
                          ) : null}

                          {slotsLoading ? (
                            <p className="mt-2 flex items-center gap-2 text-xs text-amber-800/85 dark:text-amber-200/80">
                              <Loader2
                                className="h-3.5 w-3.5 animate-spin"
                                aria-hidden="true"
                              />
                              {t.status.interview.loadingSlots}
                            </p>
                          ) : !slotsError && slotsList.length === 0 ? (
                            <p className="mt-2 text-xs text-amber-800/85 dark:text-amber-200/80">
                              {t.status.interview.noSlots}
                            </p>
                          ) : null}

                          {slotsList.length > 0 ? (
                            <div className="nice-scrollbar mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
                              {slotsList.map((slot) => {
                                const confirming = pendingSlotId === slot.id;
                                const slotOnline = slot.mode === "ONLINE";
                                return (
                                  <div
                                    key={slot.id}
                                    className="rounded-md border border-amber-200/80 bg-background/70 p-2.5 dark:border-amber-500/20"
                                  >
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                        {slotOnline ? (
                                          <Video className="h-3.5 w-3.5" aria-hidden="true" />
                                        ) : (
                                          <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                                        )}
                                      </span>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium">
                                          {formatDateTimeId(slot.scheduledAt)}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                          {fillTemplate(t.status.interview.durationValue, {
                                            n: slot.durationMin,
                                          })}
                                          · {PLATFORM_LABELS[slot.platform]}
                                          {slot.interviewers.length > 0
                                            ? ` · ${slot.interviewers.join(", ")}`
                                            : ""}
                                          {!slotOnline && slot.address
                                            ? ` · ${slot.address}`
                                            : ""}
                                        </p>
                                      </div>
                                      {!confirming ? (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="h-11 sm:h-8"
                                          disabled={moveBusy || pendingSlotId !== null}
                                          onClick={() => setPendingSlotId(slot.id)}
                                        >
                                          <CalendarClock
                                            className="h-4 w-4"
                                            aria-hidden="true"
                                          />
                                          {t.status.interview.moveToHere}
                                        </Button>
                                      ) : null}
                                    </div>
                                    {confirming ? (
                                      <div className="mt-2 rounded-md border border-amber-300/80 bg-amber-50 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/10">
                                        <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                                          {fillTemplate(t.status.interview.moveConfirm, {
                                            time: formatDateTimeId(slot.scheduledAt),
                                          })}
                                        </p>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                          <Button
                                            size="sm"
                                            className="h-11 sm:h-8"
                                            disabled={moveBusy}
                                            onClick={() =>
                                              void moveInterviewToSlot(
                                                interview.id,
                                                slot.id,
                                              )
                                            }
                                          >
                                            {moveBusy ? (
                                              <Loader2
                                                className="h-4 w-4 animate-spin"
                                                aria-hidden="true"
                                              />
                                            ) : (
                                              <CheckCircle2
                                                className="h-4 w-4"
                                                aria-hidden="true"
                                              />
                                            )}
                                            {t.status.interview.moveYes}
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-11 sm:h-8"
                                            disabled={moveBusy}
                                            onClick={() => setPendingSlotId(null)}
                                          >
                                            {t.status.formCancel}
                                          </Button>
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}

                          {!slotsError && slotsList.length > 0 ? (
                            <p className="mt-2 text-[11px] leading-relaxed text-amber-800/70 dark:text-amber-200/70">
                              {t.status.interview.slotsNote}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {cancelConfirmOpen ? (
                        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
                          <p className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                            {t.status.interview.cancelConfirmTitle}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-rose-800/90 dark:text-rose-200/80">
                            {fillTemplate(t.status.interview.cancelConfirmDesc, {
                              n: String(interview.round),
                              time: formatDateTimeId(interview.scheduledAt),
                            })}
                          </p>
                          {cancelError ? (
                            <div
                              role="alert"
                              className="mt-2 rounded-md border border-rose-200 bg-background/70 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:text-rose-300"
                            >
                              {cancelError}
                            </div>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="h-11 bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
                              disabled={cardBusy}
                              onClick={() => void cancelAttendance(interview.id)}
                            >
                              {isInterviewBusy(interview.id, "CANCEL_ATTENDANCE") ? (
                                <Loader2
                                  className="h-4 w-4 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <XCircle className="h-4 w-4" aria-hidden="true" />
                              )}
                              {t.status.interview.cancelYes}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-11 sm:h-9"
                              disabled={cardBusy}
                              onClick={() => {
                                setCancelOpenFor(null);
                                setCancelError(null);
                              }}
                            >
                              {t.status.formCancel}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <Collapsible className="mt-3">
                    <CollapsibleTrigger className="group flex w-fit items-center gap-1 rounded text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
                      <ChevronDown
                        className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180"
                        aria-hidden="true"
                      />
                      {isOnline
                        ? t.status.interview.tipsTitleOnline
                        : t.status.interview.tipsTitleOnsite}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                        {(isOnline
                          ? t.status.interview.tipsOnline
                          : t.status.interview.tipsOnsite
                        ).map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Pilih jadwal wawancara — slot self-service dari admin */}
      {availableSlots.length > 0 && !finalStatus ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t.status.interview.slotBookTitle}
          </p>
          <p className="mt-1 text-sm text-amber-800/85 dark:text-amber-200/80">
            {t.status.interview.slotBookDesc}
          </p>
          <div className="nice-scrollbar mt-3 flex max-h-96 flex-col gap-2 overflow-y-auto">
            {availableSlots.map((slot) => {
              const busy = bookingSlotId === slot.id;
              const slotOnline = slot.mode === "ONLINE";
              return (
                <div
                  key={slot.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-200/80 bg-background/70 p-3 dark:border-amber-500/20"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    {slotOnline ? (
                      <Video className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {formatDateTimeId(slot.scheduledAt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {fillTemplate(t.status.interview.durationValue, {
                        n: slot.durationMin,
                      })}{" "}
                      · {PLATFORM_LABELS[slot.platform]}
                      {slot.interviewers.length > 0
                        ? ` · ${slot.interviewers.join(", ")}`
                        : ""}
                      {!slotOnline && slot.address ? ` · ${slot.address}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    className="h-11 sm:h-9"
                    disabled={bookingSlotId !== null}
                    onClick={() => void bookSlot(slot.id)}
                    aria-label={fillTemplate(t.status.interview.pickSlotAria, {
                      time: formatDateTimeId(slot.scheduledAt),
                    })}
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                    )}
                    {t.status.interview.pickSlot}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
