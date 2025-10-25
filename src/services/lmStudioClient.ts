import { ModelProfile } from '@/types/benchmark';

interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  profile: Pick<ModelProfile, 'baseUrl' | 'apiKey' | 'requestTimeoutMs'>;
  signal?: AbortSignal;
}

const isJsonModeError = (payload: unknown) => {
  if (!payload) {
    return false;
  }

  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return /response[_-]?format|json mode|unable to parse/i.test(text);
};

const buildHeaders = (apiKey?: string) => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
};

const request = async <T>({
  path,
  method = 'GET',
  body,
  profile,
  signal,
}: RequestOptions): Promise<{ ok: boolean; status: number; data?: T; raw: Response }> => {
  const url = new URL(path, profile.baseUrl).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), profile.requestTimeoutMs);

  const response = await fetch(url, {
    method,
    headers: buildHeaders(profile.apiKey),
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ?? controller.signal,
  }).finally(() => {
    clearTimeout(timeout);
  });

  let data: T | undefined;

  try {
    data = (await response.json()) as T;
  } catch (error) {
    console.warn('Failed to parse response JSON', error);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    raw: response,
  };
};

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionParams {
  profile: ModelProfile;
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  preferJson?: boolean;
  reasoningEffort?: 'low' | 'medium' | 'high';
  signal?: AbortSignal;
}

interface RawChatCompletionChoice {
  message?: { role: string; content: string };
  delta?: { content?: string };
  finish_reason?: string;
}

interface RawChatCompletionUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface RawChatCompletionResponse {
  id?: string;
  model?: string;
  created?: number;
  choices?: RawChatCompletionChoice[];
  usage?: RawChatCompletionUsage;
}

export interface ChatCompletionResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  raw?: RawChatCompletionResponse;
  fallbackUsed: boolean;
  supportsJsonMode: boolean;
}

const extractTextFromResponse = (payload?: RawChatCompletionResponse) => {
  if (!payload?.choices || payload.choices.length === 0) {
    return '';
  }

  const primaryMessage = payload.choices[0].message?.content;
  const deltaMessage = payload.choices[0].delta?.content;

  return primaryMessage ?? deltaMessage ?? '';
};

const mapUsage = (usage?: RawChatCompletionUsage) =>
  usage
    ? {
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
      }
    : undefined;

export const sendChatCompletion = async ({
  profile,
  messages,
  temperature,
  maxTokens,
  preferJson = true,
  reasoningEffort,
  signal,
}: ChatCompletionParams): Promise<ChatCompletionResult> => {
  const attempt = async (forcePlain = false) => {
    const responseFormat =
      preferJson && !forcePlain
        ? {
            response_format: { type: 'json_object' },
          }
        : {};

    const payload = {
      model: profile.modelId,
      temperature,
      max_tokens: maxTokens,
      messages,
      ...(profile.topP !== undefined && { top_p: profile.topP }),
      ...(profile.frequencyPenalty !== undefined && { frequency_penalty: profile.frequencyPenalty }),
      ...(profile.presencePenalty !== undefined && { presence_penalty: profile.presencePenalty }),
      ...(reasoningEffort !== undefined && { reasoning_effort: reasoningEffort }),
      ...responseFormat,
    };

    // Log reasoning effort usage for debugging
    if (reasoningEffort) {
      console.log(`[LM STUDIO] Using reasoning_effort: ${reasoningEffort} for model: ${profile.modelId}`);
    }

    return request<RawChatCompletionResponse>({
      path: '/v1/chat/completions',
      method: 'POST',
      body: payload,
      profile,
      signal,
    });
  };

  // Retry logic for model loading (400 errors may indicate model not loaded yet)
  const maxRetries = 3;
  const retryDelays = [2000, 5000, 10000]; // 2s, 5s, 10s
  const initial = await attempt();
  let lastAttempt = initial;
  let retryCount = 0;

  // Check if error might be due to model loading
  const isModelLoadingError = (status: number, body: unknown) => {
    if (status !== 400) return false;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return /model.*not.*loaded|model.*loading|not.*ready|bad request/i.test(text);
  };

  // Retry on 400 errors that might be model loading issues
  while (!lastAttempt.ok && retryCount < maxRetries) {
    const errorBody = lastAttempt.data ?? (await lastAttempt.raw.text());

    if (isModelLoadingError(lastAttempt.status, errorBody)) {
      console.warn(
        `[LM STUDIO] Model may not be loaded yet (attempt ${retryCount + 1}/${maxRetries}). Waiting ${retryDelays[retryCount]}ms before retry...`
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelays[retryCount]));
      retryCount++;
      lastAttempt = await attempt();
    } else {
      break; // Not a loading error, stop retrying
    }
  }

  if (lastAttempt.ok && lastAttempt.data) {
    if (retryCount > 0) {
      console.log(`[LM STUDIO] Request succeeded after ${retryCount} ${retryCount === 1 ? 'retry' : 'retries'}`);
    }
    return {
      text: extractTextFromResponse(lastAttempt.data),
      usage: mapUsage(lastAttempt.data?.usage),
      raw: lastAttempt.data,
      fallbackUsed: false,
      supportsJsonMode: preferJson,
    };
  }

  if (lastAttempt.ok) {
    return {
      text: '',
      raw: lastAttempt.data,
      fallbackUsed: false,
      supportsJsonMode: preferJson,
    };
  }

  const errorBody = lastAttempt.data ?? (await lastAttempt.raw.text());

  // Try JSON mode fallback if that's the issue
  if (preferJson && isJsonModeError(errorBody)) {
    console.log('[LM STUDIO] JSON mode not supported, falling back to plain text');
    const retry = await attempt(true);

    if (!retry.ok || !retry.data) {
      throw new Error(`Failed to fetch chat completion: ${retry.status}`);
    }

    return {
      text: extractTextFromResponse(retry.data),
      usage: mapUsage(retry.data?.usage),
      raw: retry.data,
      fallbackUsed: true,
      supportsJsonMode: false,
    };
  }

  throw new Error(
    `Failed to fetch chat completion: ${lastAttempt.status} - ${
      typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody)
    }`
  );
};

export const fetchModels = async (profile: ModelProfile) => {
  const response = await request<{ data?: { id: string; object: string }[] }>({
    path: '/v1/models',
    method: 'GET',
    profile,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }

  return response.data?.data ?? [];
};
