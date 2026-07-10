# Google Veo 3.1 MCP Server

MCP Server and CLI batch tool for Google Veo 3.1 Video Generation API.

## Features

- **MCP Server** for integration with Claude Desktop and other MCP clients
- **Batch CLI Tool** for processing multiple video generation jobs
- **Text-to-Video**: Generate videos from text prompts
- **Image-to-Video**: Animate static images
- **Reference Images**: Use up to 3 images for character/style consistency
- **Video Extension**: Extend existing videos by 7 seconds
- **Frame Interpolation**: Generate video between two keyframes
- **Cost Estimation**: Calculate costs before execution

## Installation

```bash
npm install
npm run build
```

## Setup

1. Get your Google API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

2. Create a `.env` file:
```env
GOOGLE_API_KEY=your_api_key_here
```

Or set the environment variable directly:
```bash
export GOOGLE_API_KEY=your_api_key_here
```

## MCP Server Usage

### Claude Desktop Configuration

Add to your Claude Desktop configuration (`%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "veo3": {
      "command": "node",
      "args": ["C:/path/to/google-veo3-1-mcp-server/dist/index.js"],
      "env": {
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

Or using npx after publishing:
```json
{
  "mcpServers": {
    "veo3": {
      "command": "npx",
      "args": ["google-veo3-1-mcp-server"],
      "env": {
        "GOOGLE_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

### Available Tools

#### generate_video
Generate video from text prompt or image.

```json
{
  "prompt": "A golden retriever running through autumn leaves",
  "model": "veo-3.1-generate-preview",
  "resolution": "1080p",
  "duration_seconds": 8,
  "generate_audio": true,
  "output_path": "./output/video.mp4"
}
```

**Parameters:**
- `prompt`: Text description of the video (required unless image provided)
- `model`: `veo-3.1-generate-preview` (default) or `veo-3.1-fast-generate-preview`
- `aspect_ratio`: `16:9` (default) or `9:16`
- `resolution`: `720p` (default), `1080p`, or `4k` (4k only for standard model)
- `duration_seconds`: `4`, `6`, or `8` (default: 8)
- `generate_audio`: Whether to generate audio (default: true)
- `negative_prompt`: Elements to avoid
- `image`: Image for Image-to-Video mode
- `reference_images`: Array of reference images for consistency
- `sample_count`: Number of videos to generate per request (default: 1)
- `output_path`: Path to save the video
- `wait`: Set to `false` to return the `operation_name` immediately instead of blocking until the video is ready (default: `true`). Also supported by `extend_video` and `interpolate_frames`.

#### extend_video
Extend an existing video by 7 seconds.

```json
{
  "video": "./input/video.mp4",
  "prompt": "Continue with the character walking forward",
  "output_path": "./output/extended.mp4"
}
```

**Requirements:**
- Input video: 1-30 seconds, 24fps, 720p or 1080p
- Output: 7 seconds at 720p

#### interpolate_frames
Generate video transitioning between two keyframes.

```json
{
  "first_frame": "./images/start.jpg",
  "last_frame": "./images/end.jpg",
  "prompt": "Smooth camera pan",
  "duration_seconds": 8,
  "generate_audio": true,
  "output_path": "./output/interpolated.mp4"
}
```

#### get_video_status
Check the status of a video generation operation. When used with `wait: false` generation, poll this tool until `done` is `true`, then download the result.

```json
{
  "operation_name": "models/veo-3.1-generate-preview/operations/abc123",
  "download": true,
  "output_path": "./output/video.mp4"
}
```

**Parameters:**
- `operation_name`: Operation name returned by a generation tool (required)
- `download`: When the operation is done, download the video(s) to `output_path` or `OUTPUT_DIR` (default: `false`)
- `output_path`: Where to save the downloaded video (implies `download`)

**Async workflow example:**
1. `generate_video` with `"wait": false` → returns `operation_name` in seconds
2. `get_video_status` with the `operation_name` → `done: false` while processing
3. Once `done: true`, call again with `"download": true` (or include `output_path`) to save the video

## Batch CLI Usage

```bash
# Estimate costs only
veo3-batch config.json --estimate-only

# Execute batch
veo3-batch config.json --output-dir ./output

# With options
veo3-batch config.json --max-concurrent 3 --no-audio --format json
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-o, --output-dir <path>` | Output directory for videos |
| `-f, --format <text\|json>` | Output format (default: text) |
| `-c, --max-concurrent <n>` | Parallel jobs (1-5, default: 2) |
| `-p, --poll-interval <ms>` | Polling interval |
| `-t, --timeout <ms>` | Total batch timeout |
| `-e, --estimate-only` | Only estimate costs |
| `--no-audio` | Generate without audio (reduces cost) |
| `--allow-any-path` | Allow absolute output paths |

### Batch Configuration Format

```json
{
  "jobs": [
    {
      "prompt": "A cat playing piano",
      "duration_seconds": 8,
      "resolution": "1080p",
      "generate_audio": true
    },
    {
      "type": "extend",
      "video": "./videos/source.mp4",
      "prompt": "Continue the scene"
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
```

## Pricing

| Feature | Resolution | With Audio | Video Only |
|---------|------------|------------|------------|
| Standard Model | 720p/1080p | $0.40/sec | $0.20/sec |
| Standard Model | 4K | $0.60/sec | $0.40/sec |
| Fast Model | 720p/1080p | $0.20/sec | $0.10/sec |

> **Note:** Gemini API preview models always generate audio. The `generate_audio` parameter is not currently supported. Use Vertex AI for audio control.

### Cost Examples

| Video Type | Resolution | Duration | Audio | Cost |
|------------|------------|----------|-------|------|
| Text-to-Video | 1080p | 8 sec | Yes | $3.20 |
| Text-to-Video | 1080p | 8 sec | No | $1.60 |
| Image-to-Video (Fast) | 720p | 4 sec | Yes | $0.80 |
| Video Extension | 720p | 7 sec | No | $1.40 |
| Frame Interpolation | 1080p | 8 sec | Yes | $3.20 |

## Models

| Model | Description | Resolutions | Speed |
|-------|-------------|-------------|-------|
| `veo-3.1-generate-preview` | High quality | 720p, 1080p, 4K | Standard |
| `veo-3.1-fast-generate-preview` | Faster generation | 720p, 1080p | Fast |

## Reference Images

Use reference images to maintain consistency:

```json
{
  "prompt": "The character walks through a forest",
  "reference_images": [
    {
      "image": "./character.jpg",
      "reference_type": "asset"
    }
  ]
}
```

- `asset`: For characters/objects (max 3 images)
- `style`: For visual style (max 1 image)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_API_KEY` | Google API key (required) | - |
| `OUTPUT_DIR` | Default output directory | `./output` |
| `DEBUG` | Enable debug logging | `false` |
| `VIDEO_POLL_INTERVAL` | Polling interval (ms) | `15000` |
| `VIDEO_MAX_POLL_ATTEMPTS` | Max polling attempts | `120` |

## API Documentation

For detailed API specifications, see:
- [Google Veo 3.1 API Specification](./docs/GOOGLE_VEO_3.1_API_SPECIFICATION.md)
- [Gemini API Video Generation](https://ai.google.dev/gemini-api/docs/video)
- [Vertex AI Veo Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo)

## License

MIT
