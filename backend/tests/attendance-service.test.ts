import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createAttendanceSession,
  finalizeAttendance,
  getAttendanceRecords,
  storeAIObservations,
  upsertProvisionalAttendance,
} from '../src/modules/attendance/service.js';
import type {
  AIObservationInput,
  AttendanceObservation,
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  AttendanceContext,
  AttendanceSightingInput,
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
  getEnrolledStudentIds(): Promise<string[]> { return Promise.resolve([]); }
  ensureUpcomingClassSession(): Promise<void> { return Promise.resolve(); }
  getClassSessionOptions(): Promise<ClassSessionOption[]> { return Promise.resolve([]); }
  getEnrolledStudents(): Promise<EnrolledStudent[]> { return Promise.resolve([]); }
  createAttendanceContext(): Promise<void> { return Promise.resolve(); }
  getExpectedStudents(): Promise<EnrolledStudent[]> { return Promise.resolve([]); }
  getStudentIdentityMap(): Promise<Map<string, string>> { return Promise.resolve(new Map()); }
  getAttendanceContext(): Promise<AttendanceContext | null> { return Promise.resolve(null); }
  storeAttendanceSightings(_id: string, _sightings: AttendanceSightingInput[]): Promise<void> {
    return Promise.resolve();
  }
  storeOccupancySnapshot(): Promise<void> { return Promise.resolve(); }

  async createAttendanceSession(
    input: CreateAttendanceSessionInput,
  ): Promise<AttendanceSession> {
    const session = {
      id: input.id,
      classSessionId: input.classSessionId,
      status: input.status ?? 'open',
      processingError: null,
    };
    this.sessions.push(session);
    return session;
  }

  async storeAIObservations(
    attendanceSessionId: string,
    inputs: AIObservationInput[],
  ): Promise<AttendanceObservation[]> {
    const observations = inputs.map((input) => ({
      ...input,
      attendanceSessionId,
    }));
    this.observations.push(...observations);
    return observations;
  }

  async upsertProvisionalAttendance(
    input: ProvisionalAttendanceInput,
  ): Promise<AttendanceRecord> {
    const existing = this.records.find((record) => record.id === input.id);
    if (existing?.finalizedAt) {
      throw new Error('Attendance record is already finalized');
    }
    const record = {
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
    return record;
  }

  async finalizeAttendance(
    input: FinalizeAttendanceInput,
  ): Promise<AttendanceRecord> {
    const record = this.records.find((candidate) => candidate.id === input.recordId);
    assert(record);
    record.finalizedBy = input.finalizedBy;
    record.finalizedAt = '2026-08-24T10:00:00.000Z';
    return record;
  }

  async getAttendanceRecords(
    attendanceSessionId: string,
  ): Promise<AttendanceRecord[]> {
    return this.records.filter(
      (record) => record.attendanceSessionId === attendanceSessionId,
    );
  }
}

describe('attendance persistence service', () => {
  it('creates sessions and stores AI observations', async () => {
    const repository = new MockAttendanceRepository();
    const session = await createAttendanceSession(repository, {
      id: 'session-1',
      classSessionId: 'class-1',
    });
    const observation = await storeAIObservations(repository, session.id, [
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
    assert.equal(observation[0].attendanceSessionId, 'session-1');
    assert.equal(repository.observations.length, 1);
  });

  it('upserts provisional evidence, finalizes, and retrieves records', async () => {
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

    await upsertProvisionalAttendance(repository, input);
    const finalized = await finalizeAttendance(repository, {
      recordId: input.id,
      attendanceSessionId: input.attendanceSessionId,
      finalizedBy: 'faculty-1',
    });
    const records = await getAttendanceRecords(repository, input.attendanceSessionId);

    assert.equal(finalized.finalizedBy, 'faculty-1');
    assert.equal(records.length, 1);
    assert.equal(records[0].status, 'present');
    await assert.rejects(
      upsertProvisionalAttendance(repository, { ...input, status: 'absent' }),
      /already finalized/,
    );
  });
});
