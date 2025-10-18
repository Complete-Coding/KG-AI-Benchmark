import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { mockOverview } from '@/data/mockResults';
import type { BenchmarkOverview, ModelBenchmarkResult } from '@/types/benchmark';

interface BenchmarkContextValue {
  overview: BenchmarkOverview;
  selectedModelId: string | null;
  selectModel: (modelId: string | null) => void;
  selectedModel?: ModelBenchmarkResult;
}

const BenchmarkContext = createContext<BenchmarkContextValue | undefined>(undefined);

export const BenchmarkProvider = ({ children }: { children: ReactNode }) => {
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const selectedModel = useMemo(() => {
    if (!selectedModelId) {
      return undefined;
    }
    return mockOverview.latestRun.results.find((result) => result.modelId === selectedModelId);
  }, [selectedModelId]);

  const value = useMemo<BenchmarkContextValue>(
    () => ({
      overview: mockOverview,
      selectedModelId,
      selectedModel,
      selectModel: setSelectedModelId,
    }),
    [selectedModelId, selectedModel]
  );

  return <BenchmarkContext.Provider value={value}>{children}</BenchmarkContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useBenchmarkContext = () => {
  const context = useContext(BenchmarkContext);

  if (!context) {
    throw new Error('useBenchmarkContext must be used within a BenchmarkProvider');
  }

  return context;
};
