import type { Pool } from 'pg';

import type {
  AttendanceObservation,
  AttendanceRecord,
  AttendanceRepository,
  AttendanceSession,
  CreateAttendanceSessionInput,
  FinalizeAttendanceInput,
  AIObservationInput,
  ProvisionalAttendanceInput,
} from './types.js';

function sessionFromRow(row: {
  id: string;
  class_session_id: string;
  status: string;
}): AttendanceSession {
  return {
    id: row.id,
    classSessionId: row.class_session_id,
    status: row.status,
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
  };
}

export class PgAttendanceRepository implements AttendanceRepository {
  constructor(private readonly database: Pool) {}

  async createAttendanceSession(
    input: CreateAttendanceSessionInput,
  ): Promise<AttendanceSession> {
    const result = await this.database.query(
      `INSERT INTO attendance_sessions (id, class_session_id, status)
       VALUES ($1, $2, $3)
       RETURNING id, class_session_id, status`,
      [input.id, input.classSessionId, input.status ?? 'open'],
    );
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
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (attendance_session_id, student_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         source = EXCLUDED.source,
         confidence = EXCLUDED.confidence,
         evidence_observation_id = EXCLUDED.evidence_observation_id
       RETURNING *`,
      [
        input.id,
        input.attendanceSessionId,
        input.studentId,
        input.status,
        input.source,
        input.confidence,
        input.evidenceObservationId,
      ],
    );
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
         SET finalized_by = $2, finalized_at = now()
         WHERE id = $1
         RETURNING *`,
        [input.recordId, input.finalizedBy],
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
}
