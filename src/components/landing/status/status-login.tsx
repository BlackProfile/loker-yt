"use client";

// Panel login halaman Cek Status (NR-18-a — dipindah verbatim dari status-page.tsx):
// form email + kode pelacakan + "Ingat saya" + bantuan kehilangan kode (collapsible
// dengan form kirim ulang kode). Semua state tetap dimiliki orchestrator
// (StatusPageInner) dan diteruskan lewat props eksplisit.

import type { FormEvent } from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Loader2,
  Mail,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Dict } from "@/components/landing/strings";

export function StatusLoginPanel({
  p,
  t,
  loginEmail,
  onLoginEmailChange,
  loginCode,
  onLoginCodeChange,
  showCode,
  onToggleShowCode,
  remember,
  onRememberChange,
  loginBusy,
  loginError,
  onLoginSubmit,
  resendEmail,
  onResendEmailChange,
  resendBusy,
  resendMsg,
  onResendSubmit,
  onBrowseJobs,
}: {
  p: Dict["status"]["page"];
  t: Dict;
  loginEmail: string;
  onLoginEmailChange: (value: string) => void;
  loginCode: string;
  onLoginCodeChange: (value: string) => void;
  showCode: boolean;
  onToggleShowCode: () => void;
  remember: boolean;
  onRememberChange: (checked: boolean) => void;
  loginBusy: boolean;
  loginError: string | null;
  onLoginSubmit: (event: FormEvent<HTMLFormElement>) => void;
  resendEmail: string;
  onResendEmailChange: (value: string) => void;
  resendBusy: boolean;
  resendMsg: { type: "ok" | "err"; text: string } | null;
  onResendSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBrowseJobs: () => void;
}) {
  return (
    <>
      <Card className="mx-auto w-full max-w-md rounded-2xl p-6 text-left md:p-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <h1 className="text-xl font-bold tracking-tight">{p.loginTitle}</h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{p.loginDesc}</p>

        <form onSubmit={onLoginSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="status-email">{p.emailLabel}</Label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="status-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => onLoginEmailChange(e.target.value)}
                placeholder={p.emailPh}
                className="h-11 pl-9"
                maxLength={120}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="status-code">{t.status.codeLabel}</Label>
            <div className="relative">
              <Input
                id="status-code"
                name="code"
                type={showCode ? "text" : "password"}
                value={loginCode}
                onChange={(e) => onLoginCodeChange(e.target.value.toUpperCase())}
                placeholder={t.status.codePh}
                className="h-11 pr-20 font-mono uppercase"
                autoComplete="off"
                maxLength={24}
                required
              />
              <button
                type="button"
                onClick={onToggleShowCode}
                className="absolute right-2 top-1/2 flex h-8 -translate-y-1/2 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                aria-label={showCode ? p.hideCode : p.showCode}
              >
                {showCode ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
                {showCode ? p.hideCode : p.showCode}
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox
              checked={remember}
              onCheckedChange={(checked) => onRememberChange(checked === true)}
              aria-label={p.remember}
            />
            {p.remember}
          </label>

          {loginError ? (
            <div
              role="alert"
              className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
            >
              {loginError}
            </div>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full"
            disabled={loginBusy || !loginEmail.trim() || !loginCode.trim()}
          >
            {loginBusy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {p.loggingIn}
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {p.login}
              </>
            )}
          </Button>
        </form>
      </Card>

      {/* Bantuan: kehilangan kode pelacakan */}
      <Collapsible className="mx-auto mt-4 w-full max-w-md">
        <Card className="rounded-2xl p-4">
          <CollapsibleTrigger className="group flex min-h-11 w-full items-center gap-2 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:min-h-0">
            <HelpCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            {p.lostCodeTitle}
            <ChevronDown
              className="ml-auto h-4 w-4 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>{p.lostCodeEmail}</li>
              <li>{p.lostCodeWa}</li>
            </ul>
            {/* NR-15 (idea 8): kirim ulang kode ke email */}
            <form
              className="mt-3 border-t pt-3"
              onSubmit={onResendSubmit}
            >
              <Label htmlFor="resend-email" className="text-sm font-medium">
                {p.emailLabel}
              </Label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <Input
                  id="resend-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={resendEmail}
                  onChange={(e) => onResendEmailChange(e.target.value)}
                  placeholder={p.emailPh}
                  className="h-11 flex-1"
                  maxLength={120}
                  required
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="h-11 shrink-0 gap-2"
                  disabled={resendBusy || !resendEmail.trim()}
                >
                  {resendBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Mail className="h-4 w-4" aria-hidden="true" />
                  )}
                  {resendBusy ? p.resendSending : p.resendBtn}
                </Button>
              </div>
              {resendMsg ? (
                <div
                  role={resendMsg.type === "err" ? "alert" : "status"}
                  className={`mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed ${
                    resendMsg.type === "ok"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
                      : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300"
                  }`}
                >
                  {resendMsg.text}
                </div>
              ) : null}
            </form>
            <Button
              variant="outline"
              className="mt-3 h-11 w-full gap-2"
              onClick={onBrowseJobs}
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {p.browseJobs}
            </Button>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </>
  );
}
