import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ActiveRunPhase,
  BenchmarkQuestion,
  BenchmarkRun,
  RunStatus,
} from '@/types/benchmark';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { questionLookup } from '@/data/questions';
import { createEmptyRunMetrics } from '@/data/defaults';
import { executeBenchmarkRun } from '@/services/benchmarkEngine';
import { runDiagnostics } from '@/services/diagnostics';
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
  draft: 'draft',
  queued: 'queued',
  running: 'running',
  completed: 'ready',
  failed: 'failed',
  cancelled: 'failed',
};

const activeRunStatusLabels: Record<ActiveRunPhase, string> = {
  starting: 'Starting',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const activeRunStatusClasses: Record<ActiveRunPhase, string> = {
  starting:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  running:
    'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  completed:
    'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  failed:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
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

const formatDuration = (startedAt?: string, completedAt?: string) => {
  if (!startedAt) {
    return '—';
  }

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return '—';
  }

  const totalSeconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const formatLatency = (latencyMs?: number) => {
  if (!Number.isFinite(latencyMs) || latencyMs == null) {
    return '—';
  }
  if (latencyMs >= 1000) {
    return `${(latencyMs / 1000).toFixed(2)} s`;
  }
  return `${Math.round(latencyMs)} ms`;
};

interface LaunchRunPayload {
  profileIds: string[];  // Changed to array for multi-profile support
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
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(
    () => new Set(profiles.length > 0 ? [profiles[0].id] : [])
  );
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
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const filteredQuestions = useMemo(
    () => filterQuestions(questions, filters),
    [questions, filters]
  );

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

  const handleToggleProfile = (profileId: string) => () => {
    setSelectedProfileIds((prev) => toggleSet(prev, profileId));
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
    if (selectedProfileIds.size === 0 || selectedQuestionIds.size === 0) {
      return;
    }

    setLaunching(true);

    try {
      await onLaunch({
        profileIds: [...selectedProfileIds],
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
        <div className="flex flex-col gap-2 text-sm text-slate-600 dark:text-slate-400">
          <p>Select a validated profile and curate the question set (up to 100 items).</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            After launch we will open a full-screen dashboard so you can watch the run in real time.
          </p>
        </div>

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

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Model profiles
            </span>
            <span className="text-xs font-semibold text-accent-700 dark:text-accent-400 px-2.5 py-1 rounded-full bg-accent-100 dark:bg-accent-900/30">
              {selectedProfileIds.size} selected → {selectedProfileIds.size} {selectedProfileIds.size === 1 ? 'run' : 'runs'} will be created
            </span>
          </div>
          <div className="max-h-60 overflow-y-auto flex flex-col gap-2 border border-slate-300 dark:border-slate-600 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/30">
            {profiles.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-3">
                No profiles available. Create a profile first.
              </p>
            ) : (
              profiles.map((profile) => {
                const isSelected = selectedProfileIds.has(profile.id);
                const hasReadiness = profile.diagnostics.some(
                  (entry) => entry.level === 'READINESS' && entry.status === 'pass'
                );
                return (
                  <label
                    key={profile.id}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                        : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:border-accent-300 dark:hover:border-accent-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={handleToggleProfile(profile.id)}
                      className="w-4 h-4 mt-1 rounded border-slate-300 dark:border-slate-600 text-accent-600 focus:ring-2 focus:ring-accent-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">
                          {profile.name}
                        </span>
                        {hasReadiness ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400">
                            Ready
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400">
                            Not Ready
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-0.5">
                        {profile.modelId}
                      </p>
                      {profile.metadata.lastReadinessAt ? (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Last check: {formatDateTime(profile.metadata.lastReadinessAt)}
                        </p>
                      ) : null}
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4 border border-slate-300 dark:border-slate-600 rounded-xl bg-slate-50/50 dark:bg-slate-900/30">
          <button
            type="button"
            onClick={() => setFiltersExpanded(!filtersExpanded)}
            className="flex items-center justify-between w-full px-4 py-3 font-semibold text-slate-900 dark:text-slate-50 hover:bg-slate-100/50 dark:hover:bg-slate-800/50 rounded-xl transition-colors text-left"
          >
            <span>Filters</span>
            <svg
              className={`w-5 h-5 text-slate-500 dark:text-slate-400 transition-transform ${filtersExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {filtersExpanded ? (
            <div className="flex flex-col gap-4 px-4 pb-4">
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
            </div>
          ) : null}
        </div>

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

        <p className="bg-info-100 dark:bg-info-900/30 border border-info-300 dark:border-info-700 text-info-800 dark:text-info-400 px-4 py-3 rounded-xl text-sm">
          Diagnostics will run automatically before each benchmark. Runs will be skipped if diagnostics fail.
        </p>

        <div className="flex justify-end gap-4 pt-4 border-t border-slate-200 dark:border-slate-700">
          <button
            className="bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-6 py-3 rounded-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            type="submit"
            disabled={
              launching ||
              selectedProfileIds.size === 0 ||
              selectedQuestionIds.size === 0
            }
          >
            {launching ? 'Starting…' : `Run benchmark${selectedProfileIds.size > 1 ? 's' : ''}`}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const Runs = () => {
  const {
    loading,
    runs,
    profiles,
    questionSummary,
    upsertRun,
    deleteRun,
    getProfileById,
    getRunById,
    activeRun,
    beginActiveRun,
    setActiveRunCurrentQuestion,
    recordActiveRunAttempt,
    finalizeActiveRun,
    clearActiveRun,
    enqueueRun,
    runQueue,
    getQueuePosition,
    recordDiagnostic,
  } = useBenchmarkContext();
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<'all' | RunStatus>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [showNewRunPanel, setShowNewRunPanel] = useState(false);
  const [executingRunIds, setExecutingRunIds] = useState<Set<string>>(new Set());

  // Ref to prevent race conditions in useEffect
  const startingRunsRef = useRef<Set<string>>(new Set());

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
    } else if (!window.confirm('Delete this run and all attempts?')) {
      return;
    }

    deleteRun(runId);
  };

  // Helper: Check if run can be resumed (has partial attempts)
  const canResumeRun = (run: BenchmarkRun): boolean => {
    // Only failed/cancelled runs can be resumed
    if (run.status !== 'failed' && run.status !== 'cancelled') {
      return false;
    }

    // Must have some attempts but not all
    const attemptedQuestionIds = new Set(run.attempts.map((a) => a.questionId));
    const hasPartialAttempts = attemptedQuestionIds.size > 0 && attemptedQuestionIds.size < run.questionIds.length;

    return hasPartialAttempts;
  };

  const handleResumeBenchmark = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    const profile = getProfileById(run.profileId);
    if (!profile) {
      alert('Profile not found. The model profile may have been deleted.');
      return;
    }

    // Find unanswered questions
    const attemptedQuestionIds = new Set(run.attempts.map((a) => a.questionId));
    const unansweredQuestionIds = run.questionIds.filter((id) => !attemptedQuestionIds.has(id));

    if (unansweredQuestionIds.length === 0) {
      alert('All questions have been answered. Use Rerun to start fresh.');
      return;
    }

    // Update run to queued status and queue it
    const resumedRun = upsertRun({
      ...run,
      status: 'queued',
      summary: `Resuming from ${attemptedQuestionIds.size}/${run.questionIds.length} questions answered`,
      notes: run.notes
        ? `${run.notes}\n\nResumed at ${new Date().toISOString()}`
        : `Resumed at ${new Date().toISOString()}`,
    });

    enqueueRun(resumedRun.id);
    setShowNewRunPanel(false);
  };

  const handleStartDraftRun = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    const profile = getProfileById(run.profileId);
    if (!profile) {
      alert('Profile not found. The model profile may have been deleted.');
      return;
    }

    // Update draft run to queued status and queue it
    const queuedRun = upsertRun({
      ...run,
      status: 'queued',
      summary: `Starting benchmark with ${run.questionIds.length} questions`,
    });

    enqueueRun(queuedRun.id);
    setShowNewRunPanel(false);
  };

  const handleRerunBenchmark = (runId: string) => {
    const run = getRunById(runId);
    if (!run) {
      return;
    }

    const profile = getProfileById(run.profileId);
    if (!profile) {
      alert('Profile not found. The model profile may have been deleted.');
      return;
    }

    const payload: LaunchRunPayload = {
      profileIds: [run.profileId],  // Wrap in array for multi-profile support
      label: `Rerun of ${run.label}`,
      questionIds: run.questionIds,
      filters: run.dataset.filters ?? [],
    };

    void handleLaunchRun(payload);
  };

  const handleLaunchRun = (payload: LaunchRunPayload): Promise<void> => {
    const { profileIds } = payload;

    if (profileIds.length === 0) {
      throw new Error('No profiles selected');
    }

    // Get selected questions (common for all runs)
    const selectedQuestions = payload.questionIds
      .map((id) => questionLookup.get(id))
      .filter((question): question is BenchmarkQuestion => Boolean(question));

    if (selectedQuestions.length === 0) {
      throw new Error('No questions selected');
    }

    const questionDescriptors = selectedQuestions.map((question, index) => {
      const questionNumber = index + 1;
      const label = question.questionId
        ? `Question ${questionNumber} (ID: ${question.questionId})`
        : `Question ${questionNumber}`;

      return {
        id: question.id,
        order: index,
        label,
        prompt: question.prompt,
        type: question.type,
      };
    });

    const now = new Date().toISOString();
    const createdRuns: BenchmarkRun[] = [];

    // Create a run for each selected profile
    profileIds.forEach((profileId, index) => {
      const profile = getProfileById(profileId);
      if (!profile) {
        console.error(`Profile ${profileId} not found, skipping`);
        return;
      }

      // Add profile name suffix if multiple profiles selected
      const runLabel = profileIds.length > 1
        ? `${payload.label} - ${profile.name} (${index + 1}/${profileIds.length})`
        : payload.label;

      const run = upsertRun({
        label: runLabel,
        profileId: profile.id,
        profileName: profile.name,
        profileModelId: profile.modelId,
        status: 'draft',  // Start as draft, will be updated by enqueueRun
        createdAt: now,
        questionIds: payload.questionIds,
        dataset: {
          label: questionSummary.label,
          totalQuestions: selectedQuestions.length,
          filters: payload.filters,
        },
        metrics: createEmptyRunMetrics(),
        attempts: [],
      });

      createdRuns.push(run);
    });

    if (createdRuns.length === 0) {
      throw new Error('Failed to create any runs');
    }

    // Enqueue all created runs
    createdRuns.forEach((run) => {
      enqueueRun(run.id);
    });

    // Navigate to the first run's detail page
    const firstRun = createdRuns[0];
    void navigate(`/runs/${firstRun.id}?live=1`);

    // Execute the first run (which is now the current run)
    const executeRun = (run: BenchmarkRun) => {
      const profile = getProfileById(run.profileId);
      if (!profile) {
        console.error(`Profile ${run.profileId} not found for execution`);
        return;
      }

      // Update run status to running and set start time
      const runningRun = upsertRun({
        ...run,
        status: 'running',
        startedAt: new Date().toISOString(),
      });

      beginActiveRun({
        runId: runningRun.id,
        label: runningRun.label,
        profileName: runningRun.profileName,
        profileModelId: runningRun.profileModelId,
        datasetLabel: questionSummary.label,
        filters: payload.filters,
        questions: questionDescriptors,
        startedAt: runningRun.startedAt ?? now,
      });

      const attempts: BenchmarkRun['attempts'] = [];
      let latestRun = runningRun;

      const runTask = async () => {
        try {
          const completedRun = await executeBenchmarkRun({
            profile,
            questions: selectedQuestions,
            run: runningRun,
            onQuestionStart: (question) => {
              setActiveRunCurrentQuestion({
                runId: runningRun.id,
                questionId: question.id,
                timestamp: new Date().toISOString(),
              });
            },
            onProgress: (attempt, _progress, metrics) => {
              attempts.push(attempt);
              recordActiveRunAttempt({
                runId: runningRun.id,
                questionId: attempt.questionId,
                attemptId: attempt.id,
                passed: attempt.evaluation.passed,
                latencyMs: attempt.latencyMs,
                notes: attempt.error ?? attempt.evaluation.notes,
                metrics,
                timestamp: new Date().toISOString(),
              });
              latestRun = upsertRun({
                ...latestRun,
                status: 'running',
                attempts: [...attempts],
                metrics,
              });
            },
          });

          latestRun = upsertRun(completedRun);
          finalizeActiveRun({
            runId: completedRun.id,
            status: 'completed',
            summary: completedRun.summary ?? 'Run completed',
            metrics: completedRun.metrics,
            completedAt: completedRun.completedAt ?? new Date().toISOString(),
          });
        } catch (error) {
          const errorMessage = (error as Error).message;
          latestRun = upsertRun({
            ...latestRun,
            status: 'failed',
            completedAt: new Date().toISOString(),
            summary: `Run failed: ${errorMessage}`,
          });
          finalizeActiveRun({
            runId: latestRun.id,
            status: 'failed',
            summary: latestRun.summary ?? 'Run failed',
            metrics: latestRun.metrics,
            completedAt: latestRun.completedAt ?? new Date().toISOString(),
            error: errorMessage,
          });
          console.error('Benchmark run failed', error);
        }
      };

      void runTask();
    };

    // Execute the first run immediately (it's the current run in the queue)
    executeRun(firstRun);

    return Promise.resolve();
  };

  const showInlineActiveRun = Boolean(
    activeRun && (activeRun.status === 'starting' || activeRun.status === 'running')
  );
  const inlineTotalQuestions = activeRun?.totalQuestions ?? 0;
  const inlineAnsweredCount = activeRun
    ? activeRun.metrics.passedCount + activeRun.metrics.failedCount
    : 0;
  const inlineProgressPercent =
    activeRun && inlineTotalQuestions > 0
      ? Math.round((inlineAnsweredCount / inlineTotalQuestions) * 100)
      : 0;
  const inlineStatusLabel = activeRun ? activeRunStatusLabels[activeRun.status] : '';
  const inlineStatusClass = activeRun ? activeRunStatusClasses[activeRun.status] : '';
  const inlineUpdated = activeRun ? formatDateTime(activeRun.updatedAt) : undefined;
  const inlineElapsed = activeRun ? formatDuration(activeRun.startedAt, activeRun.completedAt) : '—';

  const handleOpenNewRunPanel = () => setShowNewRunPanel(true);
  const handleCloseNewRunPanel = () => setShowNewRunPanel(false);

  const handleNavigateToActive = () => {
    if (!activeRun) {
      return;
    }
    void navigate(`/runs/${activeRun.runId}?live=1`);
  };

  // Auto-start queued runs when they become current
  useEffect(() => {
    const { currentRunId } = runQueue;
    if (!currentRunId) {
      return;
    }

    // Check if this run needs to be executed
    const currentRun = getRunById(currentRunId);
    if (!currentRun) {
      return;
    }

    // Only execute if not already running/completed and not already being executed
    if (currentRun.status !== 'draft' && currentRun.status !== 'queued') {
      console.log(`[Queue] Skipping run ${currentRunId} - status is ${currentRun.status}`);
      return;
    }

    // Prevent duplicate execution - check both state and ref
    if (executingRunIds.has(currentRunId) || startingRunsRef.current.has(currentRunId)) {
      console.log(`[Queue] Skipping run ${currentRunId} - already executing or starting`);
      return;
    }

    // Mark as starting (synchronous, prevents race condition)
    startingRunsRef.current.add(currentRunId);

    console.log(`[Queue] Auto-starting run ${currentRunId}, status: ${currentRun.status}`);
    console.log(`[Queue] Current queue state:`, { currentRunId, queuedCount: runQueue.queuedRunIds.length });

    // Add to executing set
    setExecutingRunIds((prev) => {
      const next = new Set(prev);
      next.add(currentRunId);
      return next;
    });

    // Get the profile and questions for this run
    const profile = getProfileById(currentRun.profileId);
    if (!profile) {
      console.error(`Profile ${currentRun.profileId} not found for run ${currentRunId}`);
      return;
    }

    // Check if this is a resumed run (has existing attempts)
    const attemptedQuestionIds = new Set(currentRun.attempts.map((a) => a.questionId));
    const isResuming = attemptedQuestionIds.size > 0;

    // Filter to only unanswered questions if resuming
    const questionsToProcess = isResuming
      ? currentRun.questionIds.filter((id) => !attemptedQuestionIds.has(id))
      : currentRun.questionIds;

    console.log(
      `[Queue] Run ${currentRunId} - ${isResuming ? 'Resuming' : 'Starting'} with ${questionsToProcess.length}/${currentRun.questionIds.length} questions`
    );

    const selectedQuestions = questionsToProcess
      .map((id) => questionLookup.get(id))
      .filter((question): question is BenchmarkQuestion => Boolean(question));

    if (selectedQuestions.length === 0) {
      console.log(`[Queue] No questions to process for run ${currentRunId} - marking as completed`);

      // All questions already answered, mark as completed
      const completedRun = upsertRun({
        ...currentRun,
        status: 'completed',
        completedAt: new Date().toISOString(),
        summary: 'All questions already answered',
      });

      finalizeActiveRun({
        runId: completedRun.id,
        status: 'completed',
        summary: completedRun.summary ?? 'Run completed',
        metrics: completedRun.metrics,
        completedAt: completedRun.completedAt ?? new Date().toISOString(),
      });

      return;
    }

    const questionDescriptors = selectedQuestions.map((question, index) => {
      const questionNumber = index + 1;
      const label = question.questionId
        ? `Question ${questionNumber} (ID: ${question.questionId})`
        : `Question ${questionNumber}`;

      return {
        id: question.id,
        order: index,
        label,
        prompt: question.prompt,
        type: question.type,
      };
    });

    // Update run status to running and set start time
    const runningRun = upsertRun({
      ...currentRun,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    beginActiveRun({
      runId: runningRun.id,
      label: runningRun.label,
      profileName: runningRun.profileName,
      profileModelId: runningRun.profileModelId,
      datasetLabel: questionSummary.label,
      filters: currentRun.dataset.filters,
      questions: questionDescriptors,
      startedAt: runningRun.startedAt ?? new Date().toISOString(),
    });

    // Preserve existing attempts if resuming
    const attempts: BenchmarkRun['attempts'] = isResuming ? [...currentRun.attempts] : [];
    let latestRun = runningRun;

    const runTask = async () => {
      try {
        // Run diagnostics before benchmark execution
        console.log(`[Queue] Running diagnostics for profile ${profile.id} before run ${runningRun.id}`);

        // Run HANDSHAKE diagnostics
        const handshakeResult = await runDiagnostics({ profile, level: 'HANDSHAKE' });
        recordDiagnostic(handshakeResult);

        if (handshakeResult.status === 'fail') {
          const errorMessage = `Diagnostics failed (HANDSHAKE): ${handshakeResult.summary}`;
          console.error(`[Queue] ${errorMessage}`);

          // Mark run as failed
          latestRun = upsertRun({
            ...latestRun,
            status: 'failed',
            completedAt: new Date().toISOString(),
            summary: errorMessage,
          });
          finalizeActiveRun({
            runId: latestRun.id,
            status: 'failed',
            summary: errorMessage,
            metrics: latestRun.metrics,
            completedAt: latestRun.completedAt ?? new Date().toISOString(),
            error: errorMessage,
          });
          return; // Skip this run
        }

        // Run READINESS diagnostics
        const readinessResult = await runDiagnostics({ profile, level: 'READINESS' });
        recordDiagnostic(readinessResult);

        if (readinessResult.status === 'fail') {
          const errorMessage = `Diagnostics failed (READINESS): ${readinessResult.summary}`;
          console.error(`[Queue] ${errorMessage}`);

          // Mark run as failed
          latestRun = upsertRun({
            ...latestRun,
            status: 'failed',
            completedAt: new Date().toISOString(),
            summary: errorMessage,
          });
          finalizeActiveRun({
            runId: latestRun.id,
            status: 'failed',
            summary: errorMessage,
            metrics: latestRun.metrics,
            completedAt: latestRun.completedAt ?? new Date().toISOString(),
            error: errorMessage,
          });
          return; // Skip this run
        }

        console.log(`[Queue] Diagnostics passed for profile ${profile.id}, proceeding with run ${runningRun.id}`);

        // Proceed with benchmark execution
        const completedRun = await executeBenchmarkRun({
          profile,
          questions: selectedQuestions,
          run: runningRun,
          onQuestionStart: (question) => {
            setActiveRunCurrentQuestion({
              runId: runningRun.id,
              questionId: question.id,
              timestamp: new Date().toISOString(),
            });
          },
          onProgress: (attempt, _progress, metrics) => {
            attempts.push(attempt);
            recordActiveRunAttempt({
              runId: runningRun.id,
              questionId: attempt.questionId,
              attemptId: attempt.id,
              passed: attempt.evaluation.passed,
              latencyMs: attempt.latencyMs,
              notes: attempt.error ?? attempt.evaluation.notes,
              metrics,
              timestamp: new Date().toISOString(),
            });
            latestRun = upsertRun({
              ...latestRun,
              status: 'running',
              attempts: [...attempts],
              metrics,
            });
          },
        });

        latestRun = upsertRun(completedRun);
        finalizeActiveRun({
          runId: completedRun.id,
          status: 'completed',
          summary: completedRun.summary ?? 'Run completed',
          metrics: completedRun.metrics,
          completedAt: completedRun.completedAt ?? new Date().toISOString(),
        });
      } catch (error) {
        const errorMessage = (error as Error).message;
        latestRun = upsertRun({
          ...latestRun,
          status: 'failed',
          completedAt: new Date().toISOString(),
          summary: `Run failed: ${errorMessage}`,
        });
        finalizeActiveRun({
          runId: latestRun.id,
          status: 'failed',
          summary: latestRun.summary ?? 'Run failed',
          metrics: latestRun.metrics,
          completedAt: latestRun.completedAt ?? new Date().toISOString(),
          error: errorMessage,
        });
        console.error('Benchmark run failed', error);
      } finally {
        // Remove from both tracking structures when done
        console.log(`[Queue] Cleaning up run ${currentRunId}`);
        startingRunsRef.current.delete(currentRunId);
        setExecutingRunIds((prev) => {
          const next = new Set(prev);
          next.delete(currentRunId);
          return next;
        });
      }
    };

    void runTask();
  }, [
    runQueue.currentRunId,
    // Remove 'runs' - it causes re-runs on every run update
    // getRunById will fetch latest data
    executingRunIds,
    getRunById,
    getProfileById,
    upsertRun,
    beginActiveRun,
    setActiveRunCurrentQuestion,
    recordActiveRunAttempt,
    finalizeActiveRun,
    recordDiagnostic, // Added for diagnostics
    questionSummary.label,
  ]);

  if (loading) {
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
        </header>

        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-accent-200 dark:border-accent-800 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin"></div>
            <p className="text-slate-600 dark:text-slate-400 font-medium">Loading runs...</p>
          </div>
        </div>
      </div>
    );
  }

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
          onClick={handleOpenNewRunPanel}
        >
          New run
        </button>
      </header>

      {showInlineActiveRun && activeRun ? (
        <section className="bg-accent-50 dark:bg-accent-900/10 border border-accent-200 dark:border-accent-700 rounded-2xl p-5 flex flex-col gap-3 transition-theme">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">
                Active benchmark
              </p>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                {activeRun.label}
              </h2>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {activeRun.profileName} · {activeRun.profileModelId}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dataset {activeRun.datasetLabel} · Elapsed {inlineElapsed}
              </p>
              {inlineUpdated ? (
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Updated {inlineUpdated}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span
                className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${inlineStatusClass}`}
              >
                {inlineStatusLabel}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNavigateToActive}
                  className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                >
                  View progress
                </button>
                {activeRun.status === 'completed' || activeRun.status === 'failed' ? (
                  <button
                    type="button"
                    onClick={clearActiveRun}
                    className="text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 transition-colors"
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs font-semibold text-accent-700 dark:text-accent-300 mb-2">
              <span>
                {inlineAnsweredCount} of {inlineTotalQuestions} answered
              </span>
              <span>{inlineProgressPercent}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-accent-200/60 dark:bg-accent-900/40 overflow-hidden">
              <div
                className="h-full bg-accent-500 transition-all duration-300"
                style={{ width: `${inlineProgressPercent}%` }}
              />
            </div>
          </div>
        </section>
      ) : null}

      {runQueue.queuedRunIds.length > 0 ? (
        <section className="bg-warning-50 dark:bg-warning-900/10 border border-warning-200 dark:border-warning-700 rounded-2xl p-5 flex flex-col gap-3 transition-theme">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning-700 dark:text-warning-300">
                Run Queue
              </p>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {runQueue.queuedRunIds.length} {runQueue.queuedRunIds.length === 1 ? 'run' : 'runs'} waiting{' '}
                {runQueue.currentRunId ? 'for current run to complete' : 'to start'}
              </p>
              <ul className="flex flex-col gap-1.5 mt-2">
                {runQueue.queuedRunIds.slice(0, 3).map((runId, index) => {
                  const run = getRunById(runId);
                  if (!run) {
                    return null;
                  }
                  return (
                    <li key={runId} className="flex items-center gap-2 text-sm">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-warning-200 dark:bg-warning-800 text-warning-800 dark:text-warning-200 font-semibold text-xs">
                        {index + 1}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-50">
                        {run.label}
                      </span>
                      <span className="text-slate-500 dark:text-slate-400">
                        · {run.profileName}
                      </span>
                    </li>
                  );
                })}
                {runQueue.queuedRunIds.length > 3 ? (
                  <li className="text-xs text-slate-500 dark:text-slate-400 ml-8">
                    ... and {runQueue.queuedRunIds.length - 3} more
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

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
          <p className="p-4 sm:p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center text-sm sm:text-base">
            No runs match the selected filters.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:-mx-6 lg:-mx-10 px-4 sm:px-6 lg:px-10">
            <table className="w-full min-w-[1100px] border-collapse text-sm sm:text-[0.95rem]">
              <thead className="text-left text-slate-600 dark:text-slate-400 font-semibold text-xs sm:text-sm">
                <tr>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Run
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Profile
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Answer Accuracy
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Topology Accuracy
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Avg latency
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Questions
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Created
                  </th>
                  <th scope="col" className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => navigate(`/runs/${run.id}`)}
                    className="cursor-pointer hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors"
                  >
                    <th
                      scope="row"
                      className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700"
                    >
                      <span className="font-semibold text-slate-900 dark:text-slate-50">
                        {run.label}
                      </span>
                    </th>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full text-xs font-semibold uppercase tracking-wide ${
                            statusClass[run.status] === 'ready'
                              ? 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400'
                              : statusClass[run.status] === 'failed'
                              ? 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400'
                              : statusClass[run.status] === 'running'
                              ? 'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-400'
                              : statusClass[run.status] === 'queued'
                              ? 'bg-info-100 text-info-800 dark:bg-info-900/30 dark:text-info-400'
                              : statusClass[run.status] === 'draft'
                              ? 'bg-slate-100 text-slate-800 dark:bg-slate-700/30 dark:text-slate-400'
                              : 'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400'
                          }`}
                        >
                          {statusLabels[run.status]}
                        </span>
                        {run.status === 'queued' && (() => {
                          const position = getQueuePosition(run.id);
                          const isCurrentRun = runQueue.currentRunId === run.id;

                          if (isCurrentRun) {
                            return (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-accent-200 dark:bg-accent-800 text-accent-800 dark:text-accent-200">
                                Currently Running
                              </span>
                            );
                          }

                          return position > 0 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-info-200 dark:bg-info-800 text-info-800 dark:text-info-200">
                              #{position} in queue
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-900 dark:text-slate-50">
                          {run.profileName}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          {run.profileModelId}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed'
                        ? `${(run.metrics.accuracy * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed'
                        ? `${(run.metrics.topologyAccuracy * 100).toFixed(1)}%`
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.metrics && run.status === 'completed'
                        ? formatLatency(run.metrics.averageLatencyMs)
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {run.questionIds.length}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {formatDateTime(run.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 sm:px-4 sm:py-3 lg:px-5 lg:py-4 border-b border-slate-200 dark:border-slate-700">
                      <div className="flex gap-2">
                        <Link
                          className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                          to={`/runs/${run.id}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          View
                        </Link>

                        {/* Draft runs: Show Start button */}
                        {run.status === 'draft' && (
                          <button
                            className="bg-gradient-to-r from-success-600 to-success-700 hover:from-success-700 hover:to-success-800 text-white font-semibold px-3 py-1.5 rounded-lg text-sm shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartDraftRun(run.id);
                            }}
                            title="Start this benchmark run"
                          >
                            Start
                          </button>
                        )}

                        {/* Queued runs: Show queue position */}
                        {run.status === 'queued' && (() => {
                          const position = getQueuePosition(run.id);
                          const isCurrentRun = runQueue.currentRunId === run.id;

                          return (
                            <span className="border border-info-400 dark:border-info-500 bg-info-500/8 dark:bg-info-500/10 text-info-700 dark:text-info-400 font-semibold px-3 py-1.5 rounded-lg text-sm">
                              {isCurrentRun ? 'Running...' : `Queued (#${position})`}
                            </span>
                          );
                        })()}

                        {/* Running runs: Show running indicator */}
                        {run.status === 'running' && (
                          <span className="border border-info-400 dark:border-info-500 bg-info-500/8 dark:bg-info-500/10 text-info-700 dark:text-info-400 font-semibold px-3 py-1.5 rounded-lg text-sm">
                            Running...
                          </span>
                        )}

                        {/* Completed/Failed/Cancelled runs: Show Resume (if resumable) and Rerun */}
                        {(run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') && (
                          <>
                            {canResumeRun(run) && (
                              <button
                                className="border border-warning-400 dark:border-warning-500 bg-warning-500/8 dark:bg-warning-500/10 text-warning-700 dark:text-warning-400 hover:bg-warning-500/16 dark:hover:bg-warning-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleResumeBenchmark(run.id);
                                }}
                                title="Resume from where it left off"
                              >
                                Resume
                              </button>
                            )}
                            <button
                              className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-3 py-1.5 rounded-lg text-sm transition-all duration-200"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRerunBenchmark(run.id);
                              }}
                              title="Rerun with same settings"
                            >
                              Rerun
                            </button>
                          </>
                        )}

                        {/* Delete button - show for all non-running statuses */}
                        {run.status !== 'running' && (
                          <button
                            className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-3 py-1.5 rounded-lg text-sm shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRun(run.id);
                            }}
                          >
                            Delete
                          </button>
                        )}
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
        onClose={handleCloseNewRunPanel}
        onLaunch={handleLaunchRun}
      />
    </div>
  );
};

export default Runs;
