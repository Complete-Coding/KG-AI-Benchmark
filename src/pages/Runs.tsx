import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BenchmarkQuestion,
  BenchmarkRun,
  RunStatus,
} from '@/types/benchmark';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { questionLookup } from '@/data/questions';
import { createEmptyRunMetrics } from '@/data/defaults';
import { executeBenchmarkRun } from '@/services/benchmarkEngine';

const statusLabels: Record<RunStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const statusClass: Record<RunStatus, string> = {
  draft: 'pending',
  queued: 'pending',
  running: 'running',
  completed: 'ready',
  failed: 'failed',
  cancelled: 'failed',
};

const formatDateTime = (iso?: string) => {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
};

interface LaunchRunPayload {
  profileId: string;
  label: string;
  questionIds: string[];
  filters: string[];
}

const filterQuestions = (
  questions: BenchmarkQuestion[],
  filters: {
    types: Set<string>;
    difficulty: Set<string>;
    search: string;
    pyq: Set<string>;
  }
) => {
  const searchTerm = filters.search.trim().toLowerCase();

  return questions.filter((question) => {
    if (filters.types.size > 0 && !filters.types.has(question.type)) {
      return false;
    }

    if (filters.difficulty.size > 0 && !filters.difficulty.has(question.difficulty)) {
      return false;
    }

    if (filters.pyq.size > 0) {
      const year = question.metadata.pyq?.year ? String(question.metadata.pyq.year) : undefined;
      if (!year || !filters.pyq.has(year)) {
        return false;
      }
    }

    if (!searchTerm) {
      return true;
    }

    const haystack = `${question.prompt} ${question.instructions ?? ''}`.toLowerCase();
    return haystack.includes(searchTerm);
  });
};

interface NewRunPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onLaunch: (payload: LaunchRunPayload) => Promise<void>;
}

const NewRunPanel = ({ isOpen, onClose, onLaunch }: NewRunPanelProps) => {
  const { profiles, questions, questionSummary } = useBenchmarkContext();
  const [selectedProfileId, setSelectedProfileId] = useState<string>(profiles[0]?.id ?? '');
  const [runLabel, setRunLabel] = useState<string>(
    `Run ${new Date().toLocaleString()}`
  );
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(
    () => new Set(questions.map((question) => question.id))
  );
  const [filters, setFilters] = useState({
    types: new Set<string>(),
    difficulty: new Set<string>(),
    search: '',
    pyq: new Set<string>(),
  });
  const [launching, setLaunching] = useState(false);
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId),
    [profiles, selectedProfileId]
  );
  const filteredQuestions = useMemo(
    () => filterQuestions(questions, filters),
    [questions, filters]
  );
  const readinessPass =
    selectedProfile?.diagnostics.some(
      (entry) => entry.level === 'READINESS' && entry.status === 'pass'
    ) ?? false;

  const toggleSet = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  };

  const handleFilterToggle =
    (type: 'types' | 'difficulty' | 'pyq', value: string) => () => {
      setFilters((prev) => ({
        ...prev,
        [type]: toggleSet(prev[type], value),
      }));
    };

  const handleSelectQuestion = (questionId: string) => () => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedQuestionIds(new Set(filteredQuestions.map((question) => question.id)));
  };

  const handleClearSelection = () => {
    setSelectedQuestionIds(new Set());
  };

  const handleLaunch = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProfileId || selectedQuestionIds.size === 0) {
      return;
    }

    setLaunching(true);

    try {
      await onLaunch({
        profileId: selectedProfileId,
        label: runLabel,
        questionIds: [...selectedQuestionIds],
        filters: [
          filters.types.size ? `Types: ${[...filters.types].join(', ')}` : null,
          filters.difficulty.size ? `Difficulty: ${[...filters.difficulty].join(', ')}` : null,
          filters.pyq.size ? `PYQ Year: ${[...filters.pyq].join(', ')}` : null,
        ].filter(Boolean) as string[],
      });
      onClose();
    } finally {
      setLaunching(false);
    }
  };

  const uniqueTypes = useMemo(
    () => Array.from(new Set(questions.map((question) => question.type))).sort(),
    [questions]
  );
  const uniqueDifficulty = useMemo(
    () => Array.from(new Set(questions.map((question) => question.difficulty))).sort(),
    [questions]
  );
  const uniqueYears = useMemo(
    () =>
      Array.from(
        new Set(
          questions
            .map((question) => question.metadata.pyq?.year)
            .filter((year): year is number => typeof year === 'number')
            .map((year) => String(year))
        )
      ).sort(),
    [questions]
  );

  if (!isOpen) {
    return null;
  }

  return (
    <aside className="panel new-run">
      <header className="panel__header">
        <div>
          <h2>Launch new benchmark</h2>
          <p className="panel__subtitle">
            Select a validated profile and curate the question set (up to 100 items).
          </p>
        </div>
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </header>

      <form
        className="new-run__form"
        onSubmit={(event) => {
          void handleLaunch(event);
        }}
      >
        <label>
          <span>Run label</span>
          <input type="text" value={runLabel} onChange={(event) => setRunLabel(event.target.value)} />
        </label>
        <label>
          <span>Model profile</span>
          <select
            value={selectedProfileId}
            onChange={(event) => setSelectedProfileId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select profile
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} · {profile.modelId}
              </option>
            ))}
          </select>
        </label>
        {selectedProfile ? (
          <p className="panel__subtitle">
            Last readiness check: {selectedProfile.metadata.lastReadinessAt ? formatDateTime(selectedProfile.metadata.lastReadinessAt) : 'never'}
          </p>
        ) : null}

        <fieldset>
          <legend>Filters</legend>
          <div className="filter-tags">
            <div>
              <strong>Type</strong>
              <div className="filter-tags__group">
                {uniqueTypes.map((type) => (
                  <label key={type}>
                    <input
                      type="checkbox"
                      checked={filters.types.has(type)}
                      onChange={handleFilterToggle('types', type)}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <strong>Difficulty</strong>
              <div className="filter-tags__group">
                {uniqueDifficulty.map((difficulty) => (
                  <label key={difficulty}>
                    <input
                      type="checkbox"
                      checked={filters.difficulty.has(difficulty)}
                      onChange={handleFilterToggle('difficulty', difficulty)}
                    />
                    <span>{difficulty}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <strong>PYQ year</strong>
              <div className="filter-tags__group">
                {uniqueYears.map((year) => (
                  <label key={year}>
                    <input
                      type="checkbox"
                      checked={filters.pyq.has(year)}
                      onChange={handleFilterToggle('pyq', year)}
                    />
                    <span>{year}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <label className="new-run__search">
            <span>Search</span>
            <input
              type="search"
              value={filters.search}
              onChange={(event) =>
                setFilters((prev) => ({
                  ...prev,
                  search: event.target.value,
                }))
              }
              placeholder="Search question text"
            />
          </label>
        </fieldset>

        <div className="new-run__selection">
          <header>
            <h3>Select questions</h3>
            <div>
              <button type="button" className="button button--ghost" onClick={handleSelectAll}>
                Select all
              </button>
              <button type="button" className="button button--ghost" onClick={handleClearSelection}>
                Clear
              </button>
            </div>
          </header>
          <p className="panel__subtitle">
            Showing {filteredQuestions.length} questions from {questionSummary.label}. Selected{' '}
            {selectedQuestionIds.size}.
          </p>
          <ul className="question-list">
            {filteredQuestions.map((question) => {
              const isSelected = selectedQuestionIds.has(question.id);
              return (
                <li key={question.id} className={isSelected ? 'question-list__item question-list__item--selected' : 'question-list__item'}>
                  <label>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={handleSelectQuestion(question.id)}
                    />
                    <div>
                      <h4>
                        {question.type} · {question.difficulty}
                      </h4>
                      <p>{question.prompt}</p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="new-run__actions">
          <button
            className="button button--primary"
            type="submit"
            disabled={
              launching ||
              !selectedProfile ||
              selectedQuestionIds.size === 0 ||
              !readinessPass
            }
          >
            {launching ? 'Launching…' : 'Launch benchmark'}
          </button>
        </div>

        {!readinessPass ? (
          <p className="warning">
            Level 2 diagnostics have not passed for this profile. Run diagnostics before launching.
          </p>
        ) : null}
      </form>
    </aside>
  );
};

const Runs = () => {
  const { runs, profiles, questionSummary, upsertRun, deleteRun, getProfileById, getRunById } =
    useBenchmarkContext();
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [showNewRunPanel, setShowNewRunPanel] = useState(false);
  const [launchingRunId, setLaunchingRunId] = useState<string | null>(null);

  const filteredRuns = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return runs
      .filter((run) => (statusFilter === 'all' ? true : run.status === statusFilter))
      .filter((run) =>
        providerFilter === 'all'
          ? true
          : getProfileById(run.profileId)?.provider === providerFilter
      )
      .filter((run) => {
        if (!term) {
          return true;
        }
        const haystack = `${run.label} ${run.profileName} ${run.profileModelId}`.toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  }, [runs, statusFilter, providerFilter, searchTerm, getProfileById]);

  const providerOptions = useMemo(
    () => Array.from(new Set(profiles.map((profile) => profile.provider))),
    [profiles]
  );

  const handleDeleteRun = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    if (run.status === 'running') {
      const confirmed = window.confirm(
        'This run is still running. Deleting it will discard progress. Continue?'
      );
      if (!confirmed) {
        return;
      }
    } else {
      if (!window.confirm('Delete this run and all attempts?')) {
        return;
      }
    }

    deleteRun(runId);
  };

  const handleLaunchRun = async (payload: LaunchRunPayload) => {
    const profile = getProfileById(payload.profileId);
    if (!profile) {
      throw new Error('Profile not found');
    }

    const selectedQuestions = payload.questionIds
      .map((id) => questionLookup.get(id))
      .filter((question): question is BenchmarkQuestion => Boolean(question));

    const now = new Date().toISOString();
    const initialRun = upsertRun({
      label: payload.label,
      profileId: profile.id,
      profileName: profile.name,
      profileModelId: profile.modelId,
      status: 'running',
      createdAt: now,
      startedAt: now,
      questionIds: payload.questionIds,
      dataset: {
        label: questionSummary.label,
        totalQuestions: selectedQuestions.length,
        filters: payload.filters,
      },
      metrics: createEmptyRunMetrics(),
      attempts: [],
    });

    setLaunchingRunId(initialRun.id);

    const attempts: BenchmarkRun['attempts'] = [];
    let latestRun = initialRun;

    try {
      const completedRun = await executeBenchmarkRun({
        profile,
        questions: selectedQuestions,
        run: initialRun,
        onProgress: (attempt, _progress, metrics) => {
          attempts.push(attempt);
          latestRun = upsertRun({
            ...latestRun,
            status: 'running',
            attempts: [...attempts],
            metrics,
          });
        },
      });
      latestRun = upsertRun(completedRun);
    } catch (error) {
      latestRun = upsertRun({
        ...latestRun,
        status: 'failed',
        completedAt: new Date().toISOString(),
        summary: `Run failed: ${(error as Error).message}`,
      });
      throw error;
    } finally {
      setLaunchingRunId(null);
    }
  };

  return (
    <div className="runs">
      <section className="panel">
        <header className="panel__header runs__header">
          <div>
            <h2>Benchmark runs</h2>
            <p className="panel__subtitle">
              Review historical runs, filter by status, and drill into attempt analytics.
            </p>
          </div>
          <button className="button button--primary" type="button" onClick={() => setShowNewRunPanel(true)}>
            New run
          </button>
        </header>

        <div className="runs__filters">
          <label>
            <span>Status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | RunStatus)}
            >
              <option value="all">All</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
              <option value="all">All</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label className="runs__search">
            <span>Search</span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search run label or model"
            />
          </label>
        </div>

        {filteredRuns.length === 0 ? (
          <p className="empty-state">No runs match the selected filters.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Status</th>
                  <th scope="col">Profile</th>
                  <th scope="col">Accuracy</th>
                  <th scope="col">Avg latency</th>
                  <th scope="col">Questions</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr key={run.id}>
                    <th scope="row">
                      <Link to={`/runs/${run.id}`} className="data-table__model-name">
                        {run.label}
                      </Link>
                    </th>
                    <td>
                      <span className={`status-pill status-pill--${statusClass[run.status]}`}>
                        {statusLabels[run.status]}
                      </span>
                    </td>
                    <td>
                      <div className="data-table__model">
                        <span className="data-table__model-name">{run.profileName}</span>
                        <span className="data-table__model-id">{run.profileModelId}</span>
                      </div>
                    </td>
                    <td>
                      {run.metrics && run.status === 'completed'
                        ? `${(run.metrics.accuracy * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td>
                      {run.metrics && run.status === 'completed'
                        ? `${Math.round(run.metrics.averageLatencyMs)} ms`
                        : '—'}
                    </td>
                    <td>{run.questionIds.length}</td>
                    <td>{formatDateTime(run.createdAt)}</td>
                    <td className="runs__actions-cell">
                      <Link className="button button--ghost" to={`/runs/${run.id}`}>
                        View
                      </Link>
                      <button className="button button--danger" type="button" onClick={() => handleDeleteRun(run.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <NewRunPanel
        isOpen={showNewRunPanel}
        onClose={() => setShowNewRunPanel(false)}
        onLaunch={handleLaunchRun}
      />
      {launchingRunId ? (
        <div className="run-progress">
          <p>Executing run {launchingRunId}. Track progress from the runs table.</p>
        </div>
      ) : null}
    </div>
  );
};

export default Runs;
