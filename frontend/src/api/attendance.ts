import type {
  AttendanceObservation,
  AttendanceRecord,
  AttendanceSession,
  ClassSessionOption,
  RecordStatus,
} from './types';
import type { AttendanceInputSource } from '../types/attendance';
import { request } from './client';

export function getAttendanceClasses(classroomId?: string) {
  const query = classroomId ? `?classroom_id=${encodeURIComponent(classroomId)}` : '';
  return request<{ classes: ClassSessionOption[] }>(`/attendance-classes${query}`);
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
