import { config } from '../../config.js';
import type {
  AIInferenceRequest,
  AIInferenceResponse,
  AIRecognitionResult,
  AIRecognitionSighting,
  AISamplingConfiguration,
  AIVideoMetadata,
  RecognitionStatus,
} from './types.js';

export type AIServiceErrorCode =
  | 'AI_SERVICE_TIMEOUT'
  | 'AI_SERVICE_UNAVAILABLE'
  | 'AI_SERVICE_HTTP_ERROR'
  | 'AI_SERVICE_INVALID_RESPONSE';

export class AIServiceError extends Error {
  constructor(
    public readonly code: AIServiceErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

interface RequestOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Correlation detail written to the backend log, never sent to the client. */
  logContext?: Record<string, string | number | boolean | null>;
  logger?: Pick<Console, 'error' | 'warn'>;
  retryDelayMs?: number;
}

/** Statuses a managed platform returns while a service is asleep, booting, or restarting. */
const gatewayStatuses = new Set([502, 503, 504]);
const maxAttempts = 2;
const defaultRetryDelayMs = 10_000;
const wakeAttempts = 3;
const wakeTimeoutMs = 10_000;
const bodySnippetLimit = 500;

/** Strips any credentials so the target can be logged safely. */
export function safeAiServiceOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-ai-service-url';
  }
}

function isLoopbackHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}

function logFailure(
  logger: Pick<Console, 'error' | 'warn'>,
  level: 'error' | 'warn',
  detail: Record<string, unknown>,
): void {
  logger[level](`[ai-service] ${JSON.stringify(detail)}`);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Free Render instances sleep after idle time. A cheap /health ping gives the
 * platform a chance to finish booting before the large inference POST.
 * Failures here are logged and ignored; inference still runs and reports.
 */
async function wakeAIService(
  baseUrl: string,
  fetchImpl: typeof fetch,
  logger: Pick<Console, 'error' | 'warn'>,
  retryDelayMs: number,
  logContext: Record<string, unknown>,
): Promise<void> {
  const healthUrl = `${baseUrl.replace(/\/$/, '')}/health`;
  for (let attempt = 1; attempt <= wakeAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), wakeTimeoutMs);
    const startedAt = Date.now();
    try {
      const response = await fetchImpl(healthUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      if (response.ok) return;
      logFailure(logger, 'error', {
        ...logContext,
        probe: 'wake',
        attempt,
        elapsed_ms: Date.now() - startedAt,
        status: response.status,
        failure: 'gateway',
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      logFailure(logger, 'error', {
        ...logContext,
        probe: 'wake',
        attempt,
        elapsed_ms: Date.now() - startedAt,
        failure: timedOut ? 'timeout' : 'connection',
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < wakeAttempts) await wait(retryDelayMs);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || typeof value === 'number';

const isRecognitionStatus = (value: unknown): value is RecognitionStatus =>
  value === 'confirmed' || value === 'uncertain' || value === 'unknown';

const isVideoMetadata = (value: unknown): value is AIVideoMetadata => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.path === 'string' &&
    typeof value.total_frames === 'number' &&
    typeof value.source_fps === 'number' &&
    isNumberOrNull(value.duration_seconds)
  );
};

const isSamplingConfiguration = (
  value: unknown,
): value is AISamplingConfiguration =>
  isRecord(value) &&
  typeof value.requested_fps === 'number' &&
  typeof value.frame_interval === 'number';

const isRecognitionResult = (
  value: unknown,
): value is AIRecognitionResult => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.identity === 'string' &&
    isRecognitionStatus(value.status) &&
    typeof value.observation_count === 'number' &&
    isNumberOrNull(value.best_similarity) &&
    isNumberOrNull(value.average_similarity) &&
    isNumberOrNull(value.second_best_similarity) &&
    isNumberOrNull(value.identity_margin)
  );
};

const isRecognitionSighting = (
  value: unknown,
): value is AIRecognitionSighting => {
  if (!isRecord(value)) return false;
  const bbox = value.bbox;
  const validBbox =
    bbox === null ||
    bbox === undefined ||
    (isRecord(bbox) &&
      typeof bbox.x === 'number' &&
      typeof bbox.y === 'number' &&
      typeof bbox.width === 'number' &&
      typeof bbox.height === 'number');
  return (
    typeof value.timestamp_seconds === 'number' &&
    typeof value.tracker_id === 'string' &&
    (value.identity === null || typeof value.identity === 'string') &&
    isRecognitionStatus(value.status) &&
    isNumberOrNull(value.best_similarity) &&
    isNumberOrNull(value.second_best_similarity) &&
    isNumberOrNull(value.identity_margin) &&
    (value.camera_id === null ||
      value.camera_id === undefined ||
      typeof value.camera_id === 'string') &&
    validBbox
  );
};

const isAIInferenceResponse = (
  value: unknown,
): value is AIInferenceResponse => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.schema_version === 'string' &&
    typeof value.model_name === 'string' &&
    (value.model_version === null || typeof value.model_version === 'string') &&
    typeof value.processing_time_seconds === 'number' &&
    (value.video === null || isVideoMetadata(value.video)) &&
    isSamplingConfiguration(value.sampling) &&
    typeof value.detected_faces === 'number' &&
    typeof value.sampled_frames === 'number' &&
    Array.isArray(value.results) &&
    value.results.every(isRecognitionResult) &&
    (value.sightings === undefined ||
      (Array.isArray(value.sightings) &&
        value.sightings.every(isRecognitionSighting))) &&
    Array.isArray(value.errors) &&
    value.errors.every((error) => typeof error === 'string') &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === 'string')
  );
};

export async function requestAIInference(
  request: AIInferenceRequest,
  options: RequestOptions = {},
): Promise<AIInferenceResponse> {
  const baseUrl = options.baseUrl ?? config.aiServiceUrl;
  const timeoutMs = options.timeoutMs ?? config.aiServiceTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? console;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const target = safeAiServiceOrigin(baseUrl);
  const endpoint = `${baseUrl.replace(/\/$/, '')}/v1/inference`;
  // The payload carries the recording, so only its shape is ever logged.
  const shape = {
    ...options.logContext,
    target,
    video_source: request.video_data_base64 ? 'upload' : 'path',
    video_bytes_base64: request.video_data_base64?.length ?? 0,
    timeout_ms: timeoutMs,
  };

  if (isLoopbackHost(baseUrl)) {
    logger.warn(
      `[ai-service] ${JSON.stringify({
        ...shape,
        warning:
          'AI_SERVICE_URL points at this host. Separate Render services must use the public AI service URL, not 127.0.0.1 or localhost.',
      })}`,
    );
  }

  // Injected fetchImpl is used by tests that only stub /v1/inference.
  if (options.fetchImpl === undefined) {
    await wakeAIService(baseUrl, fetchImpl, logger, retryDelayMs, shape);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();
    let response: Response;

    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (error) {
      const elapsedMs = Date.now() - startedAt;
      if (error instanceof Error && error.name === 'AbortError') {
        logFailure(logger, 'error', {
          ...shape,
          attempt,
          elapsed_ms: elapsedMs,
          failure: 'timeout',
        });
        throw new AIServiceError(
          'AI_SERVICE_TIMEOUT',
          `The AI service did not respond within ${Math.round(
            timeoutMs / 1000,
          )}s. A cold or overloaded service can exceed this budget; try again.`,
          undefined,
          true,
        );
      }
      const reason =
        error instanceof Error ? error.message : 'unknown connection error';
      logFailure(logger, 'error', {
        ...shape,
        attempt,
        elapsed_ms: elapsedMs,
        failure: 'connection',
        reason,
      });
      if (attempt < maxAttempts) {
        await wait(retryDelayMs);
        continue;
      }
      throw new AIServiceError(
        'AI_SERVICE_UNAVAILABLE',
        'The AI service could not be reached. Confirm it is deployed and running, then try again.',
        undefined,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      // A gateway status means the platform, not the AI application, refused the
      // request: the instance is asleep, booting, restarting, or out of memory.
      const isGateway = gatewayStatuses.has(response.status);
      const snippet = (await response.text().catch(() => ''))
        .slice(0, bodySnippetLimit)
        .trim();
      logFailure(logger, 'error', {
        ...shape,
        attempt,
        elapsed_ms: elapsedMs,
        failure: isGateway ? 'gateway' : 'http_error',
        status: response.status,
        body: snippet,
      });
      if (isGateway && attempt < maxAttempts) {
        await wait(retryDelayMs);
        continue;
      }
      throw new AIServiceError(
        'AI_SERVICE_HTTP_ERROR',
        isGateway
          ? `The AI service is not accepting requests (HTTP ${response.status}). It may be starting up after being idle; try again in a moment.`
          : `The AI service rejected the request with HTTP ${response.status}.`,
        response.status,
        isGateway,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      logFailure(logger, 'error', {
        ...shape,
        attempt,
        elapsed_ms: elapsedMs,
        failure: 'invalid_json',
        status: response.status,
      });
      throw new AIServiceError(
        'AI_SERVICE_INVALID_RESPONSE',
        'AI service returned invalid JSON',
      );
    }

    if (!isAIInferenceResponse(body)) {
      logFailure(logger, 'error', {
        ...shape,
        attempt,
        elapsed_ms: elapsedMs,
        failure: 'contract_mismatch',
        status: response.status,
      });
      throw new AIServiceError(
        'AI_SERVICE_INVALID_RESPONSE',
        'AI service returned a response that does not match the inference contract',
      );
    }

    return body;
  }

  throw new AIServiceError(
    'AI_SERVICE_UNAVAILABLE',
    'The AI service could not be reached. Confirm it is deployed and running, then try again.',
    undefined,
    true,
  );
}
