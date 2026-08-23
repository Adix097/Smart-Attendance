import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { AIServiceError } from '../src/integrations/ai-service/index.js';
import type {
  AIInferenceRequest,
  AIInferenceResponse,
} from '../src/integrations/ai-service/index.js';
import { createApp } from '../src/app.js';

const validRequest: AIInferenceRequest = {
  video_path: 'C:\\demo\\classroom.mp4',
  enrollment_dir: 'C:\\demo\\enrollment',
};

const validResponse: AIInferenceResponse = {
  schema_version: '1.0',
  model_name: 'buffalo_l',
  model_version: '1.0.1',
  processing_time_seconds: 1.2,
  video: {
    path: validRequest.video_path,
    total_frames: 10,
    source_fps: 25,
    duration_seconds: 0.4,
  },
  sampling: {
    requested_fps: 2,
    frame_interval: 13,
  },
  detected_faces: 3,
  sampled_frames: 1,
  results: [
    {
      identity: 'student-a',
      status: 'uncertain',
      observation_count: 1,
      best_similarity: 0.7,
      average_similarity: 0.7,
      second_best_similarity: null,
      identity_margin: null,
    },
  ],
  errors: [],
  warnings: [],
};

let server: Server;
let serverUrl: string;

function startBackend(
  inferenceHandler: (
    request: AIInferenceRequest,
  ) => Promise<AIInferenceResponse>,
): Promise<void> {
  return new Promise((resolve) => {
    server = createServer(createApp(inferenceHandler));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert(address && typeof address === 'object');
      serverUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function stopBackend(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postInference(body: unknown): Promise<Response> {
  return fetch(`${serverUrl}/api/ai/inference`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await startBackend(async () => validResponse);
});

after(async () => {
  await stopBackend();
});

describe('POST /api/ai/inference', () => {
  it('returns a successful typed AI response', async () => {
    const response = await postInference(validRequest);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), validResponse);
  });

  it('distinguishes an unavailable AI service', async () => {
    await stopBackend();
    await startBackend(async () => {
      throw new AIServiceError(
        'AI_SERVICE_UNAVAILABLE',
        'Unable to reach AI service',
      );
    });

    const response = await postInference(validRequest);

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'Unable to reach AI service',
      },
    });
  });

  it('handles a non-2xx AI response', async () => {
    await stopBackend();
    await startBackend(async () => {
      throw new AIServiceError(
        'AI_SERVICE_HTTP_ERROR',
        'AI service returned HTTP 500',
        500,
      );
    });

    const response = await postInference(validRequest);

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'AI_SERVICE_HTTP_ERROR',
        message: 'AI service returned HTTP 500',
      },
    });
  });

  it('handles a malformed AI response', async () => {
    await stopBackend();
    await startBackend(async () => {
      throw new AIServiceError(
        'AI_SERVICE_INVALID_RESPONSE',
        'AI service returned a response that does not match the inference contract',
      );
    });

    const response = await postInference(validRequest);

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'AI_SERVICE_INVALID_RESPONSE',
        message:
          'AI service returned a response that does not match the inference contract',
      },
    });
  });

  it('rejects missing required fields as application validation', async () => {
    const response = await postInference({ video_path: 'C:\\demo\\classroom.mp4' });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: {
        code: 'INVALID_REQUEST',
        message: 'video_path and enrollment_dir are required strings',
      },
    });
  });
});
