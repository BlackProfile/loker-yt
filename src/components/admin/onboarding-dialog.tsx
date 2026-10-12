"use client";

// NR49 Paket D — dialog "Paket Onboarding (AI)" untuk karyawan baru (hiredAt terisi).
// Bila pack belum ada: tombol "Hasilkan dengan AI" (POST). Bila ada: form editable
// (checklist/email sambutan/peralatan, satu item per baris) + Simpan (PATCH) +
// Salin Email + Hasilkan Ulang (POST) dengan peringatan inline bila ada editan.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, Copy, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiGet, apiPatch, apiPost } from "./api";
import { useAdminSession } from "./admin-context";
import { copyText } from "./format";

type Pack = {
  checklist: string[];
  welcomeEmail: string;
  equipment: string[];
  generatedAt?: string;
  editedAt?: string;
};

type PackForm = { checklist: string; welcomeEmail: string; equipment: string };

function formFromPack(pack: Pack | null): PackForm {
  return {
    checklist: (pack?.checklist ?? []).join("\n"),
    welcomeEmail: pack?.welcomeEmail ?? "",
    equipment: (pack?.equipment ?? []).join("\n"),
  };
}

function listFromText(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function OnboardingDialog({
  open,
  onOpenChange,
  applicationId,
  name,
  positionTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string;
  name: string;
  positionTitle: string | null;
}) {
  const { reportError } = useAdminSession();
  const [loadingPack, setLoadingPack] = useState(true);
  const [pack, setPack] = useState<Pack | null>(null);
  const [form, setForm] = useState<PackForm>({ checklist: "", welcomeEmail: "", equipment: "" });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPack = useCallback(async () => {
    setLoadingPack(true);
    try {
      const res = await apiGet<{ pack: Pack | null }>(
        `/api/admin/applications/${applicationId}/onboarding-pack`,
      );
      setPack(res.pack);
      setForm(formFromPack(res.pack));
    } catch (err) {
      reportError(err);
      setPack(null);
      setForm({ checklist: "", welcomeEmail: "", equipment: "" });
    } finally {
      setLoadingPack(false);
    }
  }, [applicationId, reportError]);

  useEffect(() => {
    if (open) void loadPack();
  }, [open, loadPack]);

  const dirty = useMemo(() => {
    return JSON.stringify(formFromPack(pack)) !== JSON.stringify(form);
  }, [pack, form]);

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await apiPost<{ pack: Pack }>(
        `/api/admin/applications/${applicationId}/onboarding-pack`,
      );
      setPack(res.pack);
      setForm(formFromPack(res.pack));
      toast.success("Paket onboarding dibuat — silakan tinjau dan sesuaikan.");
    } catch (err) {
      reportError(err);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (saving) return;
    const checklist = listFromText(form.checklist);
    const equipment = listFromText(form.equipment);
    if (checklist.length === 0) {
      toast.error("Checklist wajib berisi minimal satu item.");
      return;
    }
    if (!form.welcomeEmail.trim()) {
      toast.error("Email sambutan wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiPatch<{ pack: Pack }>(
        `/api/admin/applications/${applicationId}/onboarding-pack`,
        { pack: { checklist, welcomeEmail: form.welcomeEmail.trim(), equipment } },
      );
      setPack(res.pack);
      setForm(formFromPack(res.pack));
      toast.success("Paket onboarding disimpan");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyEmail() {
    const ok = await copyText(form.welcomeEmail);
    if (ok) toast.success("Email sambutan disalin");
    else toast.error("Gagal menyalin email sambutan");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-2xl sm:max-w-xl nice-scrollbar">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            Paket Onboarding (AI)
          </DialogTitle>
          <DialogDescription>
            Checklist hari pertama, draf email sambutan, dan kebutuhan peralatan untuk{" "}
            <span className="font-medium text-foreground">{name}</span>
            {positionTitle ? ` — ${positionTitle}` : ""}. AI mengusulkan; Anda bebas menyunting.
          </DialogDescription>
        </DialogHeader>

        {loadingPack ? (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat paket onboarding...
          </div>
        ) : !pack ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Belum ada paket onboarding untuk karyawan ini. Hasilkan draf otomatis dari
              data posisi dan offer, lalu sunting sesuai kebutuhan.
            </p>
            <Button
              className="h-11 w-full active:scale-[0.99] sm:w-fit"
              onClick={() => void handleGenerate()}
              disabled={generating}
            >
              {generating ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Menyusun paket...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden="true" />
                  Hasilkan dengan AI
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pack-checklist" className="text-xs">
                Checklist hari pertama &amp; minggu pertama (satu item per baris)
              </Label>
              <Textarea
                id="pack-checklist"
                value={form.checklist}
                onChange={(e) => setForm((prev) => ({ ...prev, checklist: e.target.value }))}
                rows={6}
                className="nice-scrollbar max-h-56 overflow-y-auto"
                aria-label="Checklist onboarding, satu item per baris"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="pack-email" className="text-xs">
                  Draf email sambutan
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => void handleCopyEmail()}
                  aria-label="Salin email sambutan ke clipboard"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  Salin Email
                </Button>
              </div>
              <Textarea
                id="pack-email"
                value={form.welcomeEmail}
                onChange={(e) => setForm((prev) => ({ ...prev, welcomeEmail: e.target.value }))}
                rows={7}
                className="nice-scrollbar max-h-56 overflow-y-auto"
                aria-label="Draf email sambutan karyawan baru"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pack-equipment" className="text-xs">
                Kebutuhan peralatan / akses (satu item per baris)
              </Label>
              <Textarea
                id="pack-equipment"
                value={form.equipment}
                onChange={(e) => setForm((prev) => ({ ...prev, equipment: e.target.value }))}
                rows={4}
                className="nice-scrollbar max-h-56 overflow-y-auto"
                aria-label="Kebutuhan peralatan, satu item per baris"
              />
            </div>

            {dirty ? (
              <p className="text-xs text-amber-700 dark:text-amber-400" role="status">
                Ada perubahan yang belum disimpan — menekan &quot;Hasilkan Ulang&quot; akan
                menimpa suntingan Anda.
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                className="h-11 flex-1 active:scale-[0.99] sm:flex-none"
                onClick={() => void handleSave()}
                disabled={saving || generating || !dirty}
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Menyimpan...
                  </>
                ) : (
                  "Simpan Perubahan"
                )}
              </Button>
              <Button
                variant="outline"
                className="h-11 flex-1 sm:flex-none"
                onClick={() => void handleGenerate()}
                disabled={generating || saving}
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Menyusun paket...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Hasilkan Ulang
                  </>
                )}
              </Button>
            </div>
            {pack.editedAt ? (
              <p className="text-[11px] text-muted-foreground">
                Terakhir disunting admin — hasil ulang akan menggantikan isi di atas.
              </p>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
