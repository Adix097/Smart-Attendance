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
      logger: { error: () => undefined, warn: () => undefined },
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
        retryDelayMs: 0,
        logger: { error: () => undefined, warn: () => undefined },
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
        logger: { error: () => undefined, warn: () => undefined },
        fetchImpl: async () =>
          new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      }),
      (error: unknown) =>
        error instanceof AIServiceError &&
        error.code === 'AI_SERVICE_INVALID_RESPONSE',
    );
  });

  it('retries a gateway status and succeeds when the service finishes waking up', async () => {
    let attempts = 0;
    const result = await requestAIInference(request, {
      retryDelayMs: 0,
      logger: { error: () => undefined, warn: () => undefined },
      fetchImpl: async () => {
        attempts += 1;
        return attempts === 1
          ? new Response('Bad Gateway', { status: 502 })
          : new Response(JSON.stringify(responseBody), { status: 200 });
      },
    });

    assert.equal(attempts, 2);
    assert.deepEqual(result, responseBody);
  });

  it('reports an exhausted gateway failure as retryable without leaking the payload', async () => {
    const logs: string[] = [];
    await assert.rejects(
      requestAIInference(
        { ...request, video_filename: 'c.mp4', video_data_base64: 'c2VjcmV0LXZpZGVv' },
        {
          baseUrl: 'https://ai.example.com',
          retryDelayMs: 0,
          logger: { error: (line: string) => logs.push(line), warn: () => undefined },
          fetchImpl: async () => new Response('no healthy upstream', { status: 502 }),
        },
      ),
      (error: unknown) =>
        error instanceof AIServiceError &&
        error.code === 'AI_SERVICE_HTTP_ERROR' &&
        error.statusCode === 502 &&
        error.retryable &&
        /starting up/.test(error.message),
    );

    assert.equal(logs.length, 2, 'each attempt is logged');
    assert.match(logs[0], /ai\.example\.com/);
    assert.match(logs[0], /no healthy upstream/);
    assert.match(logs[0], /"failure":"gateway"/);
    assert.ok(
      logs.every((line) => !line.includes('c2VjcmV0LXZpZGVv')),
      'the encoded recording must never be logged',
    );
  });

  it('warns when AI_SERVICE_URL points at this host', async () => {
    const logs: string[] = [];
    await requestAIInference(request, {
      baseUrl: 'http://127.0.0.1:8000',
      logger: {
        error: () => undefined,
        warn: (line: string) => logs.push(line),
      },
      fetchImpl: async () =>
        new Response(JSON.stringify(responseBody), { status: 200 }),
    });

    assert.match(logs[0], /127\.0\.0\.1/);
    assert.match(logs[0], /not 127\.0\.0\.1 or localhost/);
  });

  it('does not retry an application error status', async () => {
    let attempts = 0;
    await assert.rejects(
      requestAIInference(request, {
        retryDelayMs: 0,
        logger: { error: () => undefined, warn: () => undefined },
        fetchImpl: async () => {
          attempts += 1;
          return new Response('boom', { status: 500 });
        },
      }),
      (error: unknown) =>
        error instanceof AIServiceError &&
        error.code === 'AI_SERVICE_HTTP_ERROR' &&
        error.retryable === false,
    );

    assert.equal(attempts, 1);
  });

  it('retries a connection failure before reporting the service unreachable', async () => {
    let attempts = 0;
    await assert.rejects(
      requestAIInference(request, {
        retryDelayMs: 0,
        logger: { error: () => undefined, warn: () => undefined },
        fetchImpl: async () => {
          attempts += 1;
          throw new TypeError('fetch failed');
        },
      }),
      (error: unknown) =>
        error instanceof AIServiceError &&
        error.code === 'AI_SERVICE_UNAVAILABLE' &&
        error.retryable,
    );

    assert.equal(attempts, 2);
  });

  it('raises a typed error when the request times out', async () => {
    await assert.rejects(
      requestAIInference(request, {
        timeoutMs: 10,
        logger: { error: () => undefined, warn: () => undefined },
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
