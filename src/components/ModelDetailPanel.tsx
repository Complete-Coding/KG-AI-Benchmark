import type { ModelBenchmarkResult } from '@/types/benchmark';

interface ModelDetailPanelProps {
  model?: ModelBenchmarkResult;
}

const ModelDetailPanel = ({ model }: ModelDetailPanelProps) => {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Model insights</h2>
        <p className="panel__subtitle">
          Detailed metrics for the model you select from the comparison table.
        </p>
      </header>
      {model ? (
        <div className="model-detail">
          <div className="model-detail__header">
            <h3>{model.modelName}</h3>
            <span className="model-detail__id">{model.modelId}</span>
          </div>
          <dl className="model-detail__metrics">
            <div>
              <dt>Average latency</dt>
              <dd>{Math.round(model.averageLatencyMs)} ms</dd>
            </div>
            <div>
              <dt>Accuracy</dt>
              <dd>{Math.round(model.accuracy * 100)}%</dd>
            </div>
            <div>
              <dt>Throughput</dt>
              <dd>{model.throughput.toFixed(1)} requests/min</dd>
            </div>
            <div>
              <dt>Total token usage</dt>
              <dd>{model.tokenUsage.toLocaleString()}</dd>
            </div>
            {typeof model.costPerRunUsd === 'number' && (
              <div>
                <dt>Estimated cost / run</dt>
                <dd>${model.costPerRunUsd.toFixed(2)}</dd>
              </div>
            )}
          </dl>
          {model.notes ? <p className="model-detail__notes">{model.notes}</p> : null}
        </div>
      ) : (
        <div className="model-detail model-detail--empty">
          <p>Select a model row to see latency, throughput, and quality highlights.</p>
        </div>
      )}
    </section>
  );
};

export default ModelDetailPanel;
