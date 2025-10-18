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
import type { TrendPoint } from '@/types/benchmark';

interface TrendChartProps {
  data: TrendPoint[];
}

const TrendChart = ({ data }: TrendChartProps) => {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Recent trend</h2>
        <p className="panel__subtitle">Latency and accuracy across the last three benchmark sessions.</p>
      </header>
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={data} margin={{ top: 16, right: 24, left: 0, bottom: 8 }}>
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
              tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
              tick={{ fill: '#52606d' }}
            />
            <Tooltip
              formatter={(value: unknown, name) => {
                if (typeof value === 'number') {
                  return name === 'accuracy'
                    ? `${Math.round(value * 100)}%`
                    : `${Math.round(value)} ms`;
                }

                if (typeof value === 'string') {
                  return value;
                }

                return '';
              }}
            />
            <Legend />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="averageLatencyMs"
              stroke="#6366f1"
              strokeWidth={3}
              dot={{ strokeWidth: 0 }}
              name="Latency"
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="accuracy"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ strokeWidth: 0 }}
              name="Accuracy"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};

export default TrendChart;
