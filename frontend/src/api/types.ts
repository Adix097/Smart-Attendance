export type SessionStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ObservationStatus = 'confirmed' | 'uncertain' | 'unknown';
export type RecordStatus = 'present' | 'absent' | 'uncertain' | 'unknown';

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

export type OccurrenceStatus = 'upcoming' | 'active' | 'ended';

export interface ClassSessionOption {
  id: string;
  courseId?: string;
  classroomId?: string;
  courseCode: string;
  courseTitle: string;
  facultyName: string;
  className?: string | null;
  classroomName: string;
  scheduledStart: string;
  scheduledEnd: string;
  status?: OccurrenceStatus;
  batch?: string | null;
  students: EnrolledStudent[];
}

export interface Classroom {
  id: string;
  name: string;
}

export interface TimetableEntry {
  id: string;
  courseCode: string;
  courseName: string;
  facultyName: string;
  className: string | null;
  batch: string;
  startTime: string;
  endTime: string;
  weekday: string;
  room: string;
}

/** The class running now in a room, or the next one if the room is free. */
export interface ClassroomOccurrence {
  entryId: string;
  status: OccurrenceStatus;
  scheduledStart: string;
  scheduledEnd: string;
}

export interface ClassroomTimetable {
  timetable: TimetableEntry[];
  occurrence: ClassroomOccurrence | null;
  now: string;
  timeZone: string;
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
