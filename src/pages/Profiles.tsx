import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { ModelProfile, BenchmarkStepConfig, DiagnosticsLevel } from '@/types/benchmark';
import { defaultBenchmarkSteps, defaultSystemPrompt } from '@/data/defaults';
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
        defaultSystemPrompt: profile.defaultSystemPrompt,
        notes: profile.notes ?? '',
        benchmarkSteps: profile.benchmarkSteps.map((step) => ({ ...step })),
      }
    : {
        name: 'New profile',
        provider: 'LM Studio',
        baseUrl: 'http://localhost:1234',
        apiKey: '',
        modelId: '',
        temperature: 0.2,
        maxOutputTokens: 512,
        requestTimeoutMs: 120000,
        defaultSystemPrompt,
        notes: '',
        benchmarkSteps: defaultBenchmarkSteps.map((step) => ({ ...step })),
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
        if (field === 'temperature' || field === 'maxOutputTokens' || field === 'requestTimeoutMs') {
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
    <div className="profiles">
      <section className="panel profiles__list">
        <header className="panel__header profiles__header">
          <div>
            <h2>Model profiles</h2>
            <p className="panel__subtitle">
              Configure LM Studio endpoints, credentials, and benchmark prompts.
            </p>
          </div>
          <button className="button button--primary" type="button" onClick={handleCreateProfile}>
            New profile
          </button>
        </header>

        {profiles.length === 0 ? (
          <p className="empty-state">No profiles yet. Create one to get started.</p>
        ) : (
          <ul className="profile-list">
            {profiles.map((profile) => {
              const handshake = levelSummary(profile, 'HANDSHAKE');
              const readiness = levelSummary(profile, 'READINESS');
              const isActive = profile.id === selectedProfileId;

              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => handleSelectProfile(profile.id)}
                    className={`profile-list__item${isActive ? ' profile-list__item--active' : ''}`}
                  >
                    <div>
                      <h3>{profile.name}</h3>
                      <p className="profile-list__meta">
                        {profile.provider} &middot; {profile.modelId}
                      </p>
                    </div>
                    <div className="profile-list__status">
                      <span className={`status-pill status-pill--${handshake.status}`}>
                        L1 {handshake.status === 'ready' ? 'Pass' : 'Pending'}
                      </span>
                      <span className={`status-pill status-pill--${readiness.status}`}>
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

      <section className="panel profiles__editor">
        <header className="panel__header">
          <h2>{selectedProfile ? selectedProfile.name : 'Create profile'}</h2>
          <p className="panel__subtitle">
            Provide the connection details for your LM Studio deployment and customize prompts.
          </p>
        </header>
        <form className="profile-form" onSubmit={handleSave}>
          <div className="profile-form__grid">
            <label>
              <span>Name</span>
              <input
                required
                type="text"
                value={formState.name}
                onChange={handleChange('name')}
                placeholder="My LM Studio profile"
              />
            </label>
            <label>
              <span>Provider</span>
              <input
                type="text"
                value={formState.provider}
                onChange={handleChange('provider')}
                placeholder="LM Studio"
              />
            </label>
            <label>
              <span>Base URL</span>
              <input
                required
                type="url"
                value={formState.baseUrl}
                onChange={handleChange('baseUrl')}
                placeholder="http://127.0.0.1:1234"
              />
            </label>
            <label>
              <span>API key</span>
              <input
                type="text"
                value={formState.apiKey}
                onChange={handleChange('apiKey')}
                placeholder="api-key"
              />
            </label>
            <label>
              <span>Model identifier</span>
              <input
                required
                type="text"
                value={formState.modelId}
                onChange={handleChange('modelId')}
                placeholder="openai/gpt-oss-120b"
              />
            </label>
            <label>
              <span>Temperature</span>
              <input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={formState.temperature}
                onChange={handleChange('temperature')}
              />
            </label>
            <label>
              <span>Max output tokens</span>
              <input
                type="number"
                min="16"
                step="16"
                value={formState.maxOutputTokens}
                onChange={handleChange('maxOutputTokens')}
              />
            </label>
            <label>
              <span>Request timeout (ms)</span>
              <input
                type="number"
                min="1000"
                step="1000"
                value={formState.requestTimeoutMs}
                onChange={handleChange('requestTimeoutMs')}
              />
            </label>
          </div>

          <label className="profile-form__wide">
            <span>Default system prompt</span>
            <textarea
              value={formState.defaultSystemPrompt}
              onChange={handleChange('defaultSystemPrompt')}
              rows={6}
            />
          </label>

          <label className="profile-form__wide">
            <span>Notes</span>
            <textarea value={formState.notes} onChange={handleChange('notes')} rows={3} />
          </label>

          <div className="profile-form__steps">
            <h3>Benchmark steps</h3>
            <p className="panel__subtitle">
              Toggle steps to include in the prompt pipeline and adjust their instructions.
            </p>
            <div className="profile-form__steps-grid">
              {formState.benchmarkSteps.map((step, index) => (
                <div key={step.id} className="step-card">
                  <label className="step-card__header">
                    <input
                      type="checkbox"
                      checked={step.enabled}
                      onChange={handleStepChange(index, 'enabled')}
                    />
                    <span>{step.label}</span>
                  </label>
                  {step.description && <p>{step.description}</p>}
                  <textarea
                    rows={4}
                    value={step.promptTemplate}
                    onChange={handleStepChange(index, 'promptTemplate')}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="profile-form__actions">
            <button className="button button--primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            {selectedProfile?.id ? (
              <button
                className="button button--danger"
                type="button"
                onClick={handleDeleteProfile}
              >
                Delete profile
              </button>
            ) : null}
          </div>
        </form>

        {feedback ? <p className="feedback">{feedback}</p> : null}

        {selectedProfile ? (
          <div className="diagnostics">
            <header className="diagnostics__header">
              <div>
                <h3>Diagnostics</h3>
                <p className="panel__subtitle">
                  Run Level 1 (handshake) and Level 2 (readiness) checks before kicking off long
                  benchmarks.
                </p>
              </div>
              <div className="diagnostics__actions">
                <button
                  className="button"
                  type="button"
                  onClick={() => {
                    void handleRunDiagnostics('HANDSHAKE');
                  }}
                  disabled={runningDiagnostics !== null}
                >
                  {runningDiagnostics === 'HANDSHAKE' ? 'Running…' : 'Run Level 1'}
                </button>
                <button
                  className="button"
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
            <dl className="diagnostics__summary">
              <div>
                <dt>Handshake status</dt>
                <dd>{handshakeStats?.label ?? 'Not run yet'}</dd>
                <dd>Last run: {formatTimestamp(handshakeStats?.lastRunAt)}</dd>
              </div>
              <div>
                <dt>Readiness status</dt>
                <dd>{readinessStats?.label ?? 'Not run yet'}</dd>
                <dd>Last run: {formatTimestamp(readinessStats?.lastRunAt)}</dd>
              </div>
              <div>
                <dt>JSON mode</dt>
                <dd>
                  {selectedProfile.metadata.supportsJsonMode === false
                    ? 'Fallback to plain text'
                    : 'JSON preferred'}
                </dd>
              </div>
            </dl>
            <div className="diagnostics__logs">
              <h4>Recent log entries</h4>
              <div className="diagnostics__log-stream">
                {selectedProfile.diagnostics.length === 0 ? (
                  <p className="empty-state">Run diagnostics to populate logs.</p>
                ) : (
                  selectedProfile.diagnostics
                    .slice(-10)
                    .reverse()
                    .map((entry) => (
                      <article key={entry.id} className="diagnostics__log-entry">
                        <header>
                          <span className={`status-pill status-pill--${entry.status === 'pass' ? 'ready' : 'failed'}`}>
                            {entry.level === 'HANDSHAKE' ? 'L1' : 'L2'} {entry.status}
                          </span>
                          <time>{formatTimestamp(entry.completedAt)}</time>
                        </header>
                        <strong>{entry.summary}</strong>
                        <ul>
                          {entry.logs.map((log) => (
                            <li key={log.id} className={`log log--${log.severity}`}>
                              <span>{formatTimestamp(log.timestamp)}</span>
                              <p>{log.message}</p>
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
