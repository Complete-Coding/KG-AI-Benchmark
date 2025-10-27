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

// Color palette for different profiles (up to 10 profiles)
const PROFILE_COLORS = [
  '#10b981', // green
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#a855f7', // purple
];

interface ProfilePerformance {
  profileId: string;
  profileName: string;
  profileModelId: string;
  totalRuns: number;
  averageAccuracy: number;
  averageTopologyAccuracy: number;
  averageLatencyMs: number;
  lastRunAt?: string;
  trend: Array<{
    timestamp: string;
    accuracy: number;
    topologyAccuracy: number;
    latencyMs: number;
  }>;
}

const Dashboard = () => {
  const { loading, runs, profiles } = useBenchmarkContext();

  const profilePerformanceData = useMemo(() => {
    const completedRuns = runs.filter((run) => run.status === 'completed');

    if (completedRuns.length === 0) {
      return [];
    }

    // Group runs by profile
    const runsByProfile = new Map<string, typeof completedRuns>();
    completedRuns.forEach((run) => {
      const existing = runsByProfile.get(run.profileId) || [];
      runsByProfile.set(run.profileId, [...existing, run]);
    });

    // Compute performance metrics per profile
    const profilePerformances: ProfilePerformance[] = [];

    runsByProfile.forEach((profileRuns, profileId) => {
      const sortedRuns = [...profileRuns].sort((a, b) => {
        const aTime = a.completedAt ?? a.createdAt;
        const bTime = b.completedAt ?? b.createdAt;
        return aTime.localeCompare(bTime);
      });

      const totalRuns = profileRuns.length;
      const averageAccuracy = profileRuns.reduce((acc, run) => acc + run.metrics.accuracy, 0) / totalRuns;
      const averageTopologyAccuracy = profileRuns.reduce((acc, run) => acc + run.metrics.topologyAccuracy, 0) / totalRuns;
      const averageLatencyMs = profileRuns.reduce((acc, run) => acc + run.metrics.averageLatencyMs, 0) / totalRuns;

      const lastRun = sortedRuns[sortedRuns.length - 1];
      const lastRunAt = lastRun?.completedAt ?? lastRun?.createdAt;

      const trend = sortedRuns.map((run) => ({
        timestamp: run.completedAt ?? run.createdAt,
        accuracy: run.metrics.accuracy * 100,
        topologyAccuracy: run.metrics.topologyAccuracy * 100,
        latencyMs: run.metrics.averageLatencyMs,
      }));

      profilePerformances.push({
        profileId,
        profileName: profileRuns[0].profileName,
        profileModelId: profileRuns[0].profileModelId,
        totalRuns,
        averageAccuracy,
        averageTopologyAccuracy,
        averageLatencyMs,
        lastRunAt,
        trend,
      });
    });

    // Sort by last run date (most recent first)
    return profilePerformances.sort((a, b) => {
      if (!a.lastRunAt) return 1;
      if (!b.lastRunAt) return -1;
      return b.lastRunAt.localeCompare(a.lastRunAt);
    });
  }, [runs]);

  // Prepare chart data with all profiles' trends
  const chartData = useMemo(() => {
    if (profilePerformanceData.length === 0) {
      return [];
    }

    // Collect all unique timestamps across all profiles
    const allTimestamps = new Set<string>();
    profilePerformanceData.forEach(profile => {
      profile.trend.forEach(point => {
        allTimestamps.add(point.timestamp);
      });
    });

    const sortedTimestamps = Array.from(allTimestamps).sort();

    // Build chart data with one point per timestamp
    return sortedTimestamps.map(timestamp => {
      const dataPoint: Record<string, number | string> = {
        timestamp: new Date(timestamp).toLocaleDateString(),
        fullTimestamp: timestamp,
      };

      profilePerformanceData.forEach((profile, index) => {
        const point = profile.trend.find(p => p.timestamp === timestamp);
        if (point) {
          dataPoint[`${profile.profileId}_accuracy`] = point.accuracy;
          dataPoint[`${profile.profileId}_topologyAccuracy`] = point.topologyAccuracy;
          dataPoint[`${profile.profileId}_latency`] = point.latencyMs;
        }
      });

      return dataPoint;
    });
  }, [profilePerformanceData]);

  const activeRuns = useMemo(() =>
    runs.filter((run) => run.status === 'running' || run.status === 'queued').length,
    [runs]
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Track model profile performance and accuracy trends over time.
          </p>
        </header>

        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 border-4 border-accent-200 dark:border-accent-800 border-t-accent-600 dark:border-t-accent-400 rounded-full animate-spin"></div>
            <p className="text-slate-600 dark:text-slate-400 font-medium">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  if (profilePerformanceData.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Dashboard
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
            Track model profile performance and accuracy trends over time.
          </p>
        </header>

        <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-8 flex flex-col items-center gap-4">
          <div className="text-slate-400 dark:text-slate-500 text-6xl">📊</div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">No benchmark data yet</h2>
          <p className="text-slate-600 dark:text-slate-400 text-center max-w-md">
            Run your first benchmark to see profile performance metrics and trends.
          </p>
          <Link
            to="/runs"
            className="mt-4 px-6 py-3 bg-accent-600 hover:bg-accent-700 text-white font-semibold rounded-lg transition-colors"
          >
            Launch new benchmark →
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl lg:text-[2.2rem] font-bold tracking-tight text-slate-900 dark:text-slate-50">
          Dashboard
        </h1>
        <p className="text-slate-600 dark:text-slate-400 text-[0.95rem]">
          Track model profile performance and accuracy trends over time.
        </p>
      </header>

      {/* Active runs indicator */}
      {activeRuns > 0 && (
        <div className="bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 rounded-xl p-4 flex items-center gap-3">
          <div className="w-2 h-2 bg-accent-600 dark:bg-accent-400 rounded-full animate-pulse"></div>
          <span className="text-sm font-medium text-accent-900 dark:text-accent-100">
            {activeRuns} benchmark{activeRuns === 1 ? '' : 's'} running
          </span>
        </div>
      )}

      {/* Profile performance charts */}
      <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-4 sm:p-5 lg:p-6 flex flex-col gap-4 sm:gap-5 lg:gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Performance trends by profile
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-[0.95rem]">
            Compare how different model profiles perform over time on the same dataset.
          </p>
        </header>

        {/* Two charts: Answer Accuracy and Topology Accuracy */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Answer Accuracy Chart */}
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Answer Accuracy
            </h3>
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                  <XAxis dataKey="timestamp" tick={{ fill: '#52606d', fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(value: number) => `${Math.round(value)}%`}
                    tick={{ fill: '#52606d', fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    formatter={(value: number | string) => {
                      if (typeof value === 'number') {
                        return `${value.toFixed(1)}%`;
                      }
                      return value;
                    }}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {profilePerformanceData.map((profile, index) => (
                    <Line
                      key={profile.profileId}
                      type="monotone"
                      dataKey={`${profile.profileId}_accuracy`}
                      stroke={PROFILE_COLORS[index % PROFILE_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name={profile.profileName}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Topology Accuracy Chart */}
          <div className="flex flex-col gap-3">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Topology Accuracy
            </h3>
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 23, 42, 0.1)" />
                  <XAxis dataKey="timestamp" tick={{ fill: '#52606d', fontSize: 11 }} />
                  <YAxis
                    tickFormatter={(value: number) => `${Math.round(value)}%`}
                    tick={{ fill: '#52606d', fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    formatter={(value: number | string) => {
                      if (typeof value === 'number') {
                        return `${value.toFixed(1)}%`;
                      }
                      return value;
                    }}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Legend wrapperStyle={{ fontSize: '12px' }} />
                  {profilePerformanceData.map((profile, index) => (
                    <Line
                      key={profile.profileId}
                      type="monotone"
                      dataKey={`${profile.profileId}_topologyAccuracy`}
                      stroke={PROFILE_COLORS[index % PROFILE_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name={profile.profileName}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* Profile performance cards */}
      <section className="bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl shadow-sm p-4 sm:p-5 lg:p-6 flex flex-col gap-4 sm:gap-5 lg:gap-6 transition-theme">
        <header className="flex flex-col gap-2">
          <h2 className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 dark:text-slate-50">
            Profile performance summary
          </h2>
          <p className="text-slate-600 dark:text-slate-400 text-sm sm:text-[0.95rem]">
            Average metrics across all completed runs for each profile.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {profilePerformanceData.map((profile, index) => (
            <article
              key={profile.profileId}
              className="border border-slate-200 dark:border-slate-700 rounded-xl p-4 sm:p-5 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3 mb-4">
                <div
                  className="w-3 h-3 rounded-full mt-1.5 flex-shrink-0"
                  style={{ backgroundColor: PROFILE_COLORS[index % PROFILE_COLORS.length] }}
                ></div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-50 text-lg truncate">
                    {profile.profileName}
                  </h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                    {profile.profileModelId}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Runs
                  </div>
                  <div className="text-2xl font-bold text-slate-900 dark:text-slate-50">
                    {profile.totalRuns}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Answer
                  </div>
                  <div className="text-2xl font-bold text-success-700 dark:text-success-400">
                    {formatPercent(profile.averageAccuracy)}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Topology
                  </div>
                  <div className="text-2xl font-bold text-warning-700 dark:text-warning-400">
                    {formatPercent(profile.averageTopologyAccuracy)}
                  </div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1">
                    Latency
                  </div>
                  <div className="text-xl font-bold text-slate-900 dark:text-slate-50">
                    {formatLatency(profile.averageLatencyMs)}
                  </div>
                </div>
              </div>

              {profile.lastRunAt && (
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Last run: {formatDateTime(profile.lastRunAt)}
                  </span>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Dashboard;
