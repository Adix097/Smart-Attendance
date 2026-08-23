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
  ObservationStatus,
} from './types.js';

type InferenceHandler = (
  request: AIInferenceRequest,
) => Promise<AIInferenceResponse>;

export interface AttendanceRouteDependencies {
  repository: AttendanceRepository;
  inferenceHandler?: InferenceHandler;
}

type SessionStatus = 'pending' | 'processing' | 'completed' | 'failed';

interface ProcessRequest extends AIInferenceRequest {
  identity_student_ids?: Record<string, string>;
}

interface FinalizeRequest {
  record_id: string;
  finalized_by: string;
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
    !isNonEmptyString((value as Record<string, unknown>).video_path) ||
    !isNonEmptyString((value as Record<string, unknown>).enrollment_dir)
  ) {
    return false;
  }

  const mapping = (value as Record<string, unknown>).identity_student_ids;
  return (
    mapping === undefined ||
    (typeof mapping === 'object' &&
      mapping !== null &&
      Object.values(mapping).every(isNonEmptyString))
  );
};

const isFinalizeRequest = (value: unknown): value is FinalizeRequest => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !isNonEmptyString((value as Record<string, unknown>).record_id) ||
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

function isKnownIdentity(
  identity: string,
  enrolledStudentIds: Set<string>,
  mapping: Record<string, string> | undefined,
): string | null {
  const mapped = mapping?.[identity] ?? identity;
  return enrolledStudentIds.has(mapped) ? mapped : null;
}

function resultStatus(status: ObservationStatus): 'present' | 'uncertain' {
  return status === 'confirmed' ? 'present' : 'uncertain';
}

export function createAttendanceRouter({
  repository,
  inferenceHandler = requestAIInference,
}: AttendanceRouteDependencies): Router {
  const router = Router();

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

    const enrolledStudentIds = new Set(
      await repository.getEnrolledStudentIds(session.classSessionId),
    );
    const mapping = request.body.identity_student_ids;
    if (
      mapping &&
      Object.values(mapping).some((studentId) => !enrolledStudentIds.has(studentId))
    ) {
      response.status(400).json({
        error: {
          code: 'INVALID_ENROLLMENT_REFERENCE',
          message: 'identity_student_ids must reference enrolled students',
        },
      });
      return;
    }

    await updateAttendanceSessionStatus(repository, session.id, 'processing', null);

    try {
      const inferenceRequest: AIInferenceRequest = {
        video_path: request.body.video_path,
        enrollment_dir: request.body.enrollment_dir,
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

      const observations = await storeAIObservations(
        repository,
        session.id,
        inference.results.map((result) => {
          const studentId =
            result.status === 'unknown'
              ? null
              : isKnownIdentity(result.identity, enrolledStudentIds, mapping);
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
            },
            modelName: inference.model_name,
            modelVersion: inference.model_version,
          };
        }),
      );

      for (const observation of observations) {
        if (
          observation.studentId &&
          observation.status !== 'unknown'
        ) {
          await upsertProvisionalAttendance(repository, {
            id: crypto.randomUUID(),
            attendanceSessionId: session.id,
            studentId: observation.studentId,
            status: resultStatus(observation.status),
            source: 'ai',
            confidence: observation.similarity,
            evidenceObservationId: observation.id,
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
          message: 'record_id and finalized_by are required',
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
        finalizedBy: request.body.finalized_by,
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
