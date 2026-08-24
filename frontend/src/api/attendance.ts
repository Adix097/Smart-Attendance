import type {
  AttendanceObservation,
  AttendanceRecord,
  AttendanceSession,
  ClassSessionOption,
  RecordStatus,
} from './types';
import type { AttendanceInputSource } from '../types/attendance';

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
  if (!response.ok) throw new Error(errorMessage(body, response.status));
  return body as T;
}

export function getAttendanceClasses() {
  return request<{ classes: ClassSessionOption[] }>('/attendance-classes');
}

export function createAttendanceSession(classSessionId: string) {
  return request<AttendanceSession>('/attendance-sessions', {
    method: 'POST',
    body: JSON.stringify({ class_session_id: classSessionId }),
  });
}

export async function processAttendanceSession(
  sessionId: string,
  source: AttendanceInputSource,
) {
  const body =
    source.type === 'recorded-video'
      ? {
          video_filename: source.file.name,
          video_data_base64: await fileAsBase64(source.file),
        }
      : {
          video_filename: 'webcam-capture.webm',
          video_data_base64: await streamAsBase64(source.stream),
        };
  return request<{ session: AttendanceSession; observation_count: number }>(
    `/attendance-sessions/${sessionId}/process`,
    { method: 'POST', body: JSON.stringify(body) },
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
      body: JSON.stringify({ record_id: recordId, status }),
    },
  );
}

async function fileAsBase64(file: File): Promise<string> {
  if (file.size === 0) throw new Error('The selected video file is empty.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function streamAsBase64(stream: MediaStream): Promise<string> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record webcam video for processing.');
  }
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
    ? 'video/webm;codecs=vp8'
    : MediaRecorder.isTypeSupported('video/webm')
      ? 'video/webm'
      : undefined;
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType })
    : new MediaRecorder(stream);
  const chunks: Blob[] = [];
  const completed = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
    recorder.onerror = () => reject(new Error('Unable to capture webcam video.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
  });
  recorder.start();
  await new Promise((resolve) => window.setTimeout(resolve, 5000));
  if (recorder.state !== 'inactive') recorder.stop();
  const blob = await completed;
  if (blob.size === 0) throw new Error('No webcam frames were captured.');
  return fileAsBase64(new File([blob], 'webcam-capture.webm', { type: 'video/webm' }));
}
