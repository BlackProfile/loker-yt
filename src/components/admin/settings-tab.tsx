"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
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
  AlertTriangle,
  Award,
  BellRing,
  Bot,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Clock,
  Code2,
  Copy,
  Eye,
  Film,
  Gift,
  Globe,
  GraduationCap,
  Heart,
  Inbox,
  Info,
  LayoutTemplate,
  Loader2,
  LogOut,
  Mail,
  MailCheck,
  MailWarning,
  Mailbox,
  Mic,
  Monitor,
  MonitorSmartphone,
  PanelBottom,
  PenTool,
  Plus,
  Quote,
  RefreshCw,
  Rocket,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Stethoscope,
  Tag,
  Tags,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  BENEFIT_ICONS,
  ROLE_LABELS,
  TAG_COLORS,
  TAG_COLOR_CLASSES,
  TELEGRAM_ALERT_KEYS,
  TELEGRAM_ALERT_LABELS,
  type FaqItem,
  type TelegramAlertKey,
  type Role,
  type SectionKey,
  type SiteContent,
  type Subscriber,
  type TagColor,
  type TeamMember,
} from "@/lib/types";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";
import { copyText, formatDateTime, formatRelative, formatShortDateTime } from "./format";
import { useAdminSession } from "./admin-context";
import { SectionVisibilityCard, normalizeSections } from "./section-visibility-card";
import { CollapsibleCard } from "./collapsible-card";
import { useTagDefs } from "./use-tag-defs";
import { Reveal } from "./motion-primitives";
import { cn } from "@/lib/utils";

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
    <CollapsibleCard
      id="outbox"
      icon={Mailbox}
      title="Kotak Keluar Email"
      description="Arsip email transaksional (offer, penolakan, pengingat). Tanpa SMTP, email terarsip berstatus menunggu dan bisa dikirim ulang manual."
      actions={
        <>
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
        </>
      }
    >
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
    </CollapsibleCard>
  );
}

// ------------------------------ Bot Telegram (bot dua arah admin) ------------------------------

type TelegramPairInfo = { code: string; expiresAt: string };

type TelegramAlertsUi = Record<TelegramAlertKey, boolean>;

type TelegramPollerStatus = {
  lastSeenAt: string | null;
  secondsAgo: number | null;
  healthy: boolean;
};

type TelegramBotState = {
  hasToken: boolean;
  legacyChatId: string;
  allowedChats: string[];
  writeEnabled: boolean;
  alerts: Partial<TelegramAlertsUi> | null;
  pair: TelegramPairInfo | null;
  poller?: TelegramPollerStatus | null;
};

type TelegramDiagStep = {
  key: string;
  label: string;
  status: "ok" | "fail" | "warn";
  detail?: string;
  hint?: string;
};

type TelegramDiagResponse = {
  ok: boolean;
  steps: TelegramDiagStep[];
  botUsername: string | null;
  sendResults: { chatId: string; ok: boolean; description?: string; hint?: string }[];
  poller: TelegramPollerStatus;
};

// Detail diagnostik bisa berisi beberapa baris dipisah " | " atau newline —
// pecah menjadi baris-baris tunggal untuk dirender sebagai <p> terpisah.
function splitDiagDetail(detail: string | undefined): string[] {
  if (!detail) return [];
  return detail
    .split(/\n|\s+\|\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeTelegramAlerts(value: TelegramBotState["alerts"]): TelegramAlertsUi {
  const base = {} as TelegramAlertsUi;
  for (const key of TELEGRAM_ALERT_KEYS) {
    base[key] = value?.[key] === true;
  }
  return base;
}

// Kedaluwarsa kode pemasangan: "dd MMM yyyy HH.mm" (id-ID).
function formatPairExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Kartu mandiri: data dimuat sendiri via GET /api/admin/telegram/bot dan setiap aksi
// tersimpan langsung via POST (tidak lewat tombol Simpan utama / state site).
function TelegramBotCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [legacyChatId, setLegacyChatId] = useState("");
  const [allowedChats, setAllowedChats] = useState<string[]>([]);
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [alerts, setAlerts] = useState<TelegramAlertsUi>(() => normalizeTelegramAlerts(null));
  const [pair, setPair] = useState<TelegramPairInfo | null>(null);
  const [pollerStatus, setPollerStatus] = useState<TelegramPollerStatus | null>(null);
  const [testing, setTesting] = useState(false);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagSteps, setDiagSteps] = useState<TelegramDiagStep[] | null>(null);
  const [diagShow, setDiagShow] = useState(false);
  const [pairCreating, setPairCreating] = useState(false);
  const [pairCancelling, setPairCancelling] = useState(false);
  const [removingChat, setRemovingChat] = useState<string | null>(null);
  const [writeSaving, setWriteSaving] = useState(false);
  const [alertSaving, setAlertSaving] = useState<TelegramAlertKey | null>(null);
  const [origin, setOrigin] = useState("");

  const applyState = useCallback((data: TelegramBotState) => {
    setHasToken(Boolean(data.hasToken));
    setLegacyChatId(typeof data.legacyChatId === "string" ? data.legacyChatId : "");
    setAllowedChats(Array.isArray(data.allowedChats) ? data.allowedChats : []);
    setWriteEnabled(Boolean(data.writeEnabled));
    setAlerts(normalizeTelegramAlerts(data.alerts));
    setPair(data.pair ?? null);
    setPollerStatus(data.poller ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiGet<TelegramBotState>("/api/admin/telegram/bot");
      applyState(data);
    } catch (err) {
      reportError(err);
      setLoadError(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }, [applyState, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Auto-poll GET tiap 5 detik selama kode pemasangan aktif. Bila kode hilang dari
  // respons (chat berhasil dipasangkan / kedaluwarsa), muat ulang status lalu berhenti.
  useEffect(() => {
    if (!pair) return;
    const expiresMs = new Date(pair.expiresAt).getTime();
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        const data = await apiGet<TelegramBotState>("/api/admin/telegram/bot");
        if (stopped) return;
        // Heartbeat poller selalu diperbarui tiap GET (kode aktif pun boleh —
        // bukan bagian dari toggle optimistik).
        if (data.poller) setPollerStatus(data.poller);
        if (!data.pair) {
          applyState(data);
          if (!Number.isNaN(expiresMs) && Date.now() < expiresMs) {
            toast.success("Chat baru terhubung ke bot.");
          }
        }
        // Kode masih aktif: state lain sengaja tidak ditimpa agar toggle optimistik aman.
      } catch {
        // Gagal polling sesaat diabaikan; percobaan berikutnya mencoba lagi.
      }
    };
    const interval = setInterval(() => void tick(), 5000);
    // Hentikan otomatis tepat setelah masa berlaku kode berakhir (maks 15 menit).
    const stopTimer = setTimeout(() => {
      stopped = true;
      setPair(null);
    }, Math.max(expiresMs - Date.now(), 0) + 5000);
    return () => {
      stopped = true;
      clearInterval(interval);
      clearTimeout(stopTimer);
    };
  }, [pair, applyState]);

  async function handleTest() {
    if (testing) return;
    setTesting(true);
    try {
      const res = await apiPost<
        { ok: boolean; results: { chatId: string; ok: boolean; description?: string; hint?: string }[] }
      >("/api/admin/telegram/bot", { action: "test" });
      const results = Array.isArray(res.results) ? res.results : [];
      for (const item of results) {
        if (item.ok) {
          toast.success(`Chat ${item.chatId}: terkirim`);
        } else {
          toast.error(`Chat ${item.chatId}: gagal — ${item.description ?? "tanpa keterangan"}`, {
            description: item.hint,
          });
        }
      }
    } catch (err) {
      reportError(err);
    } finally {
      setTesting(false);
    }
  }

  // Diagnostik bertahap: token, validitas token, poller, chat, kirim uji —
  // hasil ditampilkan sebagai panel inline (bukan dialog).
  async function handleDiagnose() {
    if (diagnosing) return;
    setDiagnosing(true);
    setDiagSteps(null); // reset hasil lama saat dijalankan ulang
    setDiagShow(true);
    try {
      const res = await apiPost<TelegramDiagResponse>("/api/admin/telegram/bot", {
        action: "diagnose",
      });
      setDiagSteps(Array.isArray(res.steps) ? res.steps : []);
      if (res.poller) setPollerStatus(res.poller);
    } catch (err) {
      setDiagShow(false);
      reportError(err);
    } finally {
      setDiagnosing(false);
    }
  }

  async function handleCreatePair() {
    if (pairCreating) return;
    setPairCreating(true);
    try {
      const res = await apiPost<{ ok: boolean; code: string; expiresAt: string }>(
        "/api/admin/telegram/bot",
        { action: "create-pair" }
      );
      setPair({ code: res.code, expiresAt: res.expiresAt });
      toast.success("Kode pemasangan dibuat. Berlaku 15 menit.");
    } catch (err) {
      reportError(err);
    } finally {
      setPairCreating(false);
    }
  }

  async function handleCancelPair() {
    if (pairCancelling) return;
    setPairCancelling(true);
    try {
      await apiPost<{ ok: boolean }>("/api/admin/telegram/bot", { action: "cancel-pair" });
      setPair(null);
      toast.success("Kode pemasangan dibatalkan.");
    } catch (err) {
      reportError(err);
    } finally {
      setPairCancelling(false);
    }
  }

  async function handleRemoveChat(chatId: string) {
    if (removingChat) return;
    setRemovingChat(chatId);
    try {
      const res = await apiPost<{ ok: boolean; allowedChats: string[] }>(
        "/api/admin/telegram/bot",
        { action: "remove-chat", chatId }
      );
      setAllowedChats(Array.isArray(res.allowedChats) ? res.allowedChats : []);
      toast.success(`Chat ${chatId} dihapus dari daftar.`);
    } catch (err) {
      reportError(err);
    } finally {
      setRemovingChat(null);
    }
  }

  async function handleSetWrite(enabled: boolean) {
    if (writeSaving) return;
    const prev = writeEnabled;
    setWriteEnabled(enabled); // optimistik
    setWriteSaving(true);
    try {
      const res = await apiPost<{ ok: boolean; writeEnabled: boolean }>(
        "/api/admin/telegram/bot",
        { action: "set-write", enabled }
      );
      setWriteEnabled(Boolean(res.writeEnabled));
      toast.success(enabled ? "Aksi tulis via bot diaktifkan." : "Aksi tulis via bot dinonaktifkan.");
    } catch (err) {
      setWriteEnabled(prev); // kembalikan bila gagal
      reportError(err);
    } finally {
      setWriteSaving(false);
    }
  }

  async function handleSetAlert(key: TelegramAlertKey, enabled: boolean) {
    if (alertSaving) return;
    const prev = alerts[key];
    setAlerts((current) => ({ ...current, [key]: enabled })); // optimistik
    setAlertSaving(key);
    try {
      const res = await apiPost<{ ok: boolean; key: TelegramAlertKey; enabled: boolean }>(
        "/api/admin/telegram/bot",
        { action: "set-alert", key, enabled }
      );
      setAlerts((current) => ({ ...current, [key]: Boolean(res.enabled) }));
      toast.success(`${TELEGRAM_ALERT_LABELS[key]} ${enabled ? "diaktifkan" : "dinonaktifkan"}.`);
    } catch (err) {
      setAlerts((current) => ({ ...current, [key]: prev })); // kembalikan bila gagal
      reportError(err);
    } finally {
      setAlertSaving(null);
    }
  }

  // legacyChatId tetap ditampilkan meski tidak masuk whitelist (tidak bisa dihapus dari sini).
  const extraLegacyRows =
    legacyChatId && !allowedChats.includes(legacyChatId) ? [legacyChatId] : [];
  const chatRows = [...allowedChats, ...extraLegacyRows];

  return (
    <CollapsibleCard
      id="bot-telegram"
      icon={Send}
      title="Bot Telegram"
      description="Bot dua arah untuk admin: perintah ringkasan, aksi kandidat, dan digest pagi langsung dari Telegram."
    >
        {loading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button variant="outline" className="h-9" onClick={() => void load()}>
              Coba Lagi
            </Button>
          </div>
        ) : (
          <>
            {/* Status token & chat */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {hasToken ? (
                <Badge className="border border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
                  Token terpasang
                </Badge>
              ) : (
                <Badge className="border border-amber-200 bg-amber-100 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400">
                  Token belum diisi
                </Badge>
              )}
              {!hasToken ? (
                <p className="text-xs text-muted-foreground">
                  Isi Telegram Bot Token di kartu Integrasi &amp; Otomasi lalu klik Simpan.
                </p>
              ) : null}
              {allowedChats.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Belum ada chat terdaftar — buat kode pemasangan di bawah.
                </p>
              ) : null}
              {pollerStatus ? (
                pollerStatus.healthy ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
                    Polling aktif
                    {pollerStatus.secondsAgo != null
                      ? ` · terakhir ${pollerStatus.secondsAgo} detik lalu`
                      : ""}
                  </p>
                ) : (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="size-2 rounded-full bg-amber-500" aria-hidden="true" />
                    Polling tidak terdeteksi — pastikan mini-service telegram-bot berjalan
                    (port 3004)
                  </p>
                )
              ) : null}
            </div>

            {/* Uji kirim pesan & diagnostik bertahap */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="h-10"
                onClick={() => void handleTest()}
                disabled={testing || !isOwner}
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                Uji Bot
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => void handleDiagnose()}
                disabled={diagnosing || !isOwner}
              >
                {diagnosing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Stethoscope className="size-4" aria-hidden="true" />
                )}
                Jalankan Diagnostik
              </Button>
            </div>

            {/* Panel hasil diagnostik (inline, tanpa dialog) */}
            {diagShow ? (
              <div className="flex flex-col gap-3 rounded-lg border p-3" aria-live="polite">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">Hasil diagnostik</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0"
                    onClick={() => setDiagShow(false)}
                    disabled={diagnosing}
                    aria-label="Tutup hasil diagnostik"
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                {diagnosing && diagSteps === null ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    Menjalankan diagnostik...
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {(diagSteps ?? []).map((step) => {
                      const StepIcon =
                        step.status === "ok"
                          ? CheckCircle2
                          : step.status === "fail"
                            ? XCircle
                            : AlertTriangle;
                      const stepIconClass =
                        step.status === "ok"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : step.status === "fail"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-amber-600 dark:text-amber-500";
                      const detailLines = splitDiagDetail(step.detail);
                      return (
                        <li key={step.key} className="flex items-start gap-2.5">
                          <StepIcon
                            className={`mt-0.5 size-4 shrink-0 ${stepIconClass}`}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{step.label}</p>
                            {detailLines.length > 0 ? (
                              <div className="mt-0.5 flex flex-col">
                                {detailLines.map((line, lineIndex) => (
                                  <p
                                    key={`${step.key}-detail-${lineIndex}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    {line}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                            {step.hint ? (
                              <p className="mt-1.5 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                                Saran: {step.hint}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                    {diagSteps !== null && diagSteps.length === 0 ? (
                      <li className="text-xs text-muted-foreground">
                        Tidak ada langkah diagnostik yang dikembalikan.
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>
            ) : null}

            {/* Panel pemasangan chat (kode sekali pakai, 15 menit) */}
            <div className="rounded-lg border p-3">
              {pair ? (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs text-muted-foreground">
                      Kode pemasangan (berlaku sampai {formatPairExpiry(pair.expiresAt)})
                    </p>
                    <p className="font-mono text-2xl font-semibold tracking-widest text-rose-600 dark:text-rose-400">
                      {pair.code}
                    </p>
                  </div>
                  <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                    <li>Buka Telegram dan cari bot kamu.</li>
                    <li>
                      Kirim pesan:{" "}
                      <code className="font-mono text-foreground">/mulai KODE</code> (ganti KODE
                      dengan angka di atas).
                    </li>
                    <li>Chat otomatis terdaftar dan bisa memakai semua perintah bot.</li>
                  </ol>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-fit"
                    onClick={() => void handleCancelPair()}
                    disabled={pairCancelling || !isOwner}
                  >
                    {pairCancelling ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : null}
                    Batalkan kode
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-2">
                  <p className="text-sm font-medium">Pasang chat admin baru</p>
                  <p className="text-xs text-muted-foreground">
                    Buat kode sekali pakai, lalu kirim ke bot dari Telegram admin.
                  </p>
                  <Button
                    variant="outline"
                    className="h-10 w-fit"
                    onClick={() => void handleCreatePair()}
                    disabled={pairCreating || !isOwner}
                  >
                    {pairCreating ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Buat Kode Pemasangan
                  </Button>
                </div>
              )}
            </div>

            {/* Daftar chat terdaftar */}
            {chatRows.length > 0 ? (
              <div className="flex flex-col gap-2 rounded-lg border p-3">
                {chatRows.map((chatId) => {
                  const isLegacy = chatId === legacyChatId;
                  return (
                    <div key={chatId} className="flex items-center justify-between gap-2">
                      <p className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-sm">{chatId}</span>
                        {isLegacy ? (
                          <span className="text-xs text-muted-foreground">
                            (dari kolom Chat ID lama)
                          </span>
                        ) : null}
                      </p>
                      {!isLegacy ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950"
                          onClick={() => void handleRemoveChat(chatId)}
                          disabled={removingChat !== null || !isOwner}
                          aria-label={`Hapus chat ${chatId}`}
                        >
                          {removingChat === chatId ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <X className="size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {/* Aksi tulis via bot (optimistik) */}
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="tg-write-toggle" className="text-sm font-medium">
                  Izinkan aksi tulis via bot
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Bila nonaktif, bot hanya mengirim notifikasi &amp; tautan — tombol Ajak
                  Wawancara/Tolak disembunyikan.
                </p>
              </div>
              <Switch
                id="tg-write-toggle"
                checked={writeEnabled}
                disabled={writeSaving || !isOwner}
                onCheckedChange={(checked) => void handleSetWrite(checked)}
                aria-label="Izinkan aksi tulis via bot"
              />
            </div>

            {/* Alert Telegram */}
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Alert yang dikirim ke Telegram
              </p>
              {TELEGRAM_ALERT_KEYS.map((key) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <Label htmlFor={`tg-alert-${key}`} className="min-w-0 text-sm font-medium">
                    {TELEGRAM_ALERT_LABELS[key]}
                  </Label>
                  <Switch
                    id={`tg-alert-${key}`}
                    checked={alerts[key]}
                    disabled={alertSaving !== null || !isOwner}
                    onCheckedChange={(checked) => void handleSetAlert(key, checked)}
                    aria-label={TELEGRAM_ALERT_LABELS[key]}
                  />
                </div>
              ))}
            </div>

            {!isOwner ? (
              <p className="text-xs text-muted-foreground">
                Hanya pemilik situs (OWNER) yang dapat mengubah pengaturan bot.
              </p>
            ) : null}

            {/* Footnote tautan Tinjau pada pesan bot */}
            <p className="text-xs text-muted-foreground">
              Tombol &quot;Tinjau&quot; pada pesan bot membuka{" "}
              <span className="font-mono">
                {origin ? `${origin}/?kandidat=KODE` : ".../?kandidat=KODE"}
              </span>
              . Saat deploy produksi, set variabel lingkungan{" "}
              <code className="font-mono">NEXT_PUBLIC_SITE_URL</code> agar tautan memakai domain
              publik.
            </p>
          </>
        )}
    </CollapsibleCard>
  );
}

// ------------------------------ Sesi Aktif (Task 27) ------------------------------

type ActiveSessionRow = {
  id: string;
  userName: string;
  userEmail: string;
  userRole: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

function isMobileUserAgent(userAgent: string | null): boolean {
  return /mobile|android|iphone|ipad|ipod/i.test(userAgent ?? "");
}

function ActiveSessionsCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";
  const [rows, setRows] = useState<ActiveSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [kickTarget, setKickTarget] = useState<ActiveSessionRow | null>(null);
  const [kickAllOpen, setKickAllOpen] = useState(false);
  const [kickingAll, setKickingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiGet<ActiveSessionRow[]>("/api/admin/sessions");
      setRows(data ?? []);
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleKick() {
    if (!kickTarget || busyId) return;
    setBusyId(kickTarget.id);
    try {
      await apiDelete(`/api/admin/sessions?id=${encodeURIComponent(kickTarget.id)}`);
      toast.success(
        kickTarget.current
          ? "Perangkat ini dikeluarkan — sesi berakhir."
          : `Sesi ${kickTarget.userEmail} dikeluarkan.`,
      );
      setKickTarget(null);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function handleKickAllOthers() {
    if (kickingAll) return;
    setKickingAll(true);
    try {
      const res = await apiDelete<{ ok: boolean; revoked: number }>(
        "/api/admin/sessions?scope=others",
      );
      toast.success(`${res.revoked} perangkat lain dikeluarkan.`);
      setKickAllOpen(false);
      await load();
    } catch (err) {
      reportError(err);
    } finally {
      setKickingAll(false);
    }
  }

  return (
    <CollapsibleCard
      id="sesi-aktif"
      icon={MonitorSmartphone}
      title="Sesi Aktif"
      description="Perangkat yang sedang login ke panel admin. Keluarkan perangkat yang tidak dikenal."
      actions={
        isOwner && rows.filter((r) => !r.current).length > 0 ? (
          <Button
            variant="outline"
            className="h-10 shrink-0"
            disabled={kickingAll}
            onClick={() => setKickAllOpen(true)}
          >
            {kickingAll ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogOut className="size-4" aria-hidden="true" />
            )}
            Keluarkan Semua Perangkat Lain
          </Button>
        ) : null
      }
    >
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat sesi aktif...
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tidak ada sesi aktif tercatat. Sesi baru tercatat mulai login berikutnya.
          </p>
        ) : (
          <div className="flex max-h-96 flex-col gap-2 overflow-y-auto nice-scrollbar">
            {rows.map((row) => {
              const mobile = isMobileUserAgent(row.userAgent);
              return (
                <div
                  key={row.id}
                  className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {mobile ? (
                        <Smartphone className="size-4" aria-hidden="true" />
                      ) : (
                        <Monitor className="size-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                        {mobile ? "Perangkat seluler" : "Perangkat desktop"}
                        {row.current ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
                          >
                            Perangkat ini
                          </Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={row.userAgent ?? undefined}>
                        {row.userEmail} · {ROLE_LABELS[row.userRole as Role] ?? row.userRole}
                        {row.ip ? ` · IP ${row.ip}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Aktif {formatRelative(row.lastSeenAt)} · mulai {formatShortDateTime(row.createdAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950"
                    disabled={busyId !== null}
                    onClick={() => setKickTarget(row)}
                  >
                    {busyId === row.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <LogOut className="size-4" aria-hidden="true" />
                    )}
                    Keluarkan
                  </Button>
                </div>
              );
            })}
          </div>
        )}

      {/* Konfirmasi keluarkan satu sesi */}
      <AlertDialog
        open={kickTarget !== null}
        onOpenChange={(open) => {
          if (!busyId && !open) setKickTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keluarkan perangkat ini?</AlertDialogTitle>
            <AlertDialogDescription>
              Sesi {kickTarget?.userEmail} pada{" "}
              {kickTarget && isMobileUserAgent(kickTarget.userAgent) ? "perangkat seluler" : "perangkat desktop"}{" "}
              akan dicabut. Orang tersebut harus login ulang untuk masuk kembali.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId !== null}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={busyId !== null}
              onClick={(event) => {
                event.preventDefault();
                void handleKick();
              }}
            >
              {busyId !== null ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Mengeluarkan...
                </>
              ) : (
                "Ya, Keluarkan"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Konfirmasi keluarkan semua perangkat lain (OWNER) */}
      <AlertDialog
        open={kickAllOpen}
        onOpenChange={(open) => {
          if (!kickingAll && !open) setKickAllOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keluarkan semua perangkat lain?</AlertDialogTitle>
            <AlertDialogDescription>
              Semua sesi aktif selain perangkat ini akan dicabut. Semua pengguna lain (termasuk
              perangkatmu di browser lain) harus login ulang. Perangkat ini tetap masuk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={kickingAll}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={kickingAll}
              onClick={(event) => {
                event.preventDefault();
                void handleKickAllOthers();
              }}
            >
              {kickingAll ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Mengeluarkan...
                </>
              ) : (
                "Ya, Keluarkan Semua"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CollapsibleCard>
  );
}

// ----------------------------- Retensi Data (Task 27) -----------------------------

function RetentionCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState("365");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (role !== "OWNER") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGet<{
        retention: { enabled: boolean; days: number };
      }>("/api/admin/retention");
      setEnabled(data.retention.enabled);
      setDays(String(data.retention.days));
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [role, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await apiPut<{
        ok: true;
        retention: { enabled: boolean; days: number };
      }>("/api/admin/retention", { enabled, days: Number(days) });
      setEnabled(res.retention.enabled);
      setDays(String(res.retention.days));
      toast.success("Pengaturan retensi data disimpan.");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      id="retensi"
      icon={ShieldCheck}
      title="Retensi Data (Privasi)"
      description="Hapus otomatis lamaran lama agar data pelamar tidak disimpan selamanya."
    >
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat pengaturan retensi...
          </div>
        ) : !isOwner ? (
          <p className="text-sm text-muted-foreground">
            Retensi data hanya dapat diatur oleh pemilik studio (OWNER).
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Aktifkan Retensi Otomatis</p>
                <p className="text-xs text-muted-foreground">
                  Lamaran ditolak/diarsip lebih tua dari {days || "365"} hari dihapus permanen
                  otomatis saat perawatan data dijalankan.
                </p>
              </div>
              <Switch
                checked={enabled}
                disabled={saving}
                onCheckedChange={setEnabled}
                aria-label="Aktifkan retensi data otomatis"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="retention-days">Umur maksimum lamaran (hari)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="retention-days"
                  type="number"
                  min={30}
                  max={3650}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="h-10 w-32"
                  disabled={saving}
                />
                <Button
                  variant="outline"
                  className="h-10 shrink-0"
                  disabled={saving}
                  onClick={() => void handleSave()}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Save className="size-4" aria-hidden="true" />
                  )}
                  Simpan
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Angka 30 sampai 3650 hari. Berlaku untuk lamaran berstatus ditolak atau yang sudah
                diarsipkan.
              </p>
            </div>
          </>
        )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Laporan Email Terjadwal (NR-19) — toggle laporan mingguan/bulanan (OWNER saja).
// Kartu mandiri: GET/PUT /api/admin/reports/schedule, simpan langsung saat toggle.
// ---------------------------------------------------------------------------

type ReportEmailScheduleUi = { weeklyEnabled: boolean; monthlyEnabled: boolean };

function ReportEmailScheduleCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";
  const [schedule, setSchedule] = useState<ReportEmailScheduleUi>({
    weeklyEnabled: true,
    monthlyEnabled: true,
  });
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<"weeklyEnabled" | "monthlyEnabled" | null>(null);

  const load = useCallback(async () => {
    if (role !== "OWNER") {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGet<{ schedule: ReportEmailScheduleUi }>(
        "/api/admin/reports/schedule"
      );
      setSchedule({
        weeklyEnabled: data.schedule.weeklyEnabled !== false,
        monthlyEnabled: data.schedule.monthlyEnabled !== false,
      });
    } catch (err) {
      reportError(err);
    } finally {
      setLoading(false);
    }
  }, [role, reportError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(key: "weeklyEnabled" | "monthlyEnabled", value: boolean) {
    if (savingKey) return;
    setSavingKey(key);
    const previous = schedule;
    setSchedule((s) => ({ ...s, [key]: value })); // optimistik, revert bila gagal
    try {
      const res = await apiPut<{ ok: true; schedule: ReportEmailScheduleUi }>(
        "/api/admin/reports/schedule",
        { [key]: value },
      );
      setSchedule(res.schedule);
      toast.success("Pengaturan laporan email tersimpan.");
    } catch (err) {
      setSchedule(previous);
      reportError(err);
    } finally {
      setSavingKey(null);
    }
  }

  // OWNER-only: kartu disembunyikan untuk role lain.
  if (!isOwner) return null;

  return (
    <CollapsibleCard
      id="laporan-email"
      icon={Mailbox}
      title="Laporan Email Terjadwal"
      description="Kirim ringkasan pipeline ke email Pemilik & HR setiap Senin 08.00 dan tanggal 1 07.00 (masuk antrean email)."
    >
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Memuat jadwal laporan...
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Laporan mingguan</p>
                <p className="text-xs text-muted-foreground">
                  Ringkasan pipeline dikirim setiap Senin pukul 08.00.
                </p>
              </div>
              <Switch
                checked={schedule.weeklyEnabled}
                disabled={savingKey !== null}
                onCheckedChange={(checked) => void handleToggle("weeklyEnabled", checked)}
                aria-label="Aktifkan laporan email mingguan"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Laporan bulanan</p>
                <p className="text-xs text-muted-foreground">
                  Ringkasan pipeline dikirim setiap tanggal 1 pukul 07.00.
                </p>
              </div>
              <Switch
                checked={schedule.monthlyEnabled}
                disabled={savingKey !== null}
                onCheckedChange={(checked) => void handleToggle("monthlyEnabled", checked)}
                aria-label="Aktifkan laporan email bulanan"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Email hanya masuk antrean di Kotak Keluar — pengiriman mengikuti ketersediaan SMTP.
            </p>
          </div>
        )}
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Tag Tim (NR-24, fitur 3) — kelola daftar tag berwarna milik tim untuk
// menandai lamaran. Sumber data: hook useTagDefs (GET/PUT /api/admin/tag-defs).
// Simpan langsung setiap aksi (tambah/hapus) — sederhana dan andal.
// VIEWER hanya dapat melihat daftar (read-only).
// ---------------------------------------------------------------------------

const TAG_COLOR_LABELS: Record<TagColor, string> = {
  rose: "Rose",
  amber: "Amber",
  emerald: "Emerald",
  teal: "Teal",
  orange: "Orange",
  zinc: "Zinc",
};

function TeamTagsCard() {
  const { canMutate, reportError } = useAdminSession();
  const { tagDefs, save } = useTagDefs();
  const [name, setName] = useState("");
  const [color, setColor] = useState<TagColor>("rose");
  const [saving, setSaving] = useState(false);

  async function addTag() {
    if (!canMutate || saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Nama tag wajib diisi.");
      return;
    }
    if (trimmed.length > 24) {
      toast.error("Nama tag maksimal 24 karakter.");
      return;
    }
    if (tagDefs.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast.error(`Tag "${trimmed}" sudah terdaftar.`);
      return;
    }
    setSaving(true);
    try {
      await save([...tagDefs, { name: trimmed, color }]);
      setName("");
      setColor("rose");
      toast.success("Daftar tag disimpan");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  async function removeTag(index: number) {
    if (!canMutate || saving) return;
    setSaving(true);
    try {
      await save(tagDefs.filter((_, i) => i !== index));
      toast.success("Daftar tag disimpan");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      id="tag-tim"
      icon={Tags}
      title="Tag Tim"
      description={`${tagDefs.length} tag berwarna untuk menandai lamaran dengan cepat.`}
    >
      <div className="flex flex-col gap-4">
        {/* Daftar tag tersimpan sebagai chip berwarna + tombol hapus */}
        {tagDefs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Belum ada tag. Tambahkan mis. "Prioritas" atau "Menunggu Dokumen".
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Daftar tag tim">
            {tagDefs.map((tag, index) => (
              <li
                key={`${tag.name}-${index}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
                  TAG_COLOR_CLASSES[tag.color] ?? TAG_COLOR_CLASSES.zinc
                )}
              >
                {tag.name}
                {canMutate ? (
                  <button
                    type="button"
                    onClick={() => void removeTag(index)}
                    disabled={saving}
                    aria-label={`Hapus tag ${tag.name}`}
                    className="-mr-1 rounded-full p-0.5 transition-opacity hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {/* Form tambah tag (OWNER/HR saja) */}
        {canMutate ? (
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              void addTag();
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Label htmlFor="f-tag-name">Nama tag baru</Label>
              <Input
                id="f-tag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={24}
                placeholder="mis. Prioritas, Menunggu Dokumen"
                aria-describedby="f-tag-name-hint"
                className="h-10"
                disabled={saving}
              />
              <p id="f-tag-name-hint" className="text-xs text-muted-foreground">
                1-24 karakter.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 sm:w-44">
              <Label htmlFor="f-tag-color">Warna</Label>
              <Select
                value={color}
                onValueChange={(v) => setColor(v as TagColor)}
                disabled={saving}
              >
                <SelectTrigger id="f-tag-color" className="h-10" aria-label="Warna tag baru">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TAG_COLORS.map((c) => (
                    <SelectItem key={c} value={c}>
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "inline-block size-3 shrink-0 rounded-full border border-black/10 dark:border-white/20",
                            TAG_COLOR_CLASSES[c]
                          )}
                          aria-hidden="true"
                        />
                        {TAG_COLOR_LABELS[c]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" className="h-10 w-fit" disabled={saving || !name.trim()}>
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              Tambah
            </Button>
          </form>
        ) : (
          <p className="text-xs text-muted-foreground">
            Hanya OWNER/HR yang dapat mengubah daftar tag.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Tag muncul sebagai chip berwarna di daftar lamaran dan dialog detail.
        </p>
      </div>
    </CollapsibleCard>
  );
}

// ---------------------------------------------------------------------------
// Email Kandidat — template otomatis saat status lamaran berubah (OWNER saja).
// ---------------------------------------------------------------------------

type CandidateEmailTemplateUi = { enabled: boolean; subject: string; body: string };

type CandidateEmailsConfigUi = {
  enabled: boolean;
  surveyEnabled: boolean;
  templates: Record<string, CandidateEmailTemplateUi>;
};

const CANDIDATE_EMAIL_META: { key: string; label: string; hint: string }[] = [
  { key: "REVIEWED", label: "Sedang Ditinjau", hint: "Nonaktif secara default — aktifkan bila ingin memberi kabar di tahap awal." },
  { key: "INTERVIEW", label: "Maju Wawancara", hint: "Informasi tahap wawancara; jadwal resmi tetap dikirim dari sesi wawancara." },
  { key: "ACCEPTED", label: "Diterima", hint: "Selamat + langkah berikutnya; dilengkapi tautan survei pengalaman." },
  { key: "REJECTED", label: "Ditolak", hint: "Kabar penolakan yang hangat; dilengkapi tautan survei pengalaman." },
];

const TEMPLATE_VARIABLES = ["{nama}", "{posisi}", "{kode}", "{status}", "{tanggal}", "{situs}"];

function CandidateEmailsCard() {
  const { role, reportError } = useAdminSession();
  const isOwner = role === "OWNER";
  const [config, setConfig] = useState<CandidateEmailsConfigUi | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiGet<{ config: CandidateEmailsConfigUi }>("/api/admin/candidate-emails");
        setConfig(res.config);
      } catch (err) {
        reportError(err);
      } finally {
        setLoading(false);
      }
    })();
  }, [reportError]);

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      const res = await apiPut<{ config: CandidateEmailsConfigUi }>("/api/admin/candidate-emails", {
        config,
      });
      setConfig(res.config);
      toast.success("Konfigurasi email kandidat tersimpan.");
    } catch (err) {
      reportError(err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <CollapsibleCard
      id="email-kandidat"
      icon={Send}
      title="Email Kandidat"
      description="Email otomatis ke pelamar saat status lamarannya berubah. Terarsip di Kotak Keluar."
      actions={
        isOwner ? (
          <Button
            className="h-10 shrink-0"
            disabled={!config || loading || saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="size-4" aria-hidden="true" />
            )}
            Simpan
          </Button>
        ) : null
      }
    >
        {loading || !config ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0">
                <Label className="text-sm font-medium">Kirim email status otomatis</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Induk semua email status di bawah. Matikan untuk berhenti total.
                </p>
              </div>
              <Switch
                checked={config.enabled}
                disabled={!isOwner}
                onCheckedChange={(checked) =>
                  setConfig((prev) => (prev ? { ...prev, enabled: checked } : prev))
                }
                aria-label="Kirim email status otomatis"
              />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <div className="min-w-0">
                <Label className="text-sm font-medium">Lampirkan survei pengalaman</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Email Diterima/Ditolak mendapat tautan survei 1 pertanyaan (anonim). Rekap di tab Laporan.
                </p>
              </div>
              <Switch
                checked={config.surveyEnabled}
                disabled={!isOwner}
                onCheckedChange={(checked) =>
                  setConfig((prev) => (prev ? { ...prev, surveyEnabled: checked } : prev))
                }
                aria-label="Lampirkan survei pengalaman"
              />
            </div>

            <div className="flex flex-col gap-2">
              {CANDIDATE_EMAIL_META.map((meta) => {
                const template = config.templates[meta.key];
                if (!template) return null;
                const open = openKey === meta.key;
                return (
                  <div key={meta.key} className="rounded-xl border">
                    <div className="flex items-center justify-between gap-3 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Switch
                          checked={template.enabled}
                          disabled={!isOwner}
                          onCheckedChange={(checked) =>
                            setConfig((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    templates: {
                                      ...prev.templates,
                                      [meta.key]: { ...template, enabled: checked },
                                    },
                                  }
                                : prev,
                            )
                          }
                          aria-label={`Email status ${meta.label}`}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{meta.label}</p>
                          <p className="truncate text-xs text-muted-foreground">{meta.hint}</p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 shrink-0"
                        onClick={() => setOpenKey(open ? null : meta.key)}
                        aria-expanded={open}
                      >
                        {open ? (
                          <ChevronUp className="size-4" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="size-4" aria-hidden="true" />
                        )}
                        Template
                      </Button>
                    </div>
                    {open ? (
                      <div className="flex flex-col gap-3 border-t p-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Variabel:</span>
                          {TEMPLATE_VARIABLES.map((variable) => (
                            <Badge
                              key={variable}
                              variant="outline"
                              className="cursor-default font-mono text-[11px] font-normal"
                            >
                              {variable}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`ce-subject-${meta.key}`} className="text-xs">
                            Subjek email
                          </Label>
                          <Input
                            id={`ce-subject-${meta.key}`}
                            value={template.subject}
                            maxLength={200}
                            disabled={!isOwner}
                            onChange={(event) =>
                              setConfig((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      templates: {
                                        ...prev.templates,
                                        [meta.key]: { ...template, subject: event.target.value },
                                      },
                                    }
                                  : prev,
                              )
                            }
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`ce-body-${meta.key}`} className="text-xs">
                            Isi email
                          </Label>
                          <Textarea
                            id={`ce-body-${meta.key}`}
                            value={template.body}
                            maxLength={5000}
                            rows={8}
                            disabled={!isOwner}
                            className="nice-scrollbar"
                            onChange={(event) =>
                              setConfig((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      templates: {
                                        ...prev.templates,
                                        [meta.key]: { ...template, body: event.target.value },
                                      },
                                    }
                                  : prev,
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {!isOwner ? (
              <p className="text-xs text-muted-foreground">
                Hanya pemilik situs yang dapat mengubah konfigurasi ini.
              </p>
            ) : null}
          </div>
        )}
    </CollapsibleCard>
  );
}

// ------------------------------- Daftar Tag (NR-24) -------------------------------

const TAG_LIBRARY_MAX_ITEMS = 30;
const TAG_LIBRARY_MAX_LEN = 30;

/**
 * Kartu mandiri "Daftar Tag" (NR-24): pustaka tag yang tersedia sebagai sugesti
 * saat menandai pelamar. GET/PUT /api/admin/tags ({ tags: string[] }) — simpan
 * langsung per perubahan (tanpa tombol simpan utama). OWNER|HR bisa mengedit,
 * VIEWER hanya melihat.
 */
function TagsCard() {
  const { role } = useAdminSession();
  const canEdit = role === "OWNER" || role === "HR";
  const [tags, setTags] = useState<string[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ tags: string[] }>("/api/admin/tags");
      setTags(data.tags);
      setLoadFailed(false);
    } catch {
      // Kartu pelengkap — tampil kosong bila gagal, tetap bisa dicoba lagi.
      setLoadFailed(true);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function persist(next: string[]) {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const data = await apiPut<{ tags: string[] }>("/api/admin/tags", {
        tags: next,
      });
      setTags(data.tags);
      toast.success("Daftar tag disimpan");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Terjadi kesalahan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const tag = input.trim().slice(0, TAG_LIBRARY_MAX_LEN);
    if (!tag) return;
    if (tags.length >= TAG_LIBRARY_MAX_ITEMS) {
      toast.error(`Maksimal ${TAG_LIBRARY_MAX_ITEMS} tag.`);
      return;
    }
    if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) {
      toast.error("Tag dengan nama itu sudah ada.");
      return;
    }
    setInput("");
    void persist([...tags, tag]);
  }

  function removeTag(tag: string) {
    void persist(tags.filter((t) => t !== tag));
  }

  return (
    <CollapsibleCard
      id="daftar-tag"
      icon={Tag}
      title="Daftar Tag"
      description={
        loaded && !loadFailed
          ? `${tags.length} tag tersimpan sebagai sugesti penandaan pelamar.`
          : "Pustaka tag untuk penandaan pelamar."
      }
    >
      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          Memuat daftar tag...
        </div>
      ) : loadFailed ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground">
            Daftar tag tidak tersedia saat ini.
          </p>
          <Button variant="outline" size="sm" className="h-9" onClick={() => void load()}>
            <RefreshCw className="size-4" aria-hidden="true" />
            Coba Lagi
          </Button>
        </div>
      ) : (
        <>
          {tags.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              Belum ada tag tersimpan.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li
                  key={tag}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground"
                >
                  <span className="truncate">{tag}</span>
                  {canEdit ? (
                    <button
                      type="button"
                      className="ml-0.5 shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-rose-600"
                      onClick={() => removeTag(tag)}
                      disabled={saving}
                      aria-label={`Hapus tag ${tag}`}
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {canEdit ? (
            <div className="flex items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Tag baru, mis. Potensial"
                maxLength={TAG_LIBRARY_MAX_LEN}
                className="h-10 flex-1"
                aria-label="Nama tag baru"
              />
              <Button
                variant="outline"
                className="h-10 shrink-0"
                onClick={addTag}
                disabled={saving || tags.length >= TAG_LIBRARY_MAX_ITEMS}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Plus className="size-4" aria-hidden="true" />
                )}
                Tambah
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Hanya pemilik situs atau HR yang dapat mengubah daftar tag.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Tag tersedia sebagai sugesti saat menandai pelamar. Maksimal{" "}
            {TAG_LIBRARY_MAX_ITEMS} tag, masing-masing hingga {TAG_LIBRARY_MAX_LEN}{" "}
            karakter.
          </p>
        </>
      )}
    </CollapsibleCard>
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
      const res = await apiPost<{ discord: string; telegram: string; telegramDetail?: string | null }>(
        "/api/admin/webhook-test"
      );
      for (const [name, result] of [
        ["Discord", res.discord],
        ["Telegram", res.telegram],
      ] as const) {
        if (name === "Telegram" && result === "gagal") {
          toast.error(`Telegram: gagal — ${res.telegramDetail ?? "tanpa keterangan"}`);
        } else if (result === "ok") toast.success(`${name}: ok`);
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
      {/* Identitas Situs */}
      <CollapsibleCard
        id="identitas"
        icon={Building2}
        title="Identitas Situs"
        description="Nama dan tagline studio di halaman publik."
      >
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      </CollapsibleCard>

      {/* Hero */}
      <CollapsibleCard
        id="hero"
        icon={LayoutTemplate}
        title="Hero"
        description="Badge, deadline, judul, highlight, dan deskripsi bagian hero."
      >
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      </CollapsibleCard>

      {/* Tentang Kami */}
      <CollapsibleCard
        id="tentang"
        icon={Info}
        title="Tentang Kami"
        description="Judul dan deskripsi bagian tentang di halaman publik."
      >
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      </CollapsibleCard>

      {/* Kontak */}
      <CollapsibleCard
        id="kontak"
        icon={Mail}
        title="Kontak"
        description="Kanal kontak yang tampil di halaman publik."
      >
        <div className="grid gap-4 md:grid-cols-2">
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
        </div>
      </CollapsibleCard>

      {/* Footer */}
      <CollapsibleCard
        id="footer"
        icon={PanelBottom}
        title="Footer"
        description="Teks footer di bagian bawah halaman publik."
      >
        <Field id="f-footerText" label="Teks Footer">
          <Input
            id="f-footerText"
            value={site.footerText}
            onChange={(e) => updateField("footerText", e.target.value)}
            className="h-10"
          />
        </Field>
      </CollapsibleCard>

      {/* Suara Tim */}
      <CollapsibleCard
        id="suara-tim"
        icon={Quote}
        title="Suara Tim"
        description="Testimoni anggota tim yang tampil di halaman publik."
      >
        <div className="flex flex-col gap-3">
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
        </div>
      </CollapsibleCard>

      {/* Tag Tim (NR-24 — kelola daftar tag berwarna lamaran, OWNER/HR) */}
      <TeamTagsCard />

      {/* Benefit */}
      <CollapsibleCard
        id="benefit-publik"
        icon={Gift}
        title="Benefit Halaman Publik"
        description="Daftar keuntungan bergabung yang tampil di landing page."
      >
        <div className="flex flex-col gap-3">
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
        </div>
      </CollapsibleCard>

      {/* FAQ */}
      <CollapsibleCard
        id="faq-publik"
        icon={CircleHelp}
        title="FAQ Halaman Publik"
        description="Pertanyaan yang sering diajukan calon kreator."
      >
        <div className="flex flex-col gap-3">
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
        </div>
      </CollapsibleCard>

      {/* Chatbot Publik */}
      <CollapsibleCard
        id="chatbot"
        icon={Bot}
        title="Chatbot Publik"
        description="Aktifkan chatbot Lumina Bot di halaman publik."
      >
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
      </CollapsibleCard>

      {/* Notifikasi Lamaran */}
      <CollapsibleCard
        id="notifikasi"
        icon={BellRing}
        title="Notifikasi Lamaran"
        description="Kirim notifikasi lamaran baru ke channel Discord dan bot Telegram."
      >
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
      </CollapsibleCard>

      {/* Bot Telegram — bot dua arah untuk admin (kartu mandiri, simpan langsung per aksi) */}
      <TelegramBotCard />

      {/* Kotak Keluar Email (arsip + kirim ulang, ketergantungan SMTP) */}
      <EmailOutboxCard />

      {/* Laporan Email Terjadwal (NR-19 — toggle mingguan/bulanan, OWNER saja) */}
      <ReportEmailScheduleCard />

      {/* Email Kandidat — template otomatis per status lamaran */}
      <CandidateEmailsCard />

      {/* Sesi Aktif (perangkat login + logout paksa) */}
      <ActiveSessionsCard />

      {/* Retensi Data (privasi — hapus otomatis lamaran lama) */}
      <RetentionCard />

      {/* Daftar Tag (NR-24 — pustaka sugesti tag pelamar, simpan langsung per aksi) */}
      <TagsCard />

      {/* Tampilan Halaman Publik (visibilitas tiap bagian) */}
      <SectionVisibilityCard sections={site.sections} onChange={updateSection} />

      {/* Pelanggan Notifikasi */}
      <CollapsibleCard
        id="pelanggan"
        icon={MailCheck}
        title="Pelanggan Notifikasi"
        description={`${subscribers.length} email menerima info lowongan baru.`}
        actions={
          <Button
            variant="outline"
            className="h-10"
            onClick={() => void handleCopySubscribers()}
            disabled={subscribers.length === 0}
          >
            <Copy className="size-4" aria-hidden="true" />
            Salin Semua
          </Button>
        }
      >
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
      </CollapsibleCard>

      {/* Widget Embed */}
      <CollapsibleCard
        id="widget-embed"
        icon={Code2}
        title="Widget Embed"
        description="Tampilkan lowongan di situs lain dengan iframe ini."
        actions={
          <Button variant="outline" className="h-10" onClick={() => void handleCopyEmbed()}>
            <Copy className="size-4" aria-hidden="true" />
            Salin
          </Button>
        }
      >
          <Textarea
            readOnly
            value={embedSnippet}
            aria-label="Kode widget embed"
            className="font-mono text-xs"
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
          />
      </CollapsibleCard>

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
