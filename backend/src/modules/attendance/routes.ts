import crypto from 'node:crypto';

import { Router, type Request, type Response } from 'express';

import {
  AIServiceError,
  requestAIInference,
  type AIInferenceRequest,
  type AIInferenceResponse,
} from '../../integrations/ai-service/index.js';
import {
  createAttendanceSession,
  finalizeAttendance,
  getAttendanceObservations,
  getAttendanceRecords,
  storeAIObservations,
  updateAttendanceSessionStatus,
  upsertProvisionalAttendance,
} from './service.js';
import type {
  AttendanceRecordStatus,
  AttendanceRepository,
  AttendanceSessionDatabaseStatus,
} from './types.js';
import { config } from '../../config.js';
import {
  calculateOccupancy,
  defaultVerificationConfig,
  verifyStudent,
} from './verification.js';

type InferenceHandler = (
  request: AIInferenceRequest,
) => Promise<AIInferenceResponse>;

export interface AttendanceRouteDependencies {
  repository: AttendanceRepository;
  inferenceHandler?: InferenceHandler;
}

type SessionStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ProcessRequest extends Omit<AIInferenceRequest, 'enrollment_dir'> {}

interface FinalizeRequest {
  record_id: string;
  finalized_by?: string;
  status?: AttendanceRecordStatus;
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isCreateRequest = (
  value: unknown,
): value is { class_session_id: string } =>
  typeof value === 'object' &&
  value !== null &&
  isNonEmptyString((value as Record<string, unknown>).class_session_id);

const isProcessRequest = (value: unknown): value is ProcessRequest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isNonEmptyString((value as Record<string, unknown>).video_path)
  ) {
    return false;
  }

  return true;
};

const isFinalizeRequest = (value: unknown): value is FinalizeRequest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isNonEmptyString((value as Record<string, unknown>).record_id) ||
    (value as Record<string, unknown>).finalized_by !== undefined &&
    !isNonEmptyString((value as Record<string, unknown>).finalized_by)
  ) {
    return false;
  }
  const status = (value as Record<string, unknown>).status;
  return (
    status === undefined ||
    status === 'present' ||
    status === 'absent' ||
    status === 'uncertain' ||
    status === 'unknown'
  );
};

function externalStatus(status: AttendanceSessionDatabaseStatus): SessionStatus {
  if (status === 'open') return 'pending';
  if (status === 'ready_for_review' || status === 'finalized') return 'completed';
  return status;
}

function sessionResponse(session: {
  id: string;
  classSessionId: string;
  status: AttendanceSessionDatabaseStatus;
  processingError: string | null;
}) {
  return {
    id: session.id,
    class_session_id: session.classSessionId,
    status: externalStatus(session.status),
    error: session.processingError,
  };
}

export function createAttendanceRouter({
  repository,
  inferenceHandler = requestAIInference,
}: AttendanceRouteDependencies): Router {
  const router = Router();

  router.get('/attendance-classes', async (_request, response) => {
    await repository.ensureUpcomingClassSession();
    response.json({ classes: await repository.getClassSessionOptions() });
  });

  router.post('/attendance-sessions', async (request, response) => {
    if (!isCreateRequest(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'class_session_id is required',
        },
      });
      return;
    }

    if (!(await repository.classSessionExists(request.body.class_session_id))) {
      response.status(404).json({
        error: {
          code: 'CLASS_SESSION_NOT_FOUND',
          message: 'Class session not found',
        },
      });
      return;
    }

    const session = await createAttendanceSession(repository, {
      id: crypto.randomUUID(),
      classSessionId: request.body.class_session_id,
      status: 'open',
    });
    await repository.createAttendanceContext(session.id, session.classSessionId);
    response.status(201).json(sessionResponse(session));
  });

  router.post('/attendance-sessions/:id/process', async (request, response) => {
    if (!isProcessRequest(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'video_path and enrollment_dir are required',
        },
      });
      return;
    }

    const session = await repository.getAttendanceSession(request.params.id);
    if (!session) {
      response.status(404).json({
        error: {
          code: 'ATTENDANCE_SESSION_NOT_FOUND',
          message: 'Attendance session not found',
        },
      });
      return;
    }
    if (session.status === 'ready_for_review' || session.status === 'finalized') {
      response.json({
        session: sessionResponse(session),
        observation_count: 0,
      });
      return;
    }

    const enrolledStudents = await repository.getExpectedStudents(session.id);
    const globalIdentityMap = await repository.getStudentIdentityMap();
    if (enrolledStudents.length === 0) {
      response.status(400).json({
        error: {
          code: 'NO_ENROLLED_STUDENTS',
          message: 'The selected class session has no enrolled students',
        },
      });
      return;
    }

    await updateAttendanceSessionStatus(repository, session.id, 'processing', null);

    try {
      const inferenceRequest: AIInferenceRequest = {
        video_path: request.body.video_path,
        enrollment_dir: config.enrollmentRoot,
        model_name: request.body.model_name,
        provider: request.body.provider,
        sampling_fps: request.body.sampling_fps,
        acceptance_threshold: request.body.acceptance_threshold,
        unknown_threshold: request.body.unknown_threshold,
        identity_margin_threshold: request.body.identity_margin_threshold,
        minimum_observations: request.body.minimum_observations,
      };
      const inference = await inferenceHandler(inferenceRequest);

      if (inference.errors.length > 0) {
        throw new InferenceProcessingError(inference.errors.join('; '));
      }

      const context = await repository.getAttendanceContext(session.id);
      if (!context) {
        throw new InferenceProcessingError('Attendance context is missing');
      }
      const expectedStudentIds = new Set(enrolledStudents.map((student) => student.id));
      const sightings = (inference.sightings ?? []).map((sighting) => {
        const studentId =
          sighting.identity === null
            ? null
            : globalIdentityMap.get(sighting.identity) ?? null;
        const observedAt = new Date(
          new Date(context.scheduledStart).getTime() +
            sighting.timestamp_seconds * 1000,
        );
        return {
          id: crypto.randomUUID(),
          studentId,
          trackerId: sighting.tracker_id,
          observedAt: observedAt.toISOString(),
          cameraId: sighting.camera_id ?? null,
          similarity: sighting.best_similarity,
          x: sighting.bbox?.x ?? null,
          y: sighting.bbox?.y ?? null,
          recognitionStatus: sighting.status,
        };
      });
      await repository.storeAttendanceSightings(session.id, sightings);
      if (sightings.length > 0) {
        const snapshots = new Map<string, Set<string>>();
        for (const sighting of sightings) {
          if (
            sighting.recognitionStatus !== 'confirmed' ||
            sighting.studentId === null ||
            !expectedStudentIds.has(sighting.studentId)
          ) {
            continue;
          }
          const elapsedSeconds =
            (new Date(sighting.observedAt).getTime() -
              new Date(context.scheduledStart).getTime()) /
            1000;
          const bucket =
            Math.floor(elapsedSeconds / defaultVerificationConfig.sightingIntervalSeconds) *
            defaultVerificationConfig.sightingIntervalSeconds;
          const bucketTime = new Date(
            new Date(context.scheduledStart).getTime() + bucket * 1000,
          ).toISOString();
          const ids = snapshots.get(bucketTime) ?? new Set<string>();
          ids.add(sighting.studentId);
          snapshots.set(bucketTime, ids);
        }
        for (const [observedAt, ids] of snapshots) {
          const occupancy = calculateOccupancy(enrolledStudents.length, ids);
          await repository.storeOccupancySnapshot(
            session.id,
            observedAt,
            occupancy.expectedCount,
            occupancy.observedCount,
          );
        }
      }

      const observations = await storeAIObservations(
        repository,
        session.id,
        inference.results.map((result) => {
          const studentId =
            result.status === 'unknown' ? null : globalIdentityMap.get(result.identity) ?? null;
          const expectedStudentIds = new Set(enrolledStudents.map((student) => student.id));
          const verificationResult =
            result.status === 'unknown'
              ? 'UNKNOWN'
              : studentId === null
                ? 'UNKNOWN'
                : expectedStudentIds.has(studentId)
                  ? 'FACULTY_REVIEW_REQUIRED'
                  : 'UNEXPECTED_STUDENT';
          return {
            id: crypto.randomUUID(),
            studentId,
            status: result.status,
            similarity: result.best_similarity,
            observationCount: result.observation_count,
            secondBestSimilarity: result.second_best_similarity,
            identityMargin: result.identity_margin,
            evidence: {
              identity: result.identity,
              video: inference.video,
              sampling: inference.sampling,
              detected_faces: inference.detected_faces,
              sampled_frames: inference.sampled_frames,
              errors: inference.errors,
              warnings: inference.warnings,
              verification_result: verificationResult,
            },
            modelName: inference.model_name,
            modelVersion: inference.model_version,
          };
        }),
      );

      for (const student of enrolledStudents) {
        const verification = verifyStudent(
          student.id,
          sightings.filter((sighting) => sighting.recognitionStatus === 'confirmed').map((sighting) => ({
            ...sighting,
            observedAt: new Date(sighting.observedAt),
          })),
          new Date(context.scheduledStart),
          new Date(context.scheduledEnd),
        );
        const evidenceObservation = observations.find(
          (observation) => observation.studentId === student.id,
        );
        if (evidenceObservation || verification.totalSightings > 0) {
          await upsertProvisionalAttendance(repository, {
            id: crypto.randomUUID(),
            attendanceSessionId: session.id,
            studentId: student.id,
            status: verification.proposedStatus,
            source: 'ai',
            confidence: evidenceObservation?.similarity ?? null,
            evidenceObservationId: evidenceObservation?.id ?? null,
            verificationResult: verification.result,
            firstSeen: verification.firstSeen?.toISOString() ?? null,
            lastSeen: verification.lastSeen?.toISOString() ?? null,
            totalSightings: verification.totalSightings,
            lateEntry: verification.lateEntry,
          });
        }
      }

      const completed = await updateAttendanceSessionStatus(
        repository,
        session.id,
        'ready_for_review',
        null,
      );
      response.json({
        session: sessionResponse(completed),
        inference,
        observation_count: observations.length,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Inference processing failed';
      await updateAttendanceSessionStatus(repository, session.id, 'failed', message);

      if (error instanceof AIServiceError) {
        response.status(502).json({
          error: { code: error.code, message: error.message },
          session: sessionResponse({
            ...session,
            status: 'failed',
            processingError: message,
          }),
        });
        return;
      }

      response.status(502).json({
        error: { code: 'INFERENCE_FAILED', message },
        session: sessionResponse({
          ...session,
          status: 'failed',
          processingError: message,
        }),
      });
    }
  });

  router.get('/attendance-sessions/:id/status', async (request, response) => {
    const session = await repository.getAttendanceSession(request.params.id);
    if (!session) {
      response.status(404).json({
        error: {
          code: 'ATTENDANCE_SESSION_NOT_FOUND',
          message: 'Attendance session not found',
        },
      });
      return;
    }
    response.json(sessionResponse(session));
  });

  router.get('/attendance-sessions/:id/observations', async (request, response) => {
    const session = await repository.getAttendanceSession(request.params.id);
    if (!session) {
      response.status(404).json({
        error: {
          code: 'ATTENDANCE_SESSION_NOT_FOUND',
          message: 'Attendance session not found',
        },
      });
      return;
    }
    response.json({ observations: await getAttendanceObservations(repository, session.id) });
  });

  router.get('/attendance-sessions/:id/records', async (request, response) => {
    const session = await repository.getAttendanceSession(request.params.id);
    if (!session) {
      response.status(404).json({
        error: {
          code: 'ATTENDANCE_SESSION_NOT_FOUND',
          message: 'Attendance session not found',
        },
      });
      return;
    }
    response.json({ records: await getAttendanceRecords(repository, session.id) });
  });

  router.post('/attendance-sessions/:id/finalize', async (request, response) => {
    if (!isFinalizeRequest(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'record_id is required',
        },
      });
      return;
    }

    const session = await repository.getAttendanceSession(request.params.id);
    if (!session) {
      response.status(404).json({
        error: {
          code: 'ATTENDANCE_SESSION_NOT_FOUND',
          message: 'Attendance session not found',
        },
      });
      return;
    }

    try {
      const record = await finalizeAttendance(repository, {
        recordId: request.body.record_id,
        attendanceSessionId: session.id,
        finalizedBy: request.body.finalized_by ?? null,
        status: request.body.status,
      });
      response.json({ record });
    } catch (error) {
      response.status(400).json({
        error: {
          code: 'FINALIZATION_FAILED',
          message: error instanceof Error ? error.message : 'Unable to finalize attendance',
        },
      });
    }
  });

  return router;
}

class InferenceProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InferenceProcessingError';
  }
}
