export type SessionStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ObservationStatus = 'confirmed' | 'uncertain' | 'unknown';
export type RecordStatus = 'present' | 'absent' | 'uncertain' | 'unknown';
export type { AttendanceInputSource } from '../types/attendance';

export interface AttendanceSession {
  id: string;
  class_session_id: string;
  status: SessionStatus;
  error: string | null;
}

export interface EnrolledStudent {
  id: string;
  studentNumber: string;
  name: string;
  batch: string | null;
  group: string | null;
}

export interface ClassSessionOption {
  id: string;
  courseId?: string;
  courseCode: string;
  courseTitle: string;
  facultyName: string;
  classroomName: string;
  scheduledStart: string;
  scheduledEnd: string;
  status?: 'upcoming' | 'active' | 'ended';
  batch?: string | null;
  students: EnrolledStudent[];
}

export interface AttendanceObservation {
  id: string;
  attendanceSessionId: string;
  studentId: string | null;
  status: ObservationStatus;
  similarity: number | null;
  observationCount: number;
  secondBestSimilarity: number | null;
  identityMargin: number | null;
  evidence: Record<string, unknown>;
  modelName: string;
  modelVersion: string | null;
}

export interface AttendanceRecord {
  id: string;
  attendanceSessionId: string;
  studentId: string;
  status: RecordStatus;
  source: 'ai' | 'faculty' | 'manual';
  confidence: number | null;
  evidenceObservationId: string | null;
  finalizedBy: string | null;
  finalizedAt: string | null;
  verificationResult: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  totalSightings: number;
  lateEntry: boolean;
}
