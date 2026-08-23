import express from 'express';

import {
  AIServiceError,
  requestAIInference,
  type AIInferenceRequest,
  type AIInferenceResponse,
} from './integrations/ai-service/index.js';

type AIInferenceHandler = (
  request: AIInferenceRequest,
) => Promise<AIInferenceResponse>;

const isInferenceRequest = (value: unknown): value is AIInferenceRequest => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const request = value as Record<string, unknown>;
  return (
    typeof request.video_path === 'string' &&
    request.video_path.length > 0 &&
    typeof request.enrollment_dir === 'string' &&
    request.enrollment_dir.length > 0
  );
};

export function createApp(
  inferenceHandler: AIInferenceHandler = requestAIInference,
) {
  const app = express();

  app.use(express.json());

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
      const result = await inferenceHandler(request.body);
      response.json(result);
    } catch (error) {
      if (error instanceof AIServiceError) {
        const status =
          error.code === 'AI_SERVICE_HTTP_ERROR' &&
          error.statusCode !== undefined &&
          error.statusCode >= 400 &&
          error.statusCode < 500
            ? 502
            : 502;
        response.status(status).json({
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }

      response.status(502).json({
        error: {
          code: 'AI_SERVICE_UNAVAILABLE',
          message: 'AI service integration failed',
        },
      });
    }
  });

  return app;
}

const app = createApp();
export default app;
