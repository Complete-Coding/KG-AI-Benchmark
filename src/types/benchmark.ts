export type QuestionType = 'MCQ' | 'MSQ' | 'NAT' | 'TRUE_FALSE';

export type RunStatus = 'draft' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type DiagnosticsLevel = 'HANDSHAKE' | 'READINESS';

export type DiagnosticsSeverity = 'info' | 'warn' | 'error';

export interface BenchmarkQuestionOption {
  id: number;
  order: number;
  text: string;
}

export interface NumericAnswerRange {
  min?: number;
  max?: number;
  precision?: number;
}

export type BenchmarkQuestionAnswer =
  | {
      kind: 'single';
      correctOption: number;
    }
  | {
      kind: 'multiple';
      correctOptions: number[];
    }
  | {
      kind: 'numeric';
      range: NumericAnswerRange;
      acceptedAnswers: string[];
      caseSensitive: boolean;
    }
  | {
      kind: 'boolean';
      value: boolean;
    }
  | {
      kind: 'descriptive';
      acceptedAnswers: string[];
      caseSensitive: boolean;
    };

export interface BenchmarkQuestionMetadata {
  status: string;
  hasImages?: boolean;
  createdAt?: string;
  updatedAt?: string;
  tags: string[];
  topology?: {
    subject?: string | null;
    topic?: string | null;
    subtopic?: string | null;
  };
  pyq?: {
    type?: string | null;
    year?: number | null;
    exam?: string | null;
    branch?: string | null;
    paper?: string | null;
  };
}

export interface BenchmarkQuestion {
  id: string;
  questionId: number;
  displayId: string | null;
  type: QuestionType;
  difficulty: string;
  prompt: string;
  instructions?: string;
  options: BenchmarkQuestionOption[];
  answer: BenchmarkQuestionAnswer;
  solution?: string;
  metadata: BenchmarkQuestionMetadata;
}

export interface QuestionDatasetSummary {
  label: string;
  generatedAt: string;
  total: number;
  filters: string[];
  stats: {
    poolSize?: number;
    poolWithoutImages?: number;
    countsByType?: Record<string, number>;
  };
}

export interface QuestionTopologySubtopic {
  name: string;
  canonicalName: string;
}

export interface QuestionTopologyTopic {
  name: string;
  canonicalName: string;
  subtopics: QuestionTopologySubtopic[];
}

export interface QuestionTopologySubject {
  name: string;
  canonicalName: string;
  topics: QuestionTopologyTopic[];
}

export interface QuestionTopology {
  generatedAt?: string;
  subjects: QuestionTopologySubject[];
}

export interface DiagnosticsLogEntry {
  id: string;
  timestamp: string;
  message: string;
  severity: DiagnosticsSeverity;
}

export interface DiagnosticsResult {
  id: string;
  profileId: string;
  level: DiagnosticsLevel;
  startedAt: string;
  completedAt: string;
  status: 'pass' | 'fail';
  summary: string;
  fallbackApplied?: boolean;
  metadata?: DiagnosticsMetadata;
  logs: DiagnosticsLogEntry[];
}

export interface DiagnosticsMetadata {
  supportsJsonMode?: boolean;
  evaluation?: BenchmarkAttemptEvaluation;
  expected?: string;
  questionId?: string;
  error?: string;
  [key: string]: unknown;
}

export interface BenchmarkStepConfig {
  id: string;
  label: string;
  description?: string;
  promptTemplate: string;
  enabled: boolean;
}

export interface ModelProfile {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey?: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  benchmarkSteps: BenchmarkStepConfig[];
  defaultSystemPrompt: string;
  createdAt: string;
  updatedAt: string;
  notes?: string;
  diagnostics: DiagnosticsResult[];
  metadata: {
    supportsJsonMode?: boolean;
    lastHandshakeAt?: string;
    lastReadinessAt?: string;
  };
}

export interface BenchmarkModelResponse {
  answer?: string;
  explanation?: string;
  confidence?: number;
  raw?: unknown;
}

export interface BenchmarkAttemptEvaluation {
  expected: string;
  received: string;
  passed: boolean;
  score: number;
  notes?: string;
  metrics?: {
    confidence?: number;
  };
}

export interface BenchmarkAttempt {
  id: string;
  questionId: string;
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  requestPayload: Record<string, unknown>;
  responsePayload?: unknown;
  responseText: string;
  modelResponse?: BenchmarkModelResponse;
  evaluation: BenchmarkAttemptEvaluation;
  error?: string;
  questionSnapshot: {
    prompt: string;
    type: QuestionType;
    difficulty: string;
    options: BenchmarkQuestionOption[];
    answer: BenchmarkQuestionAnswer;
    solution?: string;
  };
}

export interface BenchmarkRunMetrics {
  accuracy: number;
  averageLatencyMs: number;
  totalLatencyMs: number;
  passedCount: number;
  failedCount: number;
}

export interface BenchmarkRun {
  id: string;
  label: string;
  profileId: string;
  profileName: string;
  profileModelId: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  questionIds: string[];
  dataset: {
    label: string;
    totalQuestions: number;
    filters: string[];
  };
  metrics: BenchmarkRunMetrics;
  attempts: BenchmarkAttempt[];
  notes?: string;
  summary?: string;
}

export type ActiveRunPhase = 'starting' | 'running' | 'completed' | 'failed';

export type ActiveRunQuestionStatus = 'queued' | 'running' | 'passed' | 'failed';

export interface ActiveRunQuestionProgress {
  id: string;
  order: number;
  label: string;
  prompt: string;
  type: QuestionType;
  status: ActiveRunQuestionStatus;
  latencyMs?: number;
  attemptId?: string;
  notes?: string;
}

export interface ActiveRunState {
  runId: string;
  label: string;
  profileName: string;
  profileModelId: string;
  datasetLabel: string;
  filters: string[];
  totalQuestions: number;
  status: ActiveRunPhase;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  currentQuestionId?: string;
  metrics: BenchmarkRunMetrics;
  questions: ActiveRunQuestionProgress[];
  summary?: string;
  error?: string;
}

export interface ActiveRunStartPayload {
  runId: string;
  label: string;
  profileName: string;
  profileModelId: string;
  datasetLabel: string;
  filters: string[];
  questions: Array<{
    id: string;
    order: number;
    label: string;
    prompt: string;
    type: QuestionType;
  }>;
  startedAt: string;
}

export interface ActiveRunQuestionStartPayload {
  runId: string;
  questionId: string;
  timestamp: string;
}

export interface ActiveRunAttemptPayload {
  runId: string;
  questionId: string;
  attemptId: string;
  passed: boolean;
  latencyMs: number;
  metrics: BenchmarkRunMetrics;
  notes?: string;
  timestamp: string;
}

export interface ActiveRunCompletePayload {
  runId: string;
  status: 'completed' | 'failed';
  summary: string;
  metrics: BenchmarkRunMetrics;
  completedAt: string;
  error?: string;
}

export interface DashboardRunSummary {
  runId: string;
  label: string;
  profileName: string;
  profileModelId: string;
  completedAt: string;
  accuracy: number;
  averageLatencyMs: number;
}

export interface DashboardOverview {
  totalRuns: number;
  activeRuns: number;
  averageAccuracy: number;
  averageLatencyMs: number;
  lastUpdated?: string;
  latestRuns: DashboardRunSummary[];
  accuracyTrend: { timestamp: string; accuracy: number; runId: string }[];
  latencyTrend: { timestamp: string; latencyMs: number; runId: string }[];
}

export type ModelCapability =
  | 'tool_use'
  | 'vision'
  | 'embeddings'
  | 'audio'
  | 'function_calling'
  | string;

export interface DiscoveredModel {
  id: string;
  /** Friendly label or alias reported by LM Studio */
  displayName?: string;
  /** Model type (llm, vlm, embeddings, etc.) */
  kind?: string;
  /** Current load state (loaded, unloaded, etc.) */
  state?: string;
  /** Maximum supported context length (tokens) */
  maxContextLength?: number;
  /** Quantization descriptor such as Q4_K_M */
  quantization?: string | null;
  /** Optional filesystem source or archive name */
  source?: string | null;
  /** Capabilities advertised by the runtime */
  capabilities: ModelCapability[];
  /** Whether the runtime reports the model as loaded */
  loaded?: boolean;
  /** Origin information for the discovery request */
  origin?: {
    baseUrl: string;
    endpoint: string;
  };
  /** Raw metadata payload for future use/debugging */
  metadata?: Record<string, unknown>;
}

export type ModelDiscoveryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelDiscoveryState {
  status: ModelDiscoveryStatus;
  models: DiscoveredModel[];
  lastFetchedAt?: string;
  error?: string;
}
