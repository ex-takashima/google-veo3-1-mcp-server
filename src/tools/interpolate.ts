/**
 * Frame Interpolation Tool for Veo 3.1
 * Generates video between first and last frames
 */

import {
  GEMINI_API_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_RESOLUTION,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  normalizeModel,
  normalizeDuration,
  calculateCost,
  type InterpolateFramesParams,
  type VeoGenerateRequest,
  type VeoOperationResponse,
  type VideoGenerationResult,
  type Model,
  type Resolution
} from '../types/tools.js';
import {
  getApiKey,
  pollVideoResult,
  downloadAndSaveVideo,
  extractVideoFromResponse,
  readImageWithMimeType
} from '../utils/video.js';
import { generateDefaultOutputPath, getDisplayPath } from '../utils/path.js';
import { debugLog, errorLog } from '../utils/debug.js';

/**
 * Interpolate between first and last frames to generate video
 *
 * Creates a smooth video transition between two keyframes
 */
export async function interpolateFrames(params: InterpolateFramesParams): Promise<VideoGenerationResult> {
  const apiKey = getApiKey();

  // Validate required parameters
  if (!params.first_frame) {
    return {
      success: false,
      error: 'first_frame parameter is required for frame interpolation'
    };
  }

  if (!params.last_frame) {
    return {
      success: false,
      error: 'last_frame parameter is required for frame interpolation'
    };
  }

  const model: Model = DEFAULT_MODEL;
  let durationSeconds: number;
  try {
    durationSeconds = normalizeDuration(params.duration_seconds);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  const generateAudio = params.generate_audio ?? true;
  const resolution: Resolution = DEFAULT_RESOLUTION;

  debugLog('Interpolating frames with parameters', {
    model,
    durationSeconds,
    generateAudio,
    hasPrompt: !!params.prompt
  });

  try {
    // Build request instance
    const instance: VeoGenerateRequest['instances'][0] = {};

    if (params.prompt) {
      instance.prompt = params.prompt;
    }

    // Handle first frame (image)
    if (params.first_frame.startsWith('gs://')) {
      instance.image = { gcsUri: params.first_frame };
    } else {
      const imageData = await readImageWithMimeType(params.first_frame);
      instance.image = {
        bytesBase64Encoded: imageData.base64,
        mimeType: imageData.mimeType
      };
    }

    // Handle last frame
    if (params.last_frame.startsWith('gs://')) {
      instance.lastFrame = { gcsUri: params.last_frame };
    } else {
      const imageData = await readImageWithMimeType(params.last_frame);
      instance.lastFrame = {
        bytesBase64Encoded: imageData.base64,
        mimeType: imageData.mimeType
      };
    }

    // Build request parameters
    // Note: generateAudio is NOT supported in Gemini API preview models
    const parameters: VeoGenerateRequest['parameters'] = {
      durationSeconds
    };

    const request: VeoGenerateRequest = {
      instances: [instance],
      parameters
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
          error: `Invalid frame images for interpolation. Details: ${errorText}`
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

    // Calculate estimated cost
    const estimatedCost = calculateCost(model, resolution, durationSeconds, generateAudio);

    // Async mode: return immediately; the caller polls with get_video_status
    if (params.wait === false) {
      return {
        success: true,
        done: false,
        operation_name: operationName,
        duration_seconds: durationSeconds,
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
        'veo3_interpolated'
      );

      try {
        videoPath = await downloadAndSaveVideo(videoData.url, videoData.base64, outputPath);
        debugLog('Interpolated video saved', { path: videoPath });
      } catch (downloadError) {
        errorLog('Failed to save interpolated video', downloadError);
      }
    }

    return {
      success: true,
      done: true,
      operation_name: operationName,
      video_url: videoUrl,
      video_path: videoPath ? getDisplayPath(videoPath) : undefined,
      duration_seconds: durationSeconds,
      estimated_cost: estimatedCost
    };

  } catch (error) {
    errorLog('Frame interpolation failed', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
