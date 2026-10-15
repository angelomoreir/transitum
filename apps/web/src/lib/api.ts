const BASE = import.meta.env.VITE_API_URL || "";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      const data = await res.json();
      accessToken = data.accessToken;
      return true;
    }
    accessToken = null;
    return false;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/** Restaura a sessão a partir do refresh cookie (arranque da app). */
export async function restoreSession(): Promise<boolean> {
  return tryRefresh();
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  params?: Record<string, string | number | undefined>;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const doFetch = () =>
    fetch(url.toString(), {
      method: opts.method ?? "GET",
      credentials: "include",
      headers: {
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

  let res = await doFetch();
  if (res.status === 401 && accessToken) {
    if (await tryRefresh()) res = await doFetch();
  }

  if (!res.ok) {
    let code = "ERROR";
    let message = "Erro no pedido";
    let issues: unknown;
    try {
      const data = await res.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
      issues = data?.error?.issues;
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiRequestError(res.status, code, message, issues);
  }
  return res.json() as Promise<T>;
}
