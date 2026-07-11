/**
 * Batch Execution Manager
 */

import * as path from 'path';
import {
  type BatchConfig,
  type BatchJob,
  type BatchExecutionOptions,
  type BatchResult,
  type JobResult,
  type BatchCostEstimate,
  type JobCostEstimate,
  type GenerateJob,
  type ExtendJob,
  type InterpolateJob,
  type JobType
} from '../types/batch.js';
import {
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_DURATION,
  EXTENSION_DURATION,
  EXTENSION_RESOLUTION,
  calculateCost,
  type Model,
  type Resolution,
  type Duration
} from '../types/tools.js';
import { generateVideo } from '../tools/generate.js';
import { extendVideo } from '../tools/extend.js';
import { interpolateFrames } from '../tools/interpolate.js';
import { applyJobDefaults, resolveOutputPath } from './batch-config.js';
import { ensureDirectoryExists } from './path.js';
import { debugLog, errorLog, infoLog } from './debug.js';

// =============================================================================
// Semaphore for Concurrency Control
// =============================================================================

class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.waiting.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

// =============================================================================
// Batch Manager
// =============================================================================

export class BatchManager {
  private config: BatchConfig;
  private options: BatchExecutionOptions;
  private configDir: string;

  constructor(config: BatchConfig, options: BatchExecutionOptions, configDir: string) {
    this.config = config;
    this.options = options;
    this.configDir = configDir;
  }

  /**
   * Estimate costs for the batch without executing
   */
  estimateBatchCost(): BatchCostEstimate {
    const estimates: JobCostEstimate[] = [];
    let totalCost = 0;
    let totalDuration = 0;

    this.config.jobs.forEach((job, index) => {
      const jobWithDefaults = applyJobDefaults(job, this.config);
      const jobType = job.type || 'generate';
      const estimate = this.estimateJobCost(jobWithDefaults, jobType, index);
      estimates.push(estimate);
      totalCost += estimate.estimated_cost;
      totalDuration += estimate.duration_seconds;
    });

    return {
      jobs: estimates,
      total_estimated_cost: totalCost,
      total_duration_seconds: totalDuration
    };
  }

  /**
   * Estimate cost for a single job
   */
  private estimateJobCost(job: BatchJob, jobType: JobType, index: number): JobCostEstimate {
    let model: Model;
    let resolution: Resolution;
    let durationSeconds: number;
    let generateAudio: boolean;

    switch (jobType) {
      case 'extend': {
        model = DEFAULT_MODEL;
        resolution = EXTENSION_RESOLUTION;
        durationSeconds = EXTENSION_DURATION;
        generateAudio = false; // Extensions don't generate audio
        break;
      }
      case 'interpolate': {
        const intJob = job as InterpolateJob;
        model = DEFAULT_MODEL;
        resolution = DEFAULT_RESOLUTION;
        durationSeconds = (intJob.duration_seconds as number) || DEFAULT_DURATION;
        generateAudio = intJob.generate_audio ?? !this.options.noAudio;
        break;
      }
      default: {
        const genJob = job as GenerateJob;
        model = (genJob.model as Model) || DEFAULT_MODEL;
        resolution = (genJob.resolution as Resolution) || DEFAULT_RESOLUTION;
        durationSeconds = (genJob.duration_seconds as number) || DEFAULT_DURATION;
        generateAudio = genJob.generate_audio ?? !this.options.noAudio;
        break;
      }
    }

    const cost = calculateCost(model, resolution, durationSeconds);

    return {
      index,
      job_type: jobType,
      model,
      resolution,
      duration_seconds: durationSeconds,
      generate_audio: generateAudio,
      estimated_cost: cost
    };
  }

  /**
   * Execute all jobs in the batch
   */
  async executeBatch(): Promise<BatchResult> {
    const startedAt = new Date();
    const results: JobResult[] = [];

    // Ensure output directory exists
    ensureDirectoryExists(this.options.outputDir);

    const semaphore = new Semaphore(this.options.maxConcurrent);
    const totalJobs = this.config.jobs.length;

    infoLog(`Starting batch execution: ${totalJobs} jobs, ${this.options.maxConcurrent} concurrent`);

    // Execute jobs with concurrency control
    const promises = this.config.jobs.map(async (job, index) => {
      await semaphore.acquire();

      try {
        infoLog(`Starting job ${index + 1}/${totalJobs}`);
        const result = await this.executeJobWithRetry(job, index);
        results[index] = result;

        if (result.success) {
          infoLog(`Job ${index + 1} completed successfully`);
        } else {
          errorLog(`Job ${index + 1} failed: ${result.error}`);
        }
      } finally {
        semaphore.release();
      }
    });

    // Wait for all jobs with timeout. On timeout we still return the
    // partial results collected so far instead of discarding them.
    let timeoutId: NodeJS.Timeout | undefined;
    const timedOut = await Promise.race([
      Promise.all(promises).then(() => false),
      new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(true), this.options.timeout);
      })
    ]);
    if (timeoutId) clearTimeout(timeoutId);

    if (timedOut) {
      errorLog(`Batch execution timed out after ${this.options.timeout}ms; returning partial results`);
    }

    const completedAt = new Date();

    // Calculate summary
    const successful = results.filter(r => r?.success).length;
    const failed = results.filter(r => r && !r.success).length;
    const cancelled = totalJobs - results.filter(r => r).length;

    const totalCost = results
      .filter(r => r?.estimated_cost)
      .reduce((sum, r) => sum + (r.estimated_cost || 0), 0);

    return {
      total_jobs: totalJobs,
      successful,
      failed,
      cancelled,
      total_estimated_cost: totalCost,
      jobs: results,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: completedAt.getTime() - startedAt.getTime()
    };
  }

  /**
   * Execute a single job with retry logic
   */
  private async executeJobWithRetry(job: BatchJob, index: number): Promise<JobResult> {
    const jobWithDefaults = applyJobDefaults(job, this.config);
    const jobType = job.type || 'generate';
    const startedAt = new Date();

    let outputPath: string;
    try {
      outputPath = resolveOutputPath(
        job, index, this.options.outputDir, this.configDir, this.options.allowAnyPath
      );
    } catch (error) {
      return {
        index,
        job: jobWithDefaults,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        started_at: startedAt,
        completed_at: new Date(),
        retries: 0
      };
    }

    let lastError: string | undefined;
    let retries = 0;

    const { max_retries, retry_delay_ms, retry_on_errors } = this.options.retryPolicy;

    for (let attempt = 0; attempt <= max_retries; attempt++) {
      try {
        debugLog(`Job ${index + 1} attempt ${attempt + 1}`);

        const result = await this.executeJob(jobWithDefaults, jobType, outputPath);

        if (result.success) {
          const completedAt = new Date();
          return {
            index,
            job: jobWithDefaults,
            success: true,
            operation_name: result.operation_name,
            video_url: result.video_url,
            video_path: result.video_path,
            estimated_cost: result.estimated_cost,
            started_at: startedAt,
            completed_at: completedAt,
            duration_ms: completedAt.getTime() - startedAt.getTime(),
            retries
          };
        }

        lastError = result.error || result.failure_reason;

        // Check if error is retryable
        const shouldRetry = this.isRetryableError(lastError, retry_on_errors);

        if (shouldRetry && attempt < max_retries) {
          retries++;
          debugLog(`Job ${index + 1} failed with retryable error, waiting ${retry_delay_ms}ms before retry`);
          await this.sleep(retry_delay_ms);
        } else {
          break;
        }

      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        const shouldRetry = this.isRetryableError(lastError, retry_on_errors);

        if (shouldRetry && attempt < max_retries) {
          retries++;
          debugLog(`Job ${index + 1} threw retryable error, waiting ${retry_delay_ms}ms before retry`);
          await this.sleep(retry_delay_ms);
        } else {
          break;
        }
      }
    }

    const completedAt = new Date();
    return {
      index,
      job: jobWithDefaults,
      success: false,
      error: lastError,
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: completedAt.getTime() - startedAt.getTime(),
      retries
    };
  }

  /**
   * Execute a single job
   */
  private async executeJob(job: BatchJob, jobType: JobType, outputPath: string) {
    switch (jobType) {
      case 'extend': {
        const extJob = job as ExtendJob;
        return extendVideo({
          video: extJob.video,
          prompt: extJob.prompt,
          output_path: outputPath,
          poll_interval: this.options.pollInterval
        });
      }

      case 'interpolate': {
        const intJob = job as InterpolateJob;
        return interpolateFrames({
          first_frame: intJob.first_frame,
          last_frame: intJob.last_frame,
          prompt: intJob.prompt,
          duration_seconds: intJob.duration_seconds,
          generate_audio: this.options.noAudio ? false : intJob.generate_audio,
          output_path: outputPath,
          poll_interval: this.options.pollInterval
        });
      }

      default: {
        const genJob = job as GenerateJob;
        return generateVideo({
          prompt: genJob.prompt,
          model: genJob.model,
          aspect_ratio: genJob.aspect_ratio,
          resolution: genJob.resolution,
          duration_seconds: genJob.duration_seconds,
          generate_audio: this.options.noAudio ? false : genJob.generate_audio,
          negative_prompt: genJob.negative_prompt,
          image: genJob.image,
          reference_images: genJob.reference_images,
          output_path: outputPath,
          poll_interval: this.options.pollInterval
        });
      }
    }
  }

  /**
   * Check if an error is retryable based on patterns
   */
  private isRetryableError(error: string | undefined, patterns: string[]): boolean {
    if (!error) return false;

    const errorLower = error.toLowerCase();

    for (const pattern of patterns) {
      const patternLower = pattern.toLowerCase();
      if (errorLower.includes(patternLower)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
