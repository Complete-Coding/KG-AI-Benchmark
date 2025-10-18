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
      <section className="panel">
        <header className="panel__header">
          <h2>Run not found</h2>
          <p className="panel__subtitle">
            The requested run does not exist. Head back to the runs list and try again.
          </p>
        </header>
        <Link className="button" to="/runs">
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
    <div className="run-detail">
      <section className="panel run-detail__header">
        <div>
          <Link className="button button--ghost" to="/runs">
            ← Back to runs
          </Link>
          <h2>{run.label}</h2>
          <p className="panel__subtitle">
            Profile {run.profileName} · {run.profileModelId}
          </p>
        </div>
        <div className="run-detail__actions">
          <span className={`status-pill status-pill--${run.status === 'completed' ? 'ready' : 'pending'}`}>
            {run.status.toUpperCase()}
          </span>
          <button className="button button--danger" type="button" onClick={handleDelete}>
            Delete run
          </button>
        </div>
      </section>

      <section className="panel">
        <header className="panel__header">
          <h3>Summary</h3>
          <p className="panel__subtitle">
            Completed at {formatDateTime(run.completedAt)} · {run.questionIds.length} questions evaluated.
          </p>
        </header>
        <div className="summary-grid">
          <article className="summary-card">
            <h3>Accuracy</h3>
            <div className="summary-card__value">
              {(run.metrics.accuracy * 100).toFixed(1)}%
            </div>
            <span className="summary-card__meta">
              {run.metrics.passedCount} passed · {run.metrics.failedCount} failed
            </span>
          </article>
          <article className="summary-card">
            <h3>Average latency</h3>
            <div className="summary-card__value">{Math.round(run.metrics.averageLatencyMs)} ms</div>
            <span className="summary-card__meta">
              Total latency {Math.round(run.metrics.totalLatencyMs)} ms
            </span>
          </article>
          <article className="summary-card">
            <h3>Duration</h3>
            <div className="summary-card__value">{durationSeconds.toFixed(1)} s</div>
            <span className="summary-card__meta">
              Started {formatDateTime(run.startedAt)} · Completed {formatDateTime(run.completedAt)}
            </span>
          </article>
          <article className="summary-card">
            <h3>Token usage</h3>
            <div className="summary-card__value">{tokenSummary.total.toLocaleString()}</div>
            <span className="summary-card__meta">
              Prompt {tokenSummary.prompt.toLocaleString()} · Completion{' '}
              {tokenSummary.completion.toLocaleString()}
            </span>
          </article>
        </div>
      </section>

      <div className="run-detail__grid">
        <section className="panel">
          <header className="panel__header">
            <h3>Latency & pass rate</h3>
            <p className="panel__subtitle">Per-question latency (ms) and pass/fail outcome.</p>
          </header>
          <div className="chart-container">
            {latencySeries.length === 0 ? (
              <div className="chart-placeholder">No attempts recorded.</div>
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

        <section className="panel">
          <header className="panel__header">
            <h3>Dataset</h3>
            <p className="panel__subtitle">Run executed against the following curated set.</p>
          </header>
          <dl className="dataset-summary__stats">
            <div>
              <dt>Dataset</dt>
              <dd>{run.dataset.label}</dd>
            </div>
            <div>
              <dt>Questions</dt>
              <dd>{run.dataset.totalQuestions}</dd>
            </div>
          </dl>
          <h4>Filters</h4>
          <ul className="dataset-summary__filters">
            {run.dataset.filters.length === 0 ? <li>None</li> : null}
            {run.dataset.filters.map((filter) => (
              <li key={filter}>{filter}</li>
            ))}
          </ul>
          {run.summary ? <p className="run-detail__summary">{run.summary}</p> : null}
        </section>
      </div>

      <section className="panel run-detail__attempts">
        <header className="panel__header">
          <h3>Attempt breakdown</h3>
          <p className="panel__subtitle">Inspect model responses, evaluations, and metrics.</p>
        </header>
        {run.attempts.length === 0 ? (
          <p className="empty-state">This run has no attempts recorded.</p>
        ) : (
          <ul className="attempt-list">
            {run.attempts.map((attempt, index) => (
              <li
                key={attempt.id}
                className={`attempt${attempt.evaluation.passed ? ' attempt--pass' : ' attempt--fail'}`}
              >
                <header>
                  <div>
                    <strong>
                      #{index + 1} · {attempt.questionSnapshot.type}
                    </strong>
                    <span className="attempt__meta">
                      {attempt.questionSnapshot.difficulty} · Latency {Math.round(attempt.latencyMs)} ms
                    </span>
                  </div>
                  <span className={`status-pill status-pill--${attempt.evaluation.passed ? 'ready' : 'failed'}`}>
                    {attempt.evaluation.passed ? 'Pass' : 'Fail'}
                  </span>
                </header>
                <p className="attempt__question">{attempt.questionSnapshot.prompt}</p>
                <div className="attempt__metrics">
                  <div>
                    <strong>Expected</strong>
                    <span>{attempt.evaluation.expected}</span>
                  </div>
                  <div>
                    <strong>Received</strong>
                    <span>{attempt.evaluation.received || '—'}</span>
                  </div>
                  <div>
                    <strong>Confidence</strong>
                    <span>
                      {attempt.evaluation.metrics?.confidence != null
                        ? (attempt.evaluation.metrics.confidence * 100).toFixed(0) + '%'
                        : '—'}
                    </span>
                  </div>
                  <div>
                    <strong>Tokens</strong>
                    <span>
                      {attempt.totalTokens
                        ? `${attempt.totalTokens} (prompt ${attempt.promptTokens ?? 0}, completion ${attempt.completionTokens ?? 0})`
                        : '—'}
                    </span>
                  </div>
                </div>
                {attempt.modelResponse?.explanation ? (
                  <div className="attempt__explanation">
                    <strong>Explanation</strong>
                    <p>{attempt.modelResponse.explanation}</p>
                  </div>
                ) : null}
                {attempt.error ? (
                  <p className="attempt__error">Error: {attempt.error}</p>
                ) : (
                  <details>
                    <summary>Raw response</summary>
                    <pre>{attempt.responseText}</pre>
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
