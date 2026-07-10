/**
 * Batch Configuration Loading and Validation
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  type BatchConfig,
  type BatchJob,
  type BatchExecutionOptions,
  type GenerateJob,
  type ExtendJob,
  type InterpolateJob,
  DEFAULT_BATCH_OPTIONS,
  DEFAULT_RETRY_POLICY,
  BATCH_CONSTRAINTS
} from '../types/batch.js';
import {
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_DURATION,
  isValidModel,
  isValidResolution,
  isValidAspectRatio,
  isValidDuration,
  isValidReferenceType
} from '../types/tools.js';
import { isPathWithinBase } from './path.js';
import { debugLog } from './debug.js';

/**
 * Load batch configuration from a JSON file
 */
export function loadBatchConfig(configPath: string): BatchConfig {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Configuration file not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');

  try {
    const config = JSON.parse(content) as BatchConfig;
    debugLog('Loaded batch config', config);
    return config;
  } catch (error) {
    throw new Error(`Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate batch configuration
 */
export function validateBatchConfig(config: BatchConfig): string[] {
  const errors: string[] = [];

  // Validate jobs array
  if (!config.jobs || !Array.isArray(config.jobs)) {
    errors.push('Configuration must have a "jobs" array');
    return errors;
  }

  if (config.jobs.length < BATCH_CONSTRAINTS.minJobs) {
    errors.push(`At least ${BATCH_CONSTRAINTS.minJobs} job is required`);
  }

  if (config.jobs.length > BATCH_CONSTRAINTS.maxJobs) {
    errors.push(`Maximum ${BATCH_CONSTRAINTS.maxJobs} jobs allowed`);
  }

  // Validate each job
  config.jobs.forEach((job, index) => {
    const jobErrors = validateJob(job, index);
    errors.push(...jobErrors);
  });

  // Validate default model
  if (config.default_model && !isValidModel(config.default_model)) {
    errors.push(`Invalid default_model: ${config.default_model}`);
  }

  // Validate default resolution
  if (config.default_resolution && !isValidResolution(config.default_resolution)) {
    errors.push(`Invalid default_resolution: ${config.default_resolution}`);
  }

  // Validate default aspect ratio
  if (config.default_aspect_ratio && !isValidAspectRatio(config.default_aspect_ratio)) {
    errors.push(`Invalid default_aspect_ratio: ${config.default_aspect_ratio}`);
  }

  // Validate default duration
  if (config.default_duration_seconds !== undefined) {
    const duration = typeof config.default_duration_seconds === 'number'
      ? config.default_duration_seconds
      : parseInt(String(config.default_duration_seconds), 10);
    if (!isValidDuration(duration)) {
      errors.push(`Invalid default_duration_seconds: ${config.default_duration_seconds}. Must be 4, 6, or 8`);
    }
  }

  // Validate max_concurrent
  if (config.max_concurrent !== undefined) {
    if (config.max_concurrent < BATCH_CONSTRAINTS.minConcurrent ||
        config.max_concurrent > BATCH_CONSTRAINTS.maxConcurrent) {
      errors.push(`max_concurrent must be between ${BATCH_CONSTRAINTS.minConcurrent} and ${BATCH_CONSTRAINTS.maxConcurrent}`);
    }
  }

  // Validate poll_interval
  if (config.poll_interval !== undefined) {
    if (config.poll_interval < BATCH_CONSTRAINTS.minPollInterval ||
        config.poll_interval > BATCH_CONSTRAINTS.maxPollInterval) {
      errors.push(`poll_interval must be between ${BATCH_CONSTRAINTS.minPollInterval} and ${BATCH_CONSTRAINTS.maxPollInterval}ms`);
    }
  }

  // Validate timeout
  if (config.timeout !== undefined) {
    if (config.timeout < BATCH_CONSTRAINTS.minTimeout ||
        config.timeout > BATCH_CONSTRAINTS.maxTimeout) {
      errors.push(`timeout must be between ${BATCH_CONSTRAINTS.minTimeout} and ${BATCH_CONSTRAINTS.maxTimeout}ms`);
    }
  }

  // Validate retry policy
  if (config.retry_policy) {
    if (config.retry_policy.max_retries !== undefined) {
      if (config.retry_policy.max_retries < BATCH_CONSTRAINTS.minRetries ||
          config.retry_policy.max_retries > BATCH_CONSTRAINTS.maxRetries) {
        errors.push(`retry_policy.max_retries must be between ${BATCH_CONSTRAINTS.minRetries} and ${BATCH_CONSTRAINTS.maxRetries}`);
      }
    }

    if (config.retry_policy.retry_delay_ms !== undefined) {
      if (config.retry_policy.retry_delay_ms < BATCH_CONSTRAINTS.minRetryDelay ||
          config.retry_policy.retry_delay_ms > BATCH_CONSTRAINTS.maxRetryDelay) {
        errors.push(`retry_policy.retry_delay_ms must be between ${BATCH_CONSTRAINTS.minRetryDelay} and ${BATCH_CONSTRAINTS.maxRetryDelay}ms`);
      }
    }
  }

  return errors;
}

/**
 * Validate a single job
 */
function validateJob(job: BatchJob, index: number): string[] {
  const errors: string[] = [];
  const prefix = `Job ${index + 1}`;

  const jobType = job.type || 'generate';

  switch (jobType) {
    case 'generate': {
      const genJob = job as GenerateJob;
      if (!genJob.prompt && !genJob.image) {
        errors.push(`${prefix}: Either prompt or image is required for generate jobs`);
      }

      if (genJob.model && !isValidModel(genJob.model)) {
        errors.push(`${prefix}: Invalid model: ${genJob.model}`);
      }

      if (genJob.resolution && !isValidResolution(genJob.resolution)) {
        errors.push(`${prefix}: Invalid resolution: ${genJob.resolution}`);
      }

      if (genJob.aspect_ratio && !isValidAspectRatio(genJob.aspect_ratio)) {
        errors.push(`${prefix}: Invalid aspect_ratio: ${genJob.aspect_ratio}`);
      }

      if (genJob.duration_seconds !== undefined) {
        const duration = typeof genJob.duration_seconds === 'number'
          ? genJob.duration_seconds
          : parseInt(String(genJob.duration_seconds), 10);
        if (!isValidDuration(duration)) {
          errors.push(`${prefix}: Invalid duration_seconds: ${genJob.duration_seconds}. Must be 4, 6, or 8`);
        }
      }

      if (genJob.reference_images) {
        if (!Array.isArray(genJob.reference_images)) {
          errors.push(`${prefix}: reference_images must be an array`);
        } else if (genJob.reference_images.length > 3) {
          errors.push(`${prefix}: Maximum 3 reference images allowed`);
        } else {
          genJob.reference_images.forEach((ref, refIndex) => {
            if (!ref.image) {
              errors.push(`${prefix}: Reference image ${refIndex + 1} missing image`);
            }
            if (!ref.reference_type || !isValidReferenceType(ref.reference_type)) {
              errors.push(`${prefix}: Reference image ${refIndex + 1} has invalid reference_type. Must be "asset" or "style"`);
            }
          });
        }
      }
      break;
    }

    case 'extend': {
      const extJob = job as ExtendJob;
      if (!extJob.video) {
        errors.push(`${prefix}: video is required for extend jobs`);
      }
      break;
    }

    case 'interpolate': {
      const intJob = job as InterpolateJob;
      if (!intJob.first_frame) {
        errors.push(`${prefix}: first_frame is required for interpolate jobs`);
      }
      if (!intJob.last_frame) {
        errors.push(`${prefix}: last_frame is required for interpolate jobs`);
      }
      break;
    }

    default:
      errors.push(`${prefix}: Invalid job type: ${jobType}`);
  }

  return errors;
}

/**
 * Merge configuration with CLI options and environment variables
 * Priority: CLI options > Environment > Config file > Defaults
 */
export function mergeBatchConfig(
  config: BatchConfig,
  cliOptions: Partial<BatchExecutionOptions>
): BatchExecutionOptions {
  // Start with defaults
  const merged: BatchExecutionOptions = { ...DEFAULT_BATCH_OPTIONS };

  // Apply config file settings
  if (config.output_dir) merged.outputDir = config.output_dir;
  if (config.max_concurrent) merged.maxConcurrent = config.max_concurrent;
  if (config.poll_interval) merged.pollInterval = config.poll_interval;
  if (config.timeout) merged.timeout = config.timeout;
  if (config.retry_policy) {
    merged.retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...config.retry_policy
    };
  }

  // Apply environment variables
  if (process.env.OUTPUT_DIR) merged.outputDir = process.env.OUTPUT_DIR;

  // Apply CLI options (highest priority)
  if (cliOptions.outputDir) merged.outputDir = cliOptions.outputDir;
  if (cliOptions.maxConcurrent) merged.maxConcurrent = cliOptions.maxConcurrent;
  if (cliOptions.pollInterval) merged.pollInterval = cliOptions.pollInterval;
  if (cliOptions.timeout) merged.timeout = cliOptions.timeout;
  if (cliOptions.estimateOnly !== undefined) merged.estimateOnly = cliOptions.estimateOnly;
  if (cliOptions.format) merged.format = cliOptions.format;
  if (cliOptions.noAudio !== undefined) merged.noAudio = cliOptions.noAudio;
  if (cliOptions.allowAnyPath !== undefined) merged.allowAnyPath = cliOptions.allowAnyPath;

  debugLog('Merged batch options', merged);
  return merged;
}

/**
 * Resolve output path for a job
 */
export function resolveOutputPath(
  job: BatchJob,
  index: number,
  outputDir: string,
  configDir: string,
  allowAnyPath: boolean = false
): string {
  if (job.output_path) {
    const resolved = path.isAbsolute(job.output_path)
      ? job.output_path
      : path.resolve(configDir, job.output_path);

    if (!allowAnyPath && !isPathWithinBase(resolved, outputDir)) {
      throw new Error(
        `output_path "${job.output_path}" resolves outside the output directory "${outputDir}". ` +
        'Use --allow-any-path to permit this.'
      );
    }

    return resolved;
  }

  // Generate default output path
  const prefix = getJobPrefix(job);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${prefix}_${index + 1}_${timestamp}.mp4`;

  return path.join(outputDir, filename);
}

/**
 * Get prefix for job output filename
 */
function getJobPrefix(job: BatchJob): string {
  const jobType = job.type || 'generate';
  switch (jobType) {
    case 'extend':
      return 'veo3_extended';
    case 'interpolate':
      return 'veo3_interpolated';
    default:
      return 'veo3';
  }
}

/**
 * Apply defaults from config to a job
 */
export function applyJobDefaults(job: BatchJob, config: BatchConfig): BatchJob {
  const jobType = job.type || 'generate';

  if (jobType === 'generate') {
    const genJob = job as GenerateJob;
    return {
      ...genJob,
      model: genJob.model || config.default_model || DEFAULT_MODEL,
      resolution: genJob.resolution || config.default_resolution || DEFAULT_RESOLUTION,
      aspect_ratio: genJob.aspect_ratio || config.default_aspect_ratio || DEFAULT_ASPECT_RATIO,
      duration_seconds: genJob.duration_seconds ?? config.default_duration_seconds ?? DEFAULT_DURATION,
      generate_audio: genJob.generate_audio ?? config.default_generate_audio ?? true
    };
  }

  if (jobType === 'interpolate') {
    const intJob = job as InterpolateJob;
    return {
      ...intJob,
      duration_seconds: intJob.duration_seconds ?? config.default_duration_seconds ?? DEFAULT_DURATION,
      generate_audio: intJob.generate_audio ?? config.default_generate_audio ?? true
    };
  }

  // extend jobs don't have configurable defaults
  return job;
}
