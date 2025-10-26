import { BenchmarkRunMetrics, BenchmarkStepConfig } from '@/types/benchmark';

export const defaultBenchmarkSteps: BenchmarkStepConfig[] = [
  {
    id: 'topology-subject',
    label: 'Topology – Subject',
    description:
      'Identify the most relevant subject for the question before drilling into topics.',
    promptTemplate:
      'Identify the best matching SUBJECT for the question described below.\n\n' +
      'SUBJECT CATALOG:\n{{subjectCatalog}}\n\n' +
      'Rules:\n' +
      '1. Select the subjectId EXACTLY as it appears in the catalog (copy/paste the ID).\n' +
      '2. Always return your best guess even if confidence is low; never invent new IDs or return the string "null".\n' +
      '3. Set `confidence` between 0 and 1 to reflect certainty (e.g., 0.2 means low confidence).\n\n' +
      'Return JSON:\n' +
      '{\n' +
      '  "subjectId": "68d24e621c69bbb6f527dabb",\n' +
      '  "confidence": 0.75\n' +
      '}\n\n' +
      '{{questionContext}}',
    enabled: true,
  },
  {
    id: 'topology-topic',
    label: 'Topology – Topic',
    description:
      'Within the predicted subject, choose the most relevant topic for the question.',
    promptTemplate:
      'We have tentatively identified the subject as {{selectedSubject}}.\n' +
      'Use the topic catalog below (scoped to that subject) to choose the best TOPIC for this question.\n\n' +
      '{{topicGuidance}}\n' +
      'TOPIC CATALOG:\n{{topicCatalog}}\n\n' +
      'Rules:\n' +
      '1. Return the exact topicId from the catalog (no new IDs, no "null").\n' +
      '2. If the subject seems incorrect, pick the topic that best fits the question and note the low confidence.\n' +
      '3. Provide `confidence` between 0 and 1 reflecting certainty.\n\n' +
      'Return JSON:\n' +
      '{\n' +
      '  "topicId": "68d24e71b905a26b8ed99dd0",\n' +
      '  "confidence": 0.6\n' +
      '}\n\n' +
      '{{questionContext}}',
    enabled: true,
  },
  {
    id: 'topology-subtopic',
    label: 'Topology – Subtopic',
    description:
      'Select the precise subtopic given the chosen subject and topic.',
    promptTemplate:
      'Working within subject {{selectedSubject}} and topic {{selectedTopic}}, choose the most appropriate SUBTOPIC from the catalog below.\n\n' +
      '{{subtopicGuidance}}\n' +
      'SUBTOPIC CATALOG:\n{{subtopicCatalog}}\n\n' +
      'Rules:\n' +
      '1. Return the exact subtopicId listed (no new IDs, no "null").\n' +
      '2. Always provide your best guess; use a low confidence score if uncertain.\n' +
      '3. Confidence must be between 0 and 1.\n\n' +
      'Return JSON:\n' +
      '{\n' +
      '  "subtopicId": "68d24ec31c69bbb6f528892b",\n' +
      '  "confidence": 0.55\n' +
      '}\n\n' +
      '{{questionContext}}',
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
  topologySubjectAccuracy: 0,
  topologySubjectPassedCount: 0,
  topologySubjectFailedCount: 0,
  topologyTopicAccuracy: 0,
  topologyTopicPassedCount: 0,
  topologyTopicFailedCount: 0,
  topologySubtopicAccuracy: 0,
  topologySubtopicPassedCount: 0,
  topologySubtopicFailedCount: 0,
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
