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
    /** Sanitized upstream body snippet (never credentials or video bytes). */
    public readonly upstreamBody: string | null = null,
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
  /** Override for tests: max elapsed ms before a gateway failure skips retry. */
  gatewayRetryBudgetMs?: number;
}

/** Statuses a managed platform returns while a service is asleep, booting, or restarting. */
const gatewayStatuses = new Set([502, 503, 504]);
const maxAttempts = 2;
const defaultRetryDelayMs = 10_000;
const wakeAttempts = 3;
const wakeTimeoutMs = 10_000;
const bodySnippetLimit = 500;
/**
 * Gateway retries help cold starts. A 502 after a long wait usually means the
 * platform killed an in-flight inference (proxy timeout / OOM). Retrying then
 * doubles load and rarely recovers — only retry fast failures.
 */
const gatewayRetryBudgetMs = 45_000;

/** Strips any credentials so the target can be logged safely. */
export function safeAiServiceOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return 'invalid-ai-service-url';
  }
}

/**
 * Removes obvious credential/material patterns from an upstream error body so
 * it can be attached to logs and user-facing error messages.
 */
export function sanitizeUpstreamBody(raw: string, limit = bodySnippetLimit): string {
  let cleaned = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/data:video\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, 'data:video/[redacted]')
    .replace(/\b[A-Za-z0-9+/]{200,}={0,2}\b/g, '[base64-redacted]');

  // Repeat until stable so nested `"Authorization":"…","apikey":"…"` forms clear.
  for (let pass = 0; pass < 4; pass += 1) {
    const next = cleaned.replace(
      /("?(?:authorization|apikey|api[_-]?key|service[_-]?role|password|secret|token)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[A-Za-z0-9._~+/=-]+)/gi,
      '$1[redacted]',
    );
    if (next === cleaned) break;
    cleaned = next;
  }

  return cleaned.replace(/\s+/g, ' ').trim().slice(0, limit);
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

function optionalFormField(
  form: FormData,
  key: string,
  value: string | number | undefined,
): void {
  if (value === undefined) return;
  form.append(key, String(value));
}

/**
 * Build the outbound inference request. Uploads go as multipart so the AI
 * service does not pay a second base64 expansion on top of InsightFace.
 * Path-only local requests stay JSON.
 */
export function buildInferenceHttpRequest(request: AIInferenceRequest): {
  path: string;
  headers?: Record<string, string>;
  body: BodyInit;
  transport: 'multipart' | 'json';
  videoBytes: number;
} {
  if (request.video_data_base64 && request.video_filename) {
    const bytes = Buffer.from(request.video_data_base64, 'base64');
    const form = new FormData();
    form.append(
      'video',
      new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' }),
      request.video_filename,
    );
    form.append('enrollment_dir', request.enrollment_dir);
    optionalFormField(form, 'model_name', request.model_name);
    optionalFormField(form, 'provider', request.provider);
    optionalFormField(form, 'sampling_fps', request.sampling_fps);
    optionalFormField(form, 'acceptance_threshold', request.acceptance_threshold);
    optionalFormField(form, 'unknown_threshold', request.unknown_threshold);
    optionalFormField(
      form,
      'identity_margin_threshold',
      request.identity_margin_threshold,
    );
    optionalFormField(form, 'minimum_observations', request.minimum_observations);
    return {
      path: '/v1/inference/upload',
      body: form,
      transport: 'multipart',
      videoBytes: bytes.byteLength,
    };
  }

  const jsonBody: Record<string, unknown> = {
    enrollment_dir: request.enrollment_dir,
  };
  if (request.video_path) jsonBody.video_path = request.video_path;
  if (request.model_name !== undefined) jsonBody.model_name = request.model_name;
  if (request.provider !== undefined) jsonBody.provider = request.provider;
  if (request.sampling_fps !== undefined) jsonBody.sampling_fps = request.sampling_fps;
  if (request.acceptance_threshold !== undefined) {
    jsonBody.acceptance_threshold = request.acceptance_threshold;
  }
  if (request.unknown_threshold !== undefined) {
    jsonBody.unknown_threshold = request.unknown_threshold;
  }
  if (request.identity_margin_threshold !== undefined) {
    jsonBody.identity_margin_threshold = request.identity_margin_threshold;
  }
  if (request.minimum_observations !== undefined) {
    jsonBody.minimum_observations = request.minimum_observations;
  }

  return {
    path: '/v1/inference',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(jsonBody),
    transport: 'json',
    videoBytes: 0,
  };
}

function gatewayErrorMessage(
  status: number,
  elapsedMs: number,
  snippet: string,
  retryBudgetMs: number,
): string {
  const hint =
    elapsedMs >= retryBudgetMs
      ? 'The platform likely terminated a long-running inference (proxy timeout or out-of-memory).'
      : 'It may be starting up after being idle, restarting, or rejecting oversized bodies.';
  const detail = snippet ? ` Upstream: ${snippet}` : '';
  return `AI service returned HTTP ${status}. ${hint}${detail}`;
}

export async function requestAIInference(
  request: AIInferenceRequest,
  options: RequestOptions = {},
): Promise<AIInferenceResponse> {
  const baseUrl = options.baseUrl ?? config.aiServiceUrl;
  const timeoutMs = options.timeoutMs ?? config.aiServiceTimeoutMs;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logger = options.logger ?? console;
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
  const retryBudgetMs = options.gatewayRetryBudgetMs ?? gatewayRetryBudgetMs;
  const target = safeAiServiceOrigin(baseUrl);
  const prepared = buildInferenceHttpRequest(request);
  const endpoint = `${baseUrl.replace(/\/$/, '')}${prepared.path}`;
  const shape = {
    ...options.logContext,
    target,
    transport: prepared.transport,
    video_source: request.video_data_base64
      ? 'upload'
      : request.video_path
        ? 'path'
        : 'none',
    video_bytes: prepared.videoBytes,
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
    // Rebuild multipart each attempt — FormData body streams are single-use.
    const attemptPayload =
      attempt === 1 ? prepared : buildInferenceHttpRequest(request);

    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: attemptPayload.headers,
        body: attemptPayload.body,
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
      // FastAPI inference errors return HTTP 200 with errors[]; a true 502 on
      // this path is almost never an application ValidationError.
      const isGateway = gatewayStatuses.has(response.status);
      const rawBody = await response.text().catch(() => '');
      const snippet = sanitizeUpstreamBody(rawBody);
      const likelyMidInferenceKill =
        isGateway && elapsedMs >= retryBudgetMs;
      logFailure(logger, 'error', {
        ...shape,
        attempt,
        elapsed_ms: elapsedMs,
        failure: isGateway
          ? likelyMidInferenceKill
            ? 'gateway_mid_inference'
            : 'gateway'
          : 'http_error',
        status: response.status,
        body: snippet,
        retry_eligible:
          isGateway && !likelyMidInferenceKill && attempt < maxAttempts,
      });
      if (isGateway && !likelyMidInferenceKill && attempt < maxAttempts) {
        await wait(retryDelayMs);
        continue;
      }
      throw new AIServiceError(
        'AI_SERVICE_HTTP_ERROR',
        isGateway
          ? gatewayErrorMessage(response.status, elapsedMs, snippet, retryBudgetMs)
          : `AI service returned HTTP ${response.status}${
              snippet ? `: ${snippet}` : ''
            }`,
        response.status,
        isGateway && !likelyMidInferenceKill,
        snippet || null,
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
