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
  BenchmarkQuestion,
  BenchmarkRun,
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
import { loadProfiles, loadRuns, saveProfiles, saveRuns } from '@/services/storage';
import { discoverLmStudioModels, mergeDiscoveryResults } from '@/services/lmStudioDiscovery';
import createId from '@/utils/createId';

interface BenchmarkState {
  initialized: boolean;
  profiles: ModelProfile[];
  runs: BenchmarkRun[];
  discovery: ModelDiscoveryState;
}

const initialState: BenchmarkState = {
  initialized: false,
  profiles: [],
  runs: [],
  discovery: {
    status: 'idle',
    models: [],
  },
};

type Action =
  | { type: 'INITIALIZE'; payload: { profiles: ModelProfile[]; runs: BenchmarkRun[] } }
  | { type: 'UPSERT_PROFILE'; payload: ModelProfile }
  | { type: 'DELETE_PROFILE'; payload: string }
  | { type: 'UPSERT_RUN'; payload: BenchmarkRun }
  | { type: 'DELETE_RUN'; payload: string }
  | { type: 'RECORD_DIAGNOSTIC'; payload: DiagnosticsResult }
  | { type: 'DISCOVERY_REQUEST' }
  | { type: 'DISCOVERY_SUCCESS'; payload: { models: DiscoveredModel[]; fetchedAt: string } }
  | { type: 'DISCOVERY_FAILURE'; payload: { error: string; fetchedAt?: string } };

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

  const normalizedSteps = () => {
    const incomingSteps = profile.benchmarkSteps ?? existing?.benchmarkSteps;

    if (!incomingSteps || incomingSteps.length === 0) {
      return defaultBenchmarkSteps.map((step) => ({ ...step }));
    }

    return incomingSteps.map((step, index) => {
      const fallback =
        (step.id ? defaultStepById.get(step.id) : undefined) ?? defaultBenchmarkSteps[index];

      return {
        id: step.id ?? fallback?.id ?? `step-${index}`,
        label: step.label ?? fallback?.label ?? `Step ${index + 1}`,
        description: step.description ?? fallback?.description,
        promptTemplate: step.promptTemplate ?? fallback?.promptTemplate ?? '',
        enabled: step.enabled ?? fallback?.enabled ?? true,
      };
    });
  };

  const diagnostics = profile.diagnostics ?? existing?.diagnostics ?? [];
  const metadata = {
    supportsJsonMode:
      profile.metadata?.supportsJsonMode ?? existing?.metadata?.supportsJsonMode ?? undefined,
    lastHandshakeAt:
      profile.metadata?.lastHandshakeAt ?? existing?.metadata?.lastHandshakeAt ?? undefined,
    lastReadinessAt:
      profile.metadata?.lastReadinessAt ?? existing?.metadata?.lastReadinessAt ?? undefined,
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
    metrics: run.metrics ?? existing?.metrics ?? createEmptyRunMetrics(),
    attempts: run.attempts ?? existing?.attempts ?? [],
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
      averageLatencyMs: 0,
      latestRuns: [],
      accuracyTrend: [],
      latencyTrend: [],
    };
  }

  const completedRuns = runs.filter((run) => run.status === 'completed');
  const activeRuns = runs.filter((run) => run.status === 'running' || run.status === 'queued');

  const averageAccuracy =
    completedRuns.reduce((acc, run) => acc + run.metrics.accuracy, 0) /
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
    averageLatencyMs: averageLatency,
    latestRuns,
    accuracyTrend,
    latencyTrend,
    lastUpdated,
  };
};

const reducer = (state: BenchmarkState, action: Action): BenchmarkState => {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        initialized: true,
        profiles: action.payload.profiles,
        runs: action.payload.runs,
        discovery: state.discovery,
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
    default:
      return state;
  }
};

interface BenchmarkContextValue {
  initialized: boolean;
  questions: BenchmarkQuestion[];
  questionSummary: QuestionDatasetSummary;
  topology: QuestionTopologySubject[];
  topologyGeneratedAt?: string;
  profiles: ModelProfile[];
  runs: BenchmarkRun[];
  overview: DashboardOverview;
  discovery: ModelDiscoveryState;
  upsertProfile: (profile: Partial<ModelProfile>) => ModelProfile;
  deleteProfile: (profileId: string) => void;
  recordDiagnostic: (diagnostic: DiagnosticsResult) => void;
  upsertRun: (run: Partial<BenchmarkRun>) => BenchmarkRun;
  deleteRun: (runId: string) => void;
  getProfileById: (profileId: string) => ModelProfile | undefined;
  getRunById: (runId: string) => BenchmarkRun | undefined;
  refreshDiscoveredModels: () => Promise<void>;
}

const BenchmarkContext = createContext<BenchmarkContextValue | undefined>(undefined);

export const BenchmarkProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const storedProfiles = loadProfiles().map((profile) => normalizeProfile(profile));
    const storedRuns = loadRuns().map((run) => normalizeRun(run));

    dispatch({
      type: 'INITIALIZE',
      payload: {
        profiles: storedProfiles,
        runs: storedRuns,
      },
    });
  }, []);

  useEffect(() => {
    if (!state.initialized) {
      return;
    }

    saveProfiles(state.profiles);
  }, [state.initialized, state.profiles]);

  useEffect(() => {
    if (!state.initialized) {
      return;
    }

    saveRuns(state.runs);
  }, [state.initialized, state.runs]);

  const upsertProfile = useCallback(
    (profile: Partial<ModelProfile>): ModelProfile => {
      const existing = profile.id
        ? state.profiles.find((item) => item.id === profile.id)
        : undefined;
      const normalized = normalizeProfile(profile, existing);
      dispatch({ type: 'UPSERT_PROFILE', payload: normalized });
      return normalized;
    },
    [state.profiles]
  );

  const deleteProfile = useCallback((profileId: string) => {
    dispatch({ type: 'DELETE_PROFILE', payload: profileId });
  }, []);

  const recordDiagnostic = useCallback((diagnostic: DiagnosticsResult) => {
    dispatch({ type: 'RECORD_DIAGNOSTIC', payload: diagnostic });
  }, []);

  const upsertRun = useCallback(
    (run: Partial<BenchmarkRun>): BenchmarkRun => {
      const existing = run.id ? state.runs.find((item) => item.id === run.id) : undefined;
      const normalized = normalizeRun(run, existing);
      dispatch({ type: 'UPSERT_RUN', payload: normalized });
      return normalized;
    },
    [state.runs]
  );

  const deleteRun = useCallback((runId: string) => {
    dispatch({ type: 'DELETE_RUN', payload: runId });
  }, []);

  const getProfileById = useCallback(
    (profileId: string) => state.profiles.find((profile) => profile.id === profileId),
    [state.profiles]
  );

  const getRunById = useCallback(
    (runId: string) => state.runs.find((run) => run.id === runId),
    [state.runs]
  );

  const refreshDiscoveredModels = useCallback(async (): Promise<void> => {
    const targets = resolveDiscoveryTargets(state.profiles);

    if (targets.length === 0) {
      return;
    }

    dispatch({ type: 'DISCOVERY_REQUEST' });

    const results: Array<{ models: DiscoveredModel[]; endpoint: string }> = [];
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
        errors.push(error as Error);
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

  const overview = useMemo(() => computeDashboardOverview(state.runs), [state.runs]);

  const value = useMemo<BenchmarkContextValue>(
    () => ({
      initialized: state.initialized,
      questions: questionDataset,
      questionSummary: questionDatasetSummary,
      topology: questionTopology,
      topologyGeneratedAt: questionTopologyGeneratedAt,
      profiles: state.profiles,
      runs: state.runs,
      overview,
      discovery: state.discovery,
      upsertProfile,
      deleteProfile,
      recordDiagnostic,
      upsertRun,
      deleteRun,
      getProfileById,
      getRunById,
      refreshDiscoveredModels,
    }),
    [
      state.initialized,
      state.profiles,
      state.runs,
      state.discovery,
      overview,
      upsertProfile,
      deleteProfile,
      recordDiagnostic,
      upsertRun,
      deleteRun,
      getProfileById,
      getRunById,
      refreshDiscoveredModels,
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
