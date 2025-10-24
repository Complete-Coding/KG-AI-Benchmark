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
import Modal from '@/components/Modal';

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

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Launch new benchmark">
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          void handleLaunch(event);
        }}
      >
        <p className="text-slate-600 dark:text-slate-400 text-sm">
          Select a validated profile and curate the question set (up to 100 items).
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Run label
            </span>
            <input
              type="text"
              value={runLabel}
              onChange={(event) => setRunLabel(event.target.value)}
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>
          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Model profile
            </span>
            <select
              value={selectedProfileId}
              onChange={(event) => setSelectedProfileId(event.target.value)}
              required
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl pl-3 pr-10 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat"
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
        </div>

        {selectedProfile ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Last readiness check: {selectedProfile.metadata.lastReadinessAt ? formatDateTime(selectedProfile.metadata.lastReadinessAt) : 'never'}
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-4 border border-slate-300 dark:border-slate-600 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-900/30">
          <legend className="font-semibold text-slate-900 dark:text-slate-50 px-2">
            Filters
          </legend>
          <div className="flex flex-col gap-4">
            <div>
              <strong className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                Type
              </strong>
              <div className="flex flex-wrap gap-2">
                {uniqueTypes.map((type) => (
                  <label
                    key={type}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.types.has(type)}
                      onChange={handleFilterToggle('types', type)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{type}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <strong className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                Difficulty
              </strong>
              <div className="flex flex-wrap gap-2">
                {uniqueDifficulty.map((difficulty) => (
                  <label
                    key={difficulty}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.difficulty.has(difficulty)}
                      onChange={handleFilterToggle('difficulty', difficulty)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{difficulty}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <strong className="text-sm font-semibold text-slate-700 dark:text-slate-300 block mb-2">
                PYQ year
              </strong>
              <div className="flex flex-wrap gap-2">
                {uniqueYears.map((year) => (
                  <label
                    key={year}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={filters.pyq.has(year)}
                      onChange={handleFilterToggle('pyq', year)}
                      className="w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-300">{year}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <label className="flex flex-col">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Search
            </span>
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
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>
        </fieldset>

        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-50">
              Select questions
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                onClick={handleSelectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                onClick={handleClearSelection}
              >
                Clear
              </button>
            </div>
          </header>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Showing {filteredQuestions.length} questions from {questionSummary.label}. Selected{' '}
            {selectedQuestionIds.size}.
          </p>
          <ul className="max-h-96 overflow-y-auto flex flex-col gap-2 border border-slate-300 dark:border-slate-600 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/30">
            {filteredQuestions.map((question) => {
              const isSelected = selectedQuestionIds.has(question.id);
              return (
                <li
                  key={question.id}
                  className={`border rounded-lg p-3 transition-all ${
                    isSelected
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                      : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-accent-300 dark:hover:border-accent-700'
                  }`}
                >
                  <label className="flex gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={handleSelectQuestion(question.id)}
                      className="w-4 h-4 mt-1 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                        {question.type} · {question.difficulty}
                      </h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                        {question.prompt}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>

        {!readinessPass ? (
          <p className="bg-warning-100 dark:bg-warning-900/30 border border-warning-300 dark:border-warning-700 text-warning-800 dark:text-warning-400 px-4 py-3 rounded-xl text-sm">
            Level 2 diagnostics have not passed for this profile. Run diagnostics before launching.
          </p>
        ) : null}

        <div className="flex justify-end gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-6 py-3 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
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
      </form>
    </Modal>
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
    <div className="flex flex-col gap-6">
      <header className="flex justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Runs
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem] mt-1">
            Review historical runs, filter by status, and drill into attempt analytics.
          </p>
        </div>
        <button
          className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-4 py-2.5 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
          type="button"
          onClick={() => setShowNewRunPanel(true)}
        >
          New run
        </button>
      </header>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            All runs
          </h2>
        </header>

        <div className="flex flex-col md:flex-row gap-4">
          <label className="flex flex-col w-full md:w-auto md:max-w-48">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Status
            </span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | RunStatus)}
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl pl-3 pr-10 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat"
            >
              <option value="all">All</option>
              {Object.entries(statusLabels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col w-full md:w-auto md:max-w-48">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Provider
            </span>
            <select
              value={providerFilter}
              onChange={(event) => setProviderFilter(event.target.value)}
              className="appearance-none bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl pl-3 pr-10 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] dark:bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%239ca3af%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5rem_1.5rem] bg-[right_0.5rem_center] bg-no-repeat"
            >
              <option value="all">All</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col flex-1">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Search
            </span>
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search run label or model"
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-xl px-3 py-2.5 text-slate-900 dark:text-slate-50 focus:ring-2 focus:ring-accent-500 focus:border-accent-500 transition-theme"
            />
          </label>
        </div>

        {filteredRuns.length === 0 ? (
          <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
            No runs match the selected filters.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[0.95rem]">
              <thead className="text-left text-slate-600 dark:text-slate-400 font-semibold">
                <tr>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Run
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Status
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Profile
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Accuracy
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Avg latency
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Questions
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Created
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    className="hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <th
                      scope="row"
                      className="px-5 py-4 border-b border-slate-200 dark:border-slate-700"
                    >
                      <Link
                        to={`/runs/${run.id}`}
                        className="font-semibold text-slate-900 dark:text-slate-50 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                      >
                        {run.label}
                      </Link>
                    </th>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                      <span
                        className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                          statusClass[run.status] === 'ready'
                            ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                            : statusClass[run.status] === 'failed'
                            ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                            : statusClass[run.status] === 'running'
                            ? 'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-400'
                            : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                        }`}
                      >
                        {statusLabels[run.status]}
                      </span>
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">
                          {run.profileName}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {run.profileModelId}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed'
                        ? `${(run.metrics.accuracy * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed'
                        ? `${Math.round(run.metrics.averageLatencyMs)} ms`
                        : '—'}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.questionIds.length}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex gap-2">
                        <Link
                          className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                          to={`/runs/${run.id}`}
                        >
                          View
                        </Link>
                        <button
                          className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-3 py-1.5 rounded-lg text-sm shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                          type="button"
                          onClick={() => handleDeleteRun(run.id)}
                        >
                          Delete
                        </button>
                      </div>
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
        <div className="fixed bottom-6 right-6 bg-accent-600 text-white px-6 py-4 rounded-xl shadow-lg">
          <p className="font-semibold">Executing run {launchingRunId}. Track progress from the runs table.</p>
        </div>
      ) : null}
    </div>
  );
};

export default Runs;
