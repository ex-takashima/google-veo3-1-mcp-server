/**
 * Batch Processing Type Definitions
 */

import type { Model, Resolution, AspectRatio, Duration, ReferenceImage } from './tools.js';

// =============================================================================
// Job Types
// =============================================================================

export type JobType = 'generate' | 'extend' | 'interpolate';

export interface BaseJob {
  type?: JobType;
  output_path?: string;
}

export interface GenerateJob extends BaseJob {
  type?: 'generate';
  prompt: string;
  model?: Model;
  aspect_ratio?: AspectRatio;
  resolution?: Resolution;
  duration_seconds?: Duration | number;
  generate_audio?: boolean;
  negative_prompt?: string;
  image?: string;
  reference_images?: ReferenceImage[];
}

export interface ExtendJob extends BaseJob {
  type: 'extend';
  video: string;
  prompt?: string;
}

export interface InterpolateJob extends BaseJob {
  type: 'interpolate';
  first_frame: string;
  last_frame: string;
  prompt?: string;
  duration_seconds?: Duration | number;
  generate_audio?: boolean;
}

export type BatchJob = GenerateJob | ExtendJob | InterpolateJob;

// =============================================================================
// Retry Policy
// =============================================================================

export interface RetryPolicy {
  max_retries: number;
  retry_delay_ms: number;
  retry_on_errors: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_retries: 2,
  retry_delay_ms: 5000,
  retry_on_errors: ['rate_limit', 'timeout', '429', '503', 'RESOURCE_EXHAUSTED']
};

// =============================================================================
// Batch Configuration
// =============================================================================

export interface BatchConfig {
  jobs: BatchJob[];
  output_dir?: string;
  default_model?: Model;
  default_resolution?: Resolution;
  default_aspect_ratio?: AspectRatio;
  default_duration_seconds?: Duration | number;
  default_generate_audio?: boolean;
  max_concurrent?: number;
  poll_interval?: number;
  timeout?: number;
  retry_policy?: RetryPolicy;
}

// =============================================================================
// Batch Execution Options
// =============================================================================

export interface BatchExecutionOptions {
  outputDir: string;
  maxConcurrent: number;
  pollInterval: number;
  timeout: number;
  retryPolicy: RetryPolicy;
  estimateOnly: boolean;
  format: 'text' | 'json';
  noAudio: boolean;
  allowAnyPath: boolean;
}

export const DEFAULT_BATCH_OPTIONS: BatchExecutionOptions = {
  outputDir: './output',
  maxConcurrent: 2,
  pollInterval: 15000,
  timeout: 1800000, // 30 minutes
  retryPolicy: DEFAULT_RETRY_POLICY,
  estimateOnly: false,
  format: 'text',
  noAudio: false,
  allowAnyPath: false
};

// =============================================================================
// Job Result
// =============================================================================

export interface JobResult {
  index: number;
  job: BatchJob;
  success: boolean;
  operation_name?: string;
  video_url?: string;
  video_path?: string;
  estimated_cost?: number;
  error?: string;
  failure_reason?: string;
  started_at?: Date;
  completed_at?: Date;
  duration_ms?: number;
  retries?: number;
}

// =============================================================================
// Batch Result
// =============================================================================

export interface BatchResult {
  total_jobs: number;
  successful: number;
  failed: number;
  cancelled: number;
  total_estimated_cost: number;
  jobs: JobResult[];
  started_at: Date;
  completed_at: Date;
  duration_ms: number;
}

// =============================================================================
// Cost Estimate
// =============================================================================

export interface JobCostEstimate {
  index: number;
  job_type: JobType;
  model: Model;
  resolution: Resolution;
  duration_seconds: number;
  generate_audio: boolean;
  estimated_cost: number;
}

export interface BatchCostEstimate {
  jobs: JobCostEstimate[];
  total_estimated_cost: number;
  total_duration_seconds: number;
}

// =============================================================================
// Validation Constraints
// =============================================================================

export const BATCH_CONSTRAINTS = {
  minJobs: 1,
  maxJobs: 100,
  minConcurrent: 1,
  maxConcurrent: 5,
  minTimeout: 60000,      // 1 minute
  maxTimeout: 3600000,    // 1 hour
  minPollInterval: 5000,  // 5 seconds
  maxPollInterval: 60000, // 60 seconds
  minRetries: 0,
  maxRetries: 5,
  minRetryDelay: 100,
  maxRetryDelay: 60000
};
