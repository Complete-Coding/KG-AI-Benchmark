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
const formatLatency = (value: number) => {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }
  return `${Math.round(value)} ms`;
};

const Dashboard = () => {
  const { overview, questionSummary } = useBenchmarkContext();

  const trendData = useMemo(() => {
    const accuracyByRunId = new Map(
      overview.accuracyTrend.map((point) => [point.runId, point])
    );
    const topologyAccuracyByRunId = new Map(
      overview.topologyAccuracyTrend.map((point) => [point.runId, point])
    );

    return overview.latencyTrend.map((latencyPoint) => {
      const accuracyPoint = accuracyByRunId.get(latencyPoint.runId);
      const topologyAccuracyPoint = topologyAccuracyByRunId.get(latencyPoint.runId);
      const timestamp = new Date(latencyPoint.timestamp);
      return {
        timestamp: timestamp.toLocaleDateString(),
        answerAccuracy: (accuracyPoint?.accuracy ?? 0) * 100,
        topologyAccuracy: (topologyAccuracyPoint?.topologyAccuracy ?? 0) * 100,
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
      title: 'Avg answer accuracy',
      value: overview.totalRuns ? formatPercent(overview.averageAccuracy) : '—',
      meta: 'Across completed runs',
    },
    {
      title: 'Avg topology accuracy',
      value: overview.totalRuns ? formatPercent(overview.averageTopologyAccuracy) : '—',
      meta: 'Across completed runs',
    },
    {
      title: 'Avg latency',
      value: overview.totalRuns ? formatLatency(overview.averageLatencyMs) : '—',
      meta: 'Across completed runs',
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Dashboard
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
          Track recent benchmark activity, dataset coverage, and cross-run trends.
        </p>
      </header>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Overview
          </h2>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
          {summaryCards.map((card) => (
            <article
              key={card.title}
              className="bg-white dark:bg-slate-800 rounded-xl shadow-sm p-6 flex flex-col gap-3 border border-slate-200 dark:border-slate-700 hover:-translate-y-1 hover:shadow-md transition-all duration-200"
            >
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                {card.title}
              </h3>
              <div className="text-4xl font-bold text-slate-900 dark:text-slate-50">{card.value}</div>
              <span className="text-sm text-slate-500 dark:text-slate-400">{card.meta}</span>
            </article>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-6">
        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
          <header className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Performance trends
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
              Answer accuracy, topology accuracy, and latency across completed runs.
            </p>
          </header>
          <div className="w-full h-80">
            {trendData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400 bg-accent-500/6 dark:bg-accent-500/10 rounded-xl">
                Run a benchmark to see trend data.
              </div>
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
                        return name === 'Latency'
                          ? `${Math.round(value)} ms`
                          : `${value.toFixed(1)}%`;
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
                    strokeWidth={2}
                    dot={false}
                    name="Latency"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="answerAccuracy"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={false}
                    name="Answer Accuracy"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="topologyAccuracy"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                    name="Topology Accuracy"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
          <header className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
              Dataset snapshot
            </h2>
            <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
              Showing the latest {questionSummary.total} curated questions used for benchmarking.
            </p>
          </header>
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-50">
                {questionSummary.label}
              </h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Generated at {formatDateTime(questionSummary.generatedAt)}
              </p>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-3">
                <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Total pool
                </dt>
                <dd className="text-lg font-semibold text-slate-900 dark:text-slate-50 mt-1">
                  {questionSummary.stats.poolSize ?? '—'}
                </dd>
              </div>
              <div className="bg-accent-500/6 dark:bg-accent-500/10 rounded-xl p-3">
                <dt className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  Without images
                </dt>
                <dd className="text-lg font-semibold text-slate-900 dark:text-slate-50 mt-1">
                  {questionSummary.stats.poolWithoutImages ?? '—'}
                </dd>
              </div>
            </dl>
            <div>
              <h4 className="font-medium text-slate-900 dark:text-slate-50 mb-2">
                Filters applied
              </h4>
              <ul className="flex flex-wrap gap-2">
                {questionSummary.filters.map((filter) => (
                  <li
                    key={filter}
                    className="bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-full text-sm text-slate-700 dark:text-slate-300"
                  >
                    {filter}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-medium text-slate-900 dark:text-slate-50 mb-2">
                Question types
              </h4>
              <ul className="flex flex-wrap gap-2">
                {Object.entries(questionSummary.stats.countsByType ?? {}).map(([type, count]) => (
                  <li
                    key={type}
                    className="flex items-center justify-between gap-3 min-w-[140px] bg-slate-100 dark:bg-slate-700 px-3 py-1.5 rounded-full text-sm"
                  >
                    <span className="text-slate-700 dark:text-slate-300">{type}</span>
                    <span className="font-semibold text-slate-900 dark:text-slate-50">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Link
            className="self-start font-semibold text-accent-700 dark:text-accent-400 hover:text-accent-800 dark:hover:text-accent-300 transition-colors"
            to="/runs"
          >
            Launch new benchmark →
          </Link>
        </section>
      </div>

      <section className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm p-6 flex flex-col gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Recent runs
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Latest completed runs by profile and completion timestamp.
          </p>
        </header>
        {overview.latestRuns.length === 0 ? (
          <p className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400 text-center">
            No completed runs yet. Create a run from the Runs tab.
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
                    Model profile
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Accuracy
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Avg latency
                  </th>
                  <th scope="col" className="px-5 py-4 border-b border-slate-200 dark:border-slate-700">
                    Completed
                  </th>
                </tr>
              </thead>
              <tbody>
                {overview.latestRuns.map((run) => (
                  <tr
                    key={run.runId}
                    className="hover:bg-accent-50 dark:hover:bg-accent-900/20 transition-colors cursor-pointer"
                  >
                    <th
                      scope="row"
                      className="px-5 py-4 border-b border-slate-200 dark:border-slate-700"
                    >
                      <Link
                        to={`/runs/${run.runId}`}
                        className="font-semibold text-slate-900 dark:text-slate-50 hover:text-accent-600 dark:hover:text-accent-400 transition-colors"
                      >
                        {run.label}
                      </Link>
                    </th>
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
                      {formatPercent(run.accuracy)}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {formatLatency(run.averageLatencyMs)}
                    </td>
                    <td className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                      {formatDateTime(run.completedAt)}
                    </td>
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
