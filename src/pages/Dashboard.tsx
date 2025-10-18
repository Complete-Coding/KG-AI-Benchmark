import ModelDetailPanel from '@/components/ModelDetailPanel';
import ModelPerformanceTable from '@/components/ModelPerformanceTable';
import SummaryCards from '@/components/SummaryCards';
import TrendChart from '@/components/TrendChart';
import { useBenchmarkContext } from '@/context/BenchmarkContext';

const Dashboard = () => {
  const { overview, selectedModelId, selectModel, selectedModel } = useBenchmarkContext();
  const { latestRun, recentTrend } = overview;

  const handleSelect = (modelId: string) => {
    selectModel(selectedModelId === modelId ? null : modelId);
  };

  return (
    <div className="dashboard">
      <SummaryCards run={latestRun} />
      <ModelPerformanceTable
        results={latestRun.results}
        selectedModelId={selectedModelId}
        onSelect={handleSelect}
      />
      <div className="dashboard__grid">
        <TrendChart data={recentTrend} />
        <ModelDetailPanel model={selectedModel} />
      </div>
    </div>
  );
};

export default Dashboard;
