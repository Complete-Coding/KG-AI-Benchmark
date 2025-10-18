import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;
const formatLatency = (value: number) => `${Math.round(value)} ms`;

const Dashboard = () => {
  const { overview, questionSummary } = useBenchmarkContext();

  const trendData = useMemo(() => {
    const accuracyByRunId = new Map(
      overview.accuracyTrend.map((point) => [point.runId, point])
    );

    return overview.latencyTrend.map((latencyPoint) => {
      const accuracyPoint = accuracyByRunId.get(latencyPoint.runId);
      const timestamp = new Date(latencyPoint.timestamp);
      return {
        timestamp: timestamp.toLocaleDateString(),
        accuracy: (accuracyPoint?.accuracy ?? 0) * 100,
        latency: latencyPoint.latencyMs,
      };
    });
  }, [overview]);

  const summaryCards = [
    {
      title: 'Benchmark runs',
      value: overview.totalRuns,
      meta: overview.lastUpdated ? `Updated ${formatDateTime(overview.lastUpdated)}` : 'No runs yet',
    },
    {
      title: 'Active runs',
      value: overview.activeRuns,
      meta: overview.activeRuns === 0 ? 'All runs idle' : 'Runs in progress',
    },
    {
      title: 'Avg accuracy',
      value: overview.totalRuns ? formatPercent(overview.averageAccuracy) : '—',
      meta: 'Across completed runs',
    },
    {
      title: 'Avg latency',
      value: overview.totalRuns ? formatLatency(overview.averageLatencyMs) : '—',
      meta: 'Across completed runs',
    },
  ];

  return (
    <div className="dashboard">
      <section className="panel">
        <header className="panel__header">
          <h2>Benchmark at a glance</h2>
          <p className="panel__subtitle">
            Track recent benchmark activity, dataset coverage, and cross-run trends.
          </p>
        </header>
        <div className="summary-grid">
          {summaryCards.map((card) => (
            <article key={card.title} className="summary-card">
              <h3>{card.title}</h3>
              <div className="summary-card__value">{card.value}</div>
              <span className="summary-card__meta">{card.meta}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="dashboard__grid">
        <section className="panel">
          <header className="panel__header">
            <h2>Accuracy vs latency</h2>
            <p className="panel__subtitle">Completed runs plotted chronologically.</p>
          </header>
          <div className="chart-container">
            {trendData.length === 0 ? (
              <div className="chart-placeholder">Run a benchmark to see trend data.</div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                  <XAxis dataKey="timestamp" tick={{ fill: '#52606d' }} />
                  <YAxis
                    yAxisId="left"
                    tickFormatter={(value: number) => `${Math.round(value)} ms`}
                    tick={{ fill: '#52606d' }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={(value: number) => `${Math.round(value)}%`}
                    tick={{ fill: '#52606d' }}
                  />
                  <Tooltip
                    formatter={(value: number | string, name) => {
                      if (typeof value === 'number') {
                        return name === 'accuracy'
                          ? `${value.toFixed(1)}%`
                          : `${Math.round(value)} ms`;
                      }

                      return value;
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="latency"
                    stroke="#6366f1"
                    strokeWidth={3}
                    dot={false}
                    name="Latency"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="accuracy"
                    stroke="#10b981"
                    strokeWidth={3}
                    dot={false}
                    name="Accuracy"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="panel">
          <header className="panel__header">
            <h2>Dataset snapshot</h2>
            <p className="panel__subtitle">
              Showing the latest {questionSummary.total} curated questions used for benchmarking.
            </p>
          </header>
          <div className="dataset-summary">
            <div>
              <h3>{questionSummary.label}</h3>
              <p className="dataset-summary__meta">
                Generated at {formatDateTime(questionSummary.generatedAt)}
              </p>
            </div>
            <dl className="dataset-summary__stats">
              <div>
                <dt>Total pool</dt>
                <dd>{questionSummary.stats.poolSize ?? '—'}</dd>
              </div>
              <div>
                <dt>Without images</dt>
                <dd>{questionSummary.stats.poolWithoutImages ?? '—'}</dd>
              </div>
            </dl>
            <div>
              <h4>Filters applied</h4>
              <ul className="dataset-summary__filters">
                {questionSummary.filters.map((filter) => (
                  <li key={filter}>{filter}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Question types</h4>
              <ul className="dataset-summary__counts">
                {Object.entries(questionSummary.stats.countsByType ?? {}).map(([type, count]) => (
                  <li key={type}>
                    <span>{type}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Link className="dataset-summary__cta" to="/runs">
            Launch new benchmark
          </Link>
        </section>
      </div>

      <section className="panel">
        <header className="panel__header">
          <h2>Recent runs</h2>
          <p className="panel__subtitle">
            Latest completed runs by profile and completion timestamp.
          </p>
        </header>
        {overview.latestRuns.length === 0 ? (
          <p className="empty-state">No completed runs yet. Create a run from the Runs tab.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Model profile</th>
                  <th scope="col">Accuracy</th>
                  <th scope="col">Avg latency</th>
                  <th scope="col">Completed</th>
                </tr>
              </thead>
              <tbody>
                {overview.latestRuns.map((run) => (
                  <tr key={run.runId}>
                    <th scope="row">
                      <Link to={`/runs/${run.runId}`} className="data-table__model-name">
                        {run.label}
                      </Link>
                    </th>
                    <td>
                      <div className="data-table__model">
                        <span className="data-table__model-name">{run.profileName}</span>
                        <span className="data-table__model-id">{run.profileModelId}</span>
                      </div>
                    </td>
                    <td>{formatPercent(run.accuracy)}</td>
                    <td>{formatLatency(run.averageLatencyMs)}</td>
                    <td>{formatDateTime(run.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
