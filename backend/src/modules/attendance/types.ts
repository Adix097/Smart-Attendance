export type ObservationStatus = 'confirmed' | 'uncertain' | 'unknown';
export type AttendanceRecordStatus =
  | 'present'
  | 'absent'
  | 'uncertain'
  | 'unknown';
export type AttendanceSource = 'ai' | 'faculty' | 'manual';

export interface CreateAttendanceSessionInput {
  id: string;
  classSessionId: string;
  status?: 'open' | 'processing' | 'ready_for_review' | 'finalized';
}

export interface AttendanceSession {
  id: string;
  classSessionId: string;
  status: string;
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

export interface ProvisionalAttendanceInput {
  id: string;
  attendanceSessionId: string;
  studentId: string;
  status: AttendanceRecordStatus;
  source: AttendanceSource;
  confidence: number | null;
  evidenceObservationId: string | null;
}

export interface AttendanceRecord extends ProvisionalAttendanceInput {
  finalizedBy: string | null;
  finalizedAt: string | null;
}

export interface FinalizeAttendanceInput {
  recordId: string;
  finalizedBy: string;
}

export interface AttendanceRepository {
  createAttendanceSession(
    input: CreateAttendanceSessionInput,
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
}
