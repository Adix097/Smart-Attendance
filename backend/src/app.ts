import express from 'express';

import { pool } from './db/pool.js';
import {
  AIServiceError,
  requestAIInference,
  type AIInferenceRequest,
  type AIInferenceResponse,
} from './integrations/ai-service/index.js';
import { createAttendanceRouter } from './modules/attendance/routes.js';
import { PgAttendanceRepository } from './modules/attendance/repository.js';
import type { AttendanceRepository } from './modules/attendance/types.js';

type AIInferenceHandler = (
  request: AIInferenceRequest,
) => Promise<AIInferenceResponse>;

interface AppDependencies {
  attendanceRepository?: AttendanceRepository;
}

function isInferenceRequest(value: unknown): value is AIInferenceRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.video_path === 'string' &&
    request.video_path.length > 0 &&
    typeof request.enrollment_dir === 'string' &&
    request.enrollment_dir.length > 0
  );
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

  app.post('/api/ai/inference', async (request, response) => {
    if (!isInferenceRequest(request.body)) {
      response.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'video_path and enrollment_dir are required strings',
        },
      });
      return;
    }

    try {
      response.json(await inferenceHandler(request.body));
    } catch (error) {
      const failure =
        error instanceof AIServiceError
          ? { code: error.code, message: error.message }
          : {
              code: 'AI_SERVICE_UNAVAILABLE',
              message: 'AI service integration failed',
            };
      response.status(502).json({ error: failure });
    }
  });

  app.use('/api', createAttendanceRouter({ repository, inferenceHandler }));

  return app;
}

const app = createApp();
export default app;
