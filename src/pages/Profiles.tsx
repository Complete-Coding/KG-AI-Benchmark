import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { ModelProfile, BenchmarkStepConfig, DiagnosticsLevel } from '@/types/benchmark';
import { DEFAULT_PROFILE_VALUES } from '@/data/defaults';
import { runDiagnostics } from '@/services/diagnostics';

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
    return { status: 'pending', label: 'Not run yet', lastRunAt: undefined };
  }

  const last = history[history.length - 1];
  return {
    status: last.status === 'pass' ? 'ready' : 'failed',
    label: last.summary,
    lastRunAt: last.completedAt,
  };
};

const Profiles = () => {
  const { profiles, upsertProfile, deleteProfile, recordDiagnostic } = useBenchmarkContext();
  const [selectedProfileId, setSelectedProfileId] = useState<string | undefined>(
    profiles[0]?.id ?? undefined
  );
  const [formState, setFormState] = useState<ProfileFormState>(() => toFormState(profiles[0]));
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [runningDiagnostics, setRunningDiagnostics] = useState<DiagnosticsLevel | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const handshakeStats = selectedProfile ? levelSummary(selectedProfile, 'HANDSHAKE') : null;
  const readinessStats = selectedProfile ? levelSummary(selectedProfile, 'READINESS') : null;

  useEffect(() => {
    setFormState(toFormState(selectedProfile));
  }, [selectedProfile]);

  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    setFeedback(null);
  };

  const handleCreateProfile = () => {
    setSelectedProfileId(undefined);
    setFormState(toFormState());
    setFeedback(null);
  };

  const handleChange =
    (field: keyof ProfileFormState) => (event: FormEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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

    try {
      const saved = upsertProfile(formState);
      setSelectedProfileId(saved.id);
      setFeedback('Profile saved successfully.');
    } catch (error) {
      setFeedback(`Failed to save profile: ${(error as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProfile = () => {
    if (!selectedProfile?.id) {
      return;
    }

    deleteProfile(selectedProfile.id);
    setSelectedProfileId(undefined);
    setFormState(toFormState());
    setFeedback('Profile deleted.');
  };

  const handleRunDiagnostics = async (level: DiagnosticsLevel) => {
    if (!selectedProfile) {
      return;
    }

    setRunningDiagnostics(level);
    setFeedback(null);

    try {
      const result = await runDiagnostics({ profile: selectedProfile, level });
      recordDiagnostic(result);
      setFeedback(`${level === 'HANDSHAKE' ? 'Handshake' : 'Readiness'} diagnostics complete.`);
    } catch (error) {
      setFeedback(`Diagnostics failed: ${(error as Error).message}`);
    } finally {
      setRunningDiagnostics(null);
    }
  };

  return (
    <div className="grid grid-cols-[minmax(260px,320px)_1fr] gap-8 items-start lg:grid-cols-1">
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex justify-between items-center gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Model profiles
            </h2>
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
        </header>

        {profiles.length === 0 ? (
          <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
            No profiles yet. Create one to get started.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {profiles.map((profile) => {
              const handshake = levelSummary(profile, 'HANDSHAKE');
              const readiness = levelSummary(profile, 'READINESS');
              const isActive = profile.id === selectedProfileId;

              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectProfile(profile.id)}
                    className={`w-full text-left border rounded-xl p-4 flex justify-between items-center gap-4 backdrop-blur-md transition-all duration-200 ${
                      isActive
                        ? 'bg-white/30 dark:bg-slate-700/50 border-white dark:border-slate-600'
                        : 'bg-white/10 dark:bg-slate-800/30 border-white/15 dark:border-slate-700/50 hover:bg-white/20 dark:hover:bg-slate-700/40 hover:-translate-y-0.5'
                    }`}
                  >
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-slate-50">
                        {profile.name}
                      </h3>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                        {profile.provider} &middot; {profile.modelId}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <span
                        className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                          handshake.status === 'ready'
                            ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                            : handshake.status === 'failed'
                            ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                            : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                        }`}
                      >
                        L1 {handshake.status === 'ready' ? 'Pass' : 'Pending'}
                      </span>
                      <span
                        className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                          readiness.status === 'ready'
                            ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                            : readiness.status === 'failed'
                            ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                            : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                        }`}
                      >
                        L2 {readiness.status === 'ready' ? 'Pass' : 'Pending'}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            {selectedProfile ? selectedProfile.name : 'Create profile'}
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Provide the connection details for your LM Studio deployment and customize prompts.
          </p>
        </header>
        <form className="flex flex-col gap-6" onSubmit={handleSave}>
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
                type="url"
                value={formState.baseUrl}
                onChange={handleChange('baseUrl')}
                placeholder="http://127.0.0.1:1234"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                API key
              </span>
              <input
                type="text"
                value={formState.apiKey}
                onChange={handleChange('apiKey')}
                placeholder="api-key (optional)"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Model identifier
              </span>
              <input
                required
                type="text"
                value={formState.modelId}
                onChange={handleChange('modelId')}
                placeholder="e.g., openai/gpt-oss-120b"
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Temperature
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formState.temperature}
                onChange={handleChange('temperature')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
              <small className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Lower = more focused, higher = more creative
              </small>
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Max output tokens
              </span>
              <input
                type="number"
                min="16"
                step="16"
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
                min="1000"
                step="1000"
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
                step="0.1"
                min="0"
                max="1"
                value={formState.topP}
                onChange={handleChange('topP')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
              <small className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Nucleus sampling for response diversity
              </small>
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Frequency penalty
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formState.frequencyPenalty}
                onChange={handleChange('frequencyPenalty')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
              <small className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Reduce token repetition in responses
              </small>
            </label>
            <label className="flex flex-col">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Presence penalty
              </span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formState.presencePenalty}
                onChange={handleChange('presencePenalty')}
                className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
              />
              <small className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Reduce topic repetition in responses
              </small>
            </label>
          </div>

          <label className="flex flex-col md:col-span-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Default system prompt
            </span>
            <textarea
              value={formState.defaultSystemPrompt}
              onChange={handleChange('defaultSystemPrompt')}
              rows={6}
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 resize-y focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>

          <label className="flex flex-col md:col-span-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Notes
            </span>
            <textarea
              value={formState.notes}
              onChange={handleChange('notes')}
              rows={3}
              placeholder="Add notes about this profile..."
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 resize-y focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>

          <div className="flex flex-col gap-4 md:col-span-2">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Benchmark steps
            </h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              Toggle steps to include in the prompt pipeline and adjust their instructions.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {formState.benchmarkSteps.map((step, index) => (
                <div
                  key={step.id}
                  className="border border-slate-300 dark:border-slate-600 rounded-xl p-4 flex flex-col gap-3 bg-slate-50/50 dark:bg-slate-900/30 transition-theme"
                >
                  <label className="flex items-center gap-2 font-semibold text-slate-900 dark:text-slate-50">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      onChange={handleStepChange(index, 'enabled')}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span>{step.label}</span>
                  </label>
                  {step.description && (
                    <p className="text-sm text-slate-600 dark:text-slate-400">{step.description}</p>
                  )}
                  <textarea
                    rows={4}
                    value={step.promptTemplate}
                    onChange={handleStepChange(index, 'promptTemplate')}
                    className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-slate-50 resize-y focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-4">
            <button
              className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              type="submit"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {selectedProfile?.id ? (
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

        {feedback ? (
          <p className="text-sm font-semibold text-success-700 dark:text-success-400">
            {feedback}
          </p>
        ) : null}

        {selectedProfile ? (
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
              <div className="flex gap-3">
                <button
                  className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-4 py-2.5 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                  onClick={() => {
                    void handleRunDiagnostics('HANDSHAKE');
                  }}
                  disabled={runningDiagnostics !== null}
                >
                  {runningDiagnostics === 'HANDSHAKE' ? 'Running…' : 'Run Level 1'}
                </button>
                <button
                  className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-4 py-2.5 rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button"
                  onClick={() => {
                    void handleRunDiagnostics('READINESS');
                  }}
                  disabled={runningDiagnostics !== null}
                >
                  {runningDiagnostics === 'READINESS' ? 'Running…' : 'Run Level 2'}
                </button>
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
              <h4 className="font-semibold text-slate-900 dark:text-slate-50">
                Recent log entries
              </h4>
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
        ) : null}
      </section>
    </div>
  );
};

export default Profiles;
