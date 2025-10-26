import {
  BenchmarkQuestion,
  BenchmarkQuestionMediaImage,
  ImageSummary,
  ModelBinding,
} from '@/types/benchmark';
import createId from '@/utils/createId';
import { sendChatCompletion } from '@/services/lmStudioClient';

const buildCacheKey = (bindingId: string, image: BenchmarkQuestionMediaImage) =>
  `${bindingId}::${image.url}`;

const buildPlaceholderSummary = (
  image: BenchmarkQuestionMediaImage,
  binding: ModelBinding,
  options: { reason: 'placeholder' | 'error'; message: string }
): ImageSummary => ({
  id: createId(),
  image,
  url: image.url,
  text: options.message,
  status: options.reason === 'error' ? 'error' : 'skipped',
  bindingId: binding.id,
  bindingName: binding.name,
  generatedAt: new Date().toISOString(),
  raw: {
    reason: options.reason,
  },
});

const bufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
};

const guessMimeType = (contentType: string | null, url: string): string => {
  if (contentType && contentType !== 'application/octet-stream') {
    return contentType;
  }

  try {
    const parsed = new URL(url);
    const extension = parsed.pathname.split('.').pop()?.toLowerCase();
    switch (extension) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'gif':
        return 'image/gif';
      case 'webp':
        return 'image/webp';
      case 'svg':
        return 'image/svg+xml';
      default:
        return 'image/png';
    }
  } catch (_error) {
    return 'image/png';
  }
};

const sanitizeJsonText = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
  }
  return trimmed;
};

export interface ImagePreprocessOptions {
  question: BenchmarkQuestion;
  binding: ModelBinding;
  cache?: Map<string, ImageSummary>;
  signal?: AbortSignal;
}

export const preprocessQuestionImages = async ({
  question,
  binding,
  cache,
  signal,
}: ImagePreprocessOptions): Promise<ImageSummary[]> => {
  const images = question.media?.images ?? [];
  if (images.length === 0) {
    return [];
  }

  const summaries: ImageSummary[] = [];

  for (const image of images) {
    const cacheKey = buildCacheKey(binding.id, image);
    const cached = cache?.get(cacheKey);
    if (cached) {
      summaries.push(cached);
      continue;
    }

    try {
      const response = await fetch(image.url, {
        signal,
        cache: 'no-store',
        mode: 'cors',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const mimeType = guessMimeType(response.headers.get('Content-Type'), image.url);
      const base64 = bufferToBase64(arrayBuffer);
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const completion = await sendChatCompletion({
        binding,
        messages: [
          {
            role: 'system',
            content:
              'You are a meticulous OCR assistant. Extract readable text from images and keep formatting minimal.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  'Analyze the attached image and return JSON with keys "text" (string of extracted text) and "confidence" (number 0-1). If no text is present, return an empty string and a low confidence.',
              },
              {
                type: 'input_image',
                image_url: {
                  url: dataUrl,
                },
              },
            ],
          },
        ],
        temperature: Math.max(0, Math.min(binding.temperature ?? 0.1, 0.3)),
        maxTokens: Math.min(binding.maxOutputTokens ?? 1024, 2048),
        preferJson: false,
      });

      const rawText = completion.text ?? '';
      const cleaned = sanitizeJsonText(rawText);
      let extractedText = cleaned;
      let confidence: number | undefined;

      try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed === 'string') {
          extractedText = parsed;
        } else if (parsed && typeof parsed === 'object') {
          if (typeof (parsed as { text?: unknown }).text === 'string') {
            extractedText = (parsed as { text: string }).text;
          }
          const parsedConfidence = Number((parsed as { confidence?: unknown }).confidence);
          if (!Number.isNaN(parsedConfidence)) {
            confidence = Math.max(0, Math.min(parsedConfidence, 1));
          }
        }
      } catch (_error) {
        // Non-JSON response; use cleaned text as-is.
      }

      const summary: ImageSummary = {
        id: createId(),
        image,
        url: image.url,
        text: extractedText.trim() || '(No text detected)',
        status: extractedText.trim() ? 'ok' : 'error',
        bindingId: binding.id,
        bindingName: binding.name,
        confidence,
        raw: completion.raw,
        generatedAt: new Date().toISOString(),
      };

      if (cache) {
        cache.set(cacheKey, summary);
      }
      summaries.push(summary);
    } catch (error) {
      const hasAltText = Boolean(image.altText && image.altText.trim().length > 0);
      const fallbackMessage = hasAltText
        ? `Alt text: ${image.altText?.trim()}`
        : `Failed to OCR image: ${(error as Error).message}`;
      const summary = buildPlaceholderSummary(image, binding, {
        reason: hasAltText ? 'placeholder' : 'error',
        message: fallbackMessage,
      });
      summaries.push(summary);
    }
  }

  return summaries;
};
