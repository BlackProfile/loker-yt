"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Award,
  Calendar,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  Film,
  Globe,
  GraduationCap,
  Heart,
  Loader2,
  Mic,
  PenTool,
  Plus,
  Rocket,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  BENEFIT_ICONS,
  type FaqItem,
  type SiteContent,
} from "@/lib/types";
import { apiGet, apiPut } from "./api";

// Peta ikon lucide untuk benefit (fallback Sparkles).
const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles,
  Film,
  Users,
  Rocket,
  Wallet,
  GraduationCap,
  Globe,
  Clock,
  Zap,
  Award,
  Heart,
  Calendar,
  Camera,
  Mic,
  PenTool,
  TrendingUp,
};

function BenefitIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? Sparkles;
  return <Icon className={className} aria-hidden="true" />;
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = [...items];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function PasswordInput({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="h-10 pr-10"
        />
        <button
          type="button"
          aria-label={show ? `Sembunyikan ${label.toLowerCase()}` : `Lihat ${label.toLowerCase()}`}
          onClick={() => setShow((v) => !v)}
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {show ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

export function SettingsTab() {
  const [site, setSite] = useState<SiteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSaving, setPwSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<{ site: SiteContent }>("/api/admin/settings");
      setSite(JSON.parse(JSON.stringify(data.site)) as SiteContent);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateField<K extends keyof SiteContent>(key: K, value: SiteContent[K]) {
    setSite((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateBenefit(index: number, patch: Partial<SiteContent["benefits"][number]>) {
    setSite((prev) =>
      prev
        ? {
            ...prev,
            benefits: prev.benefits.map((b, i) => (i === index ? { ...b, ...patch } : b)),
          }
        : prev
    );
  }

  function updateFaq(index: number, patch: Partial<FaqItem>) {
    setSite((prev) =>
      prev
        ? {
            ...prev,
            faqs: prev.faqs.map((f, i) => (i === index ? { ...f, ...patch } : f)),
          }
        : prev
    );
  }

  async function handleSaveSite() {
    if (!site || saving) return;
    setSaving(true);
    try {
      const res = await apiPut<{ ok: boolean; site: SiteContent }>(
        "/api/admin/settings",
        { site }
      );
      setSite(JSON.parse(JSON.stringify(res.site)) as SiteContent);
      toast.success("Pengaturan disimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pwSaving) return;
    setPwError(null);
    if (newPassword.length < 6) {
      setPwError("Password baru minimal 6 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwError("Konfirmasi password tidak sama dengan password baru.");
      return;
    }
    setPwSaving(true);
    try {
      await apiPut<{ ok: boolean }>("/api/admin/settings", {
        currentPassword,
        newPassword,
      });
      toast.success("Password berhasil diganti");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setPwSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (loadError || !site) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {loadError ?? "Pengaturan tidak tersedia."}
          </p>
          <Button variant="outline" onClick={() => void load()} className="h-10">
            Coba Lagi
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Identitas & Hero */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Identitas &amp; Hero</CardTitle>
          <CardDescription>
            Nama situs dan isi bagian hero halaman publik.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-0 md:grid-cols-2">
          <Field id="f-siteName" label="Nama Situs">
            <Input
              id="f-siteName"
              value={site.siteName}
              onChange={(e) => updateField("siteName", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field id="f-tagline" label="Tagline">
            <Input
              id="f-tagline"
              value={site.tagline}
              onChange={(e) => updateField("tagline", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field id="f-heroBadge" label="Badge Hero">
            <Input
              id="f-heroBadge"
              value={site.heroBadge}
              onChange={(e) => updateField("heroBadge", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field id="f-deadline" label="Deadline" hint="Format bebas, mis. 30 September 2025. Kosongkan jika tidak ada.">
            <Input
              id="f-deadline"
              value={site.deadline}
              onChange={(e) => updateField("deadline", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field id="f-heroTitle" label="Judul Hero">
            <Input
              id="f-heroTitle"
              value={site.heroTitle}
              onChange={(e) => updateField("heroTitle", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field id="f-heroHighlight" label="Kata Highlight Hero" hint="Kata yang dihighlight gradien">
            <Input
              id="f-heroHighlight"
              value={site.heroHighlight}
              onChange={(e) => updateField("heroHighlight", e.target.value)}
              className="h-10"
            />
          </Field>
          <div className="md:col-span-2">
            <Field id="f-heroDescription" label="Deskripsi Hero">
              <Textarea
                id="f-heroDescription"
                value={site.heroDescription}
                onChange={(e) => updateField("heroDescription", e.target.value)}
                rows={3}
              />
            </Field>
          </div>
          <Field id="f-aboutTitle" label="Judul Tentang">
            <Input
              id="f-aboutTitle"
              value={site.aboutTitle}
              onChange={(e) => updateField("aboutTitle", e.target.value)}
              className="h-10"
            />
          </Field>
          <div className="md:col-span-1">
            <Field id="f-aboutDescription" label="Deskripsi Tentang">
              <Textarea
                id="f-aboutDescription"
                value={site.aboutDescription}
                onChange={(e) => updateField("aboutDescription", e.target.value)}
                rows={3}
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* Kontak & Footer */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Kontak &amp; Footer</CardTitle>
          <CardDescription>
            Informasi kontak dan teks footer halaman publik.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 px-0 md:grid-cols-2">
          <Field id="f-contactEmail" label="Email Kontak">
            <Input
              id="f-contactEmail"
              type="email"
              value={site.contactEmail}
              onChange={(e) => updateField("contactEmail", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field
            id="f-contactWhatsapp"
            label="WhatsApp"
            hint="Format internasional tanpa tanda +, mis. 6281234567890"
          >
            <Input
              id="f-contactWhatsapp"
              value={site.contactWhatsapp}
              onChange={(e) => updateField("contactWhatsapp", e.target.value)}
              className="h-10"
            />
          </Field>
          <Field id="f-instagram" label="Instagram">
            <Input
              id="f-instagram"
              value={site.instagram}
              onChange={(e) => updateField("instagram", e.target.value)}
              placeholder="@lumina.studio"
              className="h-10"
            />
          </Field>
          <Field id="f-footerText" label="Teks Footer">
            <Input
              id="f-footerText"
              value={site.footerText}
              onChange={(e) => updateField("footerText", e.target.value)}
              className="h-10"
            />
          </Field>
        </CardContent>
      </Card>

      {/* Benefit */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Benefit Halaman Publik</CardTitle>
          <CardDescription>
            Daftar keuntungan bergabung yang tampil di landing page.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          {site.benefits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada benefit. Tambahkan minimal satu agar bagian benefit tampil menarik.
            </p>
          ) : (
            site.benefits.map((benefit, index) => (
              <div
                key={index}
                className="flex flex-col gap-2 rounded-xl border p-3 md:grid md:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-center"
              >
                <div className="flex items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600">
                    <BenefitIcon name={benefit.icon} className="size-4" />
                  </span>
                  <Select
                    value={benefit.icon}
                    onValueChange={(v) => updateBenefit(index, { icon: v })}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full min-w-0"
                      aria-label={`Ikon benefit ${index + 1}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BENEFIT_ICONS.map((icon) => (
                        <SelectItem key={icon} value={icon}>
                          {icon}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={benefit.title}
                  onChange={(e) => updateBenefit(index, { title: e.target.value })}
                  placeholder="Judul benefit"
                  aria-label={`Judul benefit ${index + 1}`}
                  className="h-10"
                />
                <Input
                  value={benefit.description}
                  onChange={(e) => updateBenefit(index, { description: e.target.value })}
                  placeholder="Deskripsi singkat"
                  aria-label={`Deskripsi benefit ${index + 1}`}
                  className="h-10"
                />
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 sm:size-9"
                    onClick={() =>
                      setSite((prev) =>
                        prev ? { ...prev, benefits: moveItem(prev.benefits, index, -1) } : prev
                      )
                    }
                    disabled={index === 0}
                    aria-label={`Naikkan benefit ${index + 1}`}
                  >
                    <ChevronUp className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 sm:size-9"
                    onClick={() =>
                      setSite((prev) =>
                        prev ? { ...prev, benefits: moveItem(prev.benefits, index, 1) } : prev
                      )
                    }
                    disabled={index === site.benefits.length - 1}
                    aria-label={`Turunkan benefit ${index + 1}`}
                  >
                    <ChevronDown className="size-4" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-10 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9"
                    onClick={() =>
                      setSite((prev) =>
                        prev
                          ? { ...prev, benefits: prev.benefits.filter((_, i) => i !== index) }
                          : prev
                      )
                    }
                    aria-label={`Hapus benefit ${index + 1}`}
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))
          )}
          <Button
            variant="outline"
            className="h-10 w-fit"
            onClick={() =>
              setSite((prev) =>
                prev
                  ? {
                      ...prev,
                      benefits: [
                        ...prev.benefits,
                        { icon: "Sparkles", title: "Benefit Baru", description: "" },
                      ],
                    }
                  : prev
              )
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah Benefit
          </Button>
        </CardContent>
      </Card>

      {/* FAQ */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">FAQ Halaman Publik</CardTitle>
          <CardDescription>
            Pertanyaan yang sering diajukan calon kreator.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          {site.faqs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada FAQ. Tambahkan pertanyaan untuk membantu calon pelamar.
            </p>
          ) : (
            site.faqs.map((faq, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex items-center gap-2">
                  <Input
                    value={faq.question}
                    onChange={(e) => updateFaq(index, { question: e.target.value })}
                    placeholder="Pertanyaan"
                    aria-label={`Pertanyaan FAQ ${index + 1}`}
                    className="h-10"
                  />
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 sm:size-9"
                      onClick={() =>
                        setSite((prev) =>
                          prev ? { ...prev, faqs: moveItem(prev.faqs, index, -1) } : prev
                        )
                      }
                      disabled={index === 0}
                      aria-label={`Naikkan FAQ ${index + 1}`}
                    >
                      <ChevronUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 sm:size-9"
                      onClick={() =>
                        setSite((prev) =>
                          prev ? { ...prev, faqs: moveItem(prev.faqs, index, 1) } : prev
                        )
                      }
                      disabled={index === site.faqs.length - 1}
                      aria-label={`Turunkan FAQ ${index + 1}`}
                    >
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9"
                      onClick={() =>
                        setSite((prev) =>
                          prev ? { ...prev, faqs: prev.faqs.filter((_, i) => i !== index) } : prev
                        )
                      }
                      aria-label={`Hapus FAQ ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={faq.answer}
                  onChange={(e) => updateFaq(index, { answer: e.target.value })}
                  placeholder="Jawaban"
                  aria-label={`Jawaban FAQ ${index + 1}`}
                  rows={2}
                />
              </div>
            ))
          )}
          <Button
            variant="outline"
            className="h-10 w-fit"
            onClick={() =>
              setSite((prev) =>
                prev ? { ...prev, faqs: [...prev.faqs, { question: "", answer: "" }] } : prev
              )
            }
          >
            <Plus className="size-4" aria-hidden="true" />
            Tambah FAQ
          </Button>
        </CardContent>
      </Card>

      {/* Bar simpan sticky */}
      <Card className="sticky bottom-4 z-10 flex-row items-center justify-between gap-3 rounded-2xl border-rose-200 bg-rose-50/80 p-4 backdrop-blur">
        <p className="text-sm font-medium">
          Perubahan konten situs belum disimpan.
        </p>
        <Button
          onClick={() => void handleSaveSite()}
          disabled={saving}
          className="h-10 shrink-0"
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
      </Card>

      {/* Keamanan */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Keamanan</CardTitle>
          <CardDescription>
            Ganti password admin panel. Password disimpan terenkripsi di server.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-3">
              <PasswordInput
                id="f-currentPassword"
                label="Password saat ini"
                value={currentPassword}
                onChange={setCurrentPassword}
                autoComplete="current-password"
              />
              <PasswordInput
                id="f-newPassword"
                label="Password baru"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <PasswordInput
                id="f-confirmPassword"
                label="Konfirmasi password baru"
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
              />
            </div>
            {pwError ? (
              <p className="text-sm text-rose-600" role="alert">
                {pwError}
              </p>
            ) : null}
            <div>
              <Button type="submit" className="h-10" disabled={pwSaving}>
                {pwSaving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Menyimpan...
                  </>
                ) : (
                  "Ganti Password"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
