"use client";

// Tab Karyawan — onboarding & masa percobaan untuk application yang sudah diterima (hiredAt terisi).
// Ringkasan 3 angka, progres masa percobaan, editor Rencana Onboarding
// ({id,label,owner?,dueAt?,done}[] di application.onboardingPlan), dan cek-in 30/60/90 hari.
// Aksen emerald = onboarding positif; amber/rose sesuai konteks perhatian.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CalendarCheck,
  CalendarClock,
  ClipboardCheck,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
  onboardingPlan: PlanItem[];
  checkIns: CheckInDto[];
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECKIN_DAYS = [30, 60, 90] as const;

const BADGE_DONE =
  "border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400";
const BADGE_DUE =
  "border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400";

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

  if (!employee.probationEnd || Number.isNaN(endMs ?? NaN) || Number.isNaN(hiredMs)) {
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

/* ------------------------------ Editor rencana onboarding ------------------------------ */

function OnboardingPlanEditor({
  employee,
  onPlanSaved,
}: {
  employee: Employee;
  onPlanSaved: (employeeId: string, plan: PlanItem[]) => void;
}) {
  const { canMutate, reportError } = useAdminSession();
  const [draft, setDraft] = useState<PlanItem[]>(employee.onboardingPlan);
  const [newLabel, setNewLabel] = useState("");
  const [newOwner, setNewOwner] = useState("");
  const [newDue, setNewDue] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(employee.onboardingPlan),
    [draft, employee.onboardingPlan]
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
      const res = await apiPatch<{ ok: boolean; onboardingPlan: PlanItem[] }>(
        `/api/admin/hire/${employee.id}`,
        { onboardingPlan: draft }
      );
      setDraft(res.onboardingPlan);
      onPlanSaved(employee.id, res.onboardingPlan);
      toast.success("Rencana onboarding disimpan");
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
          <ClipboardCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          Rencana Onboarding
        </p>
        {draft.length > 0 ? (
          <Badge variant="outline" className={BADGE_DONE}>
            {doneCount}/{draft.length} selesai
          </Badge>
        ) : null}
      </div>

      {/* Daftar item — list panjang dapat digulir */}
      <div className="nice-scrollbar max-h-96 overflow-y-auto">
        {draft.length === 0 ? (
          <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            Belum ada item. Tambahkan agenda onboarding di bawah, misalnya orientasi, intro mentor, atau target
            minggu pertama.
          </p>
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
            <Label htmlFor={`plan-label-${employee.id}`} className="text-xs">
              Item
            </Label>
            <Input
              id={`plan-label-${employee.id}`}
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
              placeholder="Misal: Orientasi & tur studio"
              maxLength={120}
              disabled={!canMutate || saving}
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`plan-owner-${employee.id}`} className="text-xs">
              PIC (opsional)
            </Label>
            <Input
              id={`plan-owner-${employee.id}`}
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
            <Label htmlFor={`plan-due-${employee.id}`} className="text-xs">
              Tenggat (opsional)
            </Label>
            <Input
              id={`plan-due-${employee.id}`}
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
          className="bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.99]"
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Menyimpan...
            </>
          ) : (
            "Simpan Rencana"
          )}
        </Button>
      ) : null}
    </div>
  );
}

/* --------------------------------- Bagian cek-in --------------------------------- */

type CheckInDialogState = {
  day: number;
  mode: "create" | "edit";
  recordId: string | null;
  rating: number;
  notes: string;
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
    setDialog({ day, mode: "create", recordId: null, rating: 0, notes: "" });
  }

  function openEdit(record: CheckInDto) {
    setDialog({
      day: record.day,
      mode: "edit",
      recordId: record.id,
      rating: record.rating ?? 0,
      notes: record.notes ?? "",
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
        });
        onCheckInSaved(employee.id, created);
        toast.success(`Cek-in hari ke-${dialog.day} disimpan`);
      } else if (dialog.recordId) {
        const updated = await apiPatch<CheckInDto>(`/api/admin/hire/${employee.id}/checkins`, {
          id: dialog.recordId,
          rating: dialog.rating > 0 ? dialog.rating : null,
          notes: dialog.notes.trim() ? dialog.notes.trim() : null,
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
              {record && (record.rating != null || record.notes) ? (
                <div className="flex flex-col gap-1 border-t pt-2">
                  {record.rating != null ? <RatingStars value={record.rating} size="size-3.5" /> : null}
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
}: {
  employee: Employee;
  onPlanSaved: (employeeId: string, plan: PlanItem[]) => void;
  onCheckInSaved: (employeeId: string, checkIn: CheckInDto) => void;
}) {
  return (
    <Card className="gap-0 rounded-2xl p-4">
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold">{employee.name}</p>
              <Badge variant="secondary">{employee.positionTitle ?? "Tanpa posisi"}</Badge>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarCheck className="size-3.5" aria-hidden="true" />
              Bergabung {formatDate(employee.hiredAt)}
            </p>
          </div>
          <ProbationInfo employee={employee} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <OnboardingPlanEditor employee={employee} onPlanSaved={onPlanSaved} />
          <CheckInSection employee={employee} onCheckInSaved={onCheckInSaved} />
        </div>
      </CardContent>
    </Card>
  );
}

/* ----------------------------------- Tab utama ----------------------------------- */

export function HireTab() {
  const { reportError } = useAdminSession();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  // Realtime: offer diterima / rencana onboarding / cek-in berubah di tempat lain.
  useLiveRefresh("applications:changed", () => {
    void load(true);
  });

  const summary = useMemo(() => {
    const now = Date.now();
    let probationActive = 0;
    let dueCheckIns = 0;
    for (const employee of employees) {
      const endMs = employee.probationEnd ? new Date(employee.probationEnd).getTime() : null;
      if (endMs != null && !Number.isNaN(endMs) && endMs > now) probationActive += 1;
      for (const checkIn of employee.checkIns) {
        if (checkIn.completedAt) continue;
        const due = dueAtOf(employee, checkIn.day);
        if (due && due.getTime() <= now) dueCheckIns += 1;
      }
    }
    return { total: employees.length, probationActive, dueCheckIns };
  }, [employees]);

  const handlePlanSaved = useCallback((employeeId: string, plan: PlanItem[]) => {
    setEmployees((prev) =>
      prev.map((e) => (e.id === employeeId ? { ...e, onboardingPlan: plan } : e))
    );
  }, []);

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

  return (
    <div className="flex flex-col gap-4">
      <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="text-lg">Karyawan</CardTitle>
          <CardDescription className="mt-1">
            Pendampingan onboarding, masa percobaan, dan cek-in 30/60/90 hari.
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
        // Daftar panjang: digulir di dalam kontainer
        <div className="nice-scrollbar flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
          {employees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              onPlanSaved={handlePlanSaved}
              onCheckInSaved={handleCheckInSaved}
            />
          ))}
        </div>
      )}
    </div>
  );
}
