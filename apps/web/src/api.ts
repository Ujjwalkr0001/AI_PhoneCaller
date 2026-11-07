export let csrf = '';
export function setCsrf(token: string) {
  csrf = token;
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      'X-CSRF-Token': csrf,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Request failed');
  return result as T;
}
export const wsUrl = (path: string) =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`;
