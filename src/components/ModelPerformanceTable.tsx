import type { ModelBenchmarkResult } from '@/types/benchmark';

interface ModelPerformanceTableProps {
  results: ModelBenchmarkResult[];
  selectedModelId: string | null;
  onSelect: (modelId: string) => void;
}

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;
const formatLatency = (ms: number) => `${Math.round(ms)} ms`;

const ModelPerformanceTable = ({ results, selectedModelId, onSelect }: ModelPerformanceTableProps) => {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Model comparison</h2>
        <p className="panel__subtitle">Latency, accuracy, and throughput from the latest run.</p>
      </header>
      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Accuracy</th>
              <th scope="col">Avg latency</th>
              <th scope="col">Throughput (req/min)</th>
              <th scope="col">Token usage</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result) => {
              const isSelected = result.modelId === selectedModelId;
              return (
                <tr
                  key={result.modelId}
                  className={isSelected ? 'data-table__row--selected' : undefined}
                  onClick={() => onSelect(result.modelId)}
                >
                  <th scope="row">
                    <div className="data-table__model">
                      <span className="data-table__model-name">{result.modelName}</span>
                      <span className="data-table__model-id">{result.modelId}</span>
                    </div>
                  </th>
                  <td>{formatPercent(result.accuracy)}</td>
                  <td>{formatLatency(result.averageLatencyMs)}</td>
                  <td>{result.throughput.toFixed(1)}</td>
                  <td>{result.tokenUsage.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default ModelPerformanceTable;
