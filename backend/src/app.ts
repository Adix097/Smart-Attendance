import express from 'express';

import { config } from './config.js';
import { pool } from './db/pool.js';
import {
  AIServiceError,
  requestAIInference,
  safeAiServiceOrigin,
  type AIInferenceRequest,
  type AIInferenceResponse,
} from './integrations/ai-service/index.js';
import { createAttendanceRouter } from './modules/attendance/routes.js';
import { PgAttendanceRepository } from './modules/attendance/repository.js';
import type { AttendanceRepository } from './modules/attendance/types.js';

const aiHealthTimeoutMs = 10_000;

type AIInferenceHandler = (
  request: AIInferenceRequest,
  options?: { logContext?: Record<string, string | number | boolean | null> },
) => Promise<AIInferenceResponse>;

interface AppDependencies {
  attendanceRepository?: AttendanceRepository;
}

const isFilledString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

function isInferenceRequest(value: unknown): value is AIInferenceRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  const hasVideo =
    isFilledString(request.video_path) ||
    (isFilledString(request.video_filename) &&
      isFilledString(request.video_data_base64));
  return hasVideo && isFilledString(request.enrollment_dir);
}

export function createApp(
  inferenceHandler: AIInferenceHandler = requestAIInference,
  dependencies: AppDependencies = {},
) {
  const app = express();
  const repository =
    dependencies.attendanceRepository ?? new PgAttendanceRepository(pool);

  app.use(express.json({ limit: '64mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok', service: 'backend' });
  });

  /**
   * Deployment probe for the backend-to-AI-service hop. The target host is
   * written to the backend log only; the response stays free of infrastructure
   * detail so it is safe to call from anywhere.
   */
  app.get('/api/ai/health', async (_request, response) => {
    const target = config.aiServiceUrl.replace(/\/$/, '');
    const startedAt = Date.now();
    try {
      const probe = await fetch(`${target}/health`, {
        signal: AbortSignal.timeout(aiHealthTimeoutMs),
      });
      const latencyMs = Date.now() - startedAt;
      const body: unknown = await probe.json().catch(() => null);
      const enrollmentSource =
        typeof body === 'object' && body !== null && 'enrollment_source' in body
          ? String((body as Record<string, unknown>).enrollment_source)
          : null;
      console.log(
        `[ai-service] ${JSON.stringify({
          probe: 'health',
          target: safeAiServiceOrigin(target),
          status: probe.status,
          latency_ms: latencyMs,
          enrollment_source: enrollmentSource,
        })}`,
      );
      response.status(probe.ok ? 200 : 502).json({
        reachable: probe.ok,
        status: probe.status,
        latency_ms: latencyMs,
        enrollment_source: enrollmentSource,
      });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      console.error(
        `[ai-service] ${JSON.stringify({
          probe: 'health',
          target: safeAiServiceOrigin(target),
          latency_ms: latencyMs,
          failure: timedOut ? 'timeout' : 'connection',
          reason: error instanceof Error ? error.message : 'unknown error',
        })}`,
      );
      response.status(502).json({
        reachable: false,
        status: null,
        latency_ms: latencyMs,
        message: timedOut
          ? 'The AI service did not answer the health probe in time. It may be asleep or starting up.'
          : 'The AI service could not be reached. Confirm AI_SERVICE_URL and that the service is running.',
      });
    }
  });

  app.post('/api/ai/inference', async (request, response) => {
    if (!isInferenceRequest(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message:
            'enrollment_dir plus either video_path or video_filename with video_data_base64 are required',
        },
      });
      return;
    }

    try {
      response.json(await inferenceHandler(request.body));
    } catch (error) {
      const failure =
        error instanceof AIServiceError
          ? {
              code: error.code,
              message: error.message,
              retryable: error.retryable,
            }
          : {
              code: 'AI_SERVICE_UNAVAILABLE',
              message: 'AI service integration failed',
              retryable: false,
            };
      response.status(502).json({ error: failure });
    }
  });

  app.use('/api', createAttendanceRouter({ repository, inferenceHandler }));

  return app;
}

const app = createApp();
export default app;
