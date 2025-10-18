import type { BenchmarkRunMeta } from '@/types/benchmark';

interface SummaryCardsProps {
  run: BenchmarkRunMeta;
}

const formatDuration = (start: string, end: string) => {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const durationMs = Math.max(endDate.getTime() - startDate.getTime(), 0);
  const minutes = Math.floor(durationMs / 60000);
  const seconds = Math.floor((durationMs % 60000) / 1000);

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

const SummaryCards = ({ run }: SummaryCardsProps) => {
  return (
    <section className="panel">
      <header className="panel__header">
        <h2>Latest benchmark run</h2>
        <p className="panel__subtitle">{new Date(run.completedAt).toLocaleString()}</p>
      </header>
      <div className="summary-grid">
        <article className="summary-card">
          <h3>Dataset</h3>
          <p className="summary-card__value">{run.dataset.name}</p>
          <p className="summary-card__meta">{run.dataset.questionCount} prompts</p>
        </article>
        <article className="summary-card">
          <h3>Tasks</h3>
          <ul className="summary-card__tags">
            {run.dataset.taskTypes.map((task) => (
              <li key={task}>{task}</li>
            ))}
          </ul>
        </article>
        <article className="summary-card">
          <h3>Run duration</h3>
          <p className="summary-card__value">{formatDuration(run.startedAt, run.completedAt)}</p>
          <p className="summary-card__meta">{run.totalPrompts} evaluated prompts</p>
        </article>
        <article className="summary-card">
          <h3>Models compared</h3>
          <p className="summary-card__value">{run.results.length}</p>
          <p className="summary-card__meta">Click a row to view model insights</p>
        </article>
      </div>
    </section>
  );
};

export default SummaryCards;
