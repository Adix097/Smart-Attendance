import type {
  AIObservationInput,
  AttendanceObservation,
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  CreateAttendanceSessionInput,
  FinalizeAttendanceInput,
  ProvisionalAttendanceInput,
} from './types.js';

export function updateAttendanceSessionStatus(
  repository: AttendanceRepository,
  attendanceSessionId: string,
  status: AttendanceSession['status'],
  processingError?: string | null,
): Promise<AttendanceSession> {
  return repository.updateAttendanceSessionStatus(
    attendanceSessionId,
    status,
    processingError,
  );
}

export function getAttendanceObservations(
  repository: AttendanceRepository,
  attendanceSessionId: string,
): Promise<AttendanceObservation[]> {
  return repository.getAttendanceObservations(attendanceSessionId);
}

export function createAttendanceSession(
  repository: AttendanceRepository,
  input: CreateAttendanceSessionInput,
): Promise<AttendanceSession> {
  return repository.createAttendanceSession(input);
}

export function storeAIObservations(
  repository: AttendanceRepository,
  attendanceSessionId: string,
  observations: AIObservationInput[],
): Promise<AttendanceObservation[]> {
  return repository.storeAIObservations(attendanceSessionId, observations);
}

export function upsertProvisionalAttendance(
  repository: AttendanceRepository,
  input: ProvisionalAttendanceInput,
): Promise<AttendanceRecord> {
  return repository.upsertProvisionalAttendance(input);
}

export function finalizeAttendance(
  repository: AttendanceRepository,
  input: FinalizeAttendanceInput,
): Promise<AttendanceRecord> {
  return repository.finalizeAttendance(input);
}

export function getAttendanceRecords(
  repository: AttendanceRepository,
  attendanceSessionId: string,
): Promise<AttendanceRecord[]> {
  return repository.getAttendanceRecords(attendanceSessionId);
}
