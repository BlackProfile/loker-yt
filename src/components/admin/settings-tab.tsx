"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Award,
  Bot,
  Calendar,
  Camera,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Eye,
  Film,
  Globe,
  GraduationCap,
  Heart,
  Inbox,
  Loader2,
  MailCheck,
  MailWarning,
  Mailbox,
  Mic,
  PenTool,
  Plus,
  Quote,
  RefreshCw,
  Rocket,
  Send,
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
  type SectionKey,
  type SiteContent,
  type Subscriber,
  type TeamMember,
} from "@/lib/types";
import { apiGet, apiPatch, apiPost, apiPut } from "./api";
import { copyText, formatDateTime, formatShortDateTime } from "./format";
import { SectionVisibilityCard, normalizeSections } from "./section-visibility-card";
import { Reveal } from "./motion-primitives";

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

// ----------------------------- Kotak Keluar Email -----------------------------

type OutboxRow = {
  id: string;
  toEmail: string;
  subject: string;
  kind: string;
  status: string;
  error: string | null;
  applicationId: string | null;
  applicationName: string | null;
  createdAt: string;
  sentAt: string | null;
};

type OutboxResponse = {
  smtpConfigured: boolean;
  emails: OutboxRow[];
};

const OUTBOX_STATUS_LABELS: Record<string, string> = {
  QUEUED: "Menunggu",
  SENT: "Terkirim",
  FAILED: "Gagal",
  SKIPPED: "Dilewati",
};

// Warna badge status outbox: QUEUED=zinc, SENT=emerald, FAILED=rose, SKIPPED=amber.
function outboxStatusBadgeClass(status: string): string {
  switch (status) {
    case "SENT":
      return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900";
    case "FAILED":
      return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-950 dark:text-rose-400 dark:border-rose-900";
    case "SKIPPED":
      return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700";
  }
}

function EmailOutboxCard() {
  const [rows, setRows] = useState<OutboxRow[]>([]);
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [resendingId, setResendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<OutboxResponse>("/api/admin/outbox");
      setRows(data.emails ?? []);
      setSmtpConfigured(data.smtpConfigured ?? false);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered =
    statusFilter === "ALL" ? rows : rows.filter((row) => row.status === statusFilter);

  async function handleResend(row: OutboxRow) {
    if (resendingId) return;
    setResendingId(row.id);
    try {
      const res = await apiPatch<{
        ok: boolean;
        status: string;
        message?: string;
      }>("/api/admin/outbox", { id: row.id });
      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id
            ? { ...r, status: res.status, error: res.status === "FAILED" ? (res.message ?? null) : null }
            : r
        )
      );
      if (res.status === "SENT") {
        toast.success("Email berhasil dikirim ulang");
      } else if (res.status === "SKIPPED") {
        toast.info(res.message ?? "SMTP belum dikonfigurasi — email terarsip saja.");
      } else {
        toast.error(res.message ?? "Gagal mengirim email.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setResendingId(null);
    }
  }

  return (
    <Card className="gap-4 rounded-2xl p-6">
      <CardHeader className="flex-row items-center justify-between px-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mailbox className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            Kotak Keluar Email
          </CardTitle>
          <CardDescription className="mt-1">
            Arsip email transaksional (offer, penolakan, pengingat). Tanpa SMTP, email
            terarsip berstatus menunggu dan bisa dikirim ulang manual.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-9 w-[140px]" aria-label="Filter status email">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Semua status</SelectItem>
              <SelectItem value="QUEUED">Menunggu</SelectItem>
              <SelectItem value="SENT">Terkirim</SelectItem>
              <SelectItem value="FAILED">Gagal</SelectItem>
              <SelectItem value="SKIPPED">Dilewati</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Segarkan kotak keluar email"
          >
            <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-0">
        {!smtpConfigured ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-400">
            <MailWarning className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              SMTP belum dikonfigurasi — email terarsip saja. Set env{" "}
              <code className="font-mono">SMTP_HOST</code>,{" "}
              <code className="font-mono">SMTP_PORT</code>,{" "}
              <code className="font-mono">SMTP_USER</code>,{" "}
              <code className="font-mono">SMTP_PASS</code>,{" "}
              <code className="font-mono">SMTP_FROM</code> untuk pengiriman otomatis.
            </span>
          </p>
        ) : null}

        {loading ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" className="h-9" onClick={() => void load()}>
              Coba Lagi
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Inbox className="size-5 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "Belum ada email terarsip. Email offer/penolakan/pengingat akan muncul di sini."
                : "Tidak ada email dengan status ini."}
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-x-auto overflow-y-auto rounded-xl border nice-scrollbar">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableHead className="w-36 px-3 py-2.5">Waktu</TableHead>
                  <TableHead className="px-3 py-2.5">Ke</TableHead>
                  <TableHead className="px-3 py-2.5">Subjek</TableHead>
                  <TableHead className="w-24 px-3 py-2.5">Jenis</TableHead>
                  <TableHead className="w-28 px-3 py-2.5">Status</TableHead>
                  <TableHead className="w-32 px-3 py-2.5 text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="px-3 py-2.5 text-xs whitespace-nowrap text-muted-foreground">
                      {formatShortDateTime(row.createdAt)}
                      {row.sentAt ? (
                        <span className="block text-[11px] text-emerald-700 dark:text-emerald-400">
                          terkirim {formatShortDateTime(row.sentAt)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-44 px-3 py-2.5">
                      <p className="truncate text-sm" title={row.toEmail}>
                        {row.toEmail}
                      </p>
                      {row.applicationName ? (
                        <p className="truncate text-xs text-muted-foreground" title={row.applicationName}>
                          {row.applicationName}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="max-w-56 px-3 py-2.5">
                      <p className="truncate text-sm" title={row.subject}>
                        {row.subject}
                      </p>
                      {row.error ? (
                        <p className="truncate text-xs text-rose-600 dark:text-rose-400" title={row.error}>
                          {row.error}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge variant="outline" className="text-[11px]">
                        {row.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge className={`border ${outboxStatusBadgeClass(row.status)}`}>
                        {OUTBOX_STATUS_LABELS[row.status] ?? row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right">
                      {row.status === "QUEUED" || row.status === "FAILED" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 px-2 text-xs"
                          onClick={() => void handleResend(row)}
                          disabled={resendingId !== null}
                          aria-label={`Kirim ulang email "${row.subject}"`}
                        >
                          {resendingId === row.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <RefreshCw className="size-3.5" aria-hidden="true" />
                          )}
                          Kirim ulang
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {rows.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Menampilkan {filtered.length} dari {rows.length} email terbaru
            {formatDateTime(rows[0]?.createdAt).includes("-") ? "" : ""}.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SettingsTab() {
  const [site, setSite] = useState<SiteContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [origin, setOrigin] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<{ site: SiteContent }>("/api/admin/settings");
      const raw = JSON.parse(JSON.stringify(data.site)) as SiteContent;
      // Lengkapi sections dari data lama agar Switch terkontrol penuh.
      setSite({ ...raw, sections: normalizeSections(raw.sections) });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Daftar pelanggan notifikasi (bersifat pelengkap).
  useEffect(() => {
    let cancelled = false;
    apiGet<Subscriber[]>("/api/admin/subscribers")
      .then((data) => {
        if (!cancelled) setSubscribers(data);
      })
      .catch(() => {
        // Abaikan: daftar pelanggan opsional.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  function updateField<K extends keyof SiteContent>(key: K, value: SiteContent[K]) {
    setSite((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateSection(key: SectionKey, value: boolean) {
    setSite((prev) =>
      prev ? { ...prev, sections: { ...prev.sections, [key]: value } } : prev
    );
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

  function updateTeamMember(index: number, patch: Partial<TeamMember>) {
    setSite((prev) =>
      prev
        ? {
            ...prev,
            teamMembers: prev.teamMembers.map((m, i) =>
              i === index ? { ...m, ...patch } : m
            ),
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
        { site } // sections ikut terkirim sebagai bagian dari site
      );
      const saved = JSON.parse(JSON.stringify(res.site)) as SiteContent;
      setSite({ ...saved, sections: normalizeSections(saved.sections) });
      toast.success("Pengaturan disimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleWebhookTest() {
    if (webhookTesting) return;
    setWebhookTesting(true);
    try {
      const res = await apiPost<{ discord: string; telegram: string }>(
        "/api/admin/webhook-test"
      );
      for (const [name, result] of [
        ["Discord", res.discord],
        ["Telegram", res.telegram],
      ] as const) {
        if (result === "ok") toast.success(`${name}: ok`);
        else if (result === "gagal") toast.error(`${name}: gagal`);
        else toast.info(`${name}: nonaktif`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setWebhookTesting(false);
    }
  }

  async function handleCopySubscribers() {
    const ok = await copyText(subscribers.map((s) => s.email).join("\n"));
    if (ok) toast.success("Daftar email disalin");
    else toast.error("Gagal menyalin ke clipboard");
  }

  async function handleCopyEmbed() {
    if (!site) return;
    const snippet = `<iframe src="${origin}/?embed=1" width="100%" height="600" style="border:0;border-radius:12px" title="Lowongan ${site.siteName}"></iframe>`;
    const ok = await copyText(snippet);
    if (ok) toast.success("Kode embed disalin");
    else toast.error("Gagal menyalin ke clipboard");
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

  const embedSnippet = `<iframe src="${origin || "https://domain-anda"}?embed=1" width="100%" height="600" style="border:0;border-radius:12px" title="Lowongan ${site.siteName}"></iframe>`;

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

      {/* Suara Tim */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Suara Tim</CardTitle>
          <CardDescription>
            Testimoni anggota tim yang tampil di halaman publik.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-0">
          {site.teamMembers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada testimoni tim. Tambahkan agar halaman lebih hidup.
            </p>
          ) : (
            site.teamMembers.map((member, index) => (
              <div key={index} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                  <Input
                    value={member.name}
                    onChange={(e) => updateTeamMember(index, { name: e.target.value })}
                    placeholder="Nama anggota"
                    aria-label={`Nama anggota tim ${index + 1}`}
                    className="h-10"
                  />
                  <Input
                    value={member.role}
                    onChange={(e) => updateTeamMember(index, { role: e.target.value })}
                    placeholder="Peran, mis. Video Editor"
                    aria-label={`Peran anggota tim ${index + 1}`}
                    className="h-10"
                  />
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 sm:size-9"
                      onClick={() =>
                        setSite((prev) =>
                          prev
                            ? { ...prev, teamMembers: moveItem(prev.teamMembers, index, -1) }
                            : prev
                        )
                      }
                      disabled={index === 0}
                      aria-label={`Naikkan testimoni ${index + 1}`}
                    >
                      <ChevronUp className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 sm:size-9"
                      onClick={() =>
                        setSite((prev) =>
                          prev
                            ? { ...prev, teamMembers: moveItem(prev.teamMembers, index, 1) }
                            : prev
                        )
                      }
                      disabled={index === site.teamMembers.length - 1}
                      aria-label={`Turunkan testimoni ${index + 1}`}
                    >
                      <ChevronDown className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
                      onClick={() =>
                        setSite((prev) =>
                          prev
                            ? {
                                ...prev,
                                teamMembers: prev.teamMembers.filter((_, i) => i !== index),
                              }
                            : prev
                        )
                      }
                      aria-label={`Hapus testimoni ${index + 1}`}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={member.quote}
                  onChange={(e) => updateTeamMember(index, { quote: e.target.value })}
                  placeholder="Kutipan testimoni..."
                  aria-label={`Kutipan anggota tim ${index + 1}`}
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
                prev
                  ? {
                      ...prev,
                      teamMembers: [
                        ...prev.teamMembers,
                        { name: "", role: "", quote: "" },
                      ],
                    }
                  : prev
              )
            }
          >
            <Quote className="size-4" aria-hidden="true" />
            Tambah Anggota
          </Button>
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
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
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
                    className="size-10 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
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
                      className="size-10 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-9 dark:hover:bg-rose-950"
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

      {/* Integrasi & Otomasi */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="px-0">
          <CardTitle className="text-base">Integrasi &amp; Otomasi</CardTitle>
          <CardDescription>
            Chatbot publik dan notifikasi lamaran baru via Discord / Telegram.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-0">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
                Chatbot Lumina Bot
              </p>
              <p className="text-xs text-muted-foreground">
                Aktifkan chatbot Lumina Bot di halaman publik
              </p>
            </div>
            <Switch
              checked={site.chatbotEnabled}
              onCheckedChange={(checked) => updateField("chatbotEnabled", checked)}
              aria-label="Aktifkan chatbot Lumina Bot di halaman publik"
            />
          </div>

          <Field
            id="f-discord"
            label="Discord Webhook URL"
            hint="Notifikasi lamaran baru ke channel Discord."
          >
            <Input
              id="f-discord"
              value={site.discordWebhookUrl}
              onChange={(e) => updateField("discordWebhookUrl", e.target.value)}
              placeholder="https://discord.com/api/webhooks/..."
              className="h-10"
            />
          </Field>
          <div className="grid gap-4 md:grid-cols-2">
            <Field id="f-telegram-token" label="Telegram Bot Token">
              <Input
                id="f-telegram-token"
                value={site.telegramBotToken}
                onChange={(e) => updateField("telegramBotToken", e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="h-10"
              />
            </Field>
            <Field id="f-telegram-chat" label="Telegram Chat ID">
              <Input
                id="f-telegram-chat"
                value={site.telegramChatId}
                onChange={(e) => updateField("telegramChatId", e.target.value)}
                placeholder="-1001234567890"
                className="h-10"
              />
            </Field>
          </div>
          <Button
            variant="outline"
            className="h-10 w-fit"
            onClick={() => void handleWebhookTest()}
            disabled={webhookTesting}
          >
            {webhookTesting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="size-4" aria-hidden="true" />
            )}
            Kirim Pesan Uji
          </Button>
        </CardContent>
      </Card>

      {/* Tampilan Halaman Publik (visibilitas tiap bagian) */}
      <SectionVisibilityCard sections={site.sections} onChange={updateSection} />

      {/* Pelanggan Notifikasi */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="flex-row items-center justify-between px-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MailCheck className="size-4 text-rose-600 dark:text-rose-400" aria-hidden="true" />
              Pelanggan Notifikasi
            </CardTitle>
            <CardDescription className="mt-1">
              {subscribers.length} email menerima info lowongan baru.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            className="h-10"
            onClick={() => void handleCopySubscribers()}
            disabled={subscribers.length === 0}
          >
            <Copy className="size-4" aria-hidden="true" />
            Salin Semua
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          {subscribers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada pelanggan notifikasi.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg border p-3 nice-scrollbar">
              <ul className="flex flex-col gap-1 font-mono text-sm">
                {subscribers.map((sub) => (
                  <li key={sub.id} className="truncate">
                    {sub.email}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Widget Embed */}
      <Card className="gap-4 rounded-2xl p-6">
        <CardHeader className="flex-row items-center justify-between px-0">
          <div>
            <CardTitle className="text-base">Widget Embed</CardTitle>
            <CardDescription className="mt-1">
              Tampilkan lowongan di situs lain dengan iframe ini.
            </CardDescription>
          </div>
          <Button variant="outline" className="h-10" onClick={() => void handleCopyEmbed()}>
            <Copy className="size-4" aria-hidden="true" />
            Salin
          </Button>
        </CardHeader>
        <CardContent className="px-0">
          <Textarea
            readOnly
            value={embedSnippet}
            aria-label="Kode widget embed"
            className="font-mono text-xs"
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
          />
        </CardContent>
      </Card>

      {/* Bar simpan sticky (entrance halus, pola simpan tak berubah) */}
      <Reveal slideY={10} duration={0.25} className="sticky bottom-4 z-10">
        <Card className="flex-row items-center justify-between gap-3 rounded-2xl border-rose-200 bg-rose-50/80 p-4 backdrop-blur dark:border-rose-900 dark:bg-rose-950/80">
          <p className="text-sm font-medium">
            Perubahan konten situs belum disimpan.
          </p>
          <Button
            onClick={() => void handleSaveSite()}
            disabled={saving}
            className="h-11 shrink-0 active:scale-[0.99] sm:h-10"
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
      </Reveal>
    </div>
  );
}
