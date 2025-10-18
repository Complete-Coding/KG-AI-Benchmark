import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useBenchmarkContext } from '@/context/BenchmarkContext';

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

const RunDetail = () => {
  const { runId } = useParams();
  const navigate = useNavigate();
  const { getRunById, deleteRun } = useBenchmarkContext();
  const run = runId ? getRunById(runId) : undefined;

  const latencySeries = useMemo(() => {
    if (!run) {
      return [];
    }

    return run.attempts.map((attempt, index) => ({
      index: index + 1,
      latency: attempt.latencyMs,
      passed: attempt.evaluation.passed ? 1 : 0,
    }));
  }, [run]);

  const tokenSummary = useMemo(() => {
    if (!run) {
      return { prompt: 0, completion: 0, total: 0 };
    }

    return run.attempts.reduce(
      (acc, attempt) => ({
        prompt: acc.prompt + (attempt.promptTokens ?? 0),
        completion: acc.completion + (attempt.completionTokens ?? 0),
        total: acc.total + (attempt.totalTokens ?? 0),
      }),
      { prompt: 0, completion: 0, total: 0 }
    );
  }, [run]);

  if (!run) {
    return (
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme">
        <header className="flex flex-col gap-2 mb-6">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Run not found</h2>
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

  const handleDelete = () => {
    if (window.confirm('Delete this run and all attempt data?')) {
      deleteRun(run.id);
      void navigate('/runs');
    }
  };

  const durationSeconds = run.durationMs ? run.durationMs / 1000 : 0;

  return (
    <div className="flex flex-col gap-8">
      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 transition-theme flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Link
            className="inline-flex items-center gap-1.5 text-accent-700 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300 font-semibold transition-colors"
            to="/runs"
          >
            ← Back to runs
          </Link>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">{run.label}</h2>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Profile {run.profileName} · {run.profileModelId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
              run.status === 'completed'
                ? 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-300'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
            }`}
          >
            {run.status.toUpperCase()}
          </span>
          <button
            className="bg-gradient-to-r from-danger-600 to-danger-700 hover:from-danger-700 hover:to-danger-800 text-white font-semibold px-4 py-2 rounded-xl transition-all duration-200 shadow-sm hover:shadow-md"
            type="button"
            onClick={handleDelete}
          >
            Delete run
          </button>
        </div>
      </section>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Summary</h3>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Completed at {formatDateTime(run.completedAt)} · {run.questionIds.length} questions evaluated.
          </p>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <article className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 flex flex-col gap-3 border border-slate-200 dark:border-slate-700 hover:-translate-y-1 hover:shadow-md transition-all duration-200">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Accuracy
            </h3>
            <div className="text-4xl font-bold text-slate-900 dark:text-slate-50">
              {(run.metrics.accuracy * 100).toFixed(1)}%
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              {run.metrics.passedCount} passed · {run.metrics.failedCount} failed
            </span>
          </article>
          <article className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 flex flex-col gap-3 border border-slate-200 dark:border-slate-700 hover:-translate-y-1 hover:shadow-md transition-all duration-200">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Average latency
            </h3>
            <div className="text-4xl font-bold text-slate-900 dark:text-slate-50">
              {Math.round(run.metrics.averageLatencyMs)} ms
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Total latency {Math.round(run.metrics.totalLatencyMs)} ms
            </span>
          </article>
          <article className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 flex flex-col gap-3 border border-slate-200 dark:border-slate-700 hover:-translate-y-1 hover:shadow-md transition-all duration-200">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Duration
            </h3>
            <div className="text-4xl font-bold text-slate-900 dark:text-slate-50">
              {durationSeconds.toFixed(1)} s
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Started {formatDateTime(run.startedAt)} · Completed {formatDateTime(run.completedAt)}
            </span>
          </article>
          <article className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 flex flex-col gap-3 border border-slate-200 dark:border-slate-700 hover:-translate-y-1 hover:shadow-md transition-all duration-200">
            <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
              Token usage
            </h3>
            <div className="text-4xl font-bold text-slate-900 dark:text-slate-50">
              {tokenSummary.total.toLocaleString()}
            </div>
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Prompt {tokenSummary.prompt.toLocaleString()} · Completion{' '}
              {tokenSummary.completion.toLocaleString()}
            </span>
          </article>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-6">
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
          <header className="flex flex-col gap-2">
            <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Latency & pass rate</h3>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
              Per-question latency (ms) and pass/fail outcome.
            </p>
          </header>
          <div className="w-full h-80">
            {latencySeries.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400 bg-accent-500/6 dark:bg-accent-500/10 rounded-xl">
                No attempts recorded.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={latencySeries} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                  <XAxis dataKey="index" label={{ value: 'Question', position: 'insideBottomRight', offset: -8 }} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(value: number) => `${Math.round(value)} ms`}
                    tick={{ fill: '#52606d' }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={[0, 1]}
                    tickFormatter={(value: number) => (value === 1 ? 'Pass' : value === 0 ? 'Fail' : '')}
                  />
                  <Tooltip
                    formatter={(value: number | string, name) => {
                      if (name === 'latency' && typeof value === 'number') {
                        return `${Math.round(value)} ms`;
                      }
                      if (name === 'passed' && typeof value === 'number') {
                        return value === 1 ? 'Pass' : 'Fail';
                      }

                      return value;
                    }}
                  />
                  <Legend />
                  <Bar yAxisId="right" dataKey="passed" fill="#10b981" name="Pass/fail" />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="latency"
                    stroke="#6366f1"
                    strokeWidth={3}
                    dot={false}
                    name="Latency"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
          <header className="flex flex-col gap-2">
            <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Dataset</h3>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
              Run executed against the following curated set.
            </p>
          </header>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-3">
              <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Dataset
              </dt>
              <dd className="text-lg font-semibold text-slate-900 dark:text-slate-50 mt-1">
                {run.dataset.label}
              </dd>
            </div>
            <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-3">
              <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                Questions
              </dt>
              <dd className="text-lg font-semibold text-slate-900 dark:text-slate-50 mt-1">
                {run.dataset.totalQuestions}
              </dd>
            </div>
          </dl>
          <div>
            <h4 className="font-medium text-slate-900 dark:text-slate-50 mb-2">Filters</h4>
            <ul className="flex flex-wrap gap-2">
              {run.dataset.filters.length === 0 ? (
                <li className="bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-full text-sm text-slate-700 dark:text-slate-300">
                  None
                </li>
              ) : null}
              {run.dataset.filters.map((filter) => (
                <li
                  key={filter}
                  className="bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-full text-sm text-slate-700 dark:text-slate-300"
                >
                  {filter}
                </li>
              ))}
            </ul>
          </div>
          {run.summary ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/30 p-4 rounded-xl">
              {run.summary}
            </p>
          ) : null}
        </section>
      </div>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h3 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Attempt breakdown</h3>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Inspect model responses, evaluations, and metrics.
          </p>
        </header>
        {run.attempts.length === 0 ? (
          <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
            This run has no attempts recorded.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {run.attempts.map((attempt, index) => (
              <li
                key={attempt.id}
                className={`border-2 rounded-xl p-5 flex flex-col gap-4 ${
                  attempt.evaluation.passed
                    ? 'border-success-200 dark:border-success-800 bg-success-50/30 dark:bg-success-900/10'
                    : 'border-danger-200 dark:border-danger-800 bg-danger-50/30 dark:bg-danger-900/10'
                }`}
              >
                <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <strong className="text-lg font-semibold text-slate-900 dark:text-slate-50">
                      #{index + 1} · {attempt.questionSnapshot.type}
                    </strong>
                    <span className="text-sm text-slate-600 dark:text-slate-400">
                      {attempt.questionSnapshot.difficulty} · Latency {Math.round(attempt.latencyMs)} ms
                    </span>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold uppercase ${
                      attempt.evaluation.passed
                        ? 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-300'
                        : 'bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-300'
                    }`}
                  >
                    {attempt.evaluation.passed ? 'Pass' : 'Fail'}
                  </span>
                </header>
                <p className="text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900/30 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
                  {attempt.questionSnapshot.prompt}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="flex flex-col gap-1 bg-white dark:bg-slate-900/30 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <strong className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      Expected
                    </strong>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {attempt.evaluation.expected}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 bg-white dark:bg-slate-900/30 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <strong className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      Received
                    </strong>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {attempt.evaluation.received || '—'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 bg-white dark:bg-slate-900/30 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <strong className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      Confidence
                    </strong>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {attempt.evaluation.metrics?.confidence != null
                        ? (attempt.evaluation.metrics.confidence * 100).toFixed(0) + '%'
                        : '—'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 bg-white dark:bg-slate-900/30 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                    <strong className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      Tokens
                    </strong>
                    <span className="text-sm font-medium text-slate-900 dark:text-slate-50">
                      {attempt.totalTokens
                        ? `${attempt.totalTokens} (prompt ${attempt.promptTokens ?? 0}, completion ${attempt.completionTokens ?? 0})`
                        : '—'}
                    </span>
                  </div>
                </div>
                {attempt.modelResponse?.explanation ? (
                  <div className="flex flex-col gap-2 bg-accent-50/50 dark:bg-accent-900/10 p-4 rounded-lg border border-accent-200 dark:border-accent-800">
                    <strong className="text-sm font-semibold text-slate-900 dark:text-slate-50">Explanation</strong>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{attempt.modelResponse.explanation}</p>
                  </div>
                ) : null}
                {attempt.error ? (
                  <p className="text-sm text-danger-700 dark:text-danger-300 bg-danger-100 dark:bg-danger-900/20 p-4 rounded-lg border border-danger-300 dark:border-danger-700">
                    Error: {attempt.error}
                  </p>
                ) : (
                  <details className="bg-slate-100 dark:bg-slate-900/30 rounded-lg border border-slate-200 dark:border-slate-700">
                    <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition-colors">
                      Raw response
                    </summary>
                    <pre className="text-xs text-slate-700 dark:text-slate-300 p-4 overflow-x-auto border-t border-slate-200 dark:border-slate-700">
                      {attempt.responseText}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default RunDetail;
