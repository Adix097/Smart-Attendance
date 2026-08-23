export type RecognitionStatus = 'confirmed' | 'uncertain' | 'unknown';

export interface AIInferenceRequest {
  video_path: string;
  enrollment_dir: string;
  model_name?: string;
  provider?: string;
  sampling_fps?: number;
  acceptance_threshold?: number;
  unknown_threshold?: number;
  identity_margin_threshold?: number;
  minimum_observations?: number;
}

export interface AIVideoMetadata {
  path: string;
  total_frames: number;
  source_fps: number;
  duration_seconds: number | null;
}

export interface AISamplingConfiguration {
  requested_fps: number;
  frame_interval: number;
}

export interface AIRecognitionResult {
  identity: string;
  status: RecognitionStatus;
  observation_count: number;
  best_similarity: number | null;
  average_similarity: number | null;
  second_best_similarity: number | null;
  identity_margin: number | null;
}

export interface AIBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AIRecognitionSighting {
  timestamp_seconds: number;
  tracker_id: string;
  identity: string | null;
  status: RecognitionStatus;
  best_similarity: number | null;
  second_best_similarity: number | null;
  identity_margin: number | null;
  camera_id?: string | null;
  bbox?: AIBoundingBox | null;
}

export interface AIInferenceResponse {
  schema_version: string;
  model_name: string;
  model_version: string | null;
  processing_time_seconds: number;
  video: AIVideoMetadata | null;
  sampling: AISamplingConfiguration;
  detected_faces: number;
  sampled_frames: number;
  results: AIRecognitionResult[];
  sightings?: AIRecognitionSighting[];
  errors: string[];
  warnings: string[];
}
