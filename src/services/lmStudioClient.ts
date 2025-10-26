import { ModelProfile } from '@/types/benchmark';

interface RequestOptions {
  path: string;
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  profile: Pick<ModelProfile, 'baseUrl' | 'apiKey' | 'requestTimeoutMs'>;
  signal?: AbortSignal;
}

// JSON Schemas for LM Studio's json_schema format
const TOPOLOGY_SCHEMA = {
  type: 'object',
  properties: {
    subjectId: { type: 'string', description: 'Subject identifier' },
    topicId: { type: 'string', description: 'Topic identifier' },
    subtopicId: { type: 'string', description: 'Subtopic identifier' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
  },
  required: ['subjectId', 'topicId', 'subtopicId'],
  additionalProperties: false,
} as const;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The answer to the question' },
    explanation: { type: 'string', description: 'Explanation of the answer' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Confidence score' },
  },
  required: ['answer'],
  additionalProperties: false,
} as const;

type JsonFormatType = 'json_object' | 'json_schema';
type SchemaType = 'topology' | 'answer';

const isJsonModeError = (payload: unknown): { isError: boolean; needsSchema: boolean } => {
  if (!payload) {
    return { isError: false, needsSchema: false };
  }

  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);

  // Check if LM Studio requires json_schema format instead of json_object
  const needsJsonSchema = /response[_-]?format.*must be|json_schema.*text/i.test(text);
  const hasJsonModeError = /json mode|unable to parse/i.test(text);

  return {
    isError: needsJsonSchema || hasJsonModeError,
    needsSchema: needsJsonSchema,
  };
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
  schemaType?: SchemaType; // Which schema to use for json_schema mode
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
  jsonFormat?: JsonFormatType; // Which JSON format was successfully used
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
  schemaType,
  signal,
}: ChatCompletionParams): Promise<ChatCompletionResult> => {
  // Helper to build request payload for different JSON formats
  const buildPayload = (jsonFormat: JsonFormatType | null) => {
    let responseFormat = {};

    if (preferJson && jsonFormat) {
      if (jsonFormat === 'json_object') {
        responseFormat = { response_format: { type: 'json_object' } };
      } else if (jsonFormat === 'json_schema' && schemaType) {
        const schema = schemaType === 'topology' ? TOPOLOGY_SCHEMA : ANSWER_SCHEMA;
        responseFormat = {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: `${schemaType}_response`,
              schema,
              strict: true,
            },
          },
        };
      }
    }

    return {
      model: profile.modelId,
      temperature,
      max_tokens: maxTokens,
      messages,
      ...(profile.topP !== undefined && { top_p: profile.topP }),
      ...(profile.frequencyPenalty !== undefined && { frequency_penalty: profile.frequencyPenalty }),
      ...(profile.presencePenalty !== undefined && { presence_penalty: profile.presencePenalty }),
      // Note: reasoning_effort is NOT supported by LM Studio
      ...responseFormat,
    };
  };

  const attempt = async (jsonFormat: JsonFormatType | null) => {
    const payload = buildPayload(jsonFormat);

    return request<RawChatCompletionResponse>({
      path: '/v1/chat/completions',
      method: 'POST',
      body: payload,
      profile,
      signal,
    });
  };

  if (!preferJson) {
    // Plain text mode requested - no JSON formatting
    const result = await attempt(null);

    if (!result.ok) {
      const error = result.data ?? (await result.raw.text());
      throw new Error(`Chat completion failed: ${result.status} - ${JSON.stringify(error)}`);
    }

    return {
      text: extractTextFromResponse(result.data),
      usage: mapUsage(result.data?.usage),
      raw: result.data,
      fallbackUsed: false,
      supportsJsonMode: false,
    };
  }

  // Try JSON mode - first attempt with json_object (OpenAI format)
  let result = await attempt('json_object');

  if (result.ok && result.data) {
    return {
      text: extractTextFromResponse(result.data),
      usage: mapUsage(result.data?.usage),
      raw: result.data,
      fallbackUsed: false,
      supportsJsonMode: true,
      jsonFormat: 'json_object',
    };
  }

  // Check if we need to try json_schema format
  const errorBody = result.data ?? (await result.raw.text());
  const jsonError = isJsonModeError(errorBody);

  if (jsonError.isError && jsonError.needsSchema && schemaType) {
    result = await attempt('json_schema');

    if (result.ok && result.data) {
      return {
        text: extractTextFromResponse(result.data),
        usage: mapUsage(result.data?.usage),
        raw: result.data,
        fallbackUsed: false,
        supportsJsonMode: true,
        jsonFormat: 'json_schema',
      };
    }
  }

  // Both JSON formats failed - throw error (no plain text fallback)
  const finalError = result.data ?? (await result.raw.text());
  const errorMessage = typeof finalError === 'string' ? finalError : JSON.stringify(finalError);

  // Log detailed error information for debugging
  console.error('[JSON MODE ERROR]', {
    status: result.status,
    schemaType,
    preferJson,
    error: errorMessage,
    triedJsonObject: true,
    triedJsonSchema: jsonError.isError && jsonError.needsSchema && schemaType ? true : false,
  });

  throw new Error(
    `JSON mode required but not supported: ${result.status} - ${errorMessage}`
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
