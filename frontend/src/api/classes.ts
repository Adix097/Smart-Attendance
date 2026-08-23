import type { ClassSessionOption } from './types';

const apiBase = import.meta.env.VITE_API_URL ?? '/api';

export async function getAttendanceClasses(): Promise<{ classes: ClassSessionOption[] }> {
  let response: Response;
  try {
    response = await fetch(`${apiBase}/attendance-classes`, {
      headers: { 'content-type': 'application/json' },
    });
  } catch {
    throw new Error('Backend unavailable. Start Express and try again.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof body.error === 'object' &&
      body.error !== null &&
      'message' in body.error &&
      typeof body.error.message === 'string'
        ? body.error.message
        : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as { classes: ClassSessionOption[] };
}
