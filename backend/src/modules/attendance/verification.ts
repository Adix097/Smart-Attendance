export interface VerificationConfig {
  minimumSightings: number;
  minimumPresenceDurationSeconds: number;
  requiredEndPresenceSeconds: number;
  lateEntryMinutes: number;
  sightingIntervalSeconds: number;
}

export const defaultVerificationConfig: VerificationConfig = {
  minimumSightings: 2,
  minimumPresenceDurationSeconds: 30,
  requiredEndPresenceSeconds: 60,
  lateEntryMinutes: 15,
  sightingIntervalSeconds: 15,
};

export interface AttendanceSighting {
  studentId: string | null;
  trackerId: string;
  observedAt: Date;
  cameraId?: string | null;
  similarity?: number | null;
  x?: number | null;
  y?: number | null;
}

export type VerificationResult =
  | 'AUTO_VERIFIED_PRESENT'
  | 'FACULTY_REVIEW_REQUIRED'
  | 'LATE_ENTRY'
  | 'UNEXPECTED_STUDENT'
  | 'UNKNOWN';

export interface StudentVerification {
  studentId: string | null;
  totalSightings: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
  presenceDurationSeconds: number;
  lateEntry: boolean;
  result: VerificationResult;
  proposedStatus: 'present' | 'uncertain' | 'unknown';
}

export function classifyIdentity(
  studentId: string | null,
  expectedStudentIds: ReadonlySet<string>,
): VerificationResult {
  if (studentId === null) return 'UNKNOWN';
  return expectedStudentIds.has(studentId)
    ? 'FACULTY_REVIEW_REQUIRED'
    : 'UNEXPECTED_STUDENT';
}

export function verifyStudent(
  studentId: string,
  sightings: AttendanceSighting[],
  scheduledStart: Date,
  scheduledEnd: Date,
  config: VerificationConfig = defaultVerificationConfig,
): StudentVerification {
  const studentSightings = sightings
    .filter((sighting) => sighting.studentId === studentId)
    .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  const firstSeen = studentSightings[0]?.observedAt ?? null;
  const lastSeen = studentSightings.at(-1)?.observedAt ?? null;
  const presenceDurationSeconds =
    firstSeen && lastSeen
      ? Math.max(0, (lastSeen.getTime() - firstSeen.getTime()) / 1000)
      : 0;
  const lateEntry =
    firstSeen !== null &&
    firstSeen.getTime() >
      scheduledStart.getTime() + config.lateEntryMinutes * 60 * 1000;
  const sufficientEvidence =
    studentSightings.length >= config.minimumSightings &&
    presenceDurationSeconds >= config.minimumPresenceDurationSeconds;
  const presentAtEnd =
    lastSeen !== null &&
    scheduledEnd.getTime() - lastSeen.getTime() <=
      config.requiredEndPresenceSeconds * 1000;

  if (lateEntry) {
    return {
      studentId,
      totalSightings: studentSightings.length,
      firstSeen,
      lastSeen,
      presenceDurationSeconds,
      lateEntry,
      result: 'LATE_ENTRY',
      proposedStatus: 'uncertain',
    };
  }
  if (sufficientEvidence && presentAtEnd) {
    return {
      studentId,
      totalSightings: studentSightings.length,
      firstSeen,
      lastSeen,
      presenceDurationSeconds,
      lateEntry,
      result: 'AUTO_VERIFIED_PRESENT',
      proposedStatus: 'present',
    };
  }
  return {
    studentId,
    totalSightings: studentSightings.length,
    firstSeen,
    lastSeen,
    presenceDurationSeconds,
    lateEntry,
    result: 'FACULTY_REVIEW_REQUIRED',
    proposedStatus: 'uncertain',
  };
}

export function calculateOccupancy(
  expectedCount: number,
  observedStudentIds: Iterable<string>,
): { expectedCount: number; observedCount: number; occupancyRatio: number } {
  const observedCount = new Set(observedStudentIds).size;
  return {
    expectedCount,
    observedCount,
    occupancyRatio: expectedCount === 0 ? 0 : Math.min(1, observedCount / expectedCount),
  };
}
