"use client";

// Command palette panel admin (Ctrl+K / Cmd+K):
//   - grup "Navigasi": semua tab sidebar → pindah tab via onNavigate,
//   - grup "Posisi" & "Pelamar": hasil GET /api/admin/search?q= (debounce).
// Memilih posisi membuka halaman kelola via hash #admin/posisi/<id>; memilih
// pelamar memindah ke tab Pelamar lalu membuka dialog detailnya (event global
// "lumina-open-application" + id yang ditahan untuk lintas-tab mount).

import { useEffect, useRef, useState } from "react";
import { Briefcase, ContactRound, Loader2, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import type { CandidateSummary } from "@/lib/types";
import { stageLabel } from "@/lib/stages";
import { apiGet } from "./api";
import { openCandidateDialog } from "./candidate-detail-dialog";

export type PaletteNavItem = {
  value: string;
  label: string;
  icon: LucideIcon;
};

type SearchResponse = {
  positions: { id: string; title: string; isActive: boolean }[];
  applications: {
    id: string;
    name: string;
    trackingCode: string;
    positionTitle: string | null;
    status: string;
  }[];
};

const EMPTY_RESULTS: SearchResponse = { positions: [], applications: [] };
const EMPTY_CANDIDATES: CandidateSummary[] = [];

// ---------------------------------------------------------------------------
// Transport id lamaran lintas-komponen: palet mengirim event
// "lumina-open-application" TEPAT saat memindahkan tab — listener di
// ApplicationsTab belum tentu sudah terpasang (tab baru di-mount). Id lalu
// ditahan di sini dan diambil ApplicationsTab saat daftar lamarannya siap.
// ---------------------------------------------------------------------------

let pendingApplicationId: string | null = null;

/** Tahan id lamaran yang harus dibuka setelah tab Pelamar aktif + data siap. */
export function setPendingApplicationId(id: string): void {
  pendingApplicationId = id;
}

/** Ambil (dan kosongkan) id lamaran yang ditahan, bila ada. */
export function takePendingApplicationId(): string | null {
  const id = pendingApplicationId;
  pendingApplicationId = null;
  return id;
}

export function CommandPalette({
  open,
  onOpenChange,
  onNavigate,
  navItems,
  activeTab,
  canSearchCandidates = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (tab: string) => void;
  navItems: PaletteNavItem[];
  activeTab: string;
  /** NR-41 G9 — aktifkan grup "Cari kandidat" (OWNER/HR saja; API menolak VIEWER). */
  canSearchCandidates?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<SearchResponse>(EMPTY_RESULTS);
  const [candidates, setCandidates] = useState<CandidateSummary[]>(EMPTY_CANDIDATES);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  // Bersihkan timer debounce saat unmount (tanpa setState — hanya side effect).
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  async function runSearch(query: string) {
    const seq = ++seqRef.current;
    try {
      // NR-41 G9 — kandidat dicari paralel dari /api/admin/candidates?q=.
      const [data, candidateRows] = await Promise.all([
        apiGet<SearchResponse>(
          `/api/admin/search?q=${encodeURIComponent(query)}`
        ),
        canSearchCandidates
          ? apiGet<CandidateSummary[]>(
              `/api/admin/candidates?q=${encodeURIComponent(query)}`
            )
          : Promise.resolve(EMPTY_CANDIDATES),
      ]);
      if (seq !== seqRef.current) return; // respons basi — abaikan
      setResults({
        positions: Array.isArray(data.positions) ? data.positions : [],
        applications: Array.isArray(data.applications) ? data.applications : [],
      });
      setCandidates(
        Array.isArray(candidateRows)
          ? candidateRows.slice(0, 8)
          : EMPTY_CANDIDATES
      );
    } catch {
      if (seq !== seqRef.current) return;
      setResults(EMPTY_RESULTS);
      setCandidates(EMPTY_CANDIDATES);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    const query = value.trim();
    if (query.length < 2) {
      seqRef.current += 1; // batalkan respons in-flight
      setSearching(false);
      setResults(EMPTY_RESULTS);
      setCandidates(EMPTY_CANDIDATES);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query);
    }, 250);
  }

  function selectNavigation(value: string) {
    onOpenChange(false);
    onNavigate(value);
  }

  function selectPosition(id: string) {
    onOpenChange(false);
    onNavigate("positions");
    // Deep-link halaman kelola; hashchange listener di AdminApp & PositionsTab
    // yang menyinkronkan tab + tampilan kelola.
    const hash = `#admin/posisi/${id}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  }

  function selectApplication(id: string) {
    onOpenChange(false);
    // Lintas tab: event dikirim sebelum listener terpasang → tahan id agar
    // dibuka begitu daftar lamaran selesai dimuat.
    if (activeTab !== "applications") {
      setPendingApplicationId(id);
    }
    onNavigate("applications");
    window.dispatchEvent(
      new CustomEvent("lumina-open-application", { detail: { id } }),
    );
  }

  // NR-41 G9 — buka dialog profil kandidat (global, via event window; dialog
  // dipasang di AdminApp sehingga tidak perlu berpindah tab).
  function selectCandidate(candidate: CandidateSummary) {
    onOpenChange(false);
    openCandidateDialog(candidate.id);
  }

  const query = search.trim();
  const hasQuery = query.length >= 2;
  const showPositions = hasQuery && results.positions.length > 0;
  const showApplications = hasQuery && results.applications.length > 0;
  const showCandidates = hasQuery && candidates.length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Pencarian Panel Admin"
      description="Cari navigasi, posisi, atau pelamar."
      className="rounded-2xl sm:max-w-xl"
    >
      <CommandInput
        value={search}
        onValueChange={handleSearchChange}
        placeholder="Ketik untuk mencari tab, posisi, atau pelamar..."
        aria-label="Kolom pencarian panel admin"
      />
      <CommandList>
        {searching ? (
          <div
            className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"
            role="status"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Mencari...
          </div>
        ) : null}

        {!hasQuery ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            Tulis minimal 2 karakter untuk mencari posisi &amp; pelamar. Pilih
            navigasi di bawah untuk berpindah tab.
          </p>
        ) : null}

        <CommandGroup heading="Navigasi">
          {navItems.map((item) => (
            <CommandItem
              key={item.value}
              value={item.label}
              onSelect={() => selectNavigation(item.value)}
            >
              <item.icon className="size-4" aria-hidden="true" />
              <span>{item.label}</span>
              {activeTab === item.value ? (
                <span className="text-muted-foreground ml-auto text-xs">
                  terbuka
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>

        {showPositions ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Posisi">
              {results.positions.map((position) => (
                <CommandItem
                  key={position.id}
                  value={position.title}
                  onSelect={() => selectPosition(position.id)}
                >
                  <Briefcase className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    {position.title}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {position.isActive ? "Aktif" : "Nonaktif"}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {showApplications ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Pelamar">
              {results.applications.map((app) => (
                <CommandItem
                  key={app.id}
                  value={`${app.name} ${app.trackingCode} ${app.positionTitle ?? ""}`}
                  onSelect={() => selectApplication(app.id)}
                >
                  <UserRound className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{app.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {app.trackingCode}
                      {app.positionTitle ? ` · ${app.positionTitle}` : ""}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {stageLabel(app.status)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {showCandidates ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Kandidat (profil terpusat)">
              {candidates.map((candidate) => (
                <CommandItem
                  key={candidate.id}
                  value={`${candidate.name} ${candidate.email} ${candidate.phone ?? ""}`}
                  onSelect={() => selectCandidate(candidate)}
                >
                  <ContactRound className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{candidate.name}</span>
                    <span className="text-muted-foreground"> · {candidate.email}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {candidate.applicationCount} lamaran
                    {candidate.doNotHire ? " · do-not-hire" : ""}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {hasQuery && !searching ? <CommandEmpty>Tidak ada hasil.</CommandEmpty> : null}
      </CommandList>
    </CommandDialog>
  );
}
