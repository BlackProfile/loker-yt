"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";
import type { Position } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FormValues = {
  name: string;
  email: string;
  phone: string;
  portfolioUrl: string;
  socialLinks: string;
  experience: string;
  motivation: string;
};

type FieldKey = keyof FormValues | "positionId";

type FormErrors = Partial<Record<FieldKey, string>>;

const INITIAL_VALUES: FormValues = {
  name: "",
  email: "",
  phone: "",
  portfolioUrl: "",
  socialLinks: "",
  experience: "",
  motivation: "",
};

type ApplyFormProps = {
  positions: Position[];
  positionId: string;
  onPositionIdChange: (positionId: string) => void;
};

export function ApplyForm({
  positions,
  positionId,
  onPositionIdChange,
}: ApplyFormProps) {
  const [values, setValues] = useState<FormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submittedName, setSubmittedName] = useState<string | null>(null);

  const setField = (key: keyof FormValues, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const clearPositionError = () => {
    setErrors((prev) =>
      prev.positionId ? { ...prev, positionId: undefined } : prev,
    );
  };

  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!values.name.trim()) next.name = "Nama lengkap wajib diisi.";
    if (!values.email.trim()) next.email = "Email wajib diisi.";
    else if (!EMAIL_RE.test(values.email.trim()))
      next.email = "Format email tidak valid.";
    if (!values.phone.trim()) next.phone = "No. WhatsApp wajib diisi.";
    else if (values.phone.replace(/\D/g, "").length < 8)
      next.phone = "No. WhatsApp minimal 8 digit.";
    if (positions.length > 0 && !positionId)
      next.positionId = "Pilih posisi yang dilamar.";
    if (values.experience.trim().length < 10)
      next.experience = "Ceritakan pengalamanmu minimal 10 karakter.";
    if (values.motivation.trim().length < 10)
      next.motivation = "Tulis alasanmu minimal 10 karakter.";
    return next;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          phone: values.phone.trim(),
          positionId: positionId || null,
          portfolioUrl: values.portfolioUrl.trim() || null,
          socialLinks: values.socialLinks.trim() || null,
          experience: values.experience.trim(),
          motivation: values.motivation.trim(),
        }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const serverError =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : null;
        toast.error(serverError ?? "Gagal mengirim lamaran. Coba lagi ya.");
        return;
      }
      toast.success("Lamaran berhasil dikirim!");
      setSubmittedName(values.name.trim());
    } catch {
      toast.error("Gagal mengirim lamaran. Coba lagi ya.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setValues(INITIAL_VALUES);
    setErrors({});
    setSubmittedName(null);
    onPositionIdChange("");
  }

  if (submittedName !== null) {
    return (
      <div
        role="status"
        className="flex flex-col items-center justify-center gap-4 py-10 text-center"
      >
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100">
          <CheckCircle2 className="h-12 w-12 text-emerald-600" aria-hidden="true" />
        </div>
        <h3 className="text-2xl font-bold">Lamaran Terkirim!</h3>
        <p className="max-w-md text-sm text-muted-foreground">
          Terima kasih {submittedName}, lamaranmu sudah kami terima. Tim kami
          akan menghubungimu via email atau WhatsApp dalam 1-3 hari kerja.
        </p>
        <Button variant="outline" className="mt-2 h-11" onClick={resetForm}>
          Kirim Lamaran Lain
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold">Formulir Lamaran</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Kolom bertanda <span className="text-rose-600">*</span> wajib diisi.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-name">
              Nama Lengkap <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="apply-name"
              name="name"
              value={values.name}
              onChange={(e) => setField("name", e.target.value)}
              placeholder="cth. Rani Putri"
              autoComplete="name"
              className="h-11"
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "apply-name-error" : undefined}
            />
            {errors.name ? (
              <p id="apply-name-error" className="text-sm text-rose-600">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-email">
              Email <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="apply-email"
              name="email"
              type="email"
              value={values.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="nama@email.com"
              autoComplete="email"
              className="h-11"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "apply-email-error" : undefined}
            />
            {errors.email ? (
              <p id="apply-email-error" className="text-sm text-rose-600">
                {errors.email}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-phone">
              No. WhatsApp <span className="text-rose-600">*</span>
            </Label>
            <Input
              id="apply-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              value={values.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="6281234567890"
              autoComplete="tel"
              className="h-11"
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? "apply-phone-error" : undefined}
            />
            {errors.phone ? (
              <p id="apply-phone-error" className="text-sm text-rose-600">
                {errors.phone}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-position">
              Posisi yang Dilamar <span className="text-rose-600">*</span>
            </Label>
            <Select
              value={positionId || undefined}
              onValueChange={(value) => {
                onPositionIdChange(value);
                clearPositionError();
              }}
              disabled={positions.length === 0}
            >
              <SelectTrigger
                id="apply-position"
                className="h-11 w-full"
                aria-invalid={errors.positionId ? true : undefined}
                aria-describedby={
                  errors.positionId ? "apply-position-error" : undefined
                }
              >
                <SelectValue
                  placeholder={
                    positions.length === 0
                      ? "Belum ada posisi tersedia"
                      : "Pilih posisi"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {positions.map((position) => (
                  <SelectItem key={position.id} value={position.id}>
                    {position.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.positionId ? (
              <p id="apply-position-error" className="text-sm text-rose-600">
                {errors.positionId}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-portfolio">Link Portofolio / Video</Label>
            <Input
              id="apply-portfolio"
              name="portfolioUrl"
              type="url"
              value={values.portfolioUrl}
              onChange={(e) => setField("portfolioUrl", e.target.value)}
              placeholder="https://..."
              className="h-11"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="apply-social">Link Sosial Media</Label>
            <Input
              id="apply-social"
              name="socialLinks"
              type="url"
              value={values.socialLinks}
              onChange={(e) => setField("socialLinks", e.target.value)}
              placeholder="https://instagram.com/..."
              className="h-11"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="apply-experience">
            Pengalaman Kamu <span className="text-rose-600">*</span>
          </Label>
          <Textarea
            id="apply-experience"
            name="experience"
            rows={4}
            value={values.experience}
            onChange={(e) => setField("experience", e.target.value)}
            placeholder="Contoh: Selama 2 tahun saya membuat video pendek di TikTok dan mengelola akun dengan 50 ribu pengikut."
            aria-invalid={errors.experience ? true : undefined}
            aria-describedby={
              errors.experience ? "apply-experience-error" : undefined
            }
          />
          {errors.experience ? (
            <p id="apply-experience-error" className="text-sm text-rose-600">
              {errors.experience}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="apply-motivation">
            Alasan Bergabung <span className="text-rose-600">*</span>
          </Label>
          <Textarea
            id="apply-motivation"
            name="motivation"
            rows={4}
            value={values.motivation}
            onChange={(e) => setField("motivation", e.target.value)}
            placeholder="Contoh: Saya ingin bertumbuh bersama tim kreatif dan berkontribusi pada konten yang bermanfaat bagi banyak orang."
            aria-invalid={errors.motivation ? true : undefined}
            aria-describedby={
              errors.motivation ? "apply-motivation-error" : undefined
            }
          />
          {errors.motivation ? (
            <p id="apply-motivation-error" className="text-sm text-rose-600">
              {errors.motivation}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full"
          disabled={submitting}
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Mengirim...
            </>
          ) : (
            "Kirim Lamaran"
          )}
        </Button>
      </form>
    </div>
  );
}
