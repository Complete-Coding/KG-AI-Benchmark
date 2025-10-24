import {
  BenchmarkAttempt,
  BenchmarkRun,
  BenchmarkRunMetrics,
  BenchmarkQuestion,
  ModelProfile,
} from '@/types/benchmark';
import { sendChatCompletion } from '@/services/lmStudioClient';
import { evaluateModelAnswer, parseModelResponse } from '@/services/evaluation';
import { createEmptyRunMetrics } from '@/data/defaults';
import createId from '@/utils/createId';

const buildQuestionPrompt = (question: BenchmarkQuestion) => {
  const lines: string[] = [];
  lines.push(`Question (${question.type}): ${question.prompt}`);

  if (question.instructions) {
    lines.push(`Instructions: ${question.instructions}`);
  }

  if (question.options.length > 0) {
    lines.push('');
    lines.push('Options:');
    question.options.forEach((option, index) => {
      const label = String.fromCharCode(65 + index);
      lines.push(`${label}. ${option.text}`);
    });
  }

  lines.push('');
  lines.push(
    'Return JSON with keys `answer`, `explanation`, and `confidence` (0-1). For multiple answers, join option letters using commas - e.g., "A,C".'
  );

  if (question.type === 'NAT' && question.answer.kind === 'numeric') {
    if (question.answer.range.min != null && question.answer.range.max != null) {
      lines.push(
        `Numeric tolerance: [${question.answer.range.min}, ${question.answer.range.max}] (precision ${question.answer.range.precision ?? 'unspecified'}).`
      );
    }
  }

  return lines.join('\n');
};

const aggregateMetrics = (attempts: BenchmarkAttempt[]): BenchmarkRunMetrics => {
  if (attempts.length === 0) {
    return createEmptyRunMetrics();
  }

  const passedCount = attempts.filter((attempt) => attempt.evaluation.passed).length;
  const totalLatencyMs = attempts.reduce((acc, attempt) => acc + attempt.latencyMs, 0);
  const failedCount = attempts.length - passedCount;

  return {
    passedCount,
    failedCount,
    totalLatencyMs,
    accuracy: passedCount / attempts.length,
    averageLatencyMs: totalLatencyMs / attempts.length,
  };
};

export interface BenchmarkExecutionOptions {
  profile: ModelProfile;
  questions: BenchmarkQuestion[];
  run: BenchmarkRun;
  onQuestionStart?: (question: BenchmarkQuestion, index: number) => void;
  onProgress?: (attempt: BenchmarkAttempt, progress: number, metrics: BenchmarkRunMetrics) => void;
  signal?: AbortSignal;
}

export const executeBenchmarkRun = async ({
  profile,
  questions,
  run,
  onQuestionStart,
  onProgress,
  signal,
}: BenchmarkExecutionOptions): Promise<BenchmarkRun> => {
  const startedAt = new Date();
  const attempts: BenchmarkAttempt[] = [];

  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];

    onQuestionStart?.(question, index);

    if (signal?.aborted) {
      throw new DOMException('Benchmark run aborted', 'AbortError');
    }

    const requestStartedAt = new Date();
    const startTime = Date.now();
    const prompt = buildQuestionPrompt(question);

    try {
      const completion = await sendChatCompletion({
        profile,
        messages: [
          { role: 'system', content: profile.defaultSystemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature: profile.temperature,
        maxTokens: profile.maxOutputTokens,
        preferJson: profile.metadata.supportsJsonMode ?? true,
        signal,
      });

      const latencyMs = Date.now() - startTime;
      const parsed = parseModelResponse(completion.text);
      const evaluation = evaluateModelAnswer(question, parsed);

      const attempt: BenchmarkAttempt = {
        id: createId(),
        questionId: question.id,
        startedAt: requestStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
        promptTokens: completion.usage?.promptTokens,
        completionTokens: completion.usage?.completionTokens,
        totalTokens: completion.usage?.totalTokens,
        requestPayload: {
          model: profile.modelId,
          temperature: profile.temperature,
          prompt,
        },
        responsePayload: completion.raw,
        responseText: completion.text,
        modelResponse: parsed,
        evaluation,
        questionSnapshot: {
          prompt: question.prompt,
          type: question.type,
          difficulty: question.difficulty,
          options: question.options,
          answer: question.answer,
          solution: question.solution,
        },
      };

      attempts.push(attempt);

      const metrics = aggregateMetrics(attempts);
      onProgress?.(attempt, (index + 1) / questions.length, metrics);
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const attempt: BenchmarkAttempt = {
        id: createId(),
        questionId: question.id,
        startedAt: requestStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
        requestPayload: {
          model: profile.modelId,
          temperature: profile.temperature,
          prompt,
        },
        responseText: '',
        evaluation: {
          expected: '',
          received: '',
          passed: false,
          score: 0,
          notes: (error as Error).message,
        },
        error: (error as Error).message,
        questionSnapshot: {
          prompt: question.prompt,
          type: question.type,
          difficulty: question.difficulty,
          options: question.options,
          answer: question.answer,
          solution: question.solution,
        },
      };

      attempts.push(attempt);

      const metrics = aggregateMetrics(attempts);
      onProgress?.(attempt, (index + 1) / questions.length, metrics);
    }
  }

  const metrics = aggregateMetrics(attempts);
  const completedAt = new Date();

  return {
    ...run,
    status: 'completed',
    startedAt: run.startedAt ?? startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    attempts,
    metrics,
    summary: `Accuracy ${(metrics.accuracy * 100).toFixed(1)}% across ${attempts.length} questions.`,
  };
};
