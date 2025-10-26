import {
  BenchmarkRunMetrics,
  BenchmarkStepConfig,
  ModelBinding,
  ProfilePipelineStep,
} from '@/types/benchmark';
import createId from '@/utils/createId';

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
export const DEFAULT_TEXT_BINDING_ID = 'text-main';
export const DEFAULT_VISION_BINDING_ID = 'vision-main';

export const createDefaultTextBinding = (): ModelBinding => ({
  id: DEFAULT_TEXT_BINDING_ID,
  name: 'Text model',
  capability: 'text-to-text',
  transport: 'lmstudio',
  baseUrl: 'http://localhost:1234',
  apiKey: '',
  modelId: '',
  temperature: 0.2,
  maxOutputTokens: 4096,
  requestTimeoutMs: 120000,
  topP: 0.9,
  frequencyPenalty: 0,
  presencePenalty: 0,
  defaultSystemPrompt,
  metadata: {
    supportsJsonMode: true,
  },
});

export const createDefaultVisionBinding = (): ModelBinding => ({
  id: DEFAULT_VISION_BINDING_ID,
  name: 'Vision model',
  capability: 'image-to-text',
  transport: 'lmstudio',
  baseUrl: 'http://localhost:1234',
  apiKey: '',
  modelId: '',
  temperature: 0,
  maxOutputTokens: 2048,
  requestTimeoutMs: 180000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  defaultSystemPrompt: 'You are a meticulous OCR assistant. Extract readable text from images and keep formatting minimal.',
  metadata: {
    supportsJsonMode: false,
  },
});

const DEFAULT_TEXT_BINDING_TEMPLATE = createDefaultTextBinding();
const DEFAULT_VISION_BINDING_TEMPLATE = createDefaultVisionBinding();

export const createDefaultDeepSeekVisionBinding = (): ModelBinding => ({
  id: `vision-deepseek-${createId()}`,
  name: 'DeepSeek OCR (future)',
  capability: 'image-to-text',
  transport: 'openai-compatible',
  baseUrl: 'http://localhost:11434',
  apiKey: '',
  modelId: 'DeepSeek-OCR',
  temperature: 0,
  maxOutputTokens: 1024,
  requestTimeoutMs: 180000,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  defaultSystemPrompt:
    'You are DeepSeek-OCR. Extract text faithfully from the provided image. Return concise text (no hallucinations).',
  metadata: {
    supportsJsonMode: false,
  },
  notes:
    'Placeholder configuration until a macOS/GGUF build is available. Replace baseUrl/modelId with the deployed endpoint and enable compression if supported.',
});

export const DEFAULT_PROFILE_PIPELINE: ProfilePipelineStep[] = [
  {
    id: 'image-preprocess',
    label: 'Image preprocessing',
    capability: 'image-to-text',
    bindingId: DEFAULT_VISION_BINDING_ID,
    enabled: true,
  },
  {
    id: 'text-main',
    label: 'Text reasoning',
    capability: 'text-to-text',
    bindingId: DEFAULT_TEXT_BINDING_ID,
    enabled: true,
  },
];

export const DEFAULT_PROFILE_VALUES = {
  name: 'New Profile',
  description: '',
  notes: '',
  bindings: [DEFAULT_VISION_BINDING_TEMPLATE, DEFAULT_TEXT_BINDING_TEMPLATE],
  pipeline: DEFAULT_PROFILE_PIPELINE,
  benchmarkSteps: defaultBenchmarkSteps,
  // Compatibility fields used by legacy code paths
  provider: 'LM Studio',
  baseUrl: DEFAULT_TEXT_BINDING_TEMPLATE.baseUrl,
  apiKey: DEFAULT_TEXT_BINDING_TEMPLATE.apiKey ?? '',
  modelId: DEFAULT_TEXT_BINDING_TEMPLATE.modelId,
  temperature: DEFAULT_TEXT_BINDING_TEMPLATE.temperature,
  maxOutputTokens: DEFAULT_TEXT_BINDING_TEMPLATE.maxOutputTokens,
  requestTimeoutMs: DEFAULT_TEXT_BINDING_TEMPLATE.requestTimeoutMs,
  topP: DEFAULT_TEXT_BINDING_TEMPLATE.topP ?? 0.9,
  frequencyPenalty: DEFAULT_TEXT_BINDING_TEMPLATE.frequencyPenalty ?? 0,
  presencePenalty: DEFAULT_TEXT_BINDING_TEMPLATE.presencePenalty ?? 0,
  defaultSystemPrompt: DEFAULT_TEXT_BINDING_TEMPLATE.defaultSystemPrompt,
} as const;
