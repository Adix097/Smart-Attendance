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
