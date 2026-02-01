/**
 * Google Veo 3.1 API Type Definitions
 */

// =============================================================================
// Model Definitions
// =============================================================================

export const MODELS = [
  'veo-3.1-generate-preview',
  'veo-3.1-fast-generate-preview'
] as const;

export type Model = typeof MODELS[number];

export const DEFAULT_MODEL: Model = 'veo-3.1-generate-preview';

// =============================================================================
// Video Configuration
// =============================================================================

export const RESOLUTIONS = ['720p', '1080p', '4k'] as const;
export type Resolution = typeof RESOLUTIONS[number];
export const DEFAULT_RESOLUTION: Resolution = '720p';

export const ASPECT_RATIOS = ['16:9', '9:16'] as const;
export type AspectRatio = typeof ASPECT_RATIOS[number];
export const DEFAULT_ASPECT_RATIO: AspectRatio = '16:9';

export const DURATIONS = [4, 6, 8] as const;
export type Duration = typeof DURATIONS[number];
export const DEFAULT_DURATION: Duration = 8;

export const EXTENSION_DURATION = 7; // Video extension is always 7 seconds
export const EXTENSION_RESOLUTION: Resolution = '720p'; // Extension is always 720p

export const PERSON_GENERATION_OPTIONS = ['allow_adult', 'dont_allow', 'allow_all'] as const;
export type PersonGeneration = typeof PERSON_GENERATION_OPTIONS[number];

export const COMPRESSION_QUALITY_OPTIONS = ['optimized', 'lossless'] as const;
export type CompressionQuality = typeof COMPRESSION_QUALITY_OPTIONS[number];

export const RESIZE_MODES = ['pad', 'crop'] as const;
export type ResizeMode = typeof RESIZE_MODES[number];

// =============================================================================
// Reference Image Types
// =============================================================================

export const REFERENCE_TYPES = ['asset', 'style'] as const;
export type ReferenceType = typeof REFERENCE_TYPES[number];

export interface ReferenceImage {
  image: string; // base64 or URL
  reference_type: ReferenceType;
}

// =============================================================================
// Pricing (USD per second)
// =============================================================================

export const PRICING: Record<Model, Partial<Record<Resolution, { video: number; video_audio: number }>>> = {
  'veo-3.1-generate-preview': {
    '720p': { video: 0.20, video_audio: 0.40 },
    '1080p': { video: 0.20, video_audio: 0.40 },
    '4k': { video: 0.40, video_audio: 0.60 }
  },
  'veo-3.1-fast-generate-preview': {
    '720p': { video: 0.10, video_audio: 0.20 },
    '1080p': { video: 0.10, video_audio: 0.20 }
    // 4k not available for fast model
  }
};

// =============================================================================
// Polling Configuration
// =============================================================================

export const DEFAULT_POLL_INTERVAL = 15000; // 15 seconds
export const DEFAULT_MAX_POLL_ATTEMPTS = 120; // ~30 minutes with 15s interval

// =============================================================================
// API Configuration
// =============================================================================

export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// =============================================================================
// Tool Parameters
// =============================================================================

export interface GenerateVideoParams {
  prompt: string;
  model?: Model | string;
  aspect_ratio?: AspectRatio | string;
  resolution?: Resolution | string;
  duration_seconds?: Duration | number | string;
  generate_audio?: boolean;
  negative_prompt?: string;
  image?: string; // base64 or URL for Image-to-Video
  reference_images?: ReferenceImage[];
  sample_count?: number | string;
  person_generation?: PersonGeneration | string;
  seed?: number | string;
  compression_quality?: CompressionQuality | string;
  resize_mode?: ResizeMode | string;
  storage_uri?: string;
  output_path?: string;
}

export interface ExtendVideoParams {
  video: string; // GCS URI or base64
  prompt?: string;
  output_path?: string;
}

export interface InterpolateFramesParams {
  first_frame: string; // base64 or URL
  last_frame: string; // base64 or URL
  prompt?: string;
  duration_seconds?: Duration | number | string;
  generate_audio?: boolean;
  output_path?: string;
}

export interface GetVideoStatusParams {
  operation_name: string;
}

// =============================================================================
// API Request/Response Types
// =============================================================================

export interface VeoImageInput {
  bytesBase64Encoded?: string;
  gcsUri?: string;
}

export interface VeoVideoInput {
  bytesBase64Encoded?: string;
  uri?: string;
}

export interface VeoReferenceImageInput {
  image: VeoImageInput;
  referenceType: ReferenceType;
}

export interface VeoGenerateRequest {
  instances: Array<{
    prompt?: string;
    image?: VeoImageInput;
    lastFrame?: VeoImageInput;
    video?: VeoVideoInput;
    referenceImages?: VeoReferenceImageInput[];
  }>;
  parameters: {
    aspectRatio?: string;
    resolution?: string;
    durationSeconds?: number;
    sampleCount?: number;
    generateAudio?: boolean;
    negativePrompt?: string;
    personGeneration?: string;
    seed?: number;
    compressionQuality?: string;
    resizeMode?: string;
    storageUri?: string;
  };
}

export interface VeoGeneratedVideo {
  video: {
    uri?: string;
    bytesBase64Encoded?: string;
  };
}

export interface VeoOperationResponse {
  name: string;
  done?: boolean;
  metadata?: Record<string, unknown>;
  response?: {
    generatedVideos?: VeoGeneratedVideo[];
  };
  error?: {
    code: number;
    message: string;
    details?: Array<Record<string, unknown>>;
  };
}

// =============================================================================
// Tool Result Types
// =============================================================================

export interface VideoGenerationResult {
  success: boolean;
  operation_name?: string;
  video_url?: string;
  video_path?: string;
  duration_seconds?: number;
  estimated_cost?: number;
  error?: string;
  failure_reason?: string;
}

export interface VideoStatusResult {
  success: boolean;
  operation_name: string;
  done: boolean;
  video_url?: string;
  error?: string;
  failure_reason?: string;
}

// =============================================================================
// Validation Functions
// =============================================================================

export function isValidModel(model: string): model is Model {
  return MODELS.includes(model as Model);
}

export function isValidResolution(resolution: string): resolution is Resolution {
  return RESOLUTIONS.includes(resolution as Resolution);
}

export function isValidAspectRatio(ratio: string): ratio is AspectRatio {
  return ASPECT_RATIOS.includes(ratio as AspectRatio);
}

export function isValidDuration(duration: number): duration is Duration {
  return DURATIONS.includes(duration as Duration);
}

export function isValidReferenceType(type: string): type is ReferenceType {
  return REFERENCE_TYPES.includes(type as ReferenceType);
}

export function isValidPersonGeneration(value: string): value is PersonGeneration {
  return PERSON_GENERATION_OPTIONS.includes(value as PersonGeneration);
}

export function isValidResolutionForModel(resolution: Resolution, model: Model): boolean {
  if (model === 'veo-3.1-fast-generate-preview' && resolution === '4k') {
    return false; // 4k not available for fast model
  }
  return true;
}

// =============================================================================
// Cost Calculation
// =============================================================================

export function calculateCost(
  model: Model,
  resolution: Resolution,
  durationSeconds: number,
  generateAudio: boolean
): number {
  const modelPricing = PRICING[model];
  const resolutionPricing = modelPricing[resolution];

  if (!resolutionPricing) {
    // Fall back to 1080p pricing if resolution not found
    const fallbackPricing = modelPricing['1080p'];
    if (!fallbackPricing) return 0;
    const pricePerSecond = generateAudio ? fallbackPricing.video_audio : fallbackPricing.video;
    return pricePerSecond * durationSeconds;
  }

  const pricePerSecond = generateAudio ? resolutionPricing.video_audio : resolutionPricing.video;
  return pricePerSecond * durationSeconds;
}

// =============================================================================
// Parameter Normalization
// =============================================================================

export function normalizeModel(model?: string): Model {
  if (!model) return DEFAULT_MODEL;
  if (isValidModel(model)) return model;
  return DEFAULT_MODEL;
}

export function normalizeResolution(resolution?: string): Resolution {
  if (!resolution) return DEFAULT_RESOLUTION;
  if (isValidResolution(resolution)) return resolution;
  return DEFAULT_RESOLUTION;
}

export function normalizeAspectRatio(ratio?: string): AspectRatio {
  if (!ratio) return DEFAULT_ASPECT_RATIO;
  if (isValidAspectRatio(ratio)) return ratio;
  return DEFAULT_ASPECT_RATIO;
}

export function normalizeDuration(duration?: number | string): Duration {
  if (duration === undefined || duration === null) return DEFAULT_DURATION;
  const numDuration = typeof duration === 'string' ? parseInt(duration, 10) : duration;
  if (isNaN(numDuration)) return DEFAULT_DURATION;
  if (isValidDuration(numDuration)) return numDuration;
  // Find closest valid duration
  const sorted = [...DURATIONS].sort((a, b) => Math.abs(a - numDuration) - Math.abs(b - numDuration));
  return sorted[0];
}
