"use client";

// Helper fetch JSON terpusat untuk panel admin.
// Melempar ApiError dengan status HTTP + pesan dari body { error: string },
// fallback "Terjadi kesalahan. Coba lagi."
// ApiError dipakai untuk membedakan 401 (sesi habis -> login) dan 403 (toast akses).

const FALLBACK_MESSAGE = "Terjadi kesalahan. Coba lagi.";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function extractError(body: unknown): string | null {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as Record<string, unknown>).error;
    if (typeof err === "string" && err.trim().length > 0) return err;
  }
  return null;
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(FALLBACK_MESSAGE, 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new ApiError(extractError(body) ?? FALLBACK_MESSAGE, res.status);
  }

  return body as T;
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json" },
  };
}

export function apiGet<T>(url: string): Promise<T> {
  return apiFetch<T>(url);
}

export function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, jsonInit("POST", body ?? {}));
}

export function apiPatch<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, jsonInit("PATCH", body));
}

export function apiPut<T>(url: string, body: unknown): Promise<T> {
  return apiFetch<T>(url, jsonInit("PUT", body));
}

export function apiDelete<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: "DELETE" });
}

export function buildQuery(
  params: Record<string, string | number | undefined>
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const str = String(value);
    if (str === "" || str === "ALL") continue;
    sp.set(key, str);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
