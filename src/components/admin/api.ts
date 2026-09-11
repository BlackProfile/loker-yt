"use client";

// Helper fetch JSON terpusat untuk panel admin.
// Melempar Error dengan pesan dari body { error: string },
// fallback "Terjadi kesalahan. Coba lagi."

const FALLBACK_MESSAGE = "Terjadi kesalahan. Coba lagi.";

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
    throw new Error(FALLBACK_MESSAGE);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    throw new Error(extractError(body) ?? FALLBACK_MESSAGE);
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

export function buildQuery(params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== "ALL") {
      sp.set(key, value);
    }
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}
