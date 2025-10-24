import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import {
  ModelProfile,
  BenchmarkStepConfig,
  DiagnosticsLevel,
  DiscoveredModel,
} from '@/types/benchmark';
import { DEFAULT_PROFILE_VALUES } from '@/data/defaults';
import { runDiagnostics } from '@/services/diagnostics';
import Modal from '@/components/Modal';

interface ProfileFormState {
  id?: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  defaultSystemPrompt: string;
  notes: string;
  benchmarkSteps: BenchmarkStepConfig[];
}

const toFormState = (profile?: ModelProfile): ProfileFormState =>
  profile
    ? {
        id: profile.id,
        name: profile.name,
        provider: profile.provider,
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey ?? '',
        modelId: profile.modelId,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        requestTimeoutMs: profile.requestTimeoutMs,
        topP: profile.topP ?? DEFAULT_PROFILE_VALUES.topP,
        frequencyPenalty: profile.frequencyPenalty ?? DEFAULT_PROFILE_VALUES.frequencyPenalty,
        presencePenalty: profile.presencePenalty ?? DEFAULT_PROFILE_VALUES.presencePenalty,
        defaultSystemPrompt: profile.defaultSystemPrompt,
        notes: profile.notes ?? '',
        benchmarkSteps: profile.benchmarkSteps.map((step) => ({ ...step })),
      }
    : {
        name: DEFAULT_PROFILE_VALUES.name,
        provider: DEFAULT_PROFILE_VALUES.provider,
        baseUrl: DEFAULT_PROFILE_VALUES.baseUrl,
        apiKey: DEFAULT_PROFILE_VALUES.apiKey,
        modelId: DEFAULT_PROFILE_VALUES.modelId,
        temperature: DEFAULT_PROFILE_VALUES.temperature,
        maxOutputTokens: DEFAULT_PROFILE_VALUES.maxOutputTokens,
        requestTimeoutMs: DEFAULT_PROFILE_VALUES.requestTimeoutMs,
        topP: DEFAULT_PROFILE_VALUES.topP,
        frequencyPenalty: DEFAULT_PROFILE_VALUES.frequencyPenalty,
        presencePenalty: DEFAULT_PROFILE_VALUES.presencePenalty,
        defaultSystemPrompt: DEFAULT_PROFILE_VALUES.defaultSystemPrompt,
        notes: DEFAULT_PROFILE_VALUES.notes,
        benchmarkSteps: DEFAULT_PROFILE_VALUES.benchmarkSteps.map((step) => ({ ...step })),
      };

const formatTimestamp = (iso?: string) => {
  if (!iso) {
    return 'Never';
  }
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

const levelSummary = (profile: ModelProfile, level: DiagnosticsLevel) => {
  const history = profile.diagnostics.filter((entry) => entry.level === level);
  if (history.length === 0) {
    return { status: 'pending', label: 'Not run yet', lastRunAt: undefined } as const;
  }

  const last = history[history.length - 1];
  return {
    status: last.status === 'pass' ? 'ready' : 'failed',
    label: last.summary,
    lastRunAt: last.completedAt,
  } as const;
};

const Profiles = () => {
  const {
    profiles,
    upsertProfile,
    deleteProfile,
    recordDiagnostic,
    discovery,
    refreshDiscoveredModels,
  } = useBenchmarkContext();
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(undefined);
  const [formState, setFormState] = useState<ProfileFormState>(() => toFormState());
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [isProfileDialogOpen, setProfileDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isProfileDetailOpen, setProfileDetailOpen] = useState(false);
  const [runningDiagnostics, setRunningDiagnostics] = useState<{
    profileId: string;
    level: DiagnosticsLevel;
  } | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const handshakeStats = selectedProfile ? levelSummary(selectedProfile, 'HANDSHAKE') : null;
  const readinessStats = selectedProfile ? levelSummary(selectedProfile, 'READINESS') : null;
  const isDetailProfileRunning =
    selectedProfile != null && runningDiagnostics?.profileId === selectedProfile.id;
  const isDetailHandshakeRunning =
    isDetailProfileRunning && runningDiagnostics?.level === 'HANDSHAKE';
  const isDetailReadinessRunning =
    isDetailProfileRunning && runningDiagnostics?.level === 'READINESS';

  useEffect(() => {
    if (!selectedProfileId) {
      return;
    }
    const stillExists = profiles.some((profile) => profile.id === selectedProfileId);
    if (!stillExists) {
      setSelectedProfileId(undefined);
      setProfileDetailOpen(false);
    }
  }, [profiles, selectedProfileId]);

  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setProfileDetailOpen(true);
  };

  const handleCloseProfileDetails = () => {
    setProfileDetailOpen(false);
    setSelectedProfileId(undefined);
  };

  const handleCreateProfile = () => {
    setDialogMode('create');
    setFormState(toFormState());
    setFormError(null);
    setFeedback(null);
    setProfileDialogOpen(true);
  };

  const handleEditProfile = (profile: ModelProfile) => {
    setDialogMode('edit');
    setFormState(toFormState(profile));
    setFormError(null);
    setFeedback(null);
    setProfileDialogOpen(true);
    setSelectedProfileId(profile.id);
    setProfileDetailOpen(false);
  };

  const handleCloseDialog = () => {
    setProfileDialogOpen(false);
    setFormError(null);
  };

  const handleRefreshDiscovery = useCallback(() => {
    refreshDiscoveredModels().catch((error) => {
      console.warn('Failed to refresh LM Studio models', error);
    });
  }, [refreshDiscoveredModels]);

  const handleAdoptDiscoveredModel = useCallback(
    (model: DiscoveredModel) => {
      const baseUrl = model.origin?.baseUrl ?? DEFAULT_PROFILE_VALUES.baseUrl;
      const defaults = toFormState();
      const matchingProfile = profiles.find((profile) => profile.baseUrl === baseUrl);
      const capabilityNote =
        model.capabilities.length > 0
          ? `Capabilities: ${model.capabilities.join(', ')}.`
          : undefined;
      const quantizationNote =
        model.quantization ? `Quantization: ${model.quantization}.` : undefined;
      const sourceNote = `Discovered via LM Studio (${baseUrl}).`;

      // Intelligently set maxOutputTokens based on model's max context length
      // Use 50% of context for output, capping at 8192 tokens
      const intelligentMaxOutputTokens = model.maxContextLength
        ? Math.min(Math.floor(model.maxContextLength * 0.5), 8192)
        : defaults.maxOutputTokens;

      setDialogMode('create');
      setFormState({
        ...defaults,
        name: model.displayName ?? model.id,
        baseUrl,
        apiKey: matchingProfile?.apiKey ?? defaults.apiKey,
        requestTimeoutMs: matchingProfile?.requestTimeoutMs ?? defaults.requestTimeoutMs,
        modelId: model.id,
        maxOutputTokens: intelligentMaxOutputTokens,
        notes: [sourceNote, quantizationNote, capabilityNote].filter(Boolean).join(' '),
      });
      setFormError(null);
      setFeedback(`Loaded ${model.id} from LM Studio discovery. Save to persist.`);
      setProfileDialogOpen(true);
    },
    [profiles]
  );

  const handleChange =
    (field: keyof ProfileFormState) =>
    (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = 'value' in event.currentTarget ? event.currentTarget.value : '';

      setFormState((prev) => {
        const numericFields = [
          'temperature',
          'maxOutputTokens',
          'requestTimeoutMs',
          'topP',
          'frequencyPenalty',
          'presencePenalty',
        ];

        if (numericFields.includes(field)) {
          return {
            ...prev,
            [field]: Number(value),
          };
        }

        return {
          ...prev,
          [field]: value,
        };
      });
    };

  const handleStepChange =
    (index: number, key: keyof BenchmarkStepConfig) =>
    (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value =
        key === 'enabled'
          ? (event.currentTarget as HTMLInputElement).checked
          : event.currentTarget.value;

      setFormState((prev) => {
        const steps = prev.benchmarkSteps.map((step, stepIndex) =>
          stepIndex === index
            ? {
                ...step,
                [key]: key === 'enabled' ? Boolean(value) : value,
              }
            : step
        );

        return {
          ...prev,
          benchmarkSteps: steps,
        };
      });
    };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(null);

    try {
      const saved = upsertProfile(formState);
      setSelectedProfileId(saved.id);
      setFeedback(
        dialogMode === 'edit' ? 'Profile updated successfully.' : 'Profile created successfully.'
      );
      setProfileDialogOpen(false);
      setDialogMode('edit');
    } catch (error) {
      setFormError(`Failed to save profile: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = () => {
    const targetId = formState.id ?? selectedProfile?.id;
    if (!targetId) {
      return;
    }

    deleteProfile(targetId);
    setFeedback('Profile deleted.');
    setProfileDialogOpen(false);
    setFormError(null);
    setFormState(toFormState());
    setDialogMode('create');
    setProfileDetailOpen(false);
    setSelectedProfileId((current) => (current === targetId ? undefined : current));
  };

  const handleRunDiagnostics = async (profile: ModelProfile, level: DiagnosticsLevel) => {
    setRunningDiagnostics({ profileId: profile.id, level });
    setFeedback(null);

    try {
      const result = await runDiagnostics({ profile, level });
      recordDiagnostic(result);
      setFeedback(
        `${profile.name}: ${level === 'HANDSHAKE' ? 'Handshake' : 'Readiness'} diagnostics complete.`
      );
    } catch (error) {
      setFeedback(`${profile.name}: Diagnostics failed: ${(error as Error).message}`);
    } finally {
      setRunningDiagnostics(null);
    }
  };

  const dialogTitle = dialogMode === 'edit' ? 'Edit profile' : 'Create profile';

  return (
    <>
      <header className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
              Profiles
            </h1>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-1">
              Configure LM Studio endpoints, credentials, and benchmark prompts.
            </p>
          </div>
          <button
            className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
            type="button"
            onClick={handleCreateProfile}
          >
            New profile
          </button>
        </div>
        {feedback && !isProfileDialogOpen && !isProfileDetailOpen ? (
          <div className="rounded-xl border border-success-200 dark:border-success-800/60 bg-success-50/60 dark:bg-success-900/20 px-4 py-3 text-sm font-semibold text-success-700 dark:text-success-400 transition-theme">
            {feedback}
          </div>
        ) : null}
      </header>

      <div className="flex flex-col gap-6">
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-4 transition-theme">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Saved profiles
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Persisted locally so you can reuse configurations.
            </p>
          </div>
          {profiles.length === 0 ? (
                <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
                  No profiles yet. Create one to get started.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {profiles.map((profile) => {
                    const handshake = levelSummary(profile, 'HANDSHAKE');
                    const readiness = levelSummary(profile, 'READINESS');
                    const isActive = isProfileDetailOpen && profile.id === selectedProfileId;
                    const isRunningForProfile = runningDiagnostics?.profileId === profile.id;
                    const diagnosticsBusy = Boolean(runningDiagnostics);

                    return (
                      <li key={profile.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-pressed={isActive}
                          onClick={() => handleSelectProfile(profile.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleSelectProfile(profile.id);
                            }
                          }}
                          className={`border rounded-xl p-5 flex flex-col gap-4 transition-all duration-200 cursor-pointer focus:outline-none ${
                            isActive
                              ? 'bg-accent-50 dark:bg-slate-700 border-accent-400 dark:border-accent-500 focus-visible:ring-2 focus-visible:ring-accent-500'
                              : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-accent-500/70'
                          }`}
                        >
                          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-slate-900 dark:text-slate-50">
                                {profile.name}
                              </h3>
                              <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                                {profile.provider} &middot; {profile.modelId}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 break-words">
                                {profile.baseUrl || 'No base URL configured'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-start justify-end gap-3">
                              <div className="flex flex-col items-end gap-1 max-w-40">
                                <span
                                  className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                                    handshake.status === 'ready'
                                      ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                      : handshake.status === 'failed'
                                      ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                                      : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                                  }`}
                                >
                                  L1{' '}
                                  {handshake.status === 'ready'
                                    ? 'Ready'
                                    : handshake.status === 'failed'
                                    ? 'Failed'
                                    : 'Pending'}
                                </span>
                                <span className="text-[0.7rem] text-slate-500 dark:text-slate-400 text-right break-words">
                                  {handshake.label}
                                </span>
                                <span className="text-[0.7rem] text-slate-400 dark:text-slate-500 text-right break-words">
                                  {handshake.lastRunAt
                                    ? `Last run: ${formatTimestamp(handshake.lastRunAt)}`
                                    : 'No runs recorded'}
                                </span>
                              </div>
                              <div className="flex flex-col items-end gap-1 max-w-40">
                                <span
                                  className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                                    readiness.status === 'ready'
                                      ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                      : readiness.status === 'failed'
                                      ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                                      : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                                  }`}
                                >
                                  L2{' '}
                                  {readiness.status === 'ready'
                                    ? 'Ready'
                                    : readiness.status === 'failed'
                                    ? 'Failed'
                                    : 'Pending'}
                                </span>
                                <span className="text-[0.7rem] text-slate-500 dark:text-slate-400 text-right break-words">
                                  {readiness.label}
                                </span>
                                <span className="text-[0.7rem] text-slate-400 dark:text-slate-500 text-right break-words">
                                  {readiness.lastRunAt
                                    ? `Last run: ${formatTimestamp(readiness.lastRunAt)}`
                                    : 'No runs recorded'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                                Timeout
                              </dt>
                              <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {profile.requestTimeoutMs.toLocaleString()} ms
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                                Generation
                              </dt>
                              <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                Temp {profile.temperature} · Top P {profile.topP}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                                Max tokens
                              </dt>
                              <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                {profile.maxOutputTokens.toLocaleString()}
                              </dd>
                            </div>
                          </dl>

                          {profile.notes ? (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Notes: {profile.notes}
                            </p>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              Click to view diagnostics &amp; history
                            </span>
                            <div className="ml-auto flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRunDiagnostics(profile, 'HANDSHAKE');
                                }}
                                disabled={diagnosticsBusy}
                                className="inline-flex items-center px-3 py-1.5 text-sm font-semibold border border-accent-500/70 text-accent-600 hover:text-accent-700 hover:border-accent-600 rounded-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {isRunningForProfile && runningDiagnostics?.level === 'HANDSHAKE'
                                  ? 'Running…'
                                  : 'Run L1'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleRunDiagnostics(profile, 'READINESS');
                                }}
                                disabled={diagnosticsBusy || handshake.status !== 'ready'}
                                title={
                                  handshake.status !== 'ready'
                                    ? 'Run L1 handshake first'
                                    : 'Run L2 readiness check'
                                }
                                className="inline-flex items-center px-3 py-1.5 text-sm font-semibold border border-accent-500/70 text-accent-600 hover:text-accent-700 hover:border-accent-600 rounded-lg transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {isRunningForProfile && runningDiagnostics?.level === 'READINESS'
                                  ? 'Running…'
                                  : 'Run L2'}
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleEditProfile(profile);
                                }}
                                className="inline-flex items-center px-3 py-1.5 text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-slate-400 dark:hover:border-slate-500 rounded-lg transition-all duration-200"
                              >
                                Edit
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-4 transition-theme">
          <header className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                LM Studio models
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Auto-detected from your running LM Studio instance.
              </p>
              {discovery.lastFetchedAt && (
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                  Last updated {formatTimestamp(discovery.lastFetchedAt)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleRefreshDiscovery}
              disabled={discovery.status === 'loading'}
              className="inline-flex items-center px-3 py-2 text-sm font-medium border border-accent-500/70 text-accent-600 hover:text-accent-700 hover:border-accent-600 rounded-xl transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {discovery.status === 'loading' ? 'Scanning…' : 'Refresh'}
            </button>
          </header>

          {discovery.status === 'error' && (
            <div className="border border-danger-200 dark:border-danger-800/60 bg-danger-50/50 dark:bg-danger-900/20 rounded-xl px-3 py-2 text-sm text-danger-700 dark:text-danger-300">
              Failed to refresh models: {discovery.error}
            </div>
          )}
          {discovery.models.length === 0 && discovery.status !== 'loading' ? (
            <p className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/40 text-sm text-slate-500 dark:text-slate-400">
              No models discovered yet. Make sure LM Studio&apos;s server is running and accessible.
            </p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {discovery.models.map((model) => (
                <li
                  key={model.id}
                  className="border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/30 rounded-xl p-4 flex flex-col gap-3 transition-theme"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-slate-50">
                        {model.displayName ?? model.id}
                      </h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                        {model.kind ?? 'Model'} · {model.state ?? 'unknown state'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                        {model.maxContextLength
                          ? `Context: ${model.maxContextLength.toLocaleString()} tokens`
                          : 'Context window unknown'}
                        {model.quantization ? ` · ${model.quantization}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span
                        className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                          model.loaded
                            ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                            : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-300'
                        }`}
                      >
                        {model.loaded ? 'Loaded' : 'Not loaded'}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAdoptDiscoveredModel(model)}
                        className="text-sm font-semibold text-accent-600 hover:text-accent-700 border border-accent-500/60 hover:border-accent-600 rounded-lg px-3 py-1.5 transition-all duration-200"
                      >
                        Use as profile
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {model.capabilities.length > 0 ? (
                      model.capabilities.map((capability) => (
                        <span
                          key={capability}
                          className="px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300"
                        >
                          {capability.replace(/_/g, ' ')}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-slate-500 dark:text-slate-500">
                        No capability metadata reported.
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <Modal
        isOpen={isProfileDetailOpen && Boolean(selectedProfile)}
        onClose={handleCloseProfileDetails}
        title={selectedProfile ? selectedProfile.name : 'Profile details'}
      >
        {selectedProfile ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-2">
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {selectedProfile.provider} · {selectedProfile.modelId}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                  {selectedProfile.baseUrl || 'No base URL configured'}
                </p>
                {selectedProfile.notes ? (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Notes: {selectedProfile.notes}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleEditProfile(selectedProfile)}
                  className="inline-flex items-center px-4 py-2.5 text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-100 rounded-xl hover:border-slate-400 dark:hover:border-slate-500 transition-all duration-200"
                >
                  Edit profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleRunDiagnostics(selectedProfile, 'HANDSHAKE');
                  }}
                  disabled={Boolean(runningDiagnostics)}
                  className="inline-flex items-center px-4 py-2.5 text-sm font-semibold border border-accent-400 dark:border-accent-500 bg-accent-500/10 dark:bg-accent-500/15 text-accent-700 dark:text-accent-300 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDetailHandshakeRunning ? 'Running…' : 'Run Level 1'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleRunDiagnostics(selectedProfile, 'READINESS');
                  }}
                  disabled={Boolean(runningDiagnostics) || handshakeStats?.status !== 'ready'}
                  title={
                    handshakeStats?.status !== 'ready'
                      ? 'Run L1 handshake first'
                      : 'Run L2 readiness check'
                  }
                  className="inline-flex items-center px-4 py-2.5 text-sm font-semibold border border-accent-400 dark:border-accent-500 bg-accent-500/10 dark:bg-accent-500/15 text-accent-700 dark:text-accent-300 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDetailReadinessRunning ? 'Running…' : 'Run Level 2'}
                </button>
              </div>
            </div>

            <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-4">
                <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                  Provider
                </dt>
                <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  {selectedProfile.provider}
                </dd>
                <dd className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Model: {selectedProfile.modelId}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-4">
                <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                  Endpoint
                </dt>
                <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50 break-words">
                  {selectedProfile.baseUrl || '—'}
                </dd>
                <dd className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Timeout: {selectedProfile.requestTimeoutMs.toLocaleString()} ms
                </dd>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-4">
                <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                  Generation params
                </dt>
                <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                  Temp {selectedProfile.temperature} · Top P {selectedProfile.topP}
                </dd>
                <dd className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Max tokens: {selectedProfile.maxOutputTokens.toLocaleString()}
                </dd>
              </div>
            </dl>

            <div className="flex flex-col gap-6 border-t border-slate-200 dark:border-slate-700 pt-6">
              <header className="flex justify-between items-start gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                    Diagnostics
                  </h3>
                  <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
                    Run Level 1 (handshake) and Level 2 (readiness) checks before kicking off long
                    benchmarks.
                  </p>
                </div>
              </header>
              <dl className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-4">
                  <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                    Handshake status
                  </dt>
                  <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {handshakeStats?.label ?? 'Not run yet'}
                  </dd>
                  <dd className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Last run: {formatTimestamp(handshakeStats?.lastRunAt)}
                  </dd>
                </div>
                <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-4">
                  <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                    Readiness status
                  </dt>
                  <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {readinessStats?.label ?? 'Not run yet'}
                  </dd>
                  <dd className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Last run: {formatTimestamp(readinessStats?.lastRunAt)}
                  </dd>
                </div>
                <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-4">
                  <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-2">
                    JSON mode
                  </dt>
                  <dd className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                    {selectedProfile.metadata.supportsJsonMode === false
                      ? 'Fallback to plain text'
                      : 'JSON preferred'}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-col gap-4">
                <h4 className="font-semibold text-slate-900 dark:text-slate-50">Recent log entries</h4>
                <div className="max-h-80 overflow-y-auto flex flex-col gap-3">
                  {selectedProfile.diagnostics.length === 0 ? (
                    <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
                      Run diagnostics to populate logs.
                    </p>
                  ) : (
                    selectedProfile.diagnostics
                      .slice(-10)
                      .reverse()
                      .map((entry) => (
                        <article
                          key={entry.id}
                          className="border border-slate-300 dark:border-slate-600 rounded-xl p-4 flex flex-col gap-3 bg-slate-50/50 dark:bg-slate-900/30"
                        >
                          <header className="flex items-center justify-between">
                            <span
                              className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                                entry.status === 'pass'
                                  ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                                  : 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                              }`}
                            >
                              {entry.level === 'HANDSHAKE' ? 'L1' : 'L2'} {entry.status}
                            </span>
                            <time className="text-xs text-slate-500 dark:text-slate-400">
                              {formatTimestamp(entry.completedAt)}
                            </time>
                          </header>
                          <strong className="text-sm text-slate-900 dark:text-slate-50">
                            {entry.summary}
                          </strong>
                          <ul className="flex flex-col gap-2">
                            {entry.logs.map((log) => (
                              <li
                                key={log.id}
                                className={`text-xs border-l-2 pl-3 py-1 ${
                                  log.severity === 'error'
                                    ? 'border-danger-500 text-danger-700 dark:text-danger-400'
                                    : log.severity === 'warn'
                                    ? 'border-warning-500 text-warning-700 dark:text-warning-400'
                                    : 'border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400'
                                }`}
                              >
                                <span className="font-semibold">{formatTimestamp(log.timestamp)}</span>
                                <p className="mt-0.5">{log.message}</p>
                              </li>
                            ))}
                          </ul>
                        </article>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal isOpen={isProfileDialogOpen} onClose={handleCloseDialog} title={dialogTitle}>
        <form className="flex flex-col gap-6" onSubmit={handleSave}>
          {formError ? (
            <div className="rounded-xl border border-danger-200 dark:border-danger-700 bg-danger-50/70 dark:bg-danger-900/30 px-4 py-3 text-sm font-semibold text-danger-700 dark:text-danger-300">
              {formError}
            </div>
          ) : null}
          {feedback && isProfileDialogOpen ? (
            <div className="rounded-xl border border-accent-200 dark:border-accent-600 bg-accent-50/70 dark:bg-accent-900/30 px-4 py-3 text-sm font-semibold text-accent-700 dark:text-accent-300">
              {feedback}
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Name
              </span>
              <input
                required
                type="text"
                value={formState.name}
                onChange={handleChange('name')}
                placeholder="My LM Studio profile"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Provider
              </span>
              <input
                type="text"
                value={formState.provider}
                onChange={handleChange('provider')}
                placeholder="LM Studio"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Base URL
              </span>
              <input
                required
                type="text"
                value={formState.baseUrl}
                onChange={handleChange('baseUrl')}
                placeholder="http://localhost:1234/v1"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                API key
              </span>
              <input
                type="password"
                value={formState.apiKey}
                onChange={handleChange('apiKey')}
                placeholder="Optional"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col md:col-span-2">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Model ID
              </span>
              <input
                required
                type="text"
                value={formState.modelId}
                onChange={handleChange('modelId')}
                placeholder="example/model-identifier"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Temperature
              </span>
              <input
                type="number"
                step="0.1"
                value={formState.temperature}
                onChange={handleChange('temperature')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Max output tokens
              </span>
              <input
                type="number"
                value={formState.maxOutputTokens}
                onChange={handleChange('maxOutputTokens')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Request timeout (ms)
              </span>
              <input
                type="number"
                value={formState.requestTimeoutMs}
                onChange={handleChange('requestTimeoutMs')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Top P
              </span>
              <input
                type="number"
                step="0.05"
                value={formState.topP}
                onChange={handleChange('topP')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Frequency penalty
              </span>
              <input
                type="number"
                step="0.1"
                value={formState.frequencyPenalty}
                onChange={handleChange('frequencyPenalty')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Presence penalty
              </span>
              <input
                type="number"
                step="0.1"
                value={formState.presencePenalty}
                onChange={handleChange('presencePenalty')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
          </div>

          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Default system prompt
            </span>
            <textarea
              value={formState.defaultSystemPrompt}
              onChange={handleChange('defaultSystemPrompt')}
              rows={4}
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>

          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Notes
            </span>
            <textarea
              value={formState.notes}
              onChange={handleChange('notes')}
              rows={3}
              placeholder="Optional notes or troubleshooting tips"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>

          <div className="flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                Benchmark steps
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Enable or disable benchmark phases for this profile.
              </p>
            </div>
            <ul className="flex flex-col gap-4">
              {formState.benchmarkSteps.map((step, index) => (
                <li
                  key={step.id}
                  className="border border-slate-200 dark:border-slate-600 rounded-xl p-4 flex flex-col gap-3 bg-white dark:bg-slate-900/40 transition-theme"
                >
                  <div className="flex justify-between items-center gap-3">
                    <div>
                      <h4 className="font-semibold text-slate-900 dark:text-slate-50">
                        {step.label}
                      </h4>
                      {step.description ? (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          {step.description}
                        </p>
                      ) : null}
                    </div>
                    <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={step.enabled}
                        onChange={handleStepChange(index, 'enabled') as never}
                        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-accent-500"
                      />
                      Enabled
                    </label>
                  </div>
                  <label className="flex flex-col">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                      Prompt template
                    </span>
                    <textarea
                      value={step.promptTemplate}
                      onChange={handleStepChange(index, 'promptTemplate')}
                      rows={3}
                      className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                    />
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-4">
            <button
              className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving…' : dialogMode === 'edit' ? 'Save changes' : 'Create profile'}
            </button>
            {dialogMode === 'edit' || formState.id ? (
              <button
                className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                type="button"
                onClick={handleDeleteProfile}
              >
                Delete profile
              </button>
            ) : null}
          </div>
        </form>
      </Modal>
    </>
  );
};

export default Profiles;
