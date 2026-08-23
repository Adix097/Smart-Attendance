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
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}

interface RequestOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/inference`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AIServiceError(
        'AI_SERVICE_TIMEOUT',
        `AI service request timed out after ${timeoutMs}ms`,
      );
    }
    throw new AIServiceError(
      'AI_SERVICE_UNAVAILABLE',
      `Unable to reach AI service: ${
        error instanceof Error ? error.message : 'unknown connection error'
      }`,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AIServiceError(
      'AI_SERVICE_HTTP_ERROR',
      `AI service returned HTTP ${response.status}`,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AIServiceError(
      'AI_SERVICE_INVALID_RESPONSE',
      'AI service returned invalid JSON',
    );
  }

  if (!isAIInferenceResponse(body)) {
    throw new AIServiceError(
      'AI_SERVICE_INVALID_RESPONSE',
      'AI service returned a response that does not match the inference contract',
    );
  }

  return body;
}
