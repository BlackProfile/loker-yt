"use client";

// Tab Karyawan — onboarding & masa percobaan untuk application yang sudah diterima (hiredAt terisi).
// Ringkasan 3 angka, progres masa percobaan, editor Rencana Onboarding
// ({id,label,owner?,dueAt?,done}[] di application.onboardingPlan), dan cek-in 30/60/90 hari.
// Aksen emerald = onboarding positif; amber/rose sesuai konteks perhatian.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BadgeCheck,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  ClipboardCheck,
  Hourglass,
  IdCard,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  CHECKIN_RECOMMENDATIONS,
  CHECKIN_RECOMMENDATION_LABELS,
  EXIT_REASONS,
  EXIT_REASON_LABELS,
  type CheckInRecommendation,
  type EmployeeCardDto,
  type ExitReason,
} from "@/lib/types";
import {
  EmployeeIdCardBack,
  EmployeeIdCardFront,
  type EmployeeIdCardProps,
} from "@/components/employee-id-card";
import {
  CardStatusBadge,
  EmployeeCardDialog,
  cardVerifyUrl,
} from "./employee-card-dialog";
import { apiGet, apiPatch, apiPost } from "./api";
import { formatDate } from "./format";
import { useAdminSession } from "./admin-context";
import { useLiveRefresh } from "./use-live-refresh";
import { Reveal } from "./motion-primitives";
import { RatingStars } from "./rating-stars";

/* ---------------------------------- Tipe data ---------------------------------- */

type PlanItem = {
  id: string;
  label: string;
  owner: string | null;
  dueAt: string | null;
  done: boolean;
};

type CheckInDto = {
  id: string;
  day: number;
  dueAt: string | null;
  rating: number | null;
  notes: string | null;
  recommendation: CheckInRecommendation | null;
  completedAt: string | null;
};

type Employee = {
  id: string;
  name: string;
  email: string;
  phone: string;
  trackingCode: string | null;
  positionTitle: string | null;
  hiredAt: string;
  probationEnd: string | null;
  permanentAt: string | null;
  exitAt: string | null;
  exitReason: ExitReason | null;
  exitNote: string | null;
  onboardingPlan: PlanItem[];
  offboardingPlan: PlanItem[];
  checkIns: CheckInDto[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKIN_DAYS = [30, 60, 90] as const;
const PROBATION_DECISION_WINDOW_DAYS = 14; // panel keputusan tampil saat probasi <= 14 hari lagi

const BADGE_DONE =
  "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400";
const BADGE_DUE =
  "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400";
const BADGE_ROSE =
  "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400";
const BADGE_NEUTRAL =
  "border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300";

// Chip rekomendasi cek-in: LANJUT emerald, PERPANJANG amber, AKHIRI rose.
const RECOMMENDATION_BADGE: Record<CheckInRecommendation, string> = {
  LANJUT: BADGE_DONE,
  PERPANJANG: BADGE_DUE,
  AKHIRI: BADGE_ROSE,
};

/* --------------------------------- Util kecil --------------------------------- */

// ISO -> yyyy-mm-dd lokal untuk <input type="date">.
function dateInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// yyyy-mm-dd dari input date -> ISO (lokal), atau null bila kosong/tidak valid.
function dateInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

// dueAt cek-in: dari record bila ada, jika tidak dihitung on-the-fly dari hiredAt + n hari.
function dueAtOf(employee: Employee, day: number): Date | null {
  const record = employee.checkIns.find((c) => c.day === day);
  if (record?.dueAt) {
    const d = new Date(record.dueAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const hired = new Date(employee.hiredAt);
  if (Number.isNaN(hired.getTime())) return null;
  return new Date(hired.getTime() + day * DAY_MS);
}

/* -------------------------------- Kartu ringkasan -------------------------------- */

function SummaryStat({
  icon: Icon,
  label,
  value,
  iconClass,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  label: string;
  value: number;
  iconClass: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-background p-4">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl border", iconClass)}>
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------ Progres masa percobaan ------------------------------ */

function ProbationInfo({ employee }: { employee: Employee }) {
  const hiredMs = new Date(employee.hiredAt).getTime();
  const endMs = employee.probationEnd ? new Date(employee.probationEnd).getTime() : null;

  if (!employee.probationEnd || endMs == null || Number.isNaN(endMs) || Number.isNaN(hiredMs)) {
    return (
      <Badge variant="outline" className="shrink-0">
        Tanpa masa percobaan
      </Badge>
    );
  }

  const now = Date.now();
  const totalDays = Math.max(1, Math.round((endMs - hiredMs) / DAY_MS));
  const remainingDays = Math.ceil((endMs - now) / DAY_MS);

  if (remainingDays <= 0) {
    return (
      <Badge variant="outline" className={cn("shrink-0", BADGE_DONE)}>
        Masa percobaan selesai
      </Badge>
    );
  }

  const remainingPct = Math.min(100, Math.max(0, Math.round((remainingDays / totalDays) * 100)));
  return (
    <div className="flex w-full min-w-48 flex-col gap-1.5 sm:w-64">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={BADGE_DUE}>
          Masa percobaan {remainingDays} hari lagi
        </Badge>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          sisa {remainingDays}/{totalDays} hari
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalDays}
        aria-valuenow={Math.max(0, remainingDays)}
        aria-label={`Sisa masa percobaan ${remainingDays} dari ${totalDays} hari`}
      >
        <div
          className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
          style={{ width: `${remainingPct}%` }}
        />
      </div>
    </div>
  );
}

/* ------------- Editor rencana onboarding & checklist offboarding (generik) ------------- */

type PlanField = "onboardingPlan" | "offboardingPlan";

function PlanChecklistEditor({
  employeeId,
  title,
  titleIcon: TitleIcon,
  titleIconClass,
  field,
  items,
  emptyHint,
  addPlaceholder,
  saveLabel,
  savedToast,
  saveButtonClass,
  onPlanSaved,
}: {
  employeeId: string;
  title: string;
  titleIcon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  titleIconClass: string;
  field: PlanField;
  items: PlanItem[];
  emptyHint: string;
  addPlaceholder: string;
  saveLabel: string;
  savedToast: string;
  saveButtonClass: string;
  onPlanSaved: (employeeId: string, field: PlanField, plan: PlanItem[]) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [draft, setDraft] = useState<PlanItem[]>(items);
  const [newLabel, setNewLabel] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newDue, setNewDue] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(items),
    [draft, items]
  );
  const doneCount = draft.filter((item) => item.done).length;

  function handleAdd() {
    if (!canMutate) return;
    const label = newLabel.trim();
    if (!label) return;
    setDraft((prev) => [
      ...prev,
      {
        id: `item${Date.now().toString(36)}${prev.length}`,
        label: label.slice(0, 120),
        owner: newOwner.trim() ? newOwner.trim().slice(0, 60) : null,
        dueAt: dateInputToIso(newDue),
        done: false,
      },
    ]);
    setNewLabel("");
    setNewOwner("");
    setNewDue("");
  }

  function toggleItem(id: string, done: boolean | string) {
    if (!canMutate) return;
    setDraft((prev) => prev.map((item) => (item.id === id ? { ...item, done: done === true } : item)));
  }

  function removeItem(id: string) {
    if (!canMutate) return;
    setDraft((prev) => prev.filter((item) => item.id !== id));
  }

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const res = await apiPatch<
        { ok: boolean; onboardingPlan?: PlanItem[]; offboardingPlan?: PlanItem[] }
      >(`/api/admin/hire/${employeeId}`, { [field]: draft });
      const saved = (field === "onboardingPlan" ? res.onboardingPlan : res.offboardingPlan) ?? draft;
      setDraft(saved);
      onPlanSaved(employeeId, field, saved);
      toast.success(savedToast);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <TitleIcon className={cn("size-4", titleIconClass)} aria-hidden="true" />
          {title}
        </p>
        {draft.length > 0 ? (
          <Badge variant="outline" className={doneCount === draft.length ? BADGE_DONE : BADGE_DUE}>
            {doneCount}/{draft.length} selesai
          </Badge>
        ) : null}
      </div>

      {/* Daftar item — list panjang dapat digulir */}
      <div className="nice-scrollbar max-h-96 overflow-y-auto">
        {draft.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">{emptyHint}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {draft.map((item) => (
              <li
                key={item.id}
                className="group flex items-start gap-2 rounded-lg border px-2.5 py-2"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={item.done}
                  onCheckedChange={(checked) => toggleItem(item.id, checked)}
                  disabled={!canMutate || saving}
                  aria-label={`Tandai selesai: ${item.label}`}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-snug",
                      item.done && "text-muted-foreground line-through"
                    )}
                  >
                    {item.label}
                  </p>
                  {item.owner || item.dueAt ? (
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      {item.owner ? <span>PIC: {item.owner}</span> : null}
                      {item.dueAt ? <span>Tenggat: {formatDate(item.dueAt)}</span> : null}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground opacity-60 hover:text-rose-600 group-hover:opacity-100 dark:hover:text-rose-400"
                  onClick={() => removeItem(item.id)}
                  disabled={!canMutate || saving}
                  aria-label={`Hapus item ${item.label}`}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tambah item */}
      <div className="flex flex-col gap-2 rounded-lg bg-zinc-50/70 p-2.5 dark:bg-zinc-900/40">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`plan-${field}-label-${employeeId}`} className="text-xs">
              Item
            </Label>
            <Input
              id={`plan-${field}-label-${employeeId}`}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder={addPlaceholder}
              maxLength={120}
              disabled={!canMutate || saving}
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`plan-${field}-owner-${employeeId}`} className="text-xs">
              PIC (opsional)
            </Label>
            <Input
              id={`plan-${field}-owner-${employeeId}`}
              value={newOwner}
              onChange={(e) => setNewOwner(e.target.value)}
              placeholder="Misal: Tim HR"
              maxLength={60}
              disabled={!canMutate || saving}
              className="h-9"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`plan-${field}-due-${employeeId}`} className="text-xs">
              Tenggat (opsional)
            </Label>
            <Input
              id={`plan-${field}-due-${employeeId}`}
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              disabled={!canMutate || saving}
              className="h-9 w-40"
            />
          </div>
          <Button
            variant="outline"
            onClick={handleAdd}
            disabled={!canMutate || saving || !newLabel.trim()}
            className="h-9"
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah
          </Button>
        </div>
      </div>

      {canMutate && dirty ? (
        <Button
          onClick={() => void handleSave()}
          disabled={saving}
          className={saveButtonClass}
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Menyimpan...
            </>
          ) : (
            saveLabel
          )}
        </Button>
      ) : null}
    </div>
  );
}

/** Editor Rencana Onboarding (agenda hari pertama, mentor, target) — emerald. */
function OnboardingPlanEditor({
  employee,
  onPlanSaved,
}: {
  employee: Employee;
  onPlanSaved: (employeeId: string, field: PlanField, plan: PlanItem[]) => void;
}) {
  return (
    <PlanChecklistEditor
      employeeId={employee.id}
      title="Rencana Onboarding"
      titleIcon={ClipboardCheck}
      titleIconClass="text-emerald-600 dark:text-emerald-400"
      field="onboardingPlan"
      items={employee.onboardingPlan}
      emptyHint="Belum ada item. Tambahkan agenda onboarding di bawah, misalnya orientasi, intro mentor, atau target minggu pertama."
      addPlaceholder="Misal: Orientasi & tur studio"
      saveLabel="Simpan Rencana"
      savedToast="Rencana onboarding disimpan"
      saveButtonClass="bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]"
      onPlanSaved={onPlanSaved}
    />
  );
}

/** Checklist Offboarding (serah terima alumni) — tampil untuk karyawan dengan exitAt. */
function OffboardingChecklistEditor({
  employee,
  onPlanSaved,
}: {
  employee: Employee;
  onPlanSaved: (employeeId: string, field: PlanField, plan: PlanItem[]) => void;
}) {
  return (
    <PlanChecklistEditor
      employeeId={employee.id}
      title="Checklist Offboarding"
      titleIcon={LogOut}
      titleIconClass="text-amber-600 dark:text-amber-400"
      field="offboardingPlan"
      items={employee.offboardingPlan}
      emptyHint="Belum ada item serah terima. Tambahkan langkah keluar di bawah — checklist bawaan juga terbentuk otomatis saat karyawan dicatat keluar."
      addPlaceholder="Misal: Kembalikan laptop & kunci"
      saveLabel="Simpan Checklist"
      savedToast="Checklist offboarding disimpan"
      saveButtonClass="bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.99]"
      onPlanSaved={onPlanSaved}
    />
  );
}

/* --------------------------------- Bagian cek-in --------------------------------- */

type CheckInDialogState = {
  day: number;
  mode: "create" | "edit";
  recordId: string | null;
  rating: number;
  notes: string;
  recommendation: CheckInRecommendation | null;
};

function CheckInSection({
  employee,
  onCheckInSaved,
}: {
  employee: Employee;
  onCheckInSaved: (employeeId: string, checkIn: CheckInDto) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [dialog, setDialog] = useState<CheckInDialogState | null>(null);
  const [saving, setSaving] = useState(false);

  function statusOf(day: number): { record: CheckInDto | null; dueIso: string | null; key: "belum" | "jatuhTempo" | "selesai" } {
    const record = employee.checkIns.find((c) => c.day === day) ?? null;
    const due = dueAtOf(employee, day);
    const dueIso = due ? due.toISOString() : null;
    if (record?.completedAt) return { record, dueIso, key: "selesai" };
    if (due && due.getTime() <= Date.now()) return { record, dueIso, key: "jatuhTempo" };
    return { record, dueIso, key: "belum" };
  }

  function openCreate(day: number) {
    setDialog({ day, mode: "create", recordId: null, rating: 0, notes: "", recommendation: null });
  }

  function openEdit(record: CheckInDto) {
    setDialog({
      day: record.day,
      mode: "edit",
      recordId: record.id,
      rating: record.rating ?? 0,
      notes: record.notes ?? "",
      recommendation: record.recommendation ?? null,
    });
  }

  async function handleSave() {
    if (!dialog || saving) return;
    setSaving(true);
    try {
      if (dialog.mode === "create") {
        const created = await apiPost<CheckInDto>(`/api/admin/hire/${employee.id}/checkins`, {
          day: dialog.day,
          rating: dialog.rating > 0 ? dialog.rating : null,
          notes: dialog.notes.trim() ? dialog.notes.trim() : null,
          recommendation: dialog.recommendation,
        });
        onCheckInSaved(employee.id, created);
        toast.success(`Cek-in hari ke-${dialog.day} disimpan`);
      } else if (dialog.recordId) {
        const updated = await apiPatch<CheckInDto>(`/api/admin/hire/${employee.id}/checkins`, {
          id: dialog.recordId,
          rating: dialog.rating > 0 ? dialog.rating : null,
          notes: dialog.notes.trim() ? dialog.notes.trim() : null,
          recommendation: dialog.recommendation,
        });
        onCheckInSaved(employee.id, updated);
        toast.success(`Cek-in hari ke-${dialog.day} diperbarui`);
      }
      setDialog(null);
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <CalendarClock className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
        Cek-in Masa Percobaan
      </p>

      <ul className="flex flex-col gap-1.5">
        {CHECKIN_DAYS.map((day) => {
          const { record, dueIso, key } = statusOf(day);
          return (
            <li key={day} className="flex flex-col gap-2 rounded-lg border px-2.5 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Hari ke-{day}</p>
                  <p className="text-xs text-muted-foreground">
                    {dueIso ? `Tempo ${formatDate(dueIso)}` : "Tempo belum bisa dihitung"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {key === "selesai" ? (
                    <Badge variant="outline" className={BADGE_DONE}>
                      Selesai
                    </Badge>
                  ) : key === "jatuhTempo" ? (
                    <Badge variant="outline" className={BADGE_DUE}>
                      Jatuh tempo
                    </Badge>
                  ) : (
                    <Badge variant="outline">Belum waktunya</Badge>
                  )}
                  {record ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => openEdit(record)}
                      disabled={!canMutate}
                      aria-label={`Edit cek-in hari ke-${day} untuk ${employee.name}`}
                      title="Edit Cek-in"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950"
                      onClick={() => openCreate(day)}
                      disabled={!canMutate}
                    >
                      Isi Cek-in
                    </Button>
                  )}
                </div>
              </div>
              {record && (record.rating != null || record.notes || record.recommendation) ? (
                <div className="flex flex-col gap-1 border-t pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    {record.rating != null ? <RatingStars value={record.rating} size="size-3.5" /> : null}
                    {record.recommendation ? (
                      <Badge variant="outline" className={RECOMMENDATION_BADGE[record.recommendation]}>
                        {CHECKIN_RECOMMENDATION_LABELS[record.recommendation]}
                      </Badge>
                    ) : null}
                  </div>
                  {record.notes ? (
                    <p className="line-clamp-3 text-xs text-muted-foreground">{record.notes}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* Dialog isi/edit cek-in */}
      <Dialog
        open={!!dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "edit" ? "Edit Cek-in" : "Isi Cek-in"} Hari ke-{dialog?.day}
            </DialogTitle>
            <DialogDescription>
              {employee.name} — {employee.positionTitle ?? "Tanpa posisi"}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label className="text-sm">Rating perkembangan</Label>
              <div className="flex items-center gap-1" role="group" aria-label="Rating cek-in 1 sampai 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Button
                    key={n}
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    onClick={() => setDialog((prev) => (prev ? { ...prev, rating: n } : prev))}
                    disabled={saving}
                    aria-label={`Beri rating ${n} dari 5`}
                  >
                    <Star
                      className={cn(
                        "size-5",
                        n <= (dialog?.rating ?? 0)
                          ? "fill-amber-400 text-amber-400"
                          : "text-muted-foreground/40"
                      )}
                      aria-hidden="true"
                    />
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`checkin-recommendation-${dialog?.day ?? "x"}`} className="text-sm">
                Rekomendasi (opsional)
              </Label>
              <Select
                value={dialog?.recommendation ?? "NONE"}
                onValueChange={(value) =>
                  setDialog((prev) =>
                    prev
                      ? { ...prev, recommendation: value === "NONE" ? null : (value as CheckInRecommendation) }
                      : prev
                  )
                }
                disabled={saving}
              >
                <SelectTrigger id={`checkin-recommendation-${dialog?.day ?? "x"}`} className="w-full">
                  <SelectValue placeholder="Pilih rekomendasi" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Belum ada</SelectItem>
                  {CHECKIN_RECOMMENDATIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CHECKIN_RECOMMENDATION_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`checkin-notes-${dialog?.day ?? "x"}`} className="text-sm">
                Catatan
              </Label>
              <Textarea
                id={`checkin-notes-${dialog?.day ?? "x"}`}
                value={dialog?.notes ?? ""}
                onChange={(e) => setDialog((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                placeholder="Bagaimana perkembangan karyawan pada cek-in ini?"
                rows={4}
                maxLength={2000}
                disabled={saving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)} disabled={saving}>
              Batal
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={saving || (dialog?.rating ?? 0) < 1}
              className="bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyimpan...
                </>
              ) : dialog?.mode === "edit" ? (
                "Simpan Perubahan"
              ) : (
                "Simpan Cek-in"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* --------------------------------- Kartu karyawan --------------------------------- */

function EmployeeCard({
  employee,
  onPlanSaved,
  onCheckInSaved,
  onOpenExit,
}: {
  employee: Employee;
  onPlanSaved: (employeeId: string, field: PlanField, plan: PlanItem[]) => void;
  onCheckInSaved: (employeeId: string, checkIn: CheckInDto) => void;
  onOpenExit: (employee: Employee) => void;
}) {
  const { canMutate } = useAdminSession();
  const isAlumni = employee.exitAt != null;

  return (
    <Card className="gap-0 rounded-2xl p-4">
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">{employee.name}</p>
              {employee.permanentAt ? (
                <Badge variant="outline" className={BADGE_DONE}>
                  <BadgeCheck className="size-3" aria-hidden="true" />
                  Karyawan Tetap
                </Badge>
              ) : null}
              <Badge variant="secondary">{employee.positionTitle ?? "Tanpa posisi"}</Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarCheck className="size-3.5" aria-hidden="true" />
              Bergabung {formatDate(employee.hiredAt)}
            </p>
          </div>
          {isAlumni ? (
            <div className="flex min-w-0 flex-col gap-1.5 sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={BADGE_NEUTRAL}>
                  Alumni
                </Badge>
                {employee.exitReason ? (
                  <Badge variant="outline">{EXIT_REASON_LABELS[employee.exitReason]}</Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground sm:text-right">
                Keluar {formatDate(employee.exitAt)}
              </p>
              {employee.exitNote ? (
                <p className="max-w-xs text-xs italic text-muted-foreground/80 line-clamp-2 sm:text-right">
                  {employee.exitNote}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                onClick={() => onOpenExit(employee)}
                disabled={!canMutate}
              >
                <LogOut className="size-3.5" aria-hidden="true" />
                Akhiri Kerja
              </Button>
              <ProbationInfo employee={employee} />
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {isAlumni ? (
            <OffboardingChecklistEditor employee={employee} onPlanSaved={onPlanSaved} />
          ) : (
            <OnboardingPlanEditor employee={employee} onPlanSaved={onPlanSaved} />
          )}
          <CheckInSection employee={employee} onCheckInSaved={onCheckInSaved} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------- NR39-B — Seksi Kartu Karyawan (ID digital) ------------------- */

// CSS cetak massal: seluruh halaman disembunyikan, hanya koleksi .print-card
// (dari baris terpilih) yang tampil, satu kartu per halaman ukuran 85,6x54 mm.
const CARDS_PRINT_STYLE = `
@media print {
  html, body { height: auto !important; overflow: visible !important; }
  body * { visibility: hidden; }
  .print-card, .print-card * { visibility: visible; }
  .print-cards-bulk {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: block !important;
    background: #ffffff;
  }
  .print-card-page {
    width: 85.6mm;
    height: 54mm;
    overflow: hidden;
    break-inside: avoid;
    page-break-after: always;
  }
  @page { margin: 10mm; }
}
`;

const VERIFY_COUNT_WARNING = 20;

const BADGE_VERIFY_WARN =
  "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300";

// Props kartu ID untuk pratinjau/cetak dari DTO (URL verifikasi dari token current).
function cardIdProps(card: EmployeeCardDto): EmployeeIdCardProps {
  return {
    cardNumber: card.cardNumber,
    name: card.name,
    positionTitle: card.positionTitle,
    status: card.status,
    issuedAt: card.issuedAt,
    probationUntil: card.probationUntil,
    nikMasked: card.nikMasked,
    verifyUrl: cardVerifyUrl(card),
  };
}

function EmployeeCardsSection() {
  const { reportError } = useAdminSession();
  const [cards, setCards] = useState<EmployeeCardDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialogCard, setDialogCard] = useState<EmployeeCardDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await apiGet<EmployeeCardDto[]>("/api/admin/cards");
        const rows = Array.isArray(data) ? data : [];
        setCards(rows);
        // Buang pilihan yang kartunya sudah tidak ada.
        setSelectedIds((prev) => prev.filter((id) => rows.some((c) => c.id === id)));
      } catch (err) {
        reportError(err);
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: kartu terbit otomatis saat offer diterima / status berubah di tempat lain.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });

  const currentCards = useMemo(() => cards.filter((c) => c.isCurrent), [cards]);
  const historyCount = cards.length - currentCards.length;
  const selectedCards = useMemo(
    () => currentCards.filter((c) => selectedIds.includes(c.id)),
    [currentCards, selectedIds]
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function printSelected() {
    if (selectedCards.length === 0) return;
    // Koleksi cetak sudah dirender tersembunyi (print-cards-bulk);
    // CSS @media print di CARDS_PRINT_STYLE yang menampilkannya.
    window.print();
    toast.success(`${selectedCards.length} kartu dikirim ke dialog cetak`);
  }

  // Sinkron hasil dialog (PATCH checklist/aksi, POST reissue) ke daftar.
  const handleCardUpdated = useCallback((updated: EmployeeCardDto) => {
    setCards((prev) => {
      if (prev.some((c) => c.id === updated.id)) {
        return prev.map((c) => (c.id === updated.id ? updated : c));
      }
      // Kartu baru hasil reissue — kartu lama pada lamaran yang sama bukan current lagi.
      return [
        updated,
        ...prev.map((c) =>
          c.applicationId === updated.applicationId && c.id !== updated.id
            ? { ...c, isCurrent: false }
            : c
        ),
      ];
    });
    setDialogCard(updated);
  }, []);

  return (
    <Reveal>
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col gap-3 p-4">
          <style>{CARDS_PRINT_STYLE}</style>

          {/* Judul seksi */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400">
                <IdCard className="size-5" aria-hidden="true" />
              </span>
              <div>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  Kartu Karyawan
                  {historyCount > 0 ? (
                    <Badge variant="secondary" className="font-normal">
                      {historyCount} riwayat
                    </Badge>
                  ) : null}
                </CardTitle>
                <CardDescription className="mt-1">
                  Kartu digital untuk verifikasi keaslian karyawan — terbit otomatis saat
                  kandidat diterima.
                </CardDescription>
              </div>
            </div>
            {loading ? null : (
              <Button
                variant="outline"
                onClick={() => void load(true)}
                disabled={refreshing}
                className="h-11 active:scale-[0.99] sm:h-9"
                aria-label="Segarkan daftar kartu karyawan"
              >
                <RefreshCw
                  className={cn("size-4", refreshing && "animate-spin")}
                  aria-hidden="true"
                />
                <span className="sm:hidden">Segarkan</span>
              </Button>
            )}
          </div>

          {loading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : currentCards.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed p-6 text-center">
              <IdCard className="size-8 text-muted-foreground/50" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                Belum ada kartu. Kartu terbit otomatis begitu kandidat menerima penawaran
                (offer diterima).
              </p>
            </div>
          ) : (
            <>
              {/* Kontrol cetak massal */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {selectedIds.length > 0
                    ? `${selectedIds.length} kartu dipilih`
                    : "Centang kartu untuk mencetak massal"}
                </p>
                <Button
                  variant="outline"
                  onClick={printSelected}
                  disabled={selectedIds.length < 1}
                  className="h-11 sm:h-9"
                >
                  <Printer className="size-4" aria-hidden="true" />
                  Cetak Terpilih ({selectedIds.length})
                </Button>
              </div>

              {/* Daftar kartu current */}
              <ul className="flex flex-col gap-2">
                {currentCards.map((card) => {
                  const selected = selectedIds.includes(card.id);
                  return (
                    <li
                      key={card.id}
                      className={cn(
                        "flex flex-col gap-2.5 rounded-xl border p-3 sm:flex-row sm:items-center",
                        selected &&
                          "border-rose-300 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleSelect(card.id)}
                          aria-label={`Pilih kartu ${card.name} untuk dicetak`}
                          className="shrink-0"
                        />
                        <span
                          aria-hidden="true"
                          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-sm font-bold text-rose-600 dark:bg-rose-950 dark:text-rose-400"
                        >
                          {(card.name.trim().charAt(0) || "?").toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{card.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {card.positionTitle ?? "Tanpa posisi"} ·{" "}
                            <span className="font-mono">{card.cardNumber}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <CardStatusBadge status={card.status} />
                        <Badge
                          variant="secondary"
                          className={cn(
                            "tabular-nums",
                            card.verifyCount >= VERIFY_COUNT_WARNING && BADGE_VERIFY_WARN
                          )}
                          title={`Kartu diverifikasi ${card.verifyCount} kali`}
                        >
                          {card.verifyCount}×
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Terbit {formatDate(card.issuedAt)}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11 sm:h-8"
                          onClick={() => {
                            setDialogCard(card);
                            setDialogOpen(true);
                          }}
                          aria-label={`Kelola kartu ${card.name}`}
                        >
                          Kelola
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      {/* Koleksi cetak massal — tersembunyi di layar, tampil hanya saat window.print() */}
      {!dialogOpen && selectedCards.length > 0 ? (
        <div className="print-cards-bulk hidden" aria-hidden="true">
          {selectedCards.map((card) => {
            const props = cardIdProps(card);
            return (
              <Fragment key={card.id}>
                <div className="print-card print-card-page">
                  <EmployeeIdCardFront {...props} />
                </div>
                <div className="print-card print-card-page">
                  <EmployeeIdCardBack {...props} />
                </div>
              </Fragment>
            );
          })}
        </div>
      ) : null}

      {/* Dialog kelola kartu */}
      <EmployeeCardDialog
        card={dialogCard}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUpdated={handleCardUpdated}
      />
    </Reveal>
  );
}

/* ------------------- NR-40 — Panel & dialog keputusan probasi/exit ------------------- */

type DecisionRow = { employee: Employee; endMs: number };

/** Panel menonjol: karyawan yang masa percobaannya berakhir <= 14 hari lagi atau sudah lewat. */
function ProbationDecisionPanel({
  employees,
  canMutate,
  onPermanent,
  onExtend,
  onExit,
}: {
  employees: Employee[];
  canMutate: boolean;
  onPermanent: (employee: Employee) => void;
  onExtend: (employee: Employee) => void;
  onExit: (employee: Employee) => void;
}) {
  const rows = useMemo<DecisionRow[]>(() => {
    const now = Date.now();
    const windowMs = PROBATION_DECISION_WINDOW_DAYS * DAY_MS;
    return employees
      .filter((e) => !e.permanentAt && !e.exitAt && e.probationEnd)
      .map((e) => ({ employee: e, endMs: new Date(e.probationEnd as string).getTime() }))
      .filter((r) => !Number.isNaN(r.endMs) && r.endMs <= now + windowMs)
      .sort((a, b) => a.endMs - b.endMs);
  }, [employees]);

  if (rows.length === 0) return null;
  const hasOverdue = rows.some((r) => r.endMs < Date.now());

  return (
    <Reveal>
      <Card
        className={cn(
          "rounded-2xl border",
          hasOverdue
            ? "border-rose-300 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20"
            : "border-amber-300 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/20"
        )}
      >
        <CardContent className="flex flex-col gap-3 p-4">
          <div>
            <CardTitle className="flex items-center gap-2.5 text-base">
              <span
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                  hasOverdue
                    ? "border-rose-200 bg-rose-100 text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-400"
                    : "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
                )}
              >
                <Hourglass className="size-5" aria-hidden="true" />
              </span>
              Keputusan Masa Percobaan
            </CardTitle>
            <CardDescription className="mt-1">
              Masa percobaan berikut berakhir dalam {PROBATION_DECISION_WINDOW_DAYS} hari atau sudah lewat —
              tentukan keputusan akhir: tetap, perpanjang, atau akhiri kerja sama.
            </CardDescription>
          </div>

          <ul className="flex flex-col gap-2">
            {rows.map(({ employee, endMs }) => {
              const overdue = endMs < Date.now();
              const daysLeft = Math.ceil((endMs - Date.now()) / DAY_MS);
              return (
                <li
                  key={employee.id}
                  className={cn(
                    "flex flex-col gap-2.5 rounded-xl border bg-background p-3 lg:flex-row lg:items-center lg:justify-between",
                    overdue ? "border-rose-300 dark:border-rose-900" : "border-amber-300 dark:border-amber-900"
                  )}
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {employee.name}
                      <Badge variant="secondary">{employee.positionTitle ?? "Tanpa posisi"}</Badge>
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-xs",
                        overdue ? "text-rose-700 dark:text-rose-400" : "text-amber-700 dark:text-amber-400"
                      )}
                    >
                      Masa percobaan {employee.name} berakhir {formatDate(employee.probationEnd)}
                      {overdue ? " — sudah lewat" : ` — ${daysLeft} hari lagi`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      className="h-11 bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99] sm:h-9"
                      onClick={() => onPermanent(employee)}
                      disabled={!canMutate}
                    >
                      <BadgeCheck className="size-4" aria-hidden="true" />
                      Tetap
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11 border-amber-300 text-amber-800 hover:bg-amber-50 hover:text-amber-900 dark:border-amber-900 dark:text-amber-300 dark:hover:bg-amber-950 sm:h-9"
                      onClick={() => onExtend(employee)}
                      disabled={!canMutate}
                    >
                      <CalendarPlus className="size-4" aria-hidden="true" />
                      Perpanjang
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-11 border-rose-300 text-rose-700 hover:bg-rose-50 hover:text-rose-800 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950 sm:h-9"
                      onClick={() => onExit(employee)}
                      disabled={!canMutate}
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      Akhiri
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </Reveal>
  );
}

/** Dialog "Tetap" — konfirmasi jadikan Karyawan Tetap (POST probation PERMANENT). */
function PermanentConfirmDialog({
  employee,
  onClose,
  onConfirmed,
}: {
  employee: Employee;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const { reportError } = useAdminSession();
  const [saving, setSaving] = useState(false);

  async function handleConfirm() {
    if (saving) return;
    setSaving(true);
    try {
      await apiPost("/api/admin/hire/probation", {
        applicationId: employee.id,
        decision: "PERMANENT",
      });
      toast.success(`${employee.name} kini Karyawan Tetap`);
      onClose();
      onConfirmed();
    } catch (err) {
      reportError(err);
      setSaving(false);
    }
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <BadgeCheck className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Jadikan Karyawan Tetap?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Masa percobaan {employee.name} berakhir {formatDate(employee.probationEnd)}. Dengan keputusan ini
            {employee.name} menjadi Karyawan Tetap dan kartu berstatus Masa Percobaan otomatis menjadi Aktif.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Batal</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleConfirm();
            }}
            disabled={saving}
            className="bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Ya, Jadikan Tetap
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Dialog "Perpanjang" — tanggal baru (wajib masa depan) + alasan (wajib, >= 5 karakter). */
function ExtendProbationDialog({
  employee,
  onClose,
  onExtended,
}: {
  employee: Employee;
  onClose: () => void;
  onExtended: () => void;
}) {
  const { reportError } = useAdminSession();
  const [newEnd, setNewEnd] = useState(() => {
    const base = employee.probationEnd ? new Date(employee.probationEnd).getTime() : Date.now();
    const start = base > Date.now() ? base : Date.now();
    return dateInputValue(new Date(start + 60 * DAY_MS).toISOString());
  });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const newEndIso = dateInputToIso(newEnd);
  const isFuture = newEndIso != null && new Date(newEndIso).getTime() > Date.now();
  const reasonOk = reason.trim().length >= 5;
  const canSubmit = isFuture && reasonOk && !saving;

  async function handleSubmit() {
    if (!canSubmit || !newEndIso) return;
    setSaving(true);
    try {
      const updated = await apiPost<Employee>("/api/admin/hire/probation", {
        applicationId: employee.id,
        decision: "EXTEND",
        newProbationEnd: newEndIso,
        reason: reason.trim(),
      });
      toast.success(
        `Masa percobaan ${employee.name} diperpanjang s.d. ${formatDate(updated.probationEnd)}`
      );
      onClose();
      onExtended();
    } catch (err) {
      reportError(err);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            Perpanjang Masa Percobaan
          </DialogTitle>
          <DialogDescription>
            {employee.name} — {employee.positionTitle ?? "Tanpa posisi"}. Masa percobaan berakhir{" "}
            {formatDate(employee.probationEnd)}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="extend-probation-end">Tanggal perpanjangan</Label>
            <Input
              id="extend-probation-end"
              type="date"
              value={newEnd}
              onChange={(e) => setNewEnd(e.target.value)}
              disabled={saving}
            />
            {newEndIso && !isFuture ? (
              <p className="text-xs text-rose-700 dark:text-rose-400">
                Tanggal perpanjangan harus setelah hari ini.
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="extend-probation-reason">Alasan (wajib)</Label>
            <Textarea
              id="extend-probation-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Misal: target cek-in 60 hari belum tercapai, perlu evaluasi tambahan."
              disabled={saving}
            />
            {!reasonOk ? (
              <p className="text-xs text-muted-foreground">Minimal 5 karakter.</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="bg-amber-600 text-white hover:bg-amber-700 active:scale-[0.99]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Perpanjang
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog "Akhiri Kerja" — alasan keluar + tanggal + catatan opsional (POST /api/admin/hire/exit). */
function ExitEmployeeDialog({
  employee,
  onClose,
  onExited,
}: {
  employee: Employee;
  onClose: () => void;
  onExited: () => void;
}) {
  const { reportError } = useAdminSession();
  const [exitReason, setExitReason] = useState<ExitReason | "">("");
  const [exitDate, setExitDate] = useState(() => dateInputValue(new Date().toISOString()));
  const [exitNote, setExitNote] = useState("");
  const [saving, setSaving] = useState(false);

  const exitDateIso = dateInputToIso(exitDate);
  const canSubmit = !!exitReason && !!exitDateIso && !saving;

  async function handleSubmit() {
    if (!canSubmit || !exitDateIso) return;
    setSaving(true);
    try {
      await apiPost("/api/admin/hire/exit", {
        applicationId: employee.id,
        exitAt: exitDateIso,
        exitReason,
        exitNote: exitNote.trim() ? exitNote.trim() : undefined,
      });
      toast.success(`${employee.name} masuk daftar alumni`);
      onClose();
      onExited();
    } catch (err) {
      reportError(err);
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="size-5 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Akhiri Kerja
          </DialogTitle>
          <DialogDescription>
            {employee.name} — {employee.positionTitle ?? "Tanpa posisi"}. Kartu karyawan akan dicabut,
            checklist serah terima terbentuk otomatis, dan karyawan masuk daftar alumni.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="exit-reason">Alasan keluar</Label>
            <Select
              value={exitReason}
              onValueChange={(value) => setExitReason(value as ExitReason)}
              disabled={saving}
            >
              <SelectTrigger id="exit-reason" className="w-full">
                <SelectValue placeholder="Pilih alasan keluar" />
              </SelectTrigger>
              <SelectContent>
                {EXIT_REASONS.map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {EXIT_REASON_LABELS[reason]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="exit-date">Tanggal keluar</Label>
            <Input
              id="exit-date"
              type="date"
              value={exitDate}
              onChange={(e) => setExitDate(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="exit-note">Catatan (opsional)</Label>
            <Textarea
              id="exit-note"
              value={exitNote}
              onChange={(e) => setExitNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Misal: serah terima belum selesai, terbuka untuk rehire, dst."
              disabled={saving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="bg-rose-600 text-white hover:bg-rose-700 active:scale-[0.99]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Catat Keluar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ----------------------------------- Tab utama ----------------------------------- */

type EmployeeView = "aktif" | "alumni";

export function HireTab() {
  const { canMutate, reportError } = useAdminSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<EmployeeView>("aktif");
  const [permanentTarget, setPermanentTarget] = useState<Employee | null>(null);
  const [extendTarget, setExtendTarget] = useState<Employee | null>(null);
  const [exitTarget, setExitTarget] = useState<Employee | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);
      try {
        const data = await apiGet<Employee[]>("/api/admin/hire");
        setEmployees(Array.isArray(data) ? data : []);
      } catch (err) {
        reportError(err);
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [reportError]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: offer diterima / rencana / cek-in / keputusan probasi berubah di tempat lain.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });

  const summary = useMemo(() => {
    const now = Date.now();
    let probationActive = 0;
    let dueCheckIns = 0;
    for (const employee of employees) {
      const endMs = employee.probationEnd ? new Date(employee.probationEnd).getTime() : null;
      if (endMs != null && !Number.isNaN(endMs) && endMs > now && !employee.exitAt) {
        probationActive += 1;
      }
      for (const day of CHECKIN_DAYS) {
        const record = employee.checkIns.find((c) => c.day === day);
        if (record?.completedAt) continue;
        const due = dueAtOf(employee, day);
        if (due && due.getTime() <= now) dueCheckIns += 1;
      }
    }
    return { total: employees.length, probationActive, dueCheckIns };
  }, [employees]);

  const activeEmployees = useMemo(() => employees.filter((e) => !e.exitAt), [employees]);
  const alumniEmployees = useMemo(() => employees.filter((e) => !!e.exitAt), [employees]);
  const visibleEmployees = view === "aktif" ? activeEmployees : alumniEmployees;

  const handlePlanSaved = useCallback(
    (employeeId: string, field: PlanField, plan: PlanItem[]) => {
      setEmployees((prev) =>
        prev.map((e) => (e.id === employeeId ? { ...e, [field]: plan } : e))
      );
    },
    []
  );

  const handleCheckInSaved = useCallback((employeeId: string, checkIn: CheckInDto) => {
    setEmployees((prev) =>
      prev.map((e) => {
        if (e.id !== employeeId) return e;
        const exists = e.checkIns.some((c) => c.id === checkIn.id);
        return {
          ...e,
          checkIns: exists
            ? e.checkIns.map((c) => (c.id === checkIn.id ? checkIn : c))
            : [...e.checkIns, checkIn].sort((a, b) => a.day - b.day),
        };
      })
    );
  }, []);

  const openExitDialog = useCallback((employee: Employee) => {
    setExitTarget(employee);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg">Karyawan</CardTitle>
          <CardDescription className="mt-1">
            Onboarding, masa percobaan, cek-in 30/60/90 hari, hingga offboarding dan alumni.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="h-11 active:scale-[0.99] sm:h-10"
          aria-label="Segarkan daftar karyawan"
        >
          <RefreshCw
            className={cn("size-4", refreshing && "animate-spin")}
            aria-hidden="true"
          />
          <span className="sm:hidden">Segarkan</span>
        </Button>
      </Reveal>

      {/* Ringkasan 3 angka */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryStat
          icon={Users}
          label="Total Karyawan"
          value={summary.total}
          iconClass="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
        />
        <SummaryStat
          icon={CalendarClock}
          label="Masa Percobaan Berjalan"
          value={summary.probationActive}
          iconClass="border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400"
        />
        <SummaryStat
          icon={ClipboardCheck}
          label="Cek-in Jatuh Tempo"
          value={summary.dueCheckIns}
          iconClass="border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400"
        />
      </div>

      {/* NR-40 — keputusan masa percobaan yang mendekati/lewat jatuh tempo */}
      {!loading ? (
        <ProbationDecisionPanel
          employees={employees}
          canMutate={canMutate}
          onPermanent={setPermanentTarget}
          onExtend={setExtendTarget}
          onExit={openExitDialog}
        />
      ) : null}

      {/* NR39-B — Seksi Kartu Karyawan (kartu ID digital) */}
      <EmployeeCardsSection />

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-2xl" />
          ))}
        </div>
      ) : employees.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
            <Users className="size-10 text-muted-foreground/50" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              Belum ada karyawan. Daftar akan terisi otomatis setelah kandidat menerima penawaran.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Filter segmented: Aktif | Alumni */}
          <div
            className="inline-flex w-fit rounded-xl border bg-zinc-50 p-1 dark:bg-zinc-900/50"
            role="group"
            aria-label="Filter daftar karyawan"
          >
            <button
              type="button"
              onClick={() => setView("aktif")}
              aria-pressed={view === "aktif"}
              className={cn(
                "h-8 rounded-lg px-3 text-sm font-medium transition-colors",
                view === "aktif"
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Aktif ({activeEmployees.length})
            </button>
            <button
              type="button"
              onClick={() => setView("alumni")}
              aria-pressed={view === "alumni"}
              className={cn(
                "h-8 rounded-lg px-3 text-sm font-medium transition-colors",
                view === "alumni"
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Alumni ({alumniEmployees.length})
            </button>
          </div>

          {visibleEmployees.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                {view === "aktif" ? (
                  <Users className="size-10 text-muted-foreground/50" aria-hidden="true" />
                ) : (
                  <LogOut className="size-10 text-muted-foreground/50" aria-hidden="true" />
                )}
                <p className="text-sm text-muted-foreground">
                  {view === "aktif"
                    ? "Semua karyawan saat ini tercatat alumni. Pindah ke tab Alumni untuk melihatnya."
                    : "Belum ada alumni. Karyawan yang mengakhiri kerja sama akan tampil di sini."}
                </p>
              </CardContent>
            </Card>
          ) : (
            // Daftar panjang: digulir di dalam kontainer
            <div className="nice-scrollbar flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
              {visibleEmployees.map((employee) => (
                <EmployeeCard
                  key={employee.id}
                  employee={employee}
                  onPlanSaved={handlePlanSaved}
                  onCheckInSaved={handleCheckInSaved}
                  onOpenExit={openExitDialog}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialog keputusan probasi & offboarding */}
      {permanentTarget ? (
        <PermanentConfirmDialog
          employee={permanentTarget}
          onClose={() => setPermanentTarget(null)}
          onConfirmed={() => void load(true)}
        />
      ) : null}
      {extendTarget ? (
        <ExtendProbationDialog
          employee={extendTarget}
          onClose={() => setExtendTarget(null)}
          onExtended={() => void load(true)}
        />
      ) : null}
      {exitTarget ? (
        <ExitEmployeeDialog
          employee={exitTarget}
          onClose={() => setExitTarget(null)}
          onExited={() => void load(true)}
        />
      ) : null}
    </div>
  );
}
