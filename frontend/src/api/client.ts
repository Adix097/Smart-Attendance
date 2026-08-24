const apiBase = import.meta.env.VITE_API_URL ?? '/api';

/** Reads the backend's `{ error: { code, message } }` envelope, if present. */
function errorMessage(body: unknown, status: number): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof body.error === 'object' &&
    body.error !== null &&
    'message' in body.error &&
    typeof body.error.message === 'string'
  ) {
    return body.error.message;
  }
  return `Request failed with HTTP ${status}`;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch {
    throw new Error('Backend unavailable. Start Express and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as T;
}
