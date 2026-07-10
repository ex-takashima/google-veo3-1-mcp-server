#!/usr/bin/env node

/**
 * Google Veo 3.1 MCP Server
 *
 * Provides tools for video generation using Google's Veo 3.1 API:
 * - generate_video: Text-to-Video and Image-to-Video with reference images
 * - extend_video: Extend existing videos by 7 seconds
 * - interpolate_frames: Generate video between first and last frames
 * - get_video_status: Check status of video generation operations
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { config } from 'dotenv';

import { generateVideo } from './tools/generate.js';
import { extendVideo } from './tools/extend.js';
import { interpolateFrames } from './tools/interpolate.js';
import {
  getOperationStatus,
  getApiKey,
  extractVideosFromResponse,
  downloadAndSaveVideo
} from './utils/video.js';
import { generateDefaultOutputPath, getDisplayPath } from './utils/path.js';
import { debugLog, errorLog, infoLog } from './utils/debug.js';
import {
  MODELS,
  RESOLUTIONS,
  ASPECT_RATIOS,
  DURATIONS,
  REFERENCE_TYPES,
  PERSON_GENERATION_OPTIONS,
  type GenerateVideoParams,
  type ExtendVideoParams,
  type InterpolateFramesParams,
  type GetVideoStatusParams,
  type VideoStatusResult
} from './types/tools.js';

// Load environment variables
config();

// Warn early if the API key is missing, but keep the server running so
// MCP clients get a per-call error instead of a silent startup failure
try {
  getApiKey();
} catch {
  errorLog('GOOGLE_API_KEY not found in environment variables; tool calls will fail until it is set');
}

// =============================================================================
// Tool Definitions
// =============================================================================

const tools: Tool[] = [
  {
    name: 'generate_video',
    description: `Generate a video using Google Veo 3.1 API.

Supports:
- Text-to-Video: Generate video from a text prompt
- Image-to-Video: Animate a static image
- Reference Images: Use up to 3 asset images or 1 style image for consistency

Models:
- veo-3.1-generate-preview: High quality (default)
- veo-3.1-fast-generate-preview: Faster generation

Pricing (per second):
- 720p/1080p with audio: $0.40 (standard) / $0.20 (fast)
- 720p/1080p video only: $0.20 (standard) / $0.10 (fast)
- 4K with audio: $0.60 (standard only)`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text prompt describing the video to generate. Required unless image is provided.'
        },
        model: {
          type: 'string',
          enum: MODELS as unknown as string[],
          description: 'Model to use for generation. Default: veo-3.1-generate-preview'
        },
        aspect_ratio: {
          type: 'string',
          enum: ASPECT_RATIOS as unknown as string[],
          description: 'Aspect ratio of the video. Default: 16:9'
        },
        resolution: {
          type: 'string',
          enum: RESOLUTIONS as unknown as string[],
          description: 'Video resolution. 4K only available for standard model. Default: 720p'
        },
        duration_seconds: {
          type: 'number',
          enum: DURATIONS as unknown as number[],
          description: 'Duration of the video in seconds (4, 6, or 8). Default: 8'
        },
        generate_audio: {
          type: 'boolean',
          description: 'Whether to generate audio. Note: Gemini API preview always generates audio (this parameter is ignored). Use Vertex AI for audio control.'
        },
        negative_prompt: {
          type: 'string',
          description: 'Elements to avoid in the generated video'
        },
        image: {
          type: 'string',
          description: 'Image for Image-to-Video mode. Can be a file path, URL, or base64 string'
        },
        reference_images: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              image: {
                type: 'string',
                description: 'Image file path, URL, or base64 string'
              },
              reference_type: {
                type: 'string',
                enum: REFERENCE_TYPES as unknown as string[],
                description: 'Type of reference: "asset" for characters/objects, "style" for visual style'
              }
            },
            required: ['image', 'reference_type']
          },
          description: 'Reference images for consistency. Max 3 asset images or 1 style image'
        },
        sample_count: {
          type: 'number',
          description: 'Number of videos to generate per request (1-4). Default: 1'
        },
        person_generation: {
          type: 'string',
          enum: PERSON_GENERATION_OPTIONS as unknown as string[],
          description: 'Control person generation: allow_adult (default), dont_allow, allow_all'
        },
        seed: {
          type: 'number',
          description: 'Random seed for reproducibility (0-4294967295)'
        },
        output_path: {
          type: 'string',
          description: 'Path to save the generated video. If not provided, uses OUTPUT_DIR env var'
        },
        wait: {
          type: 'boolean',
          description: 'If false, return the operation_name immediately without waiting for completion. Poll with get_video_status and download with its download option. Default: true'
        }
      },
      required: []
    }
  },
  {
    name: 'extend_video',
    description: `Extend an existing video by 7 seconds using Veo 3.1 API.

The extension continues from the last second of the input video.

Requirements:
- Input video: 1-30 seconds, 24fps, 720p or 1080p
- Output: Always 7 seconds at 720p

Estimated cost: ~$1.40 per extension`,
    inputSchema: {
      type: 'object',
      properties: {
        video: {
          type: 'string',
          description: 'Video to extend. Can be a GCS URI (gs://), file path, URL, or base64 string'
        },
        prompt: {
          type: 'string',
          description: 'Optional prompt to guide the extension'
        },
        output_path: {
          type: 'string',
          description: 'Path to save the extended video'
        },
        wait: {
          type: 'boolean',
          description: 'If false, return the operation_name immediately without waiting for completion. Default: true'
        }
      },
      required: ['video']
    }
  },
  {
    name: 'interpolate_frames',
    description: `Generate a video that smoothly transitions between two keyframes using Veo 3.1 API.

Creates a video that starts at the first frame and ends at the last frame with AI-generated motion in between.

Pricing: Same as generate_video based on duration and audio settings`,
    inputSchema: {
      type: 'object',
      properties: {
        first_frame: {
          type: 'string',
          description: 'Starting frame image. Can be a file path, URL, or base64 string'
        },
        last_frame: {
          type: 'string',
          description: 'Ending frame image. Can be a file path, URL, or base64 string'
        },
        prompt: {
          type: 'string',
          description: 'Optional prompt to guide the interpolation'
        },
        duration_seconds: {
          type: 'number',
          enum: DURATIONS as unknown as number[],
          description: 'Duration of the video in seconds (4, 6, or 8). Default: 8'
        },
        generate_audio: {
          type: 'boolean',
          description: 'Whether to generate audio. Note: Gemini API preview always generates audio (ignored).'
        },
        output_path: {
          type: 'string',
          description: 'Path to save the generated video'
        },
        wait: {
          type: 'boolean',
          description: 'If false, return the operation_name immediately without waiting for completion. Default: true'
        }
      },
      required: ['first_frame', 'last_frame']
    }
  },
  {
    name: 'get_video_status',
    description: `Check the status of a video generation operation.

Returns the current status (done/pending) and video URL if completed.
Can also download the completed video (use after generate_video with wait: false).`,
    inputSchema: {
      type: 'object',
      properties: {
        operation_name: {
          type: 'string',
          description: 'The operation name returned from generate_video, extend_video, or interpolate_frames'
        },
        download: {
          type: 'boolean',
          description: 'If true and the operation is done, download the video to output_path (or OUTPUT_DIR). Default: false'
        },
        output_path: {
          type: 'string',
          description: 'Path to save the video when downloading. Implies download. If not provided, uses OUTPUT_DIR env var'
        }
      },
      required: ['operation_name']
    }
  }
];

// =============================================================================
// Server Setup
// =============================================================================

const server = new Server(
  {
    name: 'google-veo3-1-mcp-server',
    version: '1.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// =============================================================================
// Request Handlers
// =============================================================================

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  debugLog('Listing tools');
  return { tools };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  debugLog(`Tool called: ${name}`, args);

  try {
    switch (name) {
      case 'generate_video': {
        const params = args as unknown as GenerateVideoParams;
        const result = await generateVideo(params);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case 'extend_video': {
        const params = args as unknown as ExtendVideoParams;
        const result = await extendVideo(params);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case 'interpolate_frames': {
        const params = args as unknown as InterpolateFramesParams;
        const result = await interpolateFrames(params);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      }

      case 'get_video_status': {
        const params = args as unknown as GetVideoStatusParams;

        if (!params.operation_name) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'operation_name is required'
                }, null, 2)
              }
            ]
          };
        }

        try {
          const apiKey = getApiKey();
          const status = await getOperationStatus(params.operation_name, apiKey);

          const result: VideoStatusResult = {
            success: true,
            operation_name: params.operation_name,
            done: status.done ?? false
          };

          if (status.done) {
            // Handles both Gemini (generateVideoResponse.generatedSamples)
            // and Vertex AI (generatedVideos) response formats
            const videos = extractVideosFromResponse(status);
            const videoUrls = videos.map(v => v.url).filter((u): u is string => !!u);
            result.video_url = videoUrls[0];
            if (videoUrls.length > 1) {
              result.video_urls = videoUrls;
            }

            // Download on request (async-mode flow: generate with wait: false,
            // then poll here and download once done)
            if (videos.length > 0 && (params.download || params.output_path)) {
              const outputPath = params.output_path || generateDefaultOutputPath(
                process.env.OUTPUT_DIR || './output',
                'veo3'
              );

              const savedPaths: string[] = [];
              for (const video of videos) {
                try {
                  // saveVideo uniquifies the filename, so samples share the base path
                  const savedPath = await downloadAndSaveVideo(video.url, video.base64, outputPath, apiKey);
                  savedPaths.push(savedPath);
                } catch (downloadError) {
                  errorLog('Failed to save video', downloadError);
                  // Report status even if the download fails
                }
              }

              const displayPaths = savedPaths.map(p => getDisplayPath(p));
              result.video_path = displayPaths[0];
              if (displayPaths.length > 1) {
                result.video_paths = displayPaths;
              }
            }
          }

          if (status.error) {
            result.success = false;
            result.error = status.error.message;
            result.failure_reason = `Error code: ${status.error.code}`;
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  operation_name: params.operation_name,
                  done: false,
                  error: error instanceof Error ? error.message : String(error)
                }, null, 2)
              }
            ]
          };
        }
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`
              }, null, 2)
            }
          ]
        };
    }
  } catch (error) {
    errorLog(`Tool execution failed: ${name}`, error);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }
      ]
    };
  }
});

// =============================================================================
// Start Server
// =============================================================================

async function main() {
  infoLog('Starting Google Veo 3.1 MCP Server...');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  infoLog('Server connected and ready');
}

main().catch((error) => {
  errorLog('Server failed to start', error);
  process.exit(1);
});
