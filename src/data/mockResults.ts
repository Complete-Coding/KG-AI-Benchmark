import { BenchmarkOverview } from '@/types/benchmark';

export const mockOverview: BenchmarkOverview = {
  latestRun: {
    id: 'run-2025-02-20',
    dataset: {
      id: 'knowledge-qa-v1',
      name: 'Knowledge QA v1',
      questionCount: 200,
      description: 'General knowledge questions with subject tagging benchmarks.',
      taskTypes: ['subject-tagging', 'answer-grading', 'latency-eval'],
    },
    startedAt: '2025-02-20T10:00:00Z',
    completedAt: '2025-02-20T10:47:00Z',
    totalPrompts: 200,
    evaluationNotes:
      'Latency measured locally against LM Studio-hosted models. Accuracy scored with rubric-based grader.',
    results: [
      {
        modelId: 'llama-3.3-70b',
        modelName: 'Llama 3.3 70B Instruct',
        averageLatencyMs: 3250,
        accuracy: 0.84,
        throughput: 8.6,
        tokenUsage: 162_320,
        costPerRunUsd: 0.0,
      },
      {
        modelId: 'qwen-2.5-32b',
        modelName: 'Qwen 2.5 32B',
        averageLatencyMs: 2875,
        accuracy: 0.81,
        throughput: 9.4,
        tokenUsage: 158_540,
      },
      {
        modelId: 'phi-4-mini',
        modelName: 'Phi-4 mini (14B)',
        averageLatencyMs: 1680,
        accuracy: 0.74,
        throughput: 11.2,
        tokenUsage: 140_120,
      },
    ],
  },
  recentTrend: [
    {
      timestamp: '2025-02-18',
      averageLatencyMs: 3560,
      accuracy: 0.78,
      throughput: 7.9,
    },
    {
      timestamp: '2025-02-19',
      averageLatencyMs: 3420,
      accuracy: 0.8,
      throughput: 8.5,
    },
    {
      timestamp: '2025-02-20',
      averageLatencyMs: 3250,
      accuracy: 0.84,
      throughput: 8.6,
    },
  ],
};
