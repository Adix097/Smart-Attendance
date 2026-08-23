export type {
  AttendanceObservation,
  AttendanceRecord,
  AttendanceSession,
  ClassSessionOption,
  RecordStatus,
  SessionStatus,
} from './types';

import type {
  AttendanceObservation,
  AttendanceRecord,
  AttendanceSession,
  ClassSessionOption,
  RecordStatus,
} from './types';

const apiBase = import.meta.env.VITE_API_URL ?? '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  return body as T;
}

export function createAttendanceSession(classSessionId: string) {
  return request<AttendanceSession>('/attendance-sessions', {
    method: 'POST',
    body: JSON.stringify({ class_session_id: classSessionId }),
  });
}

export function processAttendanceSession(
  sessionId: string,
  videoPath: string,
) {
  return request<{ session: AttendanceSession; observation_count: number }>(
    `/attendance-sessions/${sessionId}/process`,
    {
      method: 'POST',
      body: JSON.stringify({
        video_path: videoPath,
      }),
    },
  );
}

export function getAttendanceSessionStatus(sessionId: string) {
  return request<AttendanceSession>(`/attendance-sessions/${sessionId}/status`);
}

export function getAttendanceObservations(sessionId: string) {
  return request<{ observations: AttendanceObservation[] }>(
    `/attendance-sessions/${sessionId}/observations`,
  );
}

export function getAttendanceRecords(sessionId: string) {
  return request<{ records: AttendanceRecord[] }>(
    `/attendance-sessions/${sessionId}/records`,
  );
}

export function finalizeAttendance(
  sessionId: string,
  recordId: string,
  status: RecordStatus,
) {
  return request<{ record: AttendanceRecord }>(
    `/attendance-sessions/${sessionId}/finalize`,
    {
      method: 'POST',
      body: JSON.stringify({
        record_id: recordId,
        status,
      }),
    },
  );
}
