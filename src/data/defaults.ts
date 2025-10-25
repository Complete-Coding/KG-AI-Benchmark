import { BenchmarkRunMetrics, BenchmarkStepConfig } from '@/types/benchmark';

export const defaultBenchmarkSteps: BenchmarkStepConfig[] = [
  {
    id: 'topology',
    label: 'Topology classification',
    description:
      'Identify the subject, topic, and subtopic covered by the question before attempting an answer.',
    promptTemplate:
      'Classify this question using the LOOKUP IDs from the taxonomy catalog below.\n\n' +
      'COMPLETE TAXONOMY CATALOG with IDs:\n\n' +
      '{{topologyCatalog}}\n\n' +
      'CRITICAL INSTRUCTIONS:\n' +
      '1. You MUST return the exact ID from the catalog above\n' +
      '2. IDs are the alphanumeric codes shown before the parentheses (e.g., "68d24e621c69bbb6f527dabb")\n' +
      '3. DO NOT create or modify IDs - only pick from the list\n' +
      '4. The name in parentheses is for reference only - return the ID, not the name\n' +
      '5. Return null for subtopicId if no subtopic applies\n\n' +
      'Return JSON using this exact schema:\n' +
      '{\n' +
      '  "subjectId": "68d24e621c69bbb6f527dabb",  // MUST be exact ID from catalog\n' +
      '  "topicId": "68d24e71b905a26b8ed99dd0",    // MUST be exact ID from catalog\n' +
      '  "subtopicId": "68d24ec31c69bbb6f528892b", // MUST be exact ID from catalog or null\n' +
      '  "confidence": 0.95  // optional, 0-1\n' +
      '}\n\n' +
      'EXAMPLE: For a question about "Context Free Grammar Basics" in "Theory of Computation":\n' +
      '{"subjectId":"68da25c631f60703d614bb62","topicId":"68da276031f60703d6189479","subtopicId":"68da29105e8ee4416b691e20","confidence":0.95}',
    enabled: true,
  },
  {
    id: 'answer',
    label: 'Final answer',
    description:
      'Produce the final answer in the required format after completing your reasoning.',
    promptTemplate:
      'Using all available context (including prior step outputs: {{previousStepOutputs}}), provide the final answer. Respect the answer format requested in the prompt. Respond using JSON with fields `answer`, `explanation`, and `confidence` (0-1).',
    enabled: true,
  },
];

export const defaultSystemPrompt = `You are an evaluation assistant for competitive exam benchmarks. 
You must always return valid JSON that adheres to this schema:
{
  "answer": string,
  "explanation": string,
  "confidence": number (0 to 1)
}

Guidelines:
- Read the user question and available options (if any) carefully.
- Think step-by-step, then provide a concise final explanation.
- If you cannot determine the answer, respond with "answer": "UNKNOWN" and explain why.
- Do not output any text before or after the JSON object.
- When requested to respond without JSON mode, still keep the JSON object as plain text.`;

export const createEmptyRunMetrics = (): BenchmarkRunMetrics => ({
  accuracy: 0,
  averageLatencyMs: 0,
  totalLatencyMs: 0,
  passedCount: 0,
  failedCount: 0,
  topologyAccuracy: 0,
  topologyPassedCount: 0,
  topologyFailedCount: 0,
});

/**
 * Default values for LM Studio profile parameters.
 * These are used as intelligent defaults when creating a new profile.
 */
export const DEFAULT_PROFILE_VALUES = {
  /** Profile name */
  name: 'New Profile',

  /** Provider name (typically "LM Studio" for local models) */
  provider: 'LM Studio',

  /** Base URL for the LM Studio server */
  baseUrl: 'http://localhost:1234',

  /** API key (optional for LM Studio) */
  apiKey: '',

  /** Model identifier (e.g., "openai/gpt-oss-120b") */
  modelId: '',

  /**
   * Temperature controls randomness in responses.
   * Lower values (0.0-0.3) = more focused and deterministic
   * Higher values (0.7-2.0) = more creative and varied
   */
  temperature: 0.2,

  /**
   * Maximum number of tokens in the model's response.
   * Set to 4096 to allow for detailed explanations in benchmark responses.
   * This will be auto-adjusted based on model's max context length when
   * adopting from LM Studio discovery.
   */
  maxOutputTokens: 4096,

  /** Request timeout in milliseconds (2 minutes default) */
  requestTimeoutMs: 120000,

  /**
   * Top P (nucleus sampling) controls response diversity.
   * Only tokens with cumulative probability <= topP are considered.
   * Range: 0.0-1.0, where 1.0 considers all tokens.
   */
  topP: 0.9,

  /**
   * Frequency penalty reduces repetition of individual tokens.
   * Higher values discourage the model from repeating the same words.
   * Range: 0.0-2.0, where 0.0 = no penalty.
   */
  frequencyPenalty: 0.0,

  /**
   * Presence penalty reduces repetition of topics.
   * Higher values encourage the model to talk about new topics.
   * Range: 0.0-2.0, where 0.0 = no penalty.
   */
  presencePenalty: 0.0,

  /** Default system prompt for benchmark evaluations */
  defaultSystemPrompt,

  /** Optional notes about the profile */
  notes: '',

  /** Benchmark step configurations */
  benchmarkSteps: defaultBenchmarkSteps,
} as const;
