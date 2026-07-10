#!/usr/bin/env node

/**
 * Google Veo 3.1 Batch CLI Tool
 *
 * Execute multiple video generation jobs from a configuration file
 */

import * as path from 'path';
import { config } from 'dotenv';
import {
  loadBatchConfig,
  validateBatchConfig,
  mergeBatchConfig
} from '../utils/batch-config.js';
import { BatchManager } from '../utils/batch-manager.js';
import { getApiKey } from '../utils/video.js';
import { errorLog, infoLog } from '../utils/debug.js';
import type { BatchExecutionOptions, BatchResult, BatchCostEstimate } from '../types/batch.js';

// Load environment variables
config();

// =============================================================================
// CLI Argument Parsing
// =============================================================================

interface CliArgs {
  configPath: string;
  outputDir?: string;
  format: 'text' | 'json';
  maxConcurrent?: number;
  pollInterval?: number;
  timeout?: number;
  estimateOnly: boolean;
  noAudio: boolean;
  allowAnyPath: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {
    configPath: '',
    format: 'text',
    estimateOnly: false,
    noAudio: false,
    allowAnyPath: false,
    help: false
  };

  const requireValue = (index: number, flag: string): string => {
    const value = args[index];
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    switch (arg) {
      case '-h':
      case '--help':
        result.help = true;
        break;

      case '-o':
      case '--output-dir':
        result.outputDir = requireValue(++i, arg);
        break;

      case '-f':
      case '--format': {
        const format = requireValue(++i, arg);
        if (format === 'text' || format === 'json') {
          result.format = format;
        } else {
          throw new Error(`Invalid format: ${format}. Must be "text" or "json"`);
        }
        break;
      }

      case '-c':
      case '--max-concurrent':
        result.maxConcurrent = parseInt(requireValue(++i, arg), 10);
        if (isNaN(result.maxConcurrent) || result.maxConcurrent < 1 || result.maxConcurrent > 5) {
          throw new Error('max-concurrent must be between 1 and 5');
        }
        break;

      case '-p':
      case '--poll-interval':
        result.pollInterval = parseInt(requireValue(++i, arg), 10);
        if (isNaN(result.pollInterval)) {
          throw new Error('poll-interval must be a number');
        }
        break;

      case '-t':
      case '--timeout':
        result.timeout = parseInt(requireValue(++i, arg), 10);
        if (isNaN(result.timeout)) {
          throw new Error('timeout must be a number');
        }
        break;

      case '-e':
      case '--estimate-only':
        result.estimateOnly = true;
        break;

      case '--no-audio':
        result.noAudio = true;
        break;

      case '--allow-any-path':
        result.allowAnyPath = true;
        break;

      default:
        if (arg.startsWith('-')) {
          throw new Error(`Unknown option: ${arg}`);
        }
        if (!result.configPath) {
          result.configPath = arg;
        }
        break;
    }
    i++;
  }

  return result;
}

function printUsage(): void {
  console.log(`
Google Veo 3.1 Batch Video Generation Tool

Usage: veo3-batch <config.json> [options]

Options:
  -o, --output-dir <path>     Output directory for generated videos
  -f, --format <text|json>    Output format (default: text)
  -c, --max-concurrent <n>    Maximum concurrent jobs (1-5, default: 2)
  -p, --poll-interval <ms>    Polling interval in milliseconds
  -t, --timeout <ms>          Total batch timeout in milliseconds
  -e, --estimate-only         Only estimate costs, don't execute
  --no-audio                  Generate videos without audio (reduces cost)
  --allow-any-path            Allow absolute output paths outside output_dir
  -h, --help                  Show this help message

Environment Variables:
  GOOGLE_API_KEY              Required: Google API key for Veo 3.1
  OUTPUT_DIR                  Default output directory
  DEBUG                       Set to "true" for debug logging

Example:
  veo3-batch batch-config.json --output-dir ./output --estimate-only
  veo3-batch batch-config.json --max-concurrent 3 --no-audio

Configuration File Format:
  {
    "jobs": [
      {
        "prompt": "A cat playing piano",
        "duration_seconds": 8,
        "resolution": "1080p",
        "generate_audio": true
      },
      {
        "type": "interpolate",
        "first_frame": "./images/start.jpg",
        "last_frame": "./images/end.jpg"
      }
    ],
    "output_dir": "./output",
    "max_concurrent": 2,
    "default_model": "veo-3.1-generate-preview"
  }
`);
}

// =============================================================================
// Output Formatting
// =============================================================================

function formatCostEstimate(estimate: BatchCostEstimate, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(estimate, null, 2);
  }

  const lines: string[] = [
    '',
    '=== Cost Estimate ===',
    ''
  ];

  estimate.jobs.forEach((job, index) => {
    lines.push(`Job ${index + 1}:`);
    lines.push(`  Type: ${job.job_type}`);
    lines.push(`  Model: ${job.model}`);
    lines.push(`  Resolution: ${job.resolution}`);
    lines.push(`  Duration: ${job.duration_seconds}s`);
    lines.push(`  Audio: ${job.generate_audio ? 'Yes' : 'No'}`);
    lines.push(`  Cost: $${job.estimated_cost.toFixed(2)}`);
    lines.push('');
  });

  lines.push('---');
  lines.push(`Total Jobs: ${estimate.jobs.length}`);
  lines.push(`Total Duration: ${estimate.total_duration_seconds}s`);
  lines.push(`Total Estimated Cost: $${estimate.total_estimated_cost.toFixed(2)}`);
  lines.push('');

  return lines.join('\n');
}

function formatBatchResult(result: BatchResult, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [
    '',
    '=== Batch Execution Results ===',
    ''
  ];

  result.jobs.forEach((job) => {
    if (!job) {
      lines.push(`Job (cancelled)`);
      lines.push('');
      return;
    }

    lines.push(`Job ${job.index + 1}:`);
    lines.push(`  Status: ${job.success ? 'SUCCESS' : 'FAILED'}`);

    if (job.success) {
      if (job.video_path) {
        lines.push(`  Output: ${job.video_path}`);
      }
      if (job.video_url) {
        lines.push(`  URL: ${job.video_url}`);
      }
      if (job.estimated_cost !== undefined) {
        lines.push(`  Cost: $${job.estimated_cost.toFixed(2)}`);
      }
    } else {
      lines.push(`  Error: ${job.error || 'Unknown error'}`);
      if (job.failure_reason) {
        lines.push(`  Reason: ${job.failure_reason}`);
      }
    }

    if (job.duration_ms) {
      lines.push(`  Duration: ${(job.duration_ms / 1000).toFixed(1)}s`);
    }

    if (job.retries && job.retries > 0) {
      lines.push(`  Retries: ${job.retries}`);
    }

    lines.push('');
  });

  lines.push('---');
  lines.push(`Total Jobs: ${result.total_jobs}`);
  lines.push(`Successful: ${result.successful}`);
  lines.push(`Failed: ${result.failed}`);
  if (result.cancelled > 0) {
    lines.push(`Cancelled: ${result.cancelled}`);
  }
  lines.push(`Total Cost: $${result.total_estimated_cost.toFixed(2)}`);
  lines.push(`Total Duration: ${(result.duration_ms / 1000).toFixed(1)}s`);
  lines.push('');

  return lines.join('\n');
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  try {
    // Parse command line arguments
    const args = parseArgs(process.argv.slice(2));

    if (args.help || !args.configPath) {
      printUsage();
      process.exit(args.help ? 0 : 1);
    }

    // Verify API key
    try {
      getApiKey();
    } catch (error) {
      errorLog('GOOGLE_API_KEY environment variable is not set');
      process.exit(1);
    }

    // Load and validate configuration
    infoLog(`Loading configuration from: ${args.configPath}`);
    const batchConfig = loadBatchConfig(args.configPath);

    const validationErrors = validateBatchConfig(batchConfig);
    if (validationErrors.length > 0) {
      errorLog('Configuration validation failed:');
      validationErrors.forEach(err => console.error(`  - ${err}`));
      process.exit(1);
    }

    // Merge options
    const cliOptions: Partial<BatchExecutionOptions> = {};
    if (args.outputDir) cliOptions.outputDir = args.outputDir;
    if (args.maxConcurrent) cliOptions.maxConcurrent = args.maxConcurrent;
    if (args.pollInterval) cliOptions.pollInterval = args.pollInterval;
    if (args.timeout) cliOptions.timeout = args.timeout;
    cliOptions.estimateOnly = args.estimateOnly;
    cliOptions.format = args.format;
    cliOptions.noAudio = args.noAudio;
    cliOptions.allowAnyPath = args.allowAnyPath;

    const options = mergeBatchConfig(batchConfig, cliOptions);
    const configDir = path.dirname(path.resolve(args.configPath));

    // Create batch manager
    const manager = new BatchManager(batchConfig, options, configDir);

    if (args.estimateOnly) {
      // Cost estimation only
      infoLog('Estimating costs...');
      const estimate = manager.estimateBatchCost();
      console.log(formatCostEstimate(estimate, args.format));
      process.exit(0);
    }

    // Execute batch
    infoLog('Starting batch execution...');
    const result = await manager.executeBatch();

    console.log(formatBatchResult(result, args.format));

    // Exit with error code if any jobs failed
    if (result.failed > 0 || result.cancelled > 0) {
      process.exit(1);
    }

    process.exit(0);

  } catch (error) {
    errorLog('Batch execution failed', error);
    process.exit(1);
  }
}

main();
