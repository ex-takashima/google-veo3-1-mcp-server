# Google Veo 3.1 API 仕様書

> 最終更新: 2026-02-01

## 概要

Veo 3.1はGoogleの最新動画生成AIモデルで、テキストプロンプトや画像から高品質な動画を生成できます。ネイティブオーディオ生成、フレーム補間、リファレンス画像による一貫性維持など、高度な機能を備えています。

---

## 利用可能なAPI

Veo 3.1は2つのAPIプラットフォームで利用可能です：

| プラットフォーム | 用途 | 認証方式 |
|-----------------|------|----------|
| **Gemini API** | 開発者向け、プロトタイピング | APIキー |
| **Vertex AI** | エンタープライズ、本番環境 | OAuth 2.0 / サービスアカウント |

---

## モデルID一覧

### Gemini API
| モデルID | 説明 |
|----------|------|
| `veo-3.1-generate-preview` | Veo 3.1 標準版（プレビュー） |
| `veo-3.1-fast-generate-preview` | Veo 3.1 高速版（プレビュー） |

### Vertex AI
| モデルID | 説明 | ステータス |
|----------|------|-----------|
| `veo-3.1-generate-001` | Veo 3.1 標準版 | Production |
| `veo-3.1-fast-generate-001` | Veo 3.1 高速版 | Production |
| `veo-3.1-generate-preview` | Veo 3.1 標準版 | Preview |
| `veo-3.1-fast-generate-preview` | Veo 3.1 高速版 | Preview |

---

## 価格 (2026年1月時点)

### Vertex AI / Gemini API 公式価格

| 機能 | 解像度 | 価格（USD） |
|------|--------|------------|
| **動画 + オーディオ生成** | 720p, 1080p | **$0.40/秒** |
| **動画 + オーディオ生成** | 4K | **$0.60/秒** |
| **動画のみ（音声なし）** | 720p, 1080p | **$0.20/秒** |

### コスト計算例

| 動画長 | 音声あり (1080p) | 音声なし (1080p) |
|--------|-----------------|-----------------|
| 4秒 | $1.60 | $0.80 |
| 6秒 | $2.40 | $1.20 |
| 8秒 | $3.20 | $1.60 |

### Gemini Advanced サブスクリプション
- **$19.99/月**: Veo 3.1フルアクセス（ネイティブ音声生成、4Kアップスケーリング含む）
- **$249.99/月 (Ultra)**: 約2,500本のVeo 3.1 Fast動画生成可能

---

## APIエンドポイント

### Gemini API

```
POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL_ID}:predictLongRunning
```

**認証ヘッダー:**
```
x-goog-api-key: YOUR_API_KEY
```

### Vertex AI

```
POST https://{LOCATION}-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}:predictLongRunning
```

**認証ヘッダー:**
```
Authorization: Bearer $(gcloud auth print-access-token)
```

---

## リクエストパラメータ

### 必須/オプションパラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|-----------|-----|------|-----------|------|
| `prompt` | string | △ | - | テキストプロンプト（画像入力時はオプション） |
| `image` | object | × | - | 開始フレーム画像（image-to-video用） |
| `lastFrame` | object | × | - | 終了フレーム画像（フレーム補間用） |
| `video` | object | × | - | 延長対象の動画（video extension用） |
| `referenceImages` | array | × | - | 参照画像（最大3枚、Veo 3.1のみ） |
| `negativePrompt` | string | × | - | 生成を避けたい要素 |

### 生成設定パラメータ

| パラメータ | 型 | デフォルト | 選択肢/範囲 |
|-----------|-----|-----------|------------|
| `aspectRatio` | string | "16:9" | "16:9", "9:16" |
| `resolution` | string | "720p" | "720p", "1080p", "4k"(プレビューのみ) |
| `durationSeconds` | integer | 8 | 4, 6, 8 |
| `sampleCount` | integer | 1 | 1-4 |
| `generateAudio` | boolean | - | true/false (Veo 3必須) |
| `personGeneration` | string | "allow_adult" | "allow_adult", "dont_allow", "allow_all" |
| `seed` | uint32 | ランダム | 0 - 4,294,967,295 |
| `compressionQuality` | string | "optimized" | "optimized", "lossless" |
| `resizeMode` | string | "pad" | "pad", "crop" |
| `storageUri` | string | - | gs://BUCKET/PATH |

### referenceImages の構造

```json
{
  "referenceImages": [
    {
      "image": {
        "bytesBase64Encoded": "BASE64_DATA"
      },
      "referenceType": "asset"
    }
  ]
}
```

- `referenceType`: `"asset"`（キャラクター/オブジェクト）または `"style"`（スタイル）
- 最大3枚のasset画像、または1枚のstyle画像

---

## サポートされるファイル形式

### 入力画像
- `image/jpeg`
- `image/png`
- `image/webp`
- **最大サイズ:** 20MB

### 入力動画（video extension用）
- `video/mp4`, `video/mov`, `video/mpeg`, `video/avi`, `video/wmv`, `video/flv`
- **要件:** 1-30秒、24fps、720p または 1080p

### 出力動画
- **形式:** MP4
- **フレームレート:** 24fps
- **透かし:** SynthID（デジタルウォーターマーク）

---

## 主要機能

### 1. Text-to-Video（テキストから動画）
テキストプロンプトから動画を生成

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="YOUR_API_KEY")

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="A cinematic shot of a golden retriever running through autumn leaves in slow motion",
    config=types.GenerateVideosConfig(
        aspect_ratio="16:9",
        resolution="1080p",
        duration_seconds=8,
        generate_audio=True
    )
)

# ポーリングで完了を待機
while not operation.done:
    time.sleep(10)
    operation = client.operations.get(operation.name)

# 結果を取得
video = operation.response.generated_videos[0]
```

### 2. Image-to-Video（画像から動画）
静止画をアニメーション化

```python
import base64

with open("start_frame.jpg", "rb") as f:
    image_data = base64.b64encode(f.read()).decode()

operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Camera slowly zooms in while clouds move in the background",
    image=types.Image(bytes_base64_encoded=image_data),
    config=types.GenerateVideosConfig(
        aspect_ratio="16:9",
        duration_seconds=8
    )
)
```

### 3. First-Last Frame Interpolation（フレーム補間）
開始フレームと終了フレームの間を補間

```python
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Smooth transition between scenes",
    image=types.Image(bytes_base64_encoded=first_frame_data),
    last_frame=types.Image(bytes_base64_encoded=last_frame_data),
    config=types.GenerateVideosConfig(
        duration_seconds=8,
        generate_audio=True
    )
)
```

### 4. Video Extension（動画延長）
既存の動画を延長（最終1秒から続きを生成）

```python
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="Continue the action with the character walking forward",
    video=types.Video(uri="gs://bucket/previous_video.mp4"),
    config=types.GenerateVideosConfig(
        # 延長は7秒、720p固定
    )
)
```

### 5. Reference Images（参照画像によるガイド）
キャラクターやスタイルの一貫性を維持

```python
operation = client.models.generate_videos(
    model="veo-3.1-generate-preview",
    prompt="The character walks through a magical forest",
    reference_images=[
        types.ReferenceImage(
            image=types.Image(bytes_base64_encoded=character_image),
            reference_type="asset"
        )
    ],
    config=types.GenerateVideosConfig(
        duration_seconds=8
    )
)
```

---

## Vertex AI REST API例

### リクエスト

```bash
curl -X POST \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/veo-3.1-generate-001:predictLongRunning" \
  -d '{
    "instances": [{
      "prompt": "A timelapse of a flower blooming in soft natural light"
    }],
    "parameters": {
      "aspectRatio": "16:9",
      "resolution": "1080p",
      "durationSeconds": 8,
      "generateAudio": true,
      "sampleCount": 1,
      "storageUri": "gs://my-bucket/output/"
    }
  }'
```

### レスポンス（初期）

```json
{
  "name": "projects/PROJECT_ID/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/OPERATION_ID"
}
```

### 操作ステータス確認

```bash
curl -X GET \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  "https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/${OPERATION_ID}"
```

### 完了時レスポンス

```json
{
  "name": "...",
  "done": true,
  "response": {
    "generatedVideos": [
      {
        "video": {
          "uri": "gs://my-bucket/output/video.mp4",
          "bytesBase64Encoded": "..."
        }
      }
    ]
  }
}
```

---

## クォータと制限

| 制限項目 | 値 |
|----------|-----|
| リクエスト/分（Production） | 50 |
| リクエスト/分（Preview） | 10 |
| 動画長 | 4, 6, 8秒 |
| 同時生成数 | 最大4本/リクエスト |
| プロンプト長 | 最大1,024トークン |
| 入力画像サイズ | 最大20MB |
| 動画保持期間 | 2日間（サーバー側） |
| レイテンシー | 11秒 〜 6分 |

### 地域制限
- EU/UK/CH/MENA地域: `personGeneration`は`"allow_adult"`のみ利用可

---

## プロンプトのベストプラクティス

### 構成要素
1. **Subject（被写体）**: オブジェクト、人物、動物、風景
2. **Action（動作）**: 被写体が何をしているか
3. **Style（スタイル）**: 映画的スタイル、カメラワーク

### 良いプロンプト例

```
A cinematic drone shot of a lone surfer riding a massive wave at sunset,
golden hour lighting, slow motion, shot on ARRI Alexa,
shallow depth of field with ocean spray in foreground
```

### 音声キューの指定

```
A chef in a busy kitchen, the sound of sizzling pans and chopping vegetables,
ambient kitchen chatter in the background
```

---

## エラーハンドリング

### 一般的なエラー

| エラーコード | 原因 | 対処法 |
|-------------|------|--------|
| 400 | 無効なパラメータ | リクエストパラメータを確認 |
| 401 | 認証エラー | APIキー/トークンを確認 |
| 429 | レート制限超過 | リトライまたはクォータ増加を申請 |
| 500 | サーバーエラー | 時間をおいてリトライ |

### コンテンツフィルタリング

生成された動画が安全性ポリシーに違反する場合、空の結果が返されます。`negativePrompt`を使用して不適切なコンテンツの生成を抑制してください。

---

## 参考リンク

- [Gemini API Video Generation](https://ai.google.dev/gemini-api/docs/video)
- [Vertex AI Veo 3.1 Documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate)
- [Vertex AI Veo API Reference](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/veo-video-generation)
- [Google Developers Blog - Veo 3.1 Announcement](https://developers.googleblog.com/en/introducing-veo-3-1-and-new-creative-capabilities-in-the-gemini-api/)

---

## 変更履歴

| 日付 | 変更内容 |
|------|----------|
| 2026-02-01 | 初版作成 |
