import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ActiveRunQuestionStatus,
  BenchmarkAttempt,
  BenchmarkQuestion,
  RunStatus,
} from '@/types/benchmark';
import { useBenchmarkContext } from '@/context/BenchmarkContext';
import { questionLookup } from '@/data/questions';
import { createEmptyRunMetrics } from '@/data/defaults';
import { executeBenchmarkRun } from '@/services/benchmarkEngine';

const runStatusLabels: Record<RunStatus, string> = {
  draft: 'Draft',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const runStatusClasses: Record<RunStatus, string> = {
  draft:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  queued:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  running:
    'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  completed:
    'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  failed:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
  cancelled:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
};

const questionStatusLabels: Record<ActiveRunQuestionStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  passed: 'Passed',
  failed: 'Failed',
  partial: 'Partial',
};

const questionStatusClasses: Record<ActiveRunQuestionStatus, string> = {
  queued:
    'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
  running:
    'bg-accent-100 text-accent-800 dark:bg-accent-900/30 dark:text-accent-300',
  passed:
    'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  partial:
    'bg-warning-100 text-warning-800 dark:bg-warning-900/30 dark:text-warning-400',
  failed:
    'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
};

const stepStatusClasses: Record<'passed' | 'failed' | 'completed', string> = {
  passed: 'bg-success-100 text-success-800 dark:bg-success-900/30 dark:text-success-400',
  failed: 'bg-danger-100 text-danger-800 dark:bg-danger-900/30 dark:text-danger-400',
  completed: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
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

const formatElapsed = (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '—';
  }

  const totalSeconds = Math.floor(ms / 1000);
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

const computeElapsedMs = (startedAt?: string, completedAt?: string) => {
  if (!startedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return end - start;
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

interface QuestionItem {
  id: string;
  label: string;
  prompt: string;
  type: string;
  status: ActiveRunQuestionStatus;
  topologyStatus?: 'passed' | 'failed';
  answerStatus?: 'passed' | 'failed';
  latencyMs?: number;
  attempt?: BenchmarkAttempt;
}

const RunDetail = () => {
  const { runId } = useParams();
  const navigate = useNavigate();
  const {
    getRunById,
    getProfileById,
    deleteRun,
    activeRun,
    upsertRun,
    questionSummary,
    beginActiveRun,
    setActiveRunCurrentQuestion,
    recordActiveRunAttempt,
    finalizeActiveRun,
  } = useBenchmarkContext();
  const run = runId ? getRunById(runId) : undefined;
  const isActiveRun = Boolean(run && activeRun && activeRun.runId === run.id);
  const [elapsedMs, setElapsedMs] = useState(() =>
    computeElapsedMs(run?.startedAt, run?.completedAt ?? activeRun?.completedAt)
  );

  useEffect(() => {
    setElapsedMs(computeElapsedMs(run?.startedAt, run?.completedAt ?? activeRun?.completedAt));

    if (
      !isActiveRun ||
      !run?.startedAt ||
      activeRun?.status === 'completed' ||
      activeRun?.status === 'failed'
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setElapsedMs(computeElapsedMs(run?.startedAt, activeRun?.completedAt));
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    isActiveRun,
    run?.startedAt,
    run?.completedAt,
    activeRun?.completedAt,
    activeRun?.status,
    activeRun?.runId,
  ]);

  const attemptsByQuestion = useMemo(() => {
    const map = new Map<string, BenchmarkAttempt>();
    run?.attempts.forEach((attempt) => {
      map.set(attempt.questionId, attempt);
    });
    return map;
  }, [run?.attempts]);

  const questionItems = useMemo<QuestionItem[]>(() => {
    if (!run) {
      return [];
    }
    if (isActiveRun && activeRun) {
      return activeRun.questions.map((question) => {
        const attempt = attemptsByQuestion.get(question.id);

        // For active runs, compute topology and answer statuses from attempt if available
        const topologyStatus = attempt?.topologyEvaluation
          ? attempt.topologyEvaluation.passed
            ? 'passed'
            : 'failed'
          : undefined;

        const answerStatus = attempt
          ? attempt.evaluation.passed
            ? 'passed'
            : 'failed'
          : undefined;

        return {
          id: question.id,
          label: question.label,
          prompt: question.prompt,
          type: question.type,
          status: question.status,
          topologyStatus,
          answerStatus,
          latencyMs: attempt?.latencyMs ?? question.latencyMs,
          attempt,
        };
      });
    }

    return run.questionIds.map((questionId, index) => {
      const attempt = attemptsByQuestion.get(questionId);
      const sourceQuestion = questionLookup.get(questionId);
      const questionNumber = index + 1;
      const numericId = sourceQuestion?.questionId;
      const label = numericId
        ? `Question ${questionNumber} (ID: ${numericId})`
        : `Question ${questionNumber}`;
      const prompt = attempt?.questionSnapshot.prompt ?? sourceQuestion?.prompt ?? '';
      const type = attempt?.questionSnapshot.type ?? sourceQuestion?.type ?? 'Unknown';

      // Separate topology and answer statuses
      const topologyStatus = attempt?.topologyEvaluation
        ? attempt.topologyEvaluation.passed
          ? 'passed'
          : 'failed'
        : undefined;

      const answerStatus = attempt
        ? attempt.evaluation.passed
          ? 'passed'
          : 'failed'
        : undefined;

      // Determine overall status based on BOTH topology and answer
      let status: ActiveRunQuestionStatus = 'queued';
      if (attempt) {
        const answerPassed = attempt.evaluation.passed;
        const topologyPassed = attempt.topologyEvaluation?.passed;

        if (topologyPassed === undefined) {
          // No topology evaluation, just use answer
          status = answerPassed ? 'passed' : 'failed';
        } else if (answerPassed && topologyPassed) {
          status = 'passed'; // Both passed
        } else if (!answerPassed && !topologyPassed) {
          status = 'failed'; // Both failed
        } else {
          status = 'partial'; // Mixed results
        }
      }

      return {
        id: questionId,
        label,
        prompt,
        type,
        status,
        topologyStatus,
        answerStatus,
        latencyMs: attempt?.latencyMs,
        attempt,
      };
    });
  }, [activeRun, attemptsByQuestion, isActiveRun, run]);

  const [selectedQuestionId, setSelectedQuestionId] = useState<string | undefined>(() =>
    questionItems[0]?.id
  );

  useEffect(() => {
    if (!questionItems.length) {
      setSelectedQuestionId(undefined);
      return;
    }

    // For active runs, only auto-select if no question is currently selected
    // or if the selected question doesn't exist
    if (isActiveRun && activeRun?.currentQuestionId) {
      // Only auto-follow if user hasn't manually selected a different question
      if (!selectedQuestionId || !questionItems.some((item) => item.id === selectedQuestionId)) {
        setSelectedQuestionId(activeRun.currentQuestionId);
      }
      return;
    }

    if (!selectedQuestionId || !questionItems.some((item) => item.id === selectedQuestionId)) {
      setSelectedQuestionId(questionItems[0].id);
    }
  }, [activeRun?.currentQuestionId, isActiveRun, questionItems, selectedQuestionId]);

  const selectedItem =
    questionItems.find((item) => item.id === selectedQuestionId) ?? questionItems[0];

  const selectedDefinition = useMemo(() => {
    if (!selectedItem) {
      return undefined;
    }
    if (selectedItem.attempt?.questionSnapshot) {
      return selectedItem.attempt.questionSnapshot;
    }
    return questionLookup.get(selectedItem.id);
  }, [selectedItem]);

  if (!run) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme">
        <header className="flex flex-col gap-2 mb-6">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Run not found
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            The requested run does not exist. Head back to the runs list and try again.
          </p>
        </header>
        <Link
          className="inline-block bg-gradient-to-r from-accent-600 to-accent-700 hover:from-accent-700 hover:to-accent-800 text-white font-semibold px-6 py-2.5 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
          to="/runs"
        >
          Back to runs
        </Link>
      </section>
    );
  }

  const accuracy = run.metrics.accuracy ? `${(run.metrics.accuracy * 100).toFixed(1)}%` : '—';
  const averageLatency = formatLatency(run.metrics.averageLatencyMs);
  const totalLatency = formatLatency(run.metrics.totalLatencyMs);
  const answeredCount = run.metrics.passedCount + run.metrics.failedCount;
  const totalQuestions = run.questionIds.length;
  const remainingCount = Math.max(totalQuestions - answeredCount, 0);
  const elapsed = formatElapsed(elapsedMs);
  const lastUpdated = isActiveRun
    ? formatDateTime(activeRun?.updatedAt)
    : formatDateTime(run.completedAt ?? run.startedAt);
  const tokensSummary = run.attempts.reduce(
    (acc, attempt) => ({
      prompt: acc.prompt + (attempt.promptTokens ?? 0),
      completion: acc.completion + (attempt.completionTokens ?? 0),
      total: acc.total + (attempt.totalTokens ?? 0),
    }),
    { prompt: 0, completion: 0, total: 0 }
  );

  const handleDelete = () => {
    const message =
      run.status === 'running'
        ? 'This run is still running. Deleting it will discard progress. Continue?'
        : 'Delete this run and all attempt data?';
    if (!window.confirm(message)) {
      return;
    }
    deleteRun(run.id);
    void navigate('/runs');
  };

  const handleRerun = () => {
    if (!run) {
      return;
    }

    const profile = getProfileById(run.profileId);
    if (!profile) {
      alert('Profile not found. The model profile may have been deleted.');
      return;
    }

    const readinessPass = profile.diagnostics.some(
      (entry) => entry.level === 'READINESS' && entry.status === 'pass'
    );

    if (!readinessPass) {
      const confirmed = window.confirm(
        'Level 2 diagnostics have not passed for this profile. Run diagnostics before launching. Continue anyway?'
      );
      if (!confirmed) {
        return;
      }
    }

    const selectedQuestions = run.questionIds
      .map((id) => questionLookup.get(id))
      .filter((question): question is BenchmarkQuestion => Boolean(question));

    if (selectedQuestions.length === 0) {
      alert('No questions found for this run.');
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

    const now = new Date().toISOString();
    const newRun = upsertRun({
      label: `Rerun of ${run.label}`,
      profileId: profile.id,
      profileName: profile.name,
      profileModelId: profile.modelId,
      status: 'running',
      createdAt: now,
      startedAt: now,
      questionIds: run.questionIds,
      dataset: {
        label: questionSummary.label,
        totalQuestions: selectedQuestions.length,
        filters: run.dataset.filters ?? [],
      },
      metrics: createEmptyRunMetrics(),
      attempts: [],
    });

    beginActiveRun({
      runId: newRun.id,
      label: newRun.label,
      profileName: newRun.profileName,
      profileModelId: newRun.profileModelId,
      datasetLabel: questionSummary.label,
      filters: run.dataset.filters ?? [],
      questions: questionDescriptors,
      startedAt: now,
    });

    void navigate(`/runs/${newRun.id}?live=1`);

    const attempts: BenchmarkAttempt[] = [];
    let latestRun = newRun;

    const runTask = async () => {
      try {
        const completedRun = await executeBenchmarkRun({
          profile,
          questions: selectedQuestions,
          run: newRun,
          onQuestionStart: (question) => {
            setActiveRunCurrentQuestion({
              runId: newRun.id,
              questionId: question.id,
              timestamp: new Date().toISOString(),
            });
          },
          onProgress: (attempt, _progress, metrics) => {
            attempts.push(attempt);
            recordActiveRunAttempt({
              runId: newRun.id,
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

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6">
        <div className="flex flex-col gap-4">
          <Link
            className="inline-flex items-center gap-1.5 text-accent-700 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300 font-semibold transition-colors"
            to="/runs"
          >
            ← Back to runs
          </Link>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-3xl font-semibold text-slate-900 dark:text-slate-50">
                {run.label}
              </h2>
              <span
                className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${runStatusClasses[run.status]}`}
              >
                {runStatusLabels[run.status]}
              </span>
              {isActiveRun && activeRun?.status === 'running' ? (
                <span className="px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide bg-accent-500 text-white animate-pulse">
                  Live
                </span>
              ) : null}
            </div>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
              Profile {run.profileName} · {run.profileModelId}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Started {formatDateTime(run.startedAt)} · Last update {lastUpdated}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="border border-accent-400 dark:border-accent-500 bg-accent-500/8 dark:bg-accent-500/10 text-accent-700 dark:text-accent-400 hover:bg-accent-500/16 dark:hover:bg-accent-500/20 font-semibold px-4 py-2 rounded-xl transition-all duration-200"
            type="button"
            onClick={handleRerun}
            title="Rerun with same settings"
          >
            Rerun
          </button>
          <button
            className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
            type="button"
            onClick={handleDelete}
          >
            Delete run
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <article className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Answer Accuracy
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{accuracy}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.metrics.passedCount} passed · {run.metrics.failedCount} failed
          </p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Topology Accuracy
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {run.metrics.topologyAccuracy ? `${(run.metrics.topologyAccuracy * 100).toFixed(1)}%` : '—'}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.metrics.topologyPassedCount} passed · {run.metrics.topologyFailedCount} failed
          </p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Average latency
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {averageLatency}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">Total {totalLatency}</p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Elapsed
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">{elapsed}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Updated {lastUpdated}
          </p>
        </article>
        <article className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-2 transition-theme">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Questions
          </h3>
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-50">
            {answeredCount}/{totalQuestions}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {remainingCount} remaining
          </p>
        </article>
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-4 transition-theme">
        <header className="flex flex-col gap-1">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Dataset
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {run.dataset.label} · {run.dataset.totalQuestions} questions
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          {run.dataset.filters.length === 0 ? (
            <span className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300">
              No additional filters
            </span>
          ) : (
            run.dataset.filters.map((filter) => (
              <span
                key={filter}
                className="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-sm text-slate-700 dark:text-slate-300"
              >
                {filter}
              </span>
            ))
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Prompt tokens
            </h4>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tokensSummary.prompt.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Completion tokens
            </h4>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tokensSummary.completion.toLocaleString()}
            </p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total tokens
            </h4>
            <p className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              {tokensSummary.total.toLocaleString()}
            </p>
          </div>
        </div>
        {run.summary ? (
          <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl">
            {run.summary}
          </p>
        ) : null}
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Attempt breakdown
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Inspect model responses, evaluations, and status for each question. Live runs will
            automatically follow the active question.
          </p>
        </header>
        {questionItems.length === 0 ? (
          <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
            No questions tracked for this run.
          </p>
        ) : (
          <div className="flex flex-col lg:flex-row gap-6">
            <nav className="lg:w-72 flex-shrink-0">
              <ul className="flex flex-row lg:flex-col gap-3 overflow-x-auto pb-2 lg:pb-0">
                {questionItems.map((item) => {
                  const isSelected = item.id === selectedItem?.id;
                  return (
                    <li key={item.id} className="min-w-[14rem] lg:min-w-0">
                      <button
                        type="button"
                        onClick={() => setSelectedQuestionId(item.id)}
                        className={`w-full text-left rounded-xl border p-4 flex flex-col gap-2 transition-all ${
                          isSelected
                            ? 'border-accent-400 dark:border-accent-500 bg-accent-50 dark:bg-accent-900/20 shadow-sm'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-accent-300 dark:hover:border-accent-500'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {item.label}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${questionStatusClasses[item.status]}`}
                          >
                            {questionStatusLabels[item.status]}
                          </span>
                        </div>
                        {item.topologyStatus || item.answerStatus ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {item.topologyStatus && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-500 dark:text-slate-400">T:</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    item.topologyStatus === 'passed'
                                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                                      : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                                  }`}
                                >
                                  {item.topologyStatus === 'passed' ? '✓' : '✗'}
                                </span>
                              </div>
                            )}
                            {item.answerStatus && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-slate-500 dark:text-slate-400">A:</span>
                                <span
                                  className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                    item.answerStatus === 'passed'
                                      ? 'bg-success-100 text-success-700 dark:bg-success-900/30 dark:text-success-400'
                                      : 'bg-danger-100 text-danger-700 dark:bg-danger-900/30 dark:text-danger-400'
                                  }`}
                                >
                                  {item.answerStatus === 'passed' ? '✓' : '✗'}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>{item.type}</span>
                          <span>{formatLatency(item.latencyMs)}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <article className="flex-1 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 bg-slate-50 dark:bg-slate-900/30 flex flex-col gap-4 transition-theme">
              {selectedItem ? (
                <>
                  <header className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h4 className="text-xl font-semibold text-slate-900 dark:text-slate-50">
                        {selectedItem.label}
                      </h4>
                      <span
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wide ${questionStatusClasses[selectedItem.status]}`}
                      >
                        {questionStatusLabels[selectedItem.status]}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {selectedItem.type} · Latency {formatLatency(selectedItem.latencyMs)}
                    </p>
                  </header>

                  <section className="flex flex-col gap-3 bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Prompt
                    </h5>
                    <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {selectedItem.prompt || 'Prompt unavailable.'}
                    </p>
                  </section>

                  {selectedItem.attempt ? (
                    <>
                      <section
                        className={`rounded-xl border p-4 flex flex-col gap-3 ${
                          selectedItem.attempt.evaluation.passed
                            ? 'border-success-200 bg-success-50 dark:border-success-800/60 dark:bg-success-900/20'
                            : 'border-danger-200 bg-danger-50 dark:border-danger-800/60 dark:bg-danger-900/20'
                        }`}
                      >
                        <div className="flex flex-col gap-1">
                          <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            {selectedItem.attempt.evaluation.passed
                              ? 'Model answered correctly'
                              : 'Model answer failed evaluation'}
                          </h5>
                          {selectedItem.attempt.evaluation.notes ? (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              {selectedItem.attempt.evaluation.notes}
                            </p>
                          ) : null}
                          {selectedItem.attempt.error ? (
                            <p className="text-sm text-danger-700 dark:text-danger-400">
                              Error: {selectedItem.attempt.error}
                            </p>
                          ) : null}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Expected
                            </span>
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                              {selectedItem.attempt.evaluation.expected || '—'}
                            </span>
                          </div>
                          <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Received
                            </span>
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                              {selectedItem.attempt.evaluation.received || '—'}
                            </span>
                          </div>
                          <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Confidence
                            </span>
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                              {selectedItem.attempt.evaluation.metrics?.confidence != null
                                ? `${(selectedItem.attempt.evaluation.metrics.confidence * 100).toFixed(0)}%`
                                : '—'}
                            </span>
                          </div>
                          <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Tokens
                            </span>
                            <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                              {selectedItem.attempt.totalTokens
                                ? `${selectedItem.attempt.totalTokens} (prompt ${
                                    selectedItem.attempt.promptTokens ?? 0
                                  }, completion ${selectedItem.attempt.completionTokens ?? 0})`
                                : '—'}
                            </span>
                          </div>
                        </div>
                      </section>

                      {selectedItem.attempt.topologyEvaluation ? (
                        <section className="border border-accent-200 dark:border-accent-700 rounded-xl bg-accent-50/60 dark:bg-accent-900/10 p-4 flex flex-col gap-3">
                          <header className="flex items-center justify-between gap-2">
                            <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                              Topology comparison
                            </h5>
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${selectedItem.attempt.topologyEvaluation.passed ? stepStatusClasses.passed : stepStatusClasses.failed}`}
                            >
                              {selectedItem.attempt.topologyEvaluation.passed ? 'Matched' : 'Mismatch'}
                            </span>
                          </header>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Expected topology
                              </span>
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                                {selectedItem.attempt.topologyEvaluation.expected || '—'}
                              </span>
                            </div>
                            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Predicted topology
                              </span>
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                                {selectedItem.attempt.topologyEvaluation.received || '—'}
                              </span>
                            </div>
                            <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1">
                              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Confidence
                              </span>
                              <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                                {selectedItem.attempt.topologyEvaluation.metrics?.confidence != null
                                  ? `${Math.round(
                                      selectedItem.attempt.topologyEvaluation.metrics.confidence * 100
                                    )}%`
                                  : '—'}
                              </span>
                            </div>
                            {selectedItem.attempt.topologyEvaluation.notes ? (
                              <div className="bg-white dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-1 sm:col-span-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Notes
                                </span>
                                <span className="text-sm text-slate-700 dark:text-slate-300">
                                  {selectedItem.attempt.topologyEvaluation.notes}
                                </span>
                              </div>
                            ) : null}
                          </div>
                          {selectedItem.attempt.topologyPrediction ? (
                            <section className="border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-900/40">
                              <header className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                                <h6 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Raw topology response
                                </h6>
                              </header>
                              <pre className="p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-x-auto">
{JSON.stringify(selectedItem.attempt.topologyPrediction, null, 2)}
                              </pre>
                            </section>
                          ) : null}
                        </section>
                      ) : null}

                      {selectedItem.attempt.steps?.length ? (
                        <section className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/40">
                          <header className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
                            <h6 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                              Step breakdown
                            </h6>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {selectedItem.attempt.steps.length} step
                              {selectedItem.attempt.steps.length === 1 ? '' : 's'}
                            </span>
                          </header>
                          <div className="p-4 flex flex-col gap-4">
                            {selectedItem.attempt.steps.map((step) => {
                              const statusKey: 'passed' | 'failed' | 'completed' = step.evaluation
                                ? step.evaluation.passed
                                  ? 'passed'
                                  : 'failed'
                                : 'completed';
                              const tokensText = step.usage?.totalTokens
                                ? `${step.usage.totalTokens} (prompt ${step.usage.promptTokens ?? 0}, completion ${step.usage.completionTokens ?? 0})`
                                : '—';
                              return (
                                <article
                                  key={`${step.id}-${step.order}`}
                                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 flex flex-col gap-3"
                                >
                                  <header className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Step {step.order + 1}
                                      </span>
                                      <h6 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                                        {step.label}
                                      </h6>
                                    </div>
                                    <span
                                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${stepStatusClasses[statusKey]}`}
                                    >
                                      {statusKey === 'completed'
                                        ? 'Completed'
                                        : statusKey === 'passed'
                                        ? 'Passed'
                                        : 'Failed'}
                                    </span>
                                  </header>
                                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-2">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Latency
                                      </span>
                                      <span className="block text-sm font-medium text-slate-900 dark:text-slate-50">
                                        {Math.round(step.latencyMs)} ms
                                      </span>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-2">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Tokens
                                      </span>
                                      <span className="block text-sm font-medium text-slate-900 dark:text-slate-50">
                                        {tokensText}
                                      </span>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-2">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Prompt schema
                                      </span>
                                      <span className="block text-xs text-slate-700 dark:text-slate-300 break-words">
                                        {step.prompt.slice(0, 140)}{step.prompt.length > 140 ? '…' : ''}
                                      </span>
                                    </div>
                                  </div>
                                  {step.topologyPrediction ? (
                                    <div className="bg-accent-50/60 dark:bg-accent-900/10 border border-accent-200 dark:border-accent-700 rounded-md p-3 flex flex-col gap-1">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-accent-700 dark:text-accent-300">
                                        Topology output
                                      </span>
                                      <span className="text-sm text-slate-700 dark:text-slate-300">
                                        {step.topologyPrediction.subject ?? '—'} ›{' '}
                                        {step.topologyPrediction.topic ?? '—'} ›{' '}
                                        {step.topologyPrediction.subtopic ?? '—'}
                                      </span>
                                    </div>
                                  ) : null}
                                  {step.modelResponse?.answer ? (
                                    <div className="bg-success-50/70 dark:bg-success-900/20 border border-success-200 dark:border-success-800 rounded-md p-3 flex flex-col gap-1">
                                      <span className="text-xs font-semibold uppercase tracking-wide text-success-700 dark:text-success-300">
                                        Answer output
                                      </span>
                                      <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                                        {step.modelResponse.answer}
                                      </span>
                                      {step.modelResponse.explanation ? (
                                        <span className="text-xs text-slate-600 dark:text-slate-300">
                                          {step.modelResponse.explanation}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {step.evaluation?.notes ? (
                                    <p className="text-xs text-danger-600 dark:text-danger-400">
                                      {step.evaluation.notes}
                                    </p>
                                  ) : null}
                                  <section className="border border-slate-200 dark:border-slate-700 rounded-md">
                                    <header className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
                                      <h6 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                        Raw response
                                      </h6>
                                    </header>
                                    <pre className="p-3 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap overflow-x-auto">
{step.responseText || '—'}
                                    </pre>
                                  </section>
                                </article>
                              );
                            })}
                          </div>
                        </section>
                      ) : null}

                      {selectedItem.attempt.modelResponse?.explanation ? (
                        <section className="bg-accent-50/80 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-xl p-4 flex flex-col gap-2">
                          <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                            Model explanation
                          </h5>
                          <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                            {selectedItem.attempt.modelResponse.explanation}
                          </p>
                        </section>
                      ) : null}

                      <section className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/40">
                        <header className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700">
                          <h6 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                            Raw response
                          </h6>
                        </header>
                        <pre className="p-4 text-xs text-slate-700 dark:text-slate-300 overflow-x-auto whitespace-pre-wrap">
{selectedItem.attempt.responseText || '—'}
                        </pre>
                      </section>
                    </>
                  ) : (
                    <section className="border border-accent-200 dark:border-accent-700 rounded-xl bg-accent-50/70 dark:bg-accent-900/10 p-4">
                      <p className="text-sm text-accent-700 dark:text-accent-300">
                        {selectedItem.status === 'queued'
                          ? 'This question is queued and will be evaluated soon.'
                          : selectedItem.status === 'running'
                          ? 'The model is currently answering this question. Details will appear once the response is evaluated.'
                          : 'No attempt data recorded for this question yet.'}
                      </p>
                    </section>
                  )}

                  {selectedDefinition?.solution ? (
                    <section className="border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-900/40 p-4 flex flex-col gap-2">
                      <h5 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
                        Official solution
                      </h5>
                      <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {selectedDefinition.solution}
                      </p>
                    </section>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Select a question to inspect the model response.
                </p>
              )}
            </article>
          </div>
        )}
      </section>
    </div>
  );
};

export default RunDetail;
