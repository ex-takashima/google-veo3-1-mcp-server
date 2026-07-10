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
 * Error carrying the HTTP status code, so callers can distinguish
 * transient (5xx) failures from permanent ones.
 */
export class ApiStatusError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiStatusError';
  }
}

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
  // Operation name may be a full URL or a path relative to the Gemini API
  const url = operationName.startsWith('http')
    ? operationName
    : `${GEMINI_API_BASE_URL}/${operationName}`;

  debugLog('Checking operation status', { url });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new ApiStatusError(
      response.status,
      `Failed to get operation status: ${response.status} ${response.statusText} - ${errorText}`
    );
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
      // Retry only transient server errors (5xx)
      if (error instanceof ApiStatusError && error.status >= 500) {
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
  const headers: Record<string, string> = {};

  // Authenticate via header (not query string) so the key never appears in URLs/logs
  if (apiKey && url.includes('generativelanguage.googleapis.com')) {
    headers['x-goog-api-key'] = apiKey;
  }

  debugLog('Downloading video', { url });

  const response = await fetch(url, { headers });

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

export interface ExtractedVideo {
  url?: string;
  base64?: string;
}

/**
 * Extract all generated videos from an operation response
 */
export function extractVideosFromResponse(response: VeoOperationResponse): ExtractedVideo[] {
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
    return generateVideoResponse.generatedSamples
      .map(sample => sample.video)
      .filter((video): video is NonNullable<typeof video> => !!video)
      .map(video => ({ url: video.uri, base64: video.bytesBase64Encoded }));
  }

  // Fallback: Check for Vertex AI format (generatedVideos)
  if (response.response?.generatedVideos?.length) {
    return response.response.generatedVideos.map(({ video }) => ({
      url: video.uri,
      base64: video.bytesBase64Encoded
    }));
  }

  return [];
}

/**
 * Extract the first video from an operation response
 */
export function extractVideoFromResponse(response: VeoOperationResponse): ExtractedVideo | null {
  return extractVideosFromResponse(response)[0] ?? null;
}

/**
 * Get MIME type from file extension
 */
function getMimeTypeFromExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
  };
  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Get MIME type from buffer magic bytes, or null if not a recognized image
 */
function getMimeTypeFromBuffer(buffer: Buffer): string | null {
  // Check magic bytes
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  // WebP: RIFF container with "WEBP" at offset 8 (bare RIFF is also WAV/AVI)
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return 'image/gif';
  }
  return null;
}

export interface ImageData {
  base64: string;
  mimeType: string;
}

/**
 * Read image file and convert to base64 with MIME type
 */
export async function readImageWithMimeType(imagePath: string): Promise<ImageData> {
  // Check if it's already base64 or a URL
  if (imagePath.startsWith('data:')) {
    // Extract base64 and mimeType from data URL
    const match = imagePath.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      return { base64: match[2], mimeType: match[1] };
    }
    throw new Error('Invalid data URL format');
  }

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    // Download image from URL
    const response = await fetch(imagePath);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const buffer = await response.arrayBuffer();
    const nodeBuffer = Buffer.from(buffer);
    return {
      base64: nodeBuffer.toString('base64'),
      mimeType: contentType.split(';')[0] // Remove charset if present
    };
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
    // Only treat as raw base64 if it can't be a path and decodes to a real image;
    // otherwise a typo'd path would silently send garbage to the (billed) API
    if (!looksLikePath(imagePath) && isBase64(imagePath)) {
      const decoded = Buffer.from(imagePath, 'base64');
      const mimeType = getMimeTypeFromBuffer(decoded);
      if (mimeType) {
        return { base64: imagePath, mimeType };
      }
    }
    throw new Error(`Image file not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const mimeType = getMimeTypeFromBuffer(buffer) ?? getMimeTypeFromExtension(absolutePath);
  return {
    base64: buffer.toString('base64'),
    mimeType
  };
}

/**
 * Read image file and convert to base64
 * @deprecated Use readImageWithMimeType instead
 */
export async function readImageAsBase64(imagePath: string): Promise<string> {
  const result = await readImageWithMimeType(imagePath);
  return result.base64;
}

/**
 * Check if a string looks like a file path rather than inline data
 */
function looksLikePath(str: string): boolean {
  return str.includes('/') || str.includes('\\');
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
    // Only treat as raw base64 if it can't be a path and decodes to an MP4
    // ("ftyp" box at offset 4)
    if (!looksLikePath(videoPath) && isBase64(videoPath)) {
      const decoded = Buffer.from(videoPath, 'base64');
      if (decoded.length >= 8 && decoded.toString('ascii', 4, 8) === 'ftyp') {
        return videoPath;
      }
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
