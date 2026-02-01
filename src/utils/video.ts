/**
 * Video polling and download utilities for Veo 3.1 API
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  GEMINI_API_BASE_URL,
  DEFAULT_POLL_INTERVAL,
  DEFAULT_MAX_POLL_ATTEMPTS,
  type VeoOperationResponse,
  type VideoGenerationResult
} from '../types/tools.js';
import { debugLog, errorLog } from './debug.js';
import { normalizeAndValidatePath, generateUniqueFilePath, ensureVideoExtension } from './path.js';

/**
 * Get API key from environment
 */
export function getApiKey(): string {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_API_KEY environment variable is not set');
  }
  return apiKey;
}

/**
 * Check operation status
 */
export async function getOperationStatus(
  operationName: string,
  apiKey: string
): Promise<VeoOperationResponse> {
  // For Gemini API, the operation name format is different
  // We need to construct the full URL based on the operation name
  let url: string;

  if (operationName.startsWith('http')) {
    // Full URL provided
    url = `${operationName}?key=${apiKey}`;
  } else if (operationName.startsWith('models/')) {
    // Relative path from Gemini API
    url = `${GEMINI_API_BASE_URL}/${operationName}?key=${apiKey}`;
  } else {
    // Assume it's just the operation ID or full path
    url = `${GEMINI_API_BASE_URL}/${operationName}?key=${apiKey}`;
  }

  debugLog('Checking operation status', { url: url.replace(apiKey, '***') });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get operation status: ${response.status} ${response.statusText} - ${errorText}`);
  }

  const result = await response.json() as VeoOperationResponse;
  debugLog('Operation status response', result);

  return result;
}

/**
 * Poll for video generation completion
 */
export async function pollVideoResult(
  operationName: string,
  apiKey: string,
  pollInterval: number = DEFAULT_POLL_INTERVAL,
  maxAttempts: number = DEFAULT_MAX_POLL_ATTEMPTS
): Promise<VeoOperationResponse> {
  debugLog(`Starting poll for operation: ${operationName}`);

  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    debugLog(`Poll attempt ${attempts}/${maxAttempts}`);

    try {
      const status = await getOperationStatus(operationName, apiKey);

      if (status.error) {
        // Operation completed with error
        errorLog('Operation failed', status.error);
        return status;
      }

      if (status.done) {
        // Operation completed successfully
        debugLog('Operation completed', status);
        return status;
      }

      // Still processing, wait before next poll
      debugLog(`Operation still processing, waiting ${pollInterval}ms`);
      await sleep(pollInterval);

    } catch (error) {
      // Check for transient errors (5xx)
      if (error instanceof Error && error.message.includes('5')) {
        debugLog(`Transient error, retrying: ${error.message}`);
        await sleep(pollInterval);
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Polling timeout: operation did not complete after ${maxAttempts} attempts`);
}

/**
 * Download video from URL
 */
export async function downloadVideo(url: string, apiKey?: string): Promise<Buffer> {
  let downloadUrl = url;

  // Add API key for Google API URLs
  if (apiKey && url.includes('generativelanguage.googleapis.com')) {
    const separator = url.includes('?') ? '&' : '?';
    downloadUrl = `${url}${separator}key=${apiKey}`;
  }

  debugLog('Downloading video', { url: downloadUrl.replace(apiKey || '', '***') });

  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Save video buffer to file
 */
export async function saveVideo(
  videoData: Buffer | string,
  outputPath: string
): Promise<string> {
  // Ensure .mp4 extension
  outputPath = ensureVideoExtension(outputPath);

  // Normalize and validate path
  const normalizedPath = normalizeAndValidatePath(outputPath);

  // Generate unique path to avoid overwriting
  const uniquePath = generateUniqueFilePath(normalizedPath);

  debugLog('Saving video', { path: uniquePath });

  // Handle base64 encoded data
  if (typeof videoData === 'string') {
    const buffer = Buffer.from(videoData, 'base64');
    fs.writeFileSync(uniquePath, buffer);
  } else {
    fs.writeFileSync(uniquePath, videoData);
  }

  return uniquePath;
}

/**
 * Download video and save to file
 */
export async function downloadAndSaveVideo(
  url: string | undefined,
  base64Data: string | undefined,
  outputPath: string,
  apiKey?: string
): Promise<string> {
  if (base64Data) {
    // Use base64 data directly
    return saveVideo(base64Data, outputPath);
  }

  if (url) {
    // Download from URL (pass API key for Google API URLs)
    const key = apiKey || process.env.GOOGLE_API_KEY;
    const videoData = await downloadVideo(url, key);
    return saveVideo(videoData, outputPath);
  }

  throw new Error('No video data available (neither URL nor base64 provided)');
}

/**
 * Extract video from operation response
 */
export function extractVideoFromResponse(
  response: VeoOperationResponse
): { url?: string; base64?: string } | null {
  // Handle Gemini API response format
  // Structure: response.generateVideoResponse.generatedSamples[].video.uri
  const generateVideoResponse = (response.response as Record<string, unknown>)?.generateVideoResponse as {
    generatedSamples?: Array<{
      video?: {
        uri?: string;
        bytesBase64Encoded?: string;
      };
    }>;
  } | undefined;

  if (generateVideoResponse?.generatedSamples?.length) {
    const video = generateVideoResponse.generatedSamples[0].video;
    if (video) {
      return {
        url: video.uri,
        base64: video.bytesBase64Encoded
      };
    }
  }

  // Fallback: Check for Vertex AI format (generatedVideos)
  if (response.response?.generatedVideos?.length) {
    const video = response.response.generatedVideos[0].video;
    return {
      url: video.uri,
      base64: video.bytesBase64Encoded
    };
  }

  return null;
}

/**
 * Read image file and convert to base64
 */
export async function readImageAsBase64(imagePath: string): Promise<string> {
  // Check if it's already base64 or a URL
  if (imagePath.startsWith('data:')) {
    // Extract base64 from data URL
    const match = imagePath.match(/^data:[^;]+;base64,(.+)$/);
    if (match) {
      return match[1];
    }
    throw new Error('Invalid data URL format');
  }

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    // Download image from URL
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }

  if (imagePath.startsWith('gs://')) {
    // GCS URI - return as-is for the API to handle
    throw new Error('GCS URIs should be passed directly to the API, not converted to base64');
  }

  // Assume it's a file path
  const absolutePath = path.isAbsolute(imagePath)
    ? imagePath
    : path.resolve(process.cwd(), imagePath);

  if (!fs.existsSync(absolutePath)) {
    // Check if it's already base64 encoded
    if (isBase64(imagePath)) {
      return imagePath;
    }
    throw new Error(`Image file not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  return buffer.toString('base64');
}

/**
 * Check if a string is base64 encoded
 */
function isBase64(str: string): boolean {
  if (str.length < 100) return false; // Too short to be an image
  try {
    const decoded = Buffer.from(str, 'base64').toString('base64');
    return decoded === str;
  } catch {
    return false;
  }
}

/**
 * Read video file and convert to base64
 */
export async function readVideoAsBase64(videoPath: string): Promise<string> {
  if (videoPath.startsWith('gs://')) {
    // GCS URI - return as-is for the API to handle
    throw new Error('GCS URIs should be passed directly to the API, not converted to base64');
  }

  if (videoPath.startsWith('http://') || videoPath.startsWith('https://')) {
    const response = await fetch(videoPath);
    if (!response.ok) {
      throw new Error(`Failed to fetch video: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString('base64');
  }

  // Assume it's a file path
  const absolutePath = path.isAbsolute(videoPath)
    ? videoPath
    : path.resolve(process.cwd(), videoPath);

  if (!fs.existsSync(absolutePath)) {
    // Check if it's already base64 encoded
    if (isBase64(videoPath)) {
      return videoPath;
    }
    throw new Error(`Video file not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  return buffer.toString('base64');
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
