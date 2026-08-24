import type { Pool } from 'pg';

import type {
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
  AIObservationInput,
  ProvisionalAttendanceInput,
} from './types.js';
import { defaultVerificationConfig } from './verification.js';
import {
  occurrenceStatus,
  selectRelevantOccurrences,
  timetableOccurrences,
  type TimetableOccurrenceRow,
} from './schedule.js';
import { config } from '../../config.js';

function sessionFromRow(row: {
  id: string;
  class_session_id: string;
  status: string;
  processing_error?: string | null;
}): AttendanceSession {
  return {
    id: row.id,
    classSessionId: row.class_session_id,
    status: row.status as AttendanceSession['status'],
    processingError: row.processing_error ?? null,
  };
}

function observationFromRow(row: Record<string, unknown>): AttendanceObservation {
  return {
    id: row.id as string,
    attendanceSessionId: row.attendance_session_id as string,
    studentId: row.student_id as string | null,
    status: row.status as AttendanceObservation['status'],
    similarity: row.similarity as number | null,
    observationCount: row.observation_count as number,
    secondBestSimilarity: row.second_best_similarity as number | null,
    identityMargin: row.identity_margin as number | null,
    evidence: row.evidence as Record<string, unknown>,
    modelName: row.model_name as string,
    modelVersion: row.model_version as string | null,
  };
}

function recordFromRow(row: Record<string, unknown>): AttendanceRecord {
  return {
    id: row.id as string,
    attendanceSessionId: row.attendance_session_id as string,
    studentId: row.student_id as string,
    status: row.status as AttendanceRecord['status'],
    source: row.source as AttendanceRecord['source'],
    confidence: row.confidence as number | null,
    evidenceObservationId: row.evidence_observation_id as string | null,
    finalizedBy: row.finalized_by as string | null,
    finalizedAt: row.finalized_at
      ? (row.finalized_at as Date).toISOString()
      : null,
    verificationResult: (row.verification_result as string | null) ?? null,
    firstSeen: row.first_seen ? (row.first_seen as Date).toISOString() : null,
    lastSeen: row.last_seen ? (row.last_seen as Date).toISOString() : null,
    totalSightings: Number(row.total_sightings ?? 0),
    lateEntry: Boolean(row.late_entry),
  };
}

export class PgAttendanceRepository implements AttendanceRepository {
  constructor(private readonly database: Pool) {}

  async classSessionExists(classSessionId: string): Promise<boolean> {
    const result = await this.database.query(
      'SELECT 1 FROM class_sessions WHERE id = $1',
      [classSessionId],
    );
    return Boolean(result.rowCount);
  }

  async getEnrolledStudentIds(classSessionId: string): Promise<string[]> {
    const result = await this.database.query(
      `SELECT e.student_id
       FROM enrollments e
       JOIN class_sessions cs ON cs.course_id = e.course_id
       WHERE cs.id = $1
       ORDER BY e.student_id`,
      [classSessionId],
    );
    return result.rows.map((row) => row.student_id as string);
  }

  async getEnrolledStudents(classSessionId: string): Promise<EnrolledStudent[]> {
    const result = await this.database.query(
      `SELECT DISTINCT s.id, s.student_number, s.name, s.batch, s.student_group
       FROM class_sessions cs
       JOIN timetable_entries te ON te.id = cs.timetable_entry_id
       JOIN students s ON (
         te.batch = 'ALL'
         OR s.student_group = te.batch
         OR EXISTS (
           SELECT 1 FROM enrollments e
           WHERE e.course_id = cs.course_id AND e.student_id = s.id
         )
       )
       WHERE cs.id = $1
       ORDER BY s.name, s.student_number`,
      [classSessionId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      studentNumber: row.student_number as string,
      name: row.name as string,
      batch: row.batch as string | null,
      group: row.student_group as string | null,
    }));
  }

  async createAttendanceContext(
    attendanceSessionId: string,
    classSessionId: string,
  ): Promise<void> {
    const classSession = await this.database.query(
      `SELECT scheduled_start, scheduled_end
       FROM class_sessions WHERE id = $1`,
      [classSessionId],
    );
    if (!classSession.rows[0]) throw new Error(`Class session not found: ${classSessionId}`);
    await this.database.query(
      `INSERT INTO attendance_contexts (
         id, attendance_session_id, class_session_id,
         scheduled_start, scheduled_end, entry_deadline
       )
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz,
               $4::timestamptz + ($6::double precision * interval '1 minute'))
       ON CONFLICT (attendance_session_id) DO NOTHING`,
      [
        crypto.randomUUID(),
        attendanceSessionId,
        classSessionId,
        classSession.rows[0].scheduled_start,
        classSession.rows[0].scheduled_end,
        defaultVerificationConfig.lateEntryMinutes,
      ],
    );
    const students = await this.getEnrolledStudents(classSessionId);
    const context = await this.database.query(
      'SELECT id FROM attendance_contexts WHERE attendance_session_id = $1',
      [attendanceSessionId],
    );
    for (const student of students) {
      await this.database.query(
        `INSERT INTO attendance_context_students (
           attendance_context_id, student_id, student_number, student_name,
           batch, student_group
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (attendance_context_id, student_id) DO NOTHING`,
        [
          context.rows[0].id,
          student.id,
          student.studentNumber,
          student.name,
          student.batch,
          student.group,
        ],
      );
    }
  }

  async getExpectedStudents(attendanceSessionId: string): Promise<EnrolledStudent[]> {
    const result = await this.database.query(
      `SELECT student_id AS id, student_number, student_name AS name,
              batch, student_group
       FROM attendance_context_students acs
       JOIN attendance_contexts ac ON ac.id = acs.attendance_context_id
       WHERE ac.attendance_session_id = $1
       ORDER BY student_name, student_number`,
      [attendanceSessionId],
    );
    return result.rows.map((row) => ({
      id: row.id as string,
      studentNumber: row.student_number as string,
      name: row.name as string,
      batch: row.batch as string | null,
      group: row.student_group as string | null,
    }));
  }

  async getStudentIdentityMap(): Promise<Map<string, EnrolledStudent>> {
    const result = await this.database.query(
      `SELECT id, student_number, name, batch, student_group
       FROM students WHERE student_number IS NOT NULL`,
    );
    return new Map(
      result.rows.map((row) => [
        row.student_number as string,
        {
          id: row.id as string,
          studentNumber: row.student_number as string,
          name: row.name as string,
          batch: row.batch as string | null,
          group: row.student_group as string | null,
        },
      ]),
    );
  }

  async getAttendanceContext(
    attendanceSessionId: string,
  ): Promise<AttendanceContext | null> {
    const result = await this.database.query(
      `SELECT scheduled_start, scheduled_end, entry_deadline
       FROM attendance_contexts WHERE attendance_session_id = $1`,
      [attendanceSessionId],
    );
    const row = result.rows[0];
    return row
      ? {
          scheduledStart: (row.scheduled_start as Date).toISOString(),
          scheduledEnd: (row.scheduled_end as Date).toISOString(),
          entryDeadline: (row.entry_deadline as Date).toISOString(),
        }
      : null;
  }

  async storeAttendanceSightings(
    attendanceSessionId: string,
    sightings: AttendanceSightingInput[],
  ): Promise<void> {
    for (const sighting of sightings) {
      await this.database.query(
        `INSERT INTO attendance_sightings (
           id, attendance_session_id, student_id, tracker_id,
           observed_at, camera_id, similarity, x, y
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (attendance_session_id, tracker_id, observed_at) DO NOTHING`,
        [
          sighting.id,
          attendanceSessionId,
          sighting.studentId,
          sighting.trackerId,
          sighting.observedAt,
          sighting.cameraId,
          sighting.similarity,
          sighting.x,
          sighting.y,
        ],
      );
    }
  }

  async storeOccupancySnapshot(
    attendanceSessionId: string,
    observedAt: string,
    expectedCount: number,
    observedCount: number,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO occupancy_snapshots (
         id, attendance_session_id, observed_at,
         expected_count, observed_count, occupancy_ratio
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (attendance_session_id, observed_at) DO NOTHING`,
      [
        crypto.randomUUID(),
        attendanceSessionId,
        observedAt,
        expectedCount,
        observedCount,
        expectedCount === 0 ? 0 : Math.min(1, observedCount / expectedCount),
      ],
    );
  }

  async ensureUpcomingClassSession(): Promise<void> {
    const result = await this.database.query(
      `SELECT te.id, te.course_id, te.faculty_id, te.room,
              te.day_of_week, te.start_time, te.end_time
       FROM timetable_entries te
       ORDER BY te.id`,
    );
    if (result.rows.length === 0) return;

    const now = new Date();
    const selected = selectRelevantOccurrences(
      timetableOccurrences(result.rows as TimetableOccurrenceRow[], now, config.timeZone),
      now,
    );
    for (const occurrence of selected) {
      await this.database.query(
      `INSERT INTO class_sessions (
         id, timetable_entry_id, course_id, faculty_id, classroom_id,
         scheduled_start, scheduled_end
       )
       VALUES ($1, $2, $3, $4, NULL, $5, $6)
       ON CONFLICT (timetable_entry_id, scheduled_start)
       WHERE timetable_entry_id IS NOT NULL DO NOTHING`,
      [
        crypto.randomUUID(),
        occurrence.row.id,
        occurrence.row.course_id,
        occurrence.row.faculty_id,
        occurrence.start.toISOString(),
        occurrence.end.toISOString(),
      ],
      );
    }
  }

  async getClassSessionOptions(): Promise<ClassSessionOption[]> {
    const result = await this.database.query(
      `SELECT cs.id, cs.course_id, c.code, c.title, f.name AS faculty_name,
              te.batch,
              COALESCE(cl.name, te.room) AS classroom_name,
              cs.scheduled_start, cs.scheduled_end
       FROM class_sessions cs
       JOIN courses c ON c.id = cs.course_id
       JOIN faculty f ON f.id = cs.faculty_id
       JOIN timetable_entries te ON te.id = cs.timetable_entry_id
       LEFT JOIN classrooms cl ON cl.id = cs.classroom_id
       WHERE EXISTS (
         SELECT 1
         FROM students s
         WHERE te.batch = 'ALL'
            OR s.student_group = te.batch
            OR EXISTS (
              SELECT 1 FROM enrollments e
              WHERE e.course_id = cs.course_id AND e.student_id = s.id
            )
       )
       ORDER BY cs.scheduled_start, c.code`,
    );
    const now = new Date();
    const activeRows = result.rows.filter((row) => {
      const start = row.scheduled_start as Date;
      const end = row.scheduled_end as Date;
      return start <= now && now < end;
    });
    const futureRows = result.rows
      .filter((row) => (row.scheduled_start as Date) > now)
      .sort((a, b) =>
        (a.scheduled_start as Date).getTime() - (b.scheduled_start as Date).getTime(),
      );
    const relevantIds = new Set(
      (activeRows.length > 0
        ? activeRows
        : futureRows.filter(
            (row) =>
              (row.scheduled_start as Date).getTime() ===
              (futureRows[0]?.scheduled_start as Date | undefined)?.getTime(),
          )
      ).map((row) => row.id as string),
    );
    const options: ClassSessionOption[] = [];
    for (const row of result.rows.filter((item) => relevantIds.has(item.id as string))) {
      options.push({
        id: row.id as string,
        courseId: row.course_id as string,
        courseCode: row.code as string,
        courseTitle: row.title as string,
        facultyName: row.faculty_name as string,
        classroomName: row.classroom_name as string,
        scheduledStart: (row.scheduled_start as Date).toISOString(),
        scheduledEnd: (row.scheduled_end as Date).toISOString(),
        status: occurrenceStatus(
          row.scheduled_start as Date,
          row.scheduled_end as Date,
          now,
        ),
        batch: row.batch as string | null,
        students: await this.getEnrolledStudents(row.id as string),
      });
    }
    return options;
  }

  async createAttendanceSession(
    input: CreateAttendanceSessionInput,
  ): Promise<AttendanceSession> {
    const result = await this.database.query(
      `INSERT INTO attendance_sessions (id, class_session_id, status)
       VALUES ($1, $2, $3)
       ON CONFLICT (class_session_id)
       DO UPDATE SET class_session_id = EXCLUDED.class_session_id
       RETURNING id, class_session_id, status, processing_error`,
      [input.id, input.classSessionId, input.status ?? 'open'],
    );
    return sessionFromRow(result.rows[0]);
  }

  async getAttendanceSession(id: string): Promise<AttendanceSession | null> {
    const result = await this.database.query(
      `SELECT id, class_session_id, status, processing_error
       FROM attendance_sessions
       WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? sessionFromRow(result.rows[0]) : null;
  }

  async updateAttendanceSessionStatus(
    id: string,
    status: AttendanceSession['status'],
    processingError: string | null = null,
  ): Promise<AttendanceSession> {
    const result = await this.database.query(
      `UPDATE attendance_sessions
       SET status = $2, processing_error = $3
       WHERE id = $1
       RETURNING id, class_session_id, status, processing_error`,
      [id, status, processingError],
    );
    if (!result.rows[0]) {
      throw new Error(`Attendance session not found: ${id}`);
    }
    return sessionFromRow(result.rows[0]);
  }

  async storeAIObservations(
    attendanceSessionId: string,
    observations: AIObservationInput[],
  ): Promise<AttendanceObservation[]> {
    const stored: AttendanceObservation[] = [];
    for (const observation of observations) {
      const result = await this.database.query(
        `INSERT INTO attendance_observations (
           id, attendance_session_id, student_id, status, similarity,
           observation_count, second_best_similarity, identity_margin,
           evidence, model_name, model_version
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          observation.id,
          attendanceSessionId,
          observation.studentId,
          observation.status,
          observation.similarity,
          observation.observationCount,
          observation.secondBestSimilarity,
          observation.identityMargin,
          observation.evidence,
          observation.modelName,
          observation.modelVersion,
        ],
      );
      stored.push(observationFromRow(result.rows[0]));
    }
    return stored;
  }

  async upsertProvisionalAttendance(
    input: ProvisionalAttendanceInput,
  ): Promise<AttendanceRecord> {
    const result = await this.database.query(
      `INSERT INTO attendance_records (
         id, attendance_session_id, student_id, status, source,
         confidence, evidence_observation_id
         , verification_result, first_seen, last_seen, total_sightings, late_entry
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (attendance_session_id, student_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         source = EXCLUDED.source,
         confidence = EXCLUDED.confidence,
         evidence_observation_id = EXCLUDED.evidence_observation_id,
         verification_result = EXCLUDED.verification_result,
         first_seen = EXCLUDED.first_seen,
         last_seen = EXCLUDED.last_seen,
         total_sightings = EXCLUDED.total_sightings,
         late_entry = EXCLUDED.late_entry
       WHERE attendance_records.finalized_at IS NULL
       RETURNING *`,
      [
        input.id,
        input.attendanceSessionId,
        input.studentId,
        input.status,
        input.source,
        input.confidence,
        input.evidenceObservationId,
        input.verificationResult ?? null,
        input.firstSeen ?? null,
        input.lastSeen ?? null,
        input.totalSightings ?? 0,
        input.lateEntry ?? false,
      ],
    );
    if (!result.rows[0]) {
      throw new Error(`Attendance record is already finalized: ${input.id}`);
    }
    return recordFromRow(result.rows[0]);
  }

  async finalizeAttendance(
    input: FinalizeAttendanceInput,
  ): Promise<AttendanceRecord> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE attendance_records
         SET status = COALESCE($2, status), finalized_by = $3, finalized_at = now()
         WHERE id = $1 AND attendance_session_id = $4
         RETURNING *`,
        [input.recordId, input.status ?? null, input.finalizedBy, input.attendanceSessionId],
      );
      if (!result.rowCount) {
        throw new Error(`Attendance record not found: ${input.recordId}`);
      }
      await client.query(
        `INSERT INTO audit_logs (
           id, actor_user_id, action, entity_type, entity_id, metadata
         )
         VALUES ($1, $2, 'attendance_finalization', 'attendance_record', $3, $4)`,
        [
          crypto.randomUUID(),
          input.finalizedBy,
          input.recordId,
          JSON.stringify({}),
        ],
      );
      await client.query('COMMIT');
      return recordFromRow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAttendanceRecords(
    attendanceSessionId: string,
  ): Promise<AttendanceRecord[]> {
    const result = await this.database.query(
      `SELECT *
       FROM attendance_records
       WHERE attendance_session_id = $1
       ORDER BY student_id`,
      [attendanceSessionId],
    );
    return result.rows.map(recordFromRow);
  }

  async getAttendanceObservations(
    attendanceSessionId: string,
  ): Promise<AttendanceObservation[]> {
    const result = await this.database.query(
      `SELECT *
       FROM attendance_observations
       WHERE attendance_session_id = $1
       ORDER BY created_at, id`,
      [attendanceSessionId],
    );
    return result.rows.map(observationFromRow);
  }
}
