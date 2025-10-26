import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
} from 'react';
import {
  ActiveRunAttemptPayload,
  ActiveRunCompletePayload,
  ActiveRunQuestionStatus,
  ActiveRunQuestionStartPayload,
  ActiveRunStartPayload,
  ActiveRunState,
  BenchmarkAttempt,
  BenchmarkRunQueue,
  BenchmarkStepConfig,
  BenchmarkQuestion,
  BenchmarkRun,
  BenchmarkRunMetrics,
  CompatibilityCheckResult,
  DashboardOverview,
  DiagnosticsResult,
  DiscoveredModel,
  ModelDiscoveryState,
  ModelProfile,
  QuestionDatasetSummary,
  QuestionTopologySubject,
} from '@/types/benchmark';
import { questionDataset, questionDatasetSummary } from '@/data/questions';
import { questionTopology, questionTopologyGeneratedAt } from '@/data/topology';
import {
  defaultBenchmarkSteps,
  defaultSystemPrompt,
  createEmptyRunMetrics,
  DEFAULT_PROFILE_VALUES,
} from '@/data/defaults';
import {
  deleteProfileRecord,
  deleteRunRecord,
  loadProfiles,
  loadRuns,
  upsertProfileRecord,
  upsertRunRecord,
} from '@/services/storage';
import { discoverLmStudioModels, mergeDiscoveryResults } from '@/services/lmStudioDiscovery';
import createId from '@/utils/createId';

interface BenchmarkState {
  initialized: boolean;
  loading: boolean;
  profiles: ModelProfile[];
  runs: BenchmarkRun[];
  discovery: ModelDiscoveryState;
  activeRun: ActiveRunState | null;
  runQueue: BenchmarkRunQueue;
}

const initialState: BenchmarkState = {
  initialized: false,
  loading: true,
  profiles: [],
  runs: [],
  discovery: {
    status: 'idle',
    models: [],
  },
  activeRun: null,
  runQueue: {
    currentRunId: null,
    queuedRunIds: [],
  },
};

type Action =
  | { type: 'INITIALIZE'; payload: { profiles: ModelProfile[]; runs: BenchmarkRun[] } }
  | { type: 'UPSERT_PROFILE'; payload: ModelProfile }
  | { type: 'DELETE_PROFILE'; payload: string }
  | { type: 'UPSERT_RUN'; payload: BenchmarkRun }
  | { type: 'DELETE_RUN'; payload: string }
  | { type: 'RECORD_DIAGNOSTIC'; payload: DiagnosticsResult }
  | { type: 'RECORD_COMPATIBILITY_CHECK'; payload: { profileId: string; result: CompatibilityCheckResult } }
  | { type: 'ACTIVE_RUN_INITIALIZE'; payload: ActiveRunStartPayload }
  | { type: 'ACTIVE_RUN_SET_CURRENT'; payload: ActiveRunQuestionStartPayload }
  | { type: 'ACTIVE_RUN_RECORD_ATTEMPT'; payload: ActiveRunAttemptPayload }
  | { type: 'ACTIVE_RUN_COMPLETE'; payload: ActiveRunCompletePayload }
  | { type: 'ACTIVE_RUN_CLEAR' }
  | { type: 'DISCOVERY_REQUEST' }
  | { type: 'DISCOVERY_SUCCESS'; payload: { models: DiscoveredModel[]; fetchedAt: string } }
  | { type: 'DISCOVERY_FAILURE'; payload: { error: string; fetchedAt?: string } }
  | { type: 'QUEUE_SET_CURRENT'; payload: string | null }
  | { type: 'QUEUE_ADD'; payload: string }
  | { type: 'QUEUE_ADD_BATCH'; payload: string[] }
  | { type: 'QUEUE_REMOVE'; payload: string }
  | { type: 'QUEUE_START_NEXT' };

const defaultStepById = new Map(defaultBenchmarkSteps.map((step) => [step.id, step]));

interface DiscoveryTarget {
  baseUrl: string;
  apiKey?: string;
  requestTimeoutMs: number;
}

const clampTimeout = (value?: number) => {
  const fallback = DEFAULT_PROFILE_VALUES.requestTimeoutMs;
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(numeric, 3000), 20000);
};

const resolveDiscoveryTargets = (profiles: ModelProfile[]): DiscoveryTarget[] => {
  const targets = new Map<string, DiscoveryTarget>();

  profiles.forEach((profile) => {
    const baseUrl = profile.baseUrl?.trim();
    if (!baseUrl) {
      return;
    }

    if (!targets.has(baseUrl)) {
      targets.set(baseUrl, {
        baseUrl,
        apiKey: profile.apiKey,
        requestTimeoutMs: clampTimeout(profile.requestTimeoutMs),
      });
    }
  });

  if (targets.size === 0) {
    const fallbackUrl = DEFAULT_PROFILE_VALUES.baseUrl;
    targets.set(fallbackUrl, {
      baseUrl: fallbackUrl,
      apiKey: DEFAULT_PROFILE_VALUES.apiKey || undefined,
      requestTimeoutMs: clampTimeout(DEFAULT_PROFILE_VALUES.requestTimeoutMs),
    });
  }

  return Array.from(targets.values());
};

const normalizeProfile = (profile: Partial<ModelProfile>, existing?: ModelProfile): ModelProfile => {
  const now = new Date().toISOString();
  const topologyDefaults = defaultStepById.get('topology');
  const answerDefaults = defaultStepById.get('answer');

  const adjustLegacyStep = (step: Partial<BenchmarkStepConfig>, index: number) => {
    if (step.id === 'analysis') {
      return {
        ...step,
        id: 'topology',
        label: step.label ?? topologyDefaults?.label ?? 'Topology classification',
        description: topologyDefaults?.description,
        promptTemplate: topologyDefaults?.promptTemplate,
      };
    }

    if (step.id === 'answer') {
      return {
        ...answerDefaults,
        ...step,
        id: 'answer',
        label: step.label ?? answerDefaults?.label ?? 'Final answer',
        promptTemplate: step.promptTemplate ?? answerDefaults?.promptTemplate,
      };
    }

    if (!step.id) {
      const fallback = defaultBenchmarkSteps[index];
      return {
        ...step,
        id: fallback?.id ?? `step-${index}`,
        label: step.label ?? fallback?.label ?? `Step ${index + 1}`,
        promptTemplate: step.promptTemplate ?? fallback?.promptTemplate ?? '',
        description: step.description ?? fallback?.description,
      };
    }

    return step;
  };

  const normalizedSteps = (): BenchmarkStepConfig[] | undefined => {
    const incomingSteps = profile.benchmarkSteps ?? existing?.benchmarkSteps;

    // If no steps provided, return undefined to use defaults dynamically
    if (!incomingSteps || incomingSteps.length === 0) {
      return undefined;
    }

    // Normalize the incoming steps
    const normalized = incomingSteps.map((step, index) => {
      const legacyAdjusted = adjustLegacyStep(step, index);
      const fallback =
        (legacyAdjusted.id ? defaultStepById.get(legacyAdjusted.id) : undefined) ??
        defaultBenchmarkSteps[index];

      return {
        id: legacyAdjusted.id ?? fallback?.id ?? `step-${index}`,
        label: legacyAdjusted.label ?? fallback?.label ?? `Step ${index + 1}`,
        description: legacyAdjusted.description ?? fallback?.description,
        promptTemplate: legacyAdjusted.promptTemplate ?? fallback?.promptTemplate ?? '',
        enabled: legacyAdjusted.enabled ?? fallback?.enabled ?? true,
      };
    });

    // Check if normalized steps are identical to defaults (meaning no customization)
    const isIdenticalToDefaults =
      normalized.length === defaultBenchmarkSteps.length &&
      normalized.every((step, index) => {
        const defaultStep = defaultBenchmarkSteps[index];
        return (
          step.id === defaultStep.id &&
          step.label === defaultStep.label &&
          step.description === defaultStep.description &&
          step.promptTemplate === defaultStep.promptTemplate &&
          step.enabled === defaultStep.enabled
        );
      });

    // If identical to defaults, return undefined to use defaults dynamically
    if (isIdenticalToDefaults) {
      return undefined;
    }

    // Otherwise, return the customized steps
    return normalized;
  };

  const diagnostics = profile.diagnostics ?? existing?.diagnostics ?? [];
  const metadata = {
    supportsJsonMode:
      profile.metadata?.supportsJsonMode ?? existing?.metadata?.supportsJsonMode ?? undefined,
    lastHandshakeAt:
      profile.metadata?.lastHandshakeAt ?? existing?.metadata?.lastHandshakeAt ?? undefined,
    lastReadinessAt:
      profile.metadata?.lastReadinessAt ?? existing?.metadata?.lastReadinessAt ?? undefined,
    compatibilityStatus:
      profile.metadata?.compatibilityStatus ?? existing?.metadata?.compatibilityStatus ?? undefined,
    jsonFormat:
      profile.metadata?.jsonFormat ?? existing?.metadata?.jsonFormat ?? undefined,
    lastCompatibilityCheckAt:
      profile.metadata?.lastCompatibilityCheckAt ?? existing?.metadata?.lastCompatibilityCheckAt ?? undefined,
    compatibilitySummary:
      profile.metadata?.compatibilitySummary ?? existing?.metadata?.compatibilitySummary ?? undefined,
  };

  return {
    id: profile.id ?? existing?.id ?? createId(),
    name: profile.name ?? existing?.name ?? 'Untitled profile',
    provider: profile.provider ?? existing?.provider ?? 'LM Studio',
    baseUrl: profile.baseUrl ?? existing?.baseUrl ?? 'http://localhost:1234',
    apiKey: profile.apiKey ?? existing?.apiKey,
    modelId: profile.modelId ?? existing?.modelId ?? '',
    temperature: profile.temperature ?? existing?.temperature ?? 0,
    maxOutputTokens: profile.maxOutputTokens ?? existing?.maxOutputTokens ?? 1024,
    requestTimeoutMs: profile.requestTimeoutMs ?? existing?.requestTimeoutMs ?? 120000,
    benchmarkSteps: normalizedSteps(),
    defaultSystemPrompt:
      profile.defaultSystemPrompt ?? existing?.defaultSystemPrompt ?? defaultSystemPrompt,
    createdAt: existing?.createdAt ?? profile.createdAt ?? now,
    updatedAt: profile.updatedAt ?? now,
    notes: profile.notes ?? existing?.notes,
    diagnostics,
    metadata,
  };
};

const normalizeRun = (run: Partial<BenchmarkRun>, existing?: BenchmarkRun): BenchmarkRun => {
  const now = new Date().toISOString();
  const baseDataset = existing?.dataset ?? {
    label: questionDatasetSummary.label,
    totalQuestions: questionDatasetSummary.total,
    filters: questionDatasetSummary.filters,
  };
  const normalizeAttempts = (attempts?: BenchmarkAttempt[]): BenchmarkAttempt[] =>
    (attempts ?? []).map((attempt) => {
      const candidate = attempt as BenchmarkAttempt & {
        steps?: BenchmarkAttempt['steps'];
      };

      return {
        ...candidate,
        steps: Array.isArray(candidate.steps) ? candidate.steps : [],
      };
    });
  const sourceMetrics = run.metrics ?? existing?.metrics;
  const normalizedMetrics: BenchmarkRunMetrics = sourceMetrics
    ? {
        ...createEmptyRunMetrics(),
        ...sourceMetrics,
      }
    : createEmptyRunMetrics();

  return {
    id: run.id ?? existing?.id ?? createId(),
    label: run.label ?? existing?.label ?? `Run ${now}`,
    profileId: run.profileId ?? existing?.profileId ?? '',
    profileName: run.profileName ?? existing?.profileName ?? 'Unknown profile',
    profileModelId: run.profileModelId ?? existing?.profileModelId ?? '',
    status: run.status ?? existing?.status ?? 'draft',
    createdAt: run.createdAt ?? existing?.createdAt ?? now,
    startedAt: run.startedAt ?? existing?.startedAt,
    completedAt: run.completedAt ?? existing?.completedAt,
    durationMs: run.durationMs ?? existing?.durationMs,
    questionIds: run.questionIds ?? existing?.questionIds ?? [],
    dataset: {
      label: run.dataset?.label ?? baseDataset.label,
      totalQuestions: run.dataset?.totalQuestions ?? baseDataset.totalQuestions,
      filters: run.dataset?.filters ?? baseDataset.filters,
    },
    metrics: normalizedMetrics,
    attempts: normalizeAttempts(run.attempts ?? existing?.attempts),
    notes: run.notes ?? existing?.notes,
    summary: run.summary ?? existing?.summary,
  };
};

const computeDashboardOverview = (runs: BenchmarkRun[]): DashboardOverview => {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      activeRuns: 0,
      averageAccuracy: 0,
      averageTopologyAccuracy: 0,
      averageLatencyMs: 0,
      latestRuns: [],
      accuracyTrend: [],
      topologyAccuracyTrend: [],
      latencyTrend: [],
    };
  }

  const completedRuns = runs.filter((run) => run.status === 'completed');
  const activeRuns = runs.filter((run) => run.status === 'running' || run.status === 'queued');

  const averageAccuracy =
    completedRuns.reduce((acc, run) => acc + run.metrics.accuracy, 0) /
    (completedRuns.length || 1);

  const averageTopologyAccuracy =
    completedRuns.reduce((acc, run) => acc + run.metrics.topologyAccuracy, 0) /
    (completedRuns.length || 1);

  const averageLatency =
    completedRuns.reduce((acc, run) => acc + run.metrics.averageLatencyMs, 0) /
    (completedRuns.length || 1);

  const sortedCompleted = [...completedRuns].sort((a, b) => {
    const aTime = a.completedAt ?? a.createdAt;
    const bTime = b.completedAt ?? b.createdAt;
    return bTime.localeCompare(aTime);
  });

  const latestRuns = sortedCompleted.slice(0, 5).map((run) => ({
    runId: run.id,
    label: run.label,
    profileName: run.profileName,
    profileModelId: run.profileModelId,
    completedAt: run.completedAt ?? run.createdAt,
    accuracy: run.metrics.accuracy,
    averageLatencyMs: run.metrics.averageLatencyMs,
  }));

  const chronological = [...completedRuns].sort((a, b) => {
    const aTime = a.completedAt ?? a.createdAt;
    const bTime = b.completedAt ?? b.createdAt;
    return aTime.localeCompare(bTime);
  });

  const accuracyTrend = chronological.map((run) => ({
    timestamp: run.completedAt ?? run.createdAt,
    accuracy: run.metrics.accuracy,
    runId: run.id,
  }));

  const topologyAccuracyTrend = chronological.map((run) => ({
    timestamp: run.completedAt ?? run.createdAt,
    topologyAccuracy: run.metrics.topologyAccuracy,
    runId: run.id,
  }));

  const latencyTrend = chronological.map((run) => ({
    timestamp: run.completedAt ?? run.createdAt,
    latencyMs: run.metrics.averageLatencyMs,
    runId: run.id,
  }));

  const lastUpdated = latestRuns[0]?.completedAt;

  return {
    totalRuns: runs.length,
    activeRuns: activeRuns.length,
    averageAccuracy,
    averageTopologyAccuracy,
    averageLatencyMs: averageLatency,
    latestRuns,
    accuracyTrend,
    topologyAccuracyTrend,
    latencyTrend,
    lastUpdated,
  };
};

const buildActiveRunState = (payload: ActiveRunStartPayload): ActiveRunState => {
  const metrics = createEmptyRunMetrics();

  return {
    runId: payload.runId,
    label: payload.label,
    profileName: payload.profileName,
    profileModelId: payload.profileModelId,
    datasetLabel: payload.datasetLabel,
    filters: payload.filters,
    totalQuestions: payload.questions.length,
    status: 'starting',
    startedAt: payload.startedAt,
    updatedAt: payload.startedAt,
    metrics,
    questions: payload.questions.map((question) => ({
      id: question.id,
      order: question.order,
      label: question.label,
      prompt: question.prompt,
      type: question.type,
      status: 'queued' as ActiveRunQuestionStatus,
    })),
  };
};

const reducer = (state: BenchmarkState, action: Action): BenchmarkState => {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        initialized: true,
        loading: false,
        profiles: action.payload.profiles,
        runs: action.payload.runs,
        discovery: state.discovery,
        activeRun: state.activeRun,
        runQueue: state.runQueue,
      };
    case 'UPSERT_PROFILE': {
      const index = state.profiles.findIndex((profile) => profile.id === action.payload.id);
      const profiles = [...state.profiles];

      if (index >= 0) {
        profiles[index] = action.payload;
      } else {
        profiles.push(action.payload);
      }

      return {
        ...state,
        profiles,
      };
    }
    case 'DELETE_PROFILE': {
      return {
        ...state,
        profiles: state.profiles.filter((profile) => profile.id !== action.payload),
      };
    }
    case 'UPSERT_RUN': {
      const index = state.runs.findIndex((run) => run.id === action.payload.id);
      const runs = [...state.runs];

      if (index >= 0) {
        runs[index] = action.payload;
      } else {
        runs.push(action.payload);
      }

      return {
        ...state,
        runs,
      };
    }
    case 'DELETE_RUN':
      return {
        ...state,
        runs: state.runs.filter((run) => run.id !== action.payload),
      };
    case 'RECORD_DIAGNOSTIC': {
      const profiles = state.profiles.map((profile) => {
        if (profile.id !== action.payload.profileId) {
          return profile;
        }

        const history = [...profile.diagnostics.filter((item) => item.id !== action.payload.id)];
        history.push(action.payload);

        const metadata = { ...profile.metadata };

        if (action.payload.status === 'pass') {
          if (action.payload.level === 'HANDSHAKE') {
            metadata.lastHandshakeAt = action.payload.completedAt;
          }
          if (action.payload.level === 'READINESS') {
            metadata.lastReadinessAt = action.payload.completedAt;
          }
        }

        if (typeof action.payload.metadata?.supportsJsonMode === 'boolean') {
          metadata.supportsJsonMode = action.payload.metadata.supportsJsonMode;
        }

        return {
          ...profile,
          diagnostics: history.sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
          metadata,
          updatedAt: action.payload.completedAt ?? profile.updatedAt,
        };
      });

      return {
        ...state,
        profiles,
      };
    }
    case 'RECORD_COMPATIBILITY_CHECK': {
      const profiles = state.profiles.map((profile) => {
        if (profile.id !== action.payload.profileId) {
          return profile;
        }

        const result = action.payload.result;
        const metadata = { ...profile.metadata };

        // Update compatibility status
        metadata.compatibilityStatus = result.compatible ? 'compatible' : 'incompatible';
        metadata.jsonFormat = result.jsonFormat ?? 'none';
        metadata.lastCompatibilityCheckAt = result.completedAt;
        metadata.compatibilitySummary = result.summary;

        // Also update supportsJsonMode for backwards compatibility
        metadata.supportsJsonMode = result.compatible && (result.jsonFormat === 'json_object' || result.jsonFormat === 'json_schema');

        return {
          ...profile,
          metadata,
          updatedAt: result.completedAt,
        };
      });

      return {
        ...state,
        profiles,
      };
    }
    case 'ACTIVE_RUN_INITIALIZE':
      return {
        ...state,
        activeRun: buildActiveRunState(action.payload),
      };
    case 'ACTIVE_RUN_SET_CURRENT': {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.runId !== action.payload.runId) {
        return state;
      }

      const questions = activeRun.questions.map((question) => {
        if (question.id === action.payload.questionId) {
          const status: ActiveRunQuestionStatus =
            question.status === 'passed' || question.status === 'failed'
              ? question.status
              : 'running';
          return {
            ...question,
            status,
          };
        }

        if (question.status === 'running') {
          return {
            ...question,
            status: 'queued' as ActiveRunQuestionStatus,
          };
        }

        return question;
      });

      return {
        ...state,
        activeRun: {
          ...activeRun,
          status: activeRun.status === 'starting' ? 'running' : activeRun.status,
          currentQuestionId: action.payload.questionId,
          updatedAt: action.payload.timestamp,
          questions,
        },
      };
    }
    case 'ACTIVE_RUN_RECORD_ATTEMPT': {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.runId !== action.payload.runId) {
        return state;
      }

      const questions = activeRun.questions.map((question) => {
        if (question.id !== action.payload.questionId) {
          return question;
        }

        return {
          ...question,
          status: (action.payload.passed ? 'passed' : 'failed') as ActiveRunQuestionStatus,
          latencyMs: action.payload.latencyMs,
          attemptId: action.payload.attemptId,
          notes: action.payload.notes,
        };
      });

      return {
        ...state,
        activeRun: {
          ...activeRun,
          status: activeRun.status === 'starting' ? 'running' : activeRun.status,
          questions,
          metrics: action.payload.metrics,
          currentQuestionId:
            activeRun.currentQuestionId === action.payload.questionId
              ? undefined
              : activeRun.currentQuestionId,
          updatedAt: action.payload.timestamp,
        },
      };
    }
    case 'ACTIVE_RUN_COMPLETE': {
      const activeRun = state.activeRun;
      if (!activeRun || activeRun.runId !== action.payload.runId) {
        return state;
      }

      return {
        ...state,
        activeRun: {
          ...activeRun,
          status: action.payload.status,
          summary: action.payload.summary,
          metrics: action.payload.metrics,
          completedAt: action.payload.completedAt,
          updatedAt: action.payload.completedAt,
          currentQuestionId: undefined,
          error: action.payload.error,
        },
      };
    }
    case 'ACTIVE_RUN_CLEAR':
      return {
        ...state,
        activeRun: null,
      };
    case 'DISCOVERY_REQUEST':
      return {
        ...state,
        discovery: {
          ...state.discovery,
          status: 'loading',
          error: undefined,
        },
      };
    case 'DISCOVERY_SUCCESS':
      return {
        ...state,
        discovery: {
          status: 'ready',
          models: action.payload.models,
          lastFetchedAt: action.payload.fetchedAt,
          error: undefined,
        },
      };
    case 'DISCOVERY_FAILURE':
      return {
        ...state,
        discovery: {
          ...state.discovery,
          status: 'error',
          error: action.payload.error,
          lastFetchedAt: action.payload.fetchedAt ?? state.discovery.lastFetchedAt,
          models: state.discovery.models,
        },
      };
    case 'QUEUE_SET_CURRENT':
      return {
        ...state,
        runQueue: {
          ...state.runQueue,
          currentRunId: action.payload,
        },
      };
    case 'QUEUE_ADD':
      return {
        ...state,
        runQueue: {
          ...state.runQueue,
          queuedRunIds: [...state.runQueue.queuedRunIds, action.payload],
        },
      };
    case 'QUEUE_ADD_BATCH': {
      // Add multiple runs at once - first becomes current if no current run, rest are queued
      const runIds = action.payload;
      if (runIds.length === 0) {
        return state;
      }

      const hasCurrentRun = Boolean(state.runQueue.currentRunId);

      if (!hasCurrentRun) {
        // First run becomes current, rest go to queue
        const [firstRunId, ...restRunIds] = runIds;
        return {
          ...state,
          runQueue: {
            currentRunId: firstRunId,
            queuedRunIds: [...state.runQueue.queuedRunIds, ...restRunIds],
          },
        };
      } else {
        // All runs go to queue
        return {
          ...state,
          runQueue: {
            ...state.runQueue,
            queuedRunIds: [...state.runQueue.queuedRunIds, ...runIds],
          },
        };
      }
    }
    case 'QUEUE_REMOVE':
      return {
        ...state,
        runQueue: {
          ...state.runQueue,
          queuedRunIds: state.runQueue.queuedRunIds.filter(id => id !== action.payload),
        },
      };
    case 'QUEUE_START_NEXT': {
      const nextRunId = state.runQueue.queuedRunIds[0];
      return {
        ...state,
        runQueue: {
          currentRunId: nextRunId ?? null,
          queuedRunIds: nextRunId ? state.runQueue.queuedRunIds.slice(1) : [],
        },
      };
    }
    default:
      return state;
  }
};

interface BenchmarkContextValue {
  initialized: boolean;
  loading: boolean;
  questions: BenchmarkQuestion[];
  questionSummary: QuestionDatasetSummary;
  topology: QuestionTopologySubject[];
  topologyGeneratedAt?: string;
  profiles: ModelProfile[];
  runs: BenchmarkRun[];
  overview: DashboardOverview;
  discovery: ModelDiscoveryState;
  activeRun: ActiveRunState | null;
  runQueue: BenchmarkRunQueue;
  upsertProfile: (profile: Partial<ModelProfile>) => ModelProfile;
  deleteProfile: (profileId: string) => void;
  recordDiagnostic: (diagnostic: DiagnosticsResult) => void;
  recordCompatibilityCheck: (profileId: string, result: CompatibilityCheckResult) => void;
  upsertRun: (run: Partial<BenchmarkRun>) => BenchmarkRun;
  deleteRun: (runId: string) => void;
  getProfileById: (profileId: string) => ModelProfile | undefined;
  getRunById: (runId: string) => BenchmarkRun | undefined;
  beginActiveRun: (payload: ActiveRunStartPayload) => void;
  setActiveRunCurrentQuestion: (payload: ActiveRunQuestionStartPayload) => void;
  recordActiveRunAttempt: (payload: ActiveRunAttemptPayload) => void;
  finalizeActiveRun: (payload: ActiveRunCompletePayload) => void;
  clearActiveRun: () => void;
  refreshDiscoveredModels: () => Promise<void>;
  enqueueRun: (runId: string) => void;
  enqueueBatch: (runIds: string[]) => void;
  dequeueRun: (runId: string) => void;
  getQueuePosition: (runId: string) => number;
}

const BenchmarkContext = createContext<BenchmarkContextValue | undefined>(undefined);

export const BenchmarkProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const [profiles, runs] = await Promise.all([loadProfiles(), loadRuns()]);

      if (cancelled) {
        return;
      }

      // Cleanup orphaned runs (runs stuck in 'running' or 'queued' after app restart)
      const cleanedRuns = runs.map((run) => {
        const normalized = normalizeRun(run);

        // Mark orphaned 'running' runs - check if actually completed
        if (normalized.status === 'running') {
          // Check if all questions were answered
          const attemptedQuestionIds = new Set(normalized.attempts.map(a => a.questionId));
          const allQuestionsAnswered = normalized.questionIds.every(qid => attemptedQuestionIds.has(qid));

          if (allQuestionsAnswered && normalized.attempts.length > 0) {
            // Run actually completed - all questions answered
            // Recalculate metrics from attempts
            const passedCount = normalized.attempts.filter(a => a.evaluation?.passed).length;
            const failedCount = normalized.attempts.length - passedCount;
            const accuracy = normalized.attempts.length > 0 ? passedCount / normalized.attempts.length : 0;

            // Count topology accuracy
            const topologyPassedCount = normalized.attempts.filter(a =>
              a.topologyEvaluation?.passed
            ).length;
            const topologyAccuracy = normalized.attempts.length > 0 ? topologyPassedCount / normalized.attempts.length : 0;

            return {
              ...normalized,
              status: 'completed' as const,
              completedAt: normalized.completedAt || new Date().toISOString(),
              summary: `Accuracy ${(accuracy * 100).toFixed(1)}% across ${normalized.attempts.length} questions.`,
              metrics: {
                ...normalized.metrics,
                passedCount,
                failedCount,
                totalCount: normalized.attempts.length,
                accuracy,
                topologyAccuracy,
              },
              notes: normalized.notes
                ? `${normalized.notes}\n\nStatus corrected to completed on app restart (all questions answered).`
                : 'Status corrected to completed on app restart (all questions answered).',
            };
          }

          // Truly incomplete run
          return {
            ...normalized,
            status: 'failed' as const,
            completedAt: normalized.completedAt || new Date().toISOString(),
            summary: normalized.summary || `Run interrupted (${attemptedQuestionIds.size}/${normalized.questionIds.length} questions answered)`,
            notes: normalized.notes
              ? `${normalized.notes}\n\nRun was interrupted and marked as failed on app restart.`
              : 'Run was interrupted and marked as failed on app restart.',
          };
        }

        // Reset orphaned 'queued' runs back to their original state
        if (normalized.status === 'queued') {
          // Check if this was a draft run (never started) or a resumed run (has attempts)
          const hasAttempts = normalized.attempts.length > 0;

          return {
            ...normalized,
            status: hasAttempts ? 'failed' as const : 'draft' as const,
            summary: hasAttempts
              ? normalized.summary || 'Run was queued but not executed'
              : normalized.summary || 'Draft run',
            notes: normalized.notes
              ? `${normalized.notes}\n\nQueued status reset on app restart.`
              : 'Queued status reset on app restart.',
          };
        }

        return normalized;
      });

      dispatch({
        type: 'INITIALIZE',
        payload: {
          profiles: profiles.map((profile) => normalizeProfile(profile)),
          runs: cleanedRuns,
        },
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const upsertProfile = useCallback(
    (profile: Partial<ModelProfile>): ModelProfile => {
      const existing = profile.id
        ? state.profiles.find((item) => item.id === profile.id)
        : undefined;
      const normalized = normalizeProfile(profile, existing);
      dispatch({ type: 'UPSERT_PROFILE', payload: normalized });
      void upsertProfileRecord(normalized);
      return normalized;
    },
    [state.profiles]
  );

  const deleteProfile = useCallback((profileId: string) => {
    dispatch({ type: 'DELETE_PROFILE', payload: profileId });
    void deleteProfileRecord(profileId);
  }, []);

  const recordDiagnostic = useCallback(
    (diagnostic: DiagnosticsResult) => {
      dispatch({ type: 'RECORD_DIAGNOSTIC', payload: diagnostic });

      const target = state.profiles.find((profile) => profile.id === diagnostic.profileId);
      if (!target) {
        return;
      }

      const history = [
        ...target.diagnostics.filter((item) => item.id !== diagnostic.id),
        diagnostic,
      ].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

      const metadata = { ...target.metadata };

      if (diagnostic.status === 'pass') {
        if (diagnostic.level === 'HANDSHAKE') {
          metadata.lastHandshakeAt = diagnostic.completedAt;
        }
        if (diagnostic.level === 'READINESS') {
          metadata.lastReadinessAt = diagnostic.completedAt;
        }
      }

      if (typeof diagnostic.metadata?.supportsJsonMode === 'boolean') {
        metadata.supportsJsonMode = diagnostic.metadata.supportsJsonMode;
      }

      const updated: ModelProfile = {
        ...target,
        diagnostics: history,
        metadata,
        updatedAt: diagnostic.completedAt ?? target.updatedAt,
      };

      void upsertProfileRecord(updated);
    },
    [state.profiles]
  );

  const recordCompatibilityCheck = useCallback(
    (profileId: string, result: CompatibilityCheckResult) => {
      dispatch({ type: 'RECORD_COMPATIBILITY_CHECK', payload: { profileId, result } });

      const target = state.profiles.find((profile) => profile.id === profileId);
      if (!target) {
        return;
      }

      const metadata = { ...target.metadata };

      metadata.compatibilityStatus = result.compatible ? 'compatible' : 'incompatible';
      metadata.jsonFormat = result.jsonFormat ?? 'none';
      metadata.lastCompatibilityCheckAt = result.completedAt;
      metadata.compatibilitySummary = result.summary;
      metadata.supportsJsonMode = result.compatible && (result.jsonFormat === 'json_object' || result.jsonFormat === 'json_schema');

      const updated: ModelProfile = {
        ...target,
        metadata,
        updatedAt: result.completedAt,
      };

      void upsertProfileRecord(updated);
    },
    [state.profiles]
  );

  const upsertRun = useCallback(
    (run: Partial<BenchmarkRun>): BenchmarkRun => {
      const existing = run.id ? state.runs.find((item) => item.id === run.id) : undefined;
      const normalized = normalizeRun(run, existing);
      dispatch({ type: 'UPSERT_RUN', payload: normalized });
      void upsertRunRecord(normalized);
      return normalized;
    },
    [state.runs]
  );

  const deleteRun = useCallback((runId: string) => {
    dispatch({ type: 'DELETE_RUN', payload: runId });
    void deleteRunRecord(runId);
  }, []);

  const getProfileById = useCallback(
    (profileId: string) => state.profiles.find((profile) => profile.id === profileId),
    [state.profiles]
  );

  const getRunById = useCallback(
    (runId: string) => state.runs.find((run) => run.id === runId),
    [state.runs]
  );

  const beginActiveRun = useCallback((payload: ActiveRunStartPayload) => {
    dispatch({ type: 'ACTIVE_RUN_INITIALIZE', payload });
  }, []);

  const setActiveRunCurrentQuestion = useCallback((payload: ActiveRunQuestionStartPayload) => {
    dispatch({ type: 'ACTIVE_RUN_SET_CURRENT', payload });
  }, []);

  const recordActiveRunAttempt = useCallback((payload: ActiveRunAttemptPayload) => {
    dispatch({ type: 'ACTIVE_RUN_RECORD_ATTEMPT', payload });
  }, []);

  const finalizeActiveRun = useCallback((payload: ActiveRunCompletePayload) => {
    dispatch({ type: 'ACTIVE_RUN_COMPLETE', payload });
  }, []);

  const clearActiveRun = useCallback(() => {
    dispatch({ type: 'ACTIVE_RUN_CLEAR' });
  }, []);

  const enqueueRun = useCallback((runId: string) => {
    console.log(`[ENQUEUE] Called for run ${runId}`);
    console.log(`[ENQUEUE] Current queue state:`, {
      currentRunId: state.runQueue.currentRunId,
      queuedCount: state.runQueue.queuedRunIds.length,
      queuedIds: state.runQueue.queuedRunIds,
    });

    // If no current run, start this one immediately
    if (!state.runQueue.currentRunId) {
      console.log(`[ENQUEUE] No current run, setting ${runId} as current`);
      dispatch({ type: 'QUEUE_SET_CURRENT', payload: runId });
      // Note: The actual run start happens in RunDetail page
    } else {
      console.log(`[ENQUEUE] Adding ${runId} to queue (current run: ${state.runQueue.currentRunId})`);
      // Add to queue and update run status to 'queued'
      dispatch({ type: 'QUEUE_ADD', payload: runId });
      const run = state.runs.find(r => r.id === runId);
      if (run) {
        upsertRun({ ...run, status: 'queued' });
      }
    }
  }, [state.runQueue.currentRunId, state.runs, upsertRun]);

  const enqueueBatch = useCallback((runIds: string[]) => {
    console.log(`[ENQUEUE BATCH] Called with ${runIds.length} runs`);
    console.log(`[ENQUEUE BATCH] Run IDs:`, runIds);
    console.log(`[ENQUEUE BATCH] Current queue state:`, {
      currentRunId: state.runQueue.currentRunId,
      queuedCount: state.runQueue.queuedRunIds.length,
      queuedIds: state.runQueue.queuedRunIds,
    });

    // Dispatch single action to add all runs at once
    dispatch({ type: 'QUEUE_ADD_BATCH', payload: runIds });

    // Update all runs to 'queued' status
    runIds.forEach((runId) => {
      const run = state.runs.find(r => r.id === runId);
      if (run) {
        upsertRun({ ...run, status: 'queued' });
      }
    });

    console.log(`[ENQUEUE BATCH] Dispatched QUEUE_ADD_BATCH with ${runIds.length} runs`);
  }, [state.runQueue.currentRunId, state.runQueue.queuedRunIds, state.runs, upsertRun]);

  const dequeueRun = useCallback((runId: string) => {
    dispatch({ type: 'QUEUE_REMOVE', payload: runId });
    // Update run status to cancelled
    const run = state.runs.find(r => r.id === runId);
    if (run) {
      upsertRun({ ...run, status: 'cancelled' });
    }
  }, [state.runs, upsertRun]);

  const getQueuePosition = useCallback((runId: string): number => {
    const index = state.runQueue.queuedRunIds.indexOf(runId);
    return index >= 0 ? index + 1 : 0;
  }, [state.runQueue.queuedRunIds]);

  const refreshDiscoveredModels = useCallback(async (): Promise<void> => {
    const targets = resolveDiscoveryTargets(state.profiles);

    if (targets.length === 0) {
      return;
    }

    dispatch({ type: 'DISCOVERY_REQUEST' });

    const results: { models: DiscoveredModel[]; endpoint: string }[] = [];
    const errors: Error[] = [];

    for (const target of targets) {
      try {
        const result = await discoverLmStudioModels({
          baseUrl: target.baseUrl,
          apiKey: target.apiKey,
          requestTimeoutMs: target.requestTimeoutMs,
          preferRichMetadata: true,
        });
        results.push(result);
      } catch (error) {
        if (error instanceof Error) {
          errors.push(error);
        } else {
          errors.push(new Error('Unknown discovery error'));
        }
      }
    }

    if (results.length > 0) {
      if (errors.length > 0) {
        console.warn('Some LM Studio discovery requests failed', errors);
      }

      const models = mergeDiscoveryResults(results);
      dispatch({
        type: 'DISCOVERY_SUCCESS',
        payload: { models, fetchedAt: new Date().toISOString() },
      });
      return;
    }

    const errorMessage =
      errors.length > 0
        ? errors.map((error) => error.message).join('; ')
        : 'LM Studio did not return any models.';

    dispatch({
      type: 'DISCOVERY_FAILURE',
      payload: { error: errorMessage, fetchedAt: new Date().toISOString() },
    });

    throw new Error(errorMessage);
  }, [state.profiles]);

  useEffect(() => {
    if (!state.initialized) {
      return;
    }

    if (state.discovery.status !== 'idle') {
      return;
    }

    refreshDiscoveredModels().catch((error) => {
      if ((error as Error).name === 'AbortError') {
        return;
      }
      console.warn('LM Studio discovery failed', error);
    });
  }, [state.initialized, state.discovery.status, refreshDiscoveredModels]);

  // Auto-start next queued run when current run completes
  useEffect(() => {
    if (!state.runQueue.currentRunId || state.runQueue.queuedRunIds.length === 0) {
      return;
    }

    const currentRun = state.runs.find(r => r.id === state.runQueue.currentRunId);
    if (currentRun && ['completed', 'failed', 'cancelled'].includes(currentRun.status)) {
      console.log('[Queue] Current run finished, starting next queued run');
      dispatch({ type: 'QUEUE_START_NEXT' });
    }
  }, [state.runs, state.runQueue.currentRunId, state.runQueue.queuedRunIds.length]);

  const overview = useMemo(() => computeDashboardOverview(state.runs), [state.runs]);

  const value = useMemo<BenchmarkContextValue>(
    () => ({
      initialized: state.initialized,
      loading: state.loading,
      questions: questionDataset,
      questionSummary: questionDatasetSummary,
      topology: questionTopology,
      topologyGeneratedAt: questionTopologyGeneratedAt,
      profiles: state.profiles,
      runs: state.runs,
      overview,
      discovery: state.discovery,
      activeRun: state.activeRun,
      runQueue: state.runQueue,
      upsertProfile,
      deleteProfile,
      recordDiagnostic,
      recordCompatibilityCheck,
      upsertRun,
      deleteRun,
      getProfileById,
      getRunById,
      beginActiveRun,
      setActiveRunCurrentQuestion,
      recordActiveRunAttempt,
      finalizeActiveRun,
      clearActiveRun,
      refreshDiscoveredModels,
      enqueueRun,
      enqueueBatch,
      dequeueRun,
      getQueuePosition,
    }),
    [
      state.initialized,
      state.loading,
      state.profiles,
      state.runs,
      state.discovery,
      state.activeRun,
      state.runQueue,
      overview,
      upsertProfile,
      deleteProfile,
      recordDiagnostic,
      recordCompatibilityCheck,
      upsertRun,
      deleteRun,
      getProfileById,
      getRunById,
      beginActiveRun,
      setActiveRunCurrentQuestion,
      recordActiveRunAttempt,
      finalizeActiveRun,
      clearActiveRun,
      refreshDiscoveredModels,
      enqueueRun,
      enqueueBatch,
      dequeueRun,
      getQueuePosition,
    ]
  );

  return <BenchmarkContext.Provider value={value}>{children}</BenchmarkContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useBenchmarkContext = () => {
  const context = useContext(BenchmarkContext);

  if (!context) {
    throw new Error('useBenchmarkContext must be used within a BenchmarkProvider');
  }

  return context;
};
