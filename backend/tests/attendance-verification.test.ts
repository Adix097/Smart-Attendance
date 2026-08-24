import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateOccupancy,
  verifyStudent,
  type AttendanceSighting,
  type VerificationConfig,
} from '../src/modules/attendance/verification.js';

const config: VerificationConfig = {
  minimumSightings: 3,
  minimumPresenceDurationSeconds: 20,
  requiredEndPresenceSeconds: 30,
  lateEntryMinutes: 15,
  sightingIntervalSeconds: 15,
};
const start = new Date('2026-08-24T11:00:00Z');
const end = new Date('2026-08-24T13:00:00Z');

function sightings(studentId: string, times: string[], trackerId = 'camera1-track-1'): AttendanceSighting[] {
  return times.map((observedAt) => ({
    studentId,
    trackerId,
    observedAt: new Date(observedAt),
  }));
}

describe('attendance verification engine', () => {
  it('auto-verifies sufficient expected evidence with end presence', () => {
    const result = verifyStudent('student-1', sightings('student-1', [
      '2026-08-24T11:05:00Z',
      '2026-08-24T12:30:00Z',
      '2026-08-24T12:59:45Z',
    ]), start, end, config);
    assert.equal(result.result, 'AUTO_VERIFIED_PRESENT');
    assert.equal(result.proposedStatus, 'present');
  });

  it('requires review for insufficient or early evidence', () => {
    assert.equal(
      verifyStudent('student-1', sightings('student-1', ['2026-08-24T11:05:00Z']), start, end, config).result,
      'FACULTY_REVIEW_REQUIRED',
    );
    assert.equal(
      verifyStudent('student-1', sightings('student-1', [
        '2026-08-24T11:05:00Z',
        '2026-08-24T11:30:00Z',
        '2026-08-24T11:31:00Z',
      ]), start, end, config).result,
      'FACULTY_REVIEW_REQUIRED',
    );
  });

  it('marks late entry for faculty review', () => {
    const result = verifyStudent('student-1', sightings('student-1', [
      '2026-08-24T11:16:00Z',
      '2026-08-24T12:30:00Z',
      '2026-08-24T12:59:45Z',
    ]), start, end, config);
    assert.equal(result.result, 'LATE_ENTRY');
    assert.equal(result.lateEntry, true);
  });

  it('aggregates multiple tracker IDs for one student', () => {
    const result = verifyStudent('student-1', [
      ...sightings('student-1', ['2026-08-24T11:05:00Z'], 'camera1-track-1'),
      ...sightings('student-1', [
        '2026-08-24T12:30:00Z',
        '2026-08-24T12:59:45Z',
      ], 'camera1-track-37'),
    ], start, end, config);
    assert.equal(result.totalSightings, 3);
    assert.equal(result.result, 'AUTO_VERIFIED_PRESENT');
  });

  it('calculates occupancy using expected students only', () => {
    assert.deepEqual(calculateOccupancy(4, ['student-1', 'student-1', 'student-2']), {
      expectedCount: 4,
      observedCount: 2,
      occupancyRatio: 0.5,
    });
  });
});
