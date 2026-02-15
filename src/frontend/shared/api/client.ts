export type ApiError = {
  code: string;
  message: string;
  request_id: string;
};

export type Envelope<T> = {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
};

export async function apiGet<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin"
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!response.ok || !payload.ok || !payload.data) {
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }
  return payload.data;
}
