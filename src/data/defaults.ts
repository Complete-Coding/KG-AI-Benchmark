import { BenchmarkRunMetrics, BenchmarkStepConfig } from '@/types/benchmark';

export const defaultBenchmarkSteps: BenchmarkStepConfig[] = [
  {
    id: 'analysis',
    label: 'Problem analysis',
    description: 'Review the prompt and enumerate the important details before answering.',
    promptTemplate:
      'Analyze the question carefully. List key facts, constraints, and any reasoning steps you will need before proposing an answer.',
    enabled: true,
  },
  {
    id: 'answer',
    label: 'Final answer',
    description:
      'Produce the final answer in the required format after completing your reasoning.',
    promptTemplate:
      'Using your reasoning, provide the final answer. Respect the answer format requested in the prompt. Respond using JSON with fields `answer`, `explanation`, and `confidence` (0-1).',
    enabled: true,
  },
];

export const defaultSystemPrompt = `You are an evaluation assistant for competitive exam benchmarks. 
You must always return valid JSON that adheres to this schema:
{
  "answer": string,
  "explanation": string,
  "confidence": number (0 to 1)
}

Guidelines:
- Read the user question and available options (if any) carefully.
- Think step-by-step, then provide a concise final explanation.
- If you cannot determine the answer, respond with "answer": "UNKNOWN" and explain why.
- Do not output any text before or after the JSON object.
- When requested to respond without JSON mode, still keep the JSON object as plain text.`;

export const createEmptyRunMetrics = (): BenchmarkRunMetrics => ({
  accuracy: 0,
  averageLatencyMs: 0,
  totalLatencyMs: 0,
  passedCount: 0,
  failedCount: 0,
});
