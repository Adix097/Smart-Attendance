import crypto from 'node:crypto';
import path from 'node:path';

import { Router, type Response } from 'express';

import {
  AIServiceError,
  requestAIInference,
  type AIInferenceRequest,
  type AIInferenceResponse,
} from '../../integrations/ai-service/index.js';
import type {
  AttendanceRecordStatus,
  AttendanceRepository,
  AttendanceSession,
  AttendanceSessionDatabaseStatus,
  EnrolledStudent,
} from './types.js';
import { config } from '../../config.js';
import { occurrenceStatus } from './schedule.js';
import {
  calculateOccupancy,
  defaultVerificationConfig,
  resolveRecognizedIdentity,
  verifyStudent,
} from './verification.js';

type InferenceHandler = (
  request: AIInferenceRequest,
  options?: { logContext?: Record<string, string | number | boolean | null> },
) => Promise<AIInferenceResponse>;

export interface AttendanceRouteDependencies {
  repository: AttendanceRepository;
  inferenceHandler?: InferenceHandler;
}

const supportedVideoExtensions = ['.mp4', '.webm', '.mov', '.avi'];

interface ProcessRequest {
  video_path?: string;
  video_filename?: string;
  video_data_base64?: string;
  model_name?: string;
  provider?: string;
  sampling_fps?: number;
  acceptance_threshold?: number;
  unknown_threshold?: number;
  identity_margin_threshold?: number;
  minimum_observations?: number;
}

interface FinalizeRequest {
  record_id: string;
  finalized_by?: string;
  status?: AttendanceRecordStatus;
}

/** A stored sighting plus the recognition status used to weigh it as evidence. */
interface ResolvedSighting {
  id: string;
  studentId: string | null;
  trackerId: string;
  observedAt: string;
  cameraId: string | null;
  similarity: number | null;
  x: number | null;
  y: number | null;
  recognitionStatus: 'confirmed' | 'uncertain' | 'unknown';
}

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const asRecord = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;

function isCreateRequest(value: unknown): value is { class_session_id: string } {
  const request = asRecord(value);
  return request !== null && isNonEmptyString(request.class_session_id);
}

function isProcessRequest(value: unknown): value is ProcessRequest {
  const request = asRecord(value);
  if (request === null) return false;
  return (
    isNonEmptyString(request.video_path) ||
    (isNonEmptyString(request.video_filename) &&
      isNonEmptyString(request.video_data_base64))
  );
}

function isFinalizeRequest(value: unknown): value is FinalizeRequest {
  const request = asRecord(value);
  if (request === null || !isNonEmptyString(request.record_id)) return false;
  if (request.finalized_by !== undefined && !isNonEmptyString(request.finalized_by)) {
    return false;
  }
  return (
    request.status === undefined ||
    request.status === 'present' ||
    request.status === 'absent' ||
    request.status === 'uncertain' ||
    request.status === 'unknown'
  );
}

function externalStatus(
  status: AttendanceSessionDatabaseStatus,
): 'pending' | 'processing' | 'completed' | 'failed' {
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

function sendError(
  response: Response,
  statusCode: number,
  code: string,
  message: string,
): void {
  response.status(statusCode).json({ error: { code, message } });
}

/**
 * Chooses how the recording reaches the AI service.
 *
 * The AI service runs as its own deployment with its own filesystem, so an
 * uploaded recording must travel in the request body. A caller-supplied
 * video_path is only meaningful when both processes share a host, so it is
 * forwarded untouched for local runs and the development harness.
 */
function videoRequestFields(
  body: ProcessRequest,
): Pick<AIInferenceRequest, 'video_path' | 'video_filename' | 'video_data_base64'> {
  if (isNonEmptyString(body.video_path)) {
    return { video_path: body.video_path };
  }
  const filename = body.video_filename ?? '';
  const extension = path.extname(filename).toLowerCase();
  if (!supportedVideoExtensions.includes(extension)) {
    throw new Error(
      `Unsupported video format: ${extension || filename}. Supported formats: ${supportedVideoExtensions.join(', ')}`,
    );
  }
  return {
    video_filename: filename,
    video_data_base64: body.video_data_base64 ?? '',
  };
}

function resolveSightings(
  inference: AIInferenceResponse,
  identityMap: ReadonlyMap<string, EnrolledStudent>,
  expectedStudentIds: ReadonlySet<string>,
  scheduledStart: Date,
): ResolvedSighting[] {
  return (inference.sightings ?? []).map((sighting) => {
    const { student } = resolveRecognizedIdentity(
      sighting.identity,
      identityMap,
      expectedStudentIds,
    );
    const observedAt = new Date(
      scheduledStart.getTime() + sighting.timestamp_seconds * 1000,
    );
    return {
      id: crypto.randomUUID(),
      studentId: student?.id ?? null,
      trackerId: sighting.tracker_id,
      observedAt: observedAt.toISOString(),
      cameraId: sighting.camera_id ?? null,
      similarity: sighting.best_similarity,
      x: sighting.bbox?.x ?? null,
      y: sighting.bbox?.y ?? null,
      recognitionStatus: sighting.status,
    };
  });
}

function occupancyByInterval(
  sightings: ResolvedSighting[],
  expectedStudentIds: ReadonlySet<string>,
  scheduledStart: Date,
): Map<string, Set<string>> {
  const { sightingIntervalSeconds } = defaultVerificationConfig;
  const buckets = new Map<string, Set<string>>();
  for (const sighting of sightings) {
    if (
      sighting.recognitionStatus !== 'confirmed' ||
      sighting.studentId === null ||
      !expectedStudentIds.has(sighting.studentId)
    ) {
      continue;
    }
    const elapsedSeconds =
      (new Date(sighting.observedAt).getTime() - scheduledStart.getTime()) / 1000;
    const bucketStart =
      Math.floor(elapsedSeconds / sightingIntervalSeconds) * sightingIntervalSeconds;
    const observedAt = new Date(
      scheduledStart.getTime() + bucketStart * 1000,
    ).toISOString();
    const students = buckets.get(observedAt) ?? new Set<string>();
    students.add(sighting.studentId);
    buckets.set(observedAt, students);
  }
  return buckets;
}

export function createAttendanceRouter({
  repository,
  inferenceHandler = requestAIInference,
}: AttendanceRouteDependencies): Router {
  const router = Router();

  async function findSession(
    id: string,
    response: Response,
  ): Promise<AttendanceSession | null> {
    const session = await repository.getAttendanceSession(id);
    if (!session) {
      sendError(
        response,
        404,
        'ATTENDANCE_SESSION_NOT_FOUND',
        'Attendance session not found',
      );
      return null;
    }
    return session;
  }

  router.get('/attendance-classes', async (request, response) => {
    const classroomId =
      typeof request.query.classroom_id === 'string'
        ? request.query.classroom_id
        : undefined;
    await repository.ensureUpcomingClassSession();
    response.json({ classes: await repository.getClassSessionOptions(classroomId) });
  });

  router.get('/classrooms', async (_request, response) => {
    response.json({ classrooms: await repository.getClassrooms() });
  });

  router.get('/classrooms/:id/timetable', async (request, response) => {
    const classroomId = request.params.id;
    if (!(await repository.classroomExists(classroomId))) {
      sendError(response, 404, 'CLASSROOM_NOT_FOUND', 'Classroom not found');
      return;
    }
    response.json({
      timetable: await repository.getClassroomTimetable(classroomId),
      occurrence: await repository.getClassroomOccurrence(classroomId),
      now: new Date().toISOString(),
      timeZone: config.timeZone,
    });
  });

  router.post('/attendance-sessions', async (request, response) => {
    if (!isCreateRequest(request.body)) {
      sendError(response, 400, 'INVALID_REQUEST', 'class_session_id is required');
      return;
    }
    if (!(await repository.classSessionExists(request.body.class_session_id))) {
      sendError(response, 404, 'CLASS_SESSION_NOT_FOUND', 'Class session not found');
      return;
    }

    const existing = await repository.getAttendanceSessionForClass(
      request.body.class_session_id,
    );
    if (existing) {
      response.json(sessionResponse(existing));
      return;
    }

    const session = await repository.createAttendanceSession({
      id: crypto.randomUUID(),
      classSessionId: request.body.class_session_id,
      status: 'open',
    });
    await repository.createAttendanceContext(session.id, session.classSessionId);
    response.status(201).json(sessionResponse(session));
  });

  router.post('/attendance-sessions/:id/process', async (request, response) => {
    if (!isProcessRequest(request.body)) {
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        'video_path or video_filename/video_data_base64 are required',
      );
      return;
    }

    const session = await findSession(request.params.id, response);
    if (!session) return;

    if (session.status === 'ready_for_review' || session.status === 'finalized') {
      response.json({ session: sessionResponse(session), observation_count: 0 });
      return;
    }

    // Timing is resolved before any state changes so an upcoming class is
    // rejected explicitly instead of being reported as an AI failure.
    const context = await repository.getAttendanceContext(session.id);
    if (!context) {
      sendError(
        response,
        409,
        'ATTENDANCE_CONTEXT_MISSING',
        'The attendance session has no scheduled window recorded',
      );
      return;
    }
    const scheduledStart = new Date(context.scheduledStart);
    const scheduledEnd = new Date(context.scheduledEnd);
    const timing = occurrenceStatus(scheduledStart, scheduledEnd, new Date());

    if (timing === 'upcoming') {
      response.status(409).json({
        error: {
          code: 'SESSION_NOT_STARTED',
          message:
            'This class has not started yet. Processing is unavailable until the scheduled start, and no recognition was attempted.',
          scheduled_start: context.scheduledStart,
          scheduled_end: context.scheduledEnd,
          time_zone: config.timeZone,
        },
        session: sessionResponse(session),
      });
      return;
    }

    let videoFields: ReturnType<typeof videoRequestFields>;
    try {
      videoFields = videoRequestFields(request.body);
    } catch (error) {
      sendError(
        response,
        400,
        'INVALID_REQUEST',
        error instanceof Error ? error.message : 'The uploaded video is not usable',
      );
      return;
    }

    const expectedStudents = await repository.getExpectedStudents(session.id);
    if (expectedStudents.length === 0) {
      sendError(
        response,
        400,
        'NO_ENROLLED_STUDENTS',
        'The selected class session has no enrolled students',
      );
      return;
    }
    const identityMap = await repository.getStudentIdentityMap();
    const expectedStudentIds = new Set(expectedStudents.map((student) => student.id));

    await repository.updateAttendanceSessionStatus(session.id, 'processing', null);

    try {
      const inference = await inferenceHandler(
        {
          ...videoFields,
          enrollment_dir: config.enrollmentRoot,
          model_name: request.body.model_name,
          provider: request.body.provider,
          sampling_fps: request.body.sampling_fps,
          acceptance_threshold: request.body.acceptance_threshold,
          unknown_threshold: request.body.unknown_threshold,
          identity_margin_threshold: request.body.identity_margin_threshold,
          minimum_observations: request.body.minimum_observations,
        },
        {
          logContext: {
            attendance_session_id: session.id,
            session_timing: timing,
            ended_session_test: config.allowEndedSessionTest,
          },
        },
      );
      if (inference.errors.length > 0) {
        throw new Error(inference.errors.join('; '));
      }

      const sightings = resolveSightings(
        inference,
        identityMap,
        expectedStudentIds,
        scheduledStart,
      );
      await repository.storeAttendanceSightings(session.id, sightings);

      for (const [observedAt, studentIds] of occupancyByInterval(
        sightings,
        expectedStudentIds,
        scheduledStart,
      )) {
        const occupancy = calculateOccupancy(expectedStudents.length, studentIds);
        await repository.storeOccupancySnapshot(
          session.id,
          observedAt,
          occupancy.expectedCount,
          occupancy.observedCount,
        );
      }

      const observations = await repository.storeAIObservations(
        session.id,
        inference.results.map((result) => {
          const resolved = resolveRecognizedIdentity(
            result.status === 'unknown' ? null : result.identity,
            identityMap,
            expectedStudentIds,
          );
          const student = resolved.student;
          return {
            id: crypto.randomUUID(),
            studentId: student?.id ?? null,
            status: result.status,
            similarity: result.best_similarity,
            observationCount: result.observation_count,
            secondBestSimilarity: result.second_best_similarity,
            identityMargin: result.identity_margin,
            evidence: {
              identity: result.identity,
              global_student_name: student?.name ?? null,
              global_student_number: student?.studentNumber ?? null,
              global_student_batch: student?.batch ?? null,
              global_student_group: student?.group ?? null,
              video: inference.video,
              sampling: inference.sampling,
              detected_faces: inference.detected_faces,
              sampled_frames: inference.sampled_frames,
              errors: inference.errors,
              warnings: inference.warnings,
              verification_result:
                resolved.status === 'EXPECTED'
                  ? 'FACULTY_REVIEW_REQUIRED'
                  : resolved.status,
            },
            modelName: inference.model_name,
            modelVersion: inference.model_version,
          };
        }),
      );

      const confirmedSightings = sightings
        .filter((sighting) => sighting.recognitionStatus === 'confirmed')
        .map((sighting) => ({ ...sighting, observedAt: new Date(sighting.observedAt) }));

      for (const student of expectedStudents) {
        const verification = verifyStudent(
          student.id,
          confirmedSightings,
          scheduledStart,
          scheduledEnd,
        );
        const evidenceObservation = observations.find(
          (observation) => observation.studentId === student.id,
        );
        if (!evidenceObservation && verification.totalSightings === 0) continue;

        await repository.upsertProvisionalAttendance({
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

      const completed = await repository.updateAttendanceSessionStatus(
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
      const code =
        error instanceof AIServiceError ? error.code : 'INFERENCE_FAILED';
      // The client only receives the sanitized message; the diagnostic context
      // that identifies the session and its timing stays in the backend log.
      console.error(
        `[attendance] ${JSON.stringify({
          attendance_session_id: session.id,
          class_session_id: session.classSessionId,
          session_timing: timing,
          scheduled_start: context.scheduledStart,
          scheduled_end: context.scheduledEnd,
          time_zone: config.timeZone,
          code,
          status: error instanceof AIServiceError ? error.statusCode ?? null : null,
          upstream_body:
            error instanceof AIServiceError ? error.upstreamBody : null,
          message,
        })}`,
      );
      await repository.updateAttendanceSessionStatus(session.id, 'failed', message);
      response.status(502).json({
        error: {
          code,
          message,
          retryable: error instanceof AIServiceError ? error.retryable : false,
        },
        session: sessionResponse({
          ...session,
          status: 'failed',
          processingError: message,
        }),
      });
    }
  });

  router.get('/attendance-sessions/:id/status', async (request, response) => {
    const session = await findSession(request.params.id, response);
    if (session) response.json(sessionResponse(session));
  });

  router.get('/attendance-sessions/:id/observations', async (request, response) => {
    const session = await findSession(request.params.id, response);
    if (!session) return;
    response.json({
      observations: await repository.getAttendanceObservations(session.id),
    });
  });

  router.get('/attendance-sessions/:id/records', async (request, response) => {
    const session = await findSession(request.params.id, response);
    if (!session) return;
    response.json({ records: await repository.getAttendanceRecords(session.id) });
  });

  router.post('/attendance-sessions/:id/finalize', async (request, response) => {
    if (!isFinalizeRequest(request.body)) {
      sendError(response, 400, 'INVALID_REQUEST', 'record_id is required');
      return;
    }

    const session = await findSession(request.params.id, response);
    if (!session) return;

    try {
      const record = await repository.finalizeAttendance({
        recordId: request.body.record_id,
        attendanceSessionId: session.id,
        finalizedBy: request.body.finalized_by ?? null,
        status: request.body.status,
      });
      response.json({ record });
    } catch (error) {
      sendError(
        response,
        400,
        'FINALIZATION_FAILED',
        error instanceof Error ? error.message : 'Unable to finalize attendance',
      );
    }
  });

  return router;
}
