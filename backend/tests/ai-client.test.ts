import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AIServiceError,
  requestAIInference,
  type AIInferenceRequest,
  type AIInferenceResponse,
} from '../src/integrations/ai-service/index.js';

const request: AIInferenceRequest = {
  video_path: 'C:\\demo\\classroom.mp4',
  enrollment_dir: 'C:\\demo\\enrollment',
};

const responseBody: AIInferenceResponse = {
  schema_version: '1.0',
  model_name: 'buffalo_l',
  model_version: '1.0.1',
  processing_time_seconds: 0.5,
  video: null,
  sampling: {
    requested_fps: 2,
    frame_interval: 13,
  },
  detected_faces: 0,
  sampled_frames: 0,
  results: [],
  errors: [],
  warnings: [],
};

describe('AI service client', () => {
  it('posts the request and parses a valid response', async () => {
    const result = await requestAIInference(request, {
      baseUrl: 'http://127.0.0.1:8000/',
      fetchImpl: async (input, init) => {
        assert.equal(input, 'http://127.0.0.1:8000/v1/inference');
        assert.equal(init?.method, 'POST');
        assert.equal(
          new Headers(init?.headers).get('content-type'),
          'application/json',
        );
        assert.equal(init?.body, JSON.stringify(request));
        return new Response(JSON.stringify(responseBody), { status: 200 });
      },
    });

    assert.deepEqual(result, responseBody);
  });

  it('raises a typed error for a non-2xx response', async () => {
    await assert.rejects(
      requestAIInference(request, {
        fetchImpl: async () => new Response('failed', { status: 503 }),
      }),
      (error: unknown) =>
        error instanceof AIServiceError &&
        error.code === 'AI_SERVICE_HTTP_ERROR' &&
        error.statusCode === 503,
    );
  });

  it('raises a typed error for a malformed response', async () => {
    await assert.rejects(
      requestAIInference(request, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      }),
      (error: unknown) =>
        error instanceof AIServiceError &&
        error.code === 'AI_SERVICE_INVALID_RESPONSE',
    );
  });

  it('raises a typed error when the request times out', async () => {
    await assert.rejects(
      requestAIInference(request, {
        timeoutMs: 10,
        fetchImpl: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      }),
      (error: unknown) =>
        error instanceof AIServiceError && error.code === 'AI_SERVICE_TIMEOUT',
    );
  });
});
