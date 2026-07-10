/**
 * Video Extension Tool for Veo 3.1
 * Extends an existing video by 7 seconds
 */

import {
  GEMINI_API_BASE_URL,
  DEFAULT_MODEL,
  EXTENSION_DURATION,
  EXTENSION_RESOLUTION,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  calculateCost,
  type ExtendVideoParams,
  type VeoGenerateRequest,
  type VeoOperationResponse,
  type VideoGenerationResult,
  type Model
} from '../types/tools.js';
import {
  getApiKey,
  pollVideoResult,
  downloadAndSaveVideo,
  extractVideoFromResponse,
  readVideoAsBase64
} from '../utils/video.js';
import { generateDefaultOutputPath, getDisplayPath } from '../utils/path.js';
import { debugLog, errorLog } from '../utils/debug.js';

/**
 * Extend a video by 7 seconds using Veo 3.1 API
 *
 * Requirements:
 * - Input video: 1-30 seconds, 24fps, 720p or 1080p
 * - Output: 7 seconds extension at 720p
 */
export async function extendVideo(params: ExtendVideoParams): Promise<VideoGenerationResult> {
  const apiKey = getApiKey();

  // Validate required parameter
  if (!params.video) {
    return {
      success: false,
      error: 'Video parameter is required for video extension'
    };
  }

  const model: Model = DEFAULT_MODEL;

  debugLog('Extending video with parameters', {
    model,
    hasPrompt: !!params.prompt,
    videoSource: params.video.startsWith('gs://') ? 'GCS' : 'file/base64'
  });

  try {
    // Build request instance
    const instance: VeoGenerateRequest['instances'][0] = {};

    if (params.prompt) {
      instance.prompt = params.prompt;
    }

    // Handle video input
    if (params.video.startsWith('gs://')) {
      instance.video = { uri: params.video };
    } else {
      const base64Data = await readVideoAsBase64(params.video);
      instance.video = { bytesBase64Encoded: base64Data };
    }

    // Build request - extension has fixed parameters
    const request: VeoGenerateRequest = {
      instances: [instance],
      parameters: {
        // Extension is always 7 seconds at 720p
        // These may be ignored by the API but we include them for completeness
      }
    };

    debugLog('API Request', request);

    // Make API call
    const url = `${GEMINI_API_BASE_URL}/models/${model}:predictLongRunning`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      errorLog('API request failed', { status: response.status, error: errorText });

      if (response.status === 401) {
        return {
          success: false,
          error: 'Authentication failed. Please check your GOOGLE_API_KEY.'
        };
      }

      if (response.status === 403) {
        return {
          success: false,
          error: 'Access denied. Your API key may not have access to Veo 3.1.'
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          error: 'Rate limit exceeded. Please try again later.'
        };
      }

      if (response.status === 400) {
        return {
          success: false,
          error: `Invalid video for extension. Requirements: 1-30 seconds, 24fps, 720p or 1080p. Details: ${errorText}`
        };
      }

      return {
        success: false,
        error: `API request failed: ${response.status} ${response.statusText} - ${errorText}`
      };
    }

    const operationResponse = await response.json() as VeoOperationResponse;
    debugLog('Initial operation response', operationResponse);

    const operationName = operationResponse.name;

    // Calculate estimated cost (7 seconds at 720p, no audio for extensions)
    const estimatedCost = calculateCost(model, EXTENSION_RESOLUTION, EXTENSION_DURATION, false);

    // Async mode: return immediately; the caller polls with get_video_status
    if (params.wait === false) {
      return {
        success: true,
        done: false,
        operation_name: operationName,
        duration_seconds: EXTENSION_DURATION,
        estimated_cost: estimatedCost
      };
    }

    // Poll for completion
    const pollInterval = params.poll_interval
      || parseInt(process.env.VIDEO_POLL_INTERVAL || '') || DEFAULT_POLL_INTERVAL;
    const maxAttempts = parseInt(process.env.VIDEO_MAX_POLL_ATTEMPTS || '') || DEFAULT_MAX_POLL_ATTEMPTS;

    const finalResponse = await pollVideoResult(operationName, apiKey, pollInterval, maxAttempts);

    // Check for errors
    if (finalResponse.error) {
      return {
        success: false,
        operation_name: operationName,
        error: finalResponse.error.message,
        failure_reason: `Error code: ${finalResponse.error.code}`
      };
    }

    // Extract video data
    const videoData = extractVideoFromResponse(finalResponse);

    if (!videoData) {
      return {
        success: false,
        operation_name: operationName,
        error: 'No video was generated. The content may have been filtered by safety policies.',
        estimated_cost: estimatedCost
      };
    }

    // Download and save if output path specified
    let videoPath: string | undefined;
    let videoUrl = videoData.url;

    if (params.output_path || process.env.OUTPUT_DIR) {
      const outputPath = params.output_path || generateDefaultOutputPath(
        process.env.OUTPUT_DIR || './output',
        'veo3_extended'
      );

      try {
        videoPath = await downloadAndSaveVideo(videoData.url, videoData.base64, outputPath);
        debugLog('Extended video saved', { path: videoPath });
      } catch (downloadError) {
        errorLog('Failed to save extended video', downloadError);
      }
    }

    return {
      success: true,
      done: true,
      operation_name: operationName,
      video_url: videoUrl,
      video_path: videoPath ? getDisplayPath(videoPath) : undefined,
      duration_seconds: EXTENSION_DURATION,
      estimated_cost: estimatedCost
    };

  } catch (error) {
    errorLog('Video extension failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
