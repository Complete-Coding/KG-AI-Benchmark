export type BenchmarkTaskType =
  | 'subject-tagging'
  | 'answer-grading'
  | 'latency-eval'
  | 'custom';

export interface BenchmarkDataset {
  id: string;
  name: string;
  questionCount: number;
  description: string;
  taskTypes: BenchmarkTaskType[];
}

export interface ModelBenchmarkResult {
  modelId: string;
  modelName: string;
  averageLatencyMs: number;
  accuracy: number;
  throughput: number;
  tokenUsage: number;
  costPerRunUsd?: number;
  notes?: string;
}

export interface BenchmarkRunMeta {
  id: string;
  dataset: BenchmarkDataset;
  startedAt: string;
  completedAt: string;
  totalPrompts: number;
  results: ModelBenchmarkResult[];
  evaluationNotes?: string;
}

export interface TrendPoint {
  timestamp: string;
  averageLatencyMs: number;
  accuracy: number;
  throughput: number;
}

export interface BenchmarkOverview {
  latestRun: BenchmarkRunMeta;
  recentTrend: TrendPoint[];
}
