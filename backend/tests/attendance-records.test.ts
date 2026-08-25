import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  AIObservationInput,
  AttendanceContext,
  AttendanceObservation,
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  ClassroomOccurrence,
  ClassroomOption,
  ClassroomTimetableEntry,
  ClassSessionOption,
  CreateAttendanceSessionInput,
  EnrolledStudent,
  FinalizeAttendanceInput,
  ProvisionalAttendanceInput,
} from '../src/modules/attendance/types.js';

class MockAttendanceRepository implements AttendanceRepository {
  readonly sessions: AttendanceSession[] = [];
  readonly observations: AttendanceObservation[] = [];
  readonly records: AttendanceRecord[] = [];

  classSessionExists(): Promise<boolean> { return Promise.resolve(true); }
  ensureUpcomingClassSession(): Promise<void> { return Promise.resolve(); }
  getClassSessionOptions(): Promise<ClassSessionOption[]> { return Promise.resolve([]); }
  getClassrooms(): Promise<ClassroomOption[]> { return Promise.resolve([]); }
  classroomExists(): Promise<boolean> { return Promise.resolve(true); }
  getClassroomTimetable(): Promise<ClassroomTimetableEntry[]> { return Promise.resolve([]); }
  getClassroomOccurrence(): Promise<ClassroomOccurrence | null> { return Promise.resolve(null); }
  getEnrolledStudents(): Promise<EnrolledStudent[]> { return Promise.resolve([]); }
  createAttendanceContext(): Promise<void> { return Promise.resolve(); }
  getExpectedStudents(): Promise<EnrolledStudent[]> { return Promise.resolve([]); }
  getStudentIdentityMap(): Promise<Map<string, EnrolledStudent>> {
    return Promise.resolve(new Map());
  }
  getAttendanceContext(): Promise<AttendanceContext | null> { return Promise.resolve(null); }
  storeAttendanceSightings(): Promise<void> { return Promise.resolve(); }
  storeOccupancySnapshot(): Promise<void> { return Promise.resolve(); }

  getAttendanceSession(id: string): Promise<AttendanceSession | null> {
    return Promise.resolve(this.sessions.find((session) => session.id === id) ?? null);
  }

  updateAttendanceSessionStatus(
    id: string,
    status: AttendanceSession['status'],
    processingError: string | null = null,
  ): Promise<AttendanceSession> {
    const session = this.sessions.find((candidate) => candidate.id === id);
    assert(session);
    session.status = status;
    session.processingError = processingError;
    return Promise.resolve(session);
  }

  createAttendanceSession(input: CreateAttendanceSessionInput): Promise<AttendanceSession> {
    const session: AttendanceSession = {
      id: input.id,
      classSessionId: input.classSessionId,
      status: input.status ?? 'open',
      processingError: null,
    };
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  getAttendanceSessionForClass(classSessionId: string): Promise<AttendanceSession | null> {
    return Promise.resolve(
      this.sessions.find((session) => session.classSessionId === classSessionId) ?? null,
    );
  }

  storeAIObservations(
    attendanceSessionId: string,
    inputs: AIObservationInput[],
  ): Promise<AttendanceObservation[]> {
    const observations = inputs.map((input) => ({ ...input, attendanceSessionId }));
    this.observations.push(...observations);
    return Promise.resolve(observations);
  }

  async upsertProvisionalAttendance(
    input: ProvisionalAttendanceInput,
  ): Promise<AttendanceRecord> {
    const existing = this.records.find((record) => record.id === input.id);
    if (existing?.finalizedAt) {
      throw new Error('Attendance record is already finalized');
    }
    const record: AttendanceRecord = {
      ...input,
      finalizedBy: null,
      finalizedAt: null,
      verificationResult: input.verificationResult ?? null,
      firstSeen: input.firstSeen ?? null,
      lastSeen: input.lastSeen ?? null,
      totalSightings: input.totalSightings ?? 0,
      lateEntry: input.lateEntry ?? false,
    };
    this.records.push(record);
    return Promise.resolve(record);
  }

  finalizeAttendance(input: FinalizeAttendanceInput): Promise<AttendanceRecord> {
    const record = this.records.find((candidate) => candidate.id === input.recordId);
    assert(record);
    record.finalizedBy = input.finalizedBy;
    record.finalizedAt = '2026-08-24T10:00:00.000Z';
    return Promise.resolve(record);
  }

  getAttendanceRecords(attendanceSessionId: string): Promise<AttendanceRecord[]> {
    return Promise.resolve(
      this.records.filter((record) => record.attendanceSessionId === attendanceSessionId),
    );
  }

  getAttendanceObservations(
    attendanceSessionId: string,
  ): Promise<AttendanceObservation[]> {
    return Promise.resolve(
      this.observations.filter(
        (observation) => observation.attendanceSessionId === attendanceSessionId,
      ),
    );
  }
}

describe('attendance record persistence', () => {
  it('creates sessions and stores AI observations', async () => {
    const repository = new MockAttendanceRepository();
    const session = await repository.createAttendanceSession({
      id: 'session-1',
      classSessionId: 'class-1',
    });
    const observations = await repository.storeAIObservations(session.id, [
      {
        id: 'observation-1',
        studentId: 'student-1',
        status: 'confirmed',
        similarity: 0.91,
        observationCount: 4,
        secondBestSimilarity: 0.2,
        identityMargin: 0.71,
        evidence: { source: 'test' },
        modelName: 'buffalo_l',
        modelVersion: '1.0.1',
      },
    ]);

    assert.equal(session.status, 'open');
    assert.equal(observations[0].attendanceSessionId, 'session-1');
    assert.equal(repository.observations.length, 1);
  });

  it('upserts provisional evidence, finalizes, and refuses to overwrite it', async () => {
    const repository = new MockAttendanceRepository();
    const input: ProvisionalAttendanceInput = {
      id: 'record-1',
      attendanceSessionId: 'session-1',
      studentId: 'student-1',
      status: 'present',
      source: 'ai',
      confidence: 0.91,
      evidenceObservationId: 'observation-1',
    };

    await repository.upsertProvisionalAttendance(input);
    const finalized = await repository.finalizeAttendance({
      recordId: input.id,
      attendanceSessionId: input.attendanceSessionId,
      finalizedBy: 'faculty-1',
    });
    const records = await repository.getAttendanceRecords(input.attendanceSessionId);

    assert.equal(finalized.finalizedBy, 'faculty-1');
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'present');
    await assert.rejects(
      repository.upsertProvisionalAttendance({ ...input, status: 'absent' }),
      /already finalized/,
    );
  });
});
