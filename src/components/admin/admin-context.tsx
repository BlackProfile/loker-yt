"use client";

import { createContext, useContext } from "react";
import type { AdminSession, Role } from "@/lib/types";

// Konteks sesi panel admin: role aktif, izin mutasi, dan penanganan error
// terpusat (401 -> kembali ke login, 403 -> toast akses ditolak).

export type AdminSessionContextValue = {
  session: AdminSession;
  role: Role;
  canMutate: boolean;
  reportError: (err: unknown) => void;
  // NR46 — pratinjau peran (Paket A): field OPSIONAL agar konsumen lama tetap
  // aman. `role` di atas SUDAH mengikuti role pratinjau bila aktif; `session`
  // selalu sesi asli.
  previewRole?: Role | null;
  startPreview?: (r: Role) => void;
  stopPreview?: () => void;
};

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export const AdminSessionProvider = AdminSessionContext.Provider;

export function useAdminSession(): AdminSessionContextValue {
  const ctx = useContext(AdminSessionContext);
  if (!ctx) {
    throw new Error("useAdminSession harus dipakai di dalam AdminSessionProvider");
  }
  return ctx;
}
