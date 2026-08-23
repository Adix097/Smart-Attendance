export type ObservationStatus = 'confirmed' | 'uncertain' | 'unknown';
export type AttendanceRecordStatus =
  | 'present'
  | 'absent'
  | 'uncertain'
  | 'unknown';
export type AttendanceSource = 'ai' | 'faculty' | 'manual';
export type AttendanceSessionDatabaseStatus =
  | 'open'
  | 'processing'
  | 'ready_for_review'
  | 'finalized'
  | 'failed';

export interface CreateAttendanceSessionInput {
  id: string;
  classSessionId: string;
  status?: 'open' | 'processing' | 'ready_for_review' | 'finalized';
}

export interface AttendanceSession {
  id: string;
  classSessionId: string;
  status: AttendanceSessionDatabaseStatus;
  processingError: string | null;
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

export interface AIObservationInput {
  id: string;
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

export interface AttendanceObservation extends AIObservationInput {
  attendanceSessionId: string;
}

export interface AttendanceSightingInput {
  id: string;
  studentId: string | null;
  trackerId: string;
  observedAt: string;
  cameraId: string | null;
  similarity: number | null;
  x: number | null;
  y: number | null;
}

export interface AttendanceContext {
  scheduledStart: string;
  scheduledEnd: string;
  entryDeadline: string;
}

export interface ProvisionalAttendanceInput {
  id: string;
  attendanceSessionId: string;
  studentId: string;
  status: AttendanceRecordStatus;
  source: AttendanceSource;
  confidence: number | null;
  evidenceObservationId: string | null;
  verificationResult?: string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  totalSightings?: number;
  lateEntry?: boolean;
}

export interface AttendanceRecord extends ProvisionalAttendanceInput {
  finalizedBy: string | null;
  finalizedAt: string | null;
  verificationResult: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  totalSightings: number;
  lateEntry: boolean;
}

export interface FinalizeAttendanceInput {
  recordId: string;
  attendanceSessionId: string;
  finalizedBy: string | null;
  status?: AttendanceRecordStatus;
}

export interface AttendanceRepository {
  classSessionExists(classSessionId: string): Promise<boolean>;
  getEnrolledStudentIds(classSessionId: string): Promise<string[]>;
  ensureUpcomingClassSession(): Promise<void>;
  getClassSessionOptions(): Promise<ClassSessionOption[]>;
  getEnrolledStudents(classSessionId: string): Promise<EnrolledStudent[]>;
  createAttendanceContext(
    attendanceSessionId: string,
    classSessionId: string,
  ): Promise<void>;
  getExpectedStudents(attendanceSessionId: string): Promise<EnrolledStudent[]>;
  getStudentIdentityMap(): Promise<Map<string, string>>;
  getAttendanceContext(attendanceSessionId: string): Promise<AttendanceContext | null>;
  storeAttendanceSightings(
    attendanceSessionId: string,
    sightings: AttendanceSightingInput[],
  ): Promise<void>;
  storeOccupancySnapshot(
    attendanceSessionId: string,
    observedAt: string,
    expectedCount: number,
    observedCount: number,
  ): Promise<void>;
  createAttendanceSession(
    input: CreateAttendanceSessionInput,
  ): Promise<AttendanceSession>;
  getAttendanceSession(id: string): Promise<AttendanceSession | null>;
  updateAttendanceSessionStatus(
    id: string,
    status: AttendanceSessionDatabaseStatus,
    processingError?: string | null,
  ): Promise<AttendanceSession>;
  storeAIObservations(
    attendanceSessionId: string,
    observations: AIObservationInput[],
  ): Promise<AttendanceObservation[]>;
  upsertProvisionalAttendance(
    input: ProvisionalAttendanceInput,
  ): Promise<AttendanceRecord>;
  finalizeAttendance(input: FinalizeAttendanceInput): Promise<AttendanceRecord>;
  getAttendanceRecords(attendanceSessionId: string): Promise<AttendanceRecord[]>;
  getAttendanceObservations(
    attendanceSessionId: string,
  ): Promise<AttendanceObservation[]>;
}
