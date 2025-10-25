import {
  BenchmarkAttempt,
  BenchmarkAttemptEvaluation,
  BenchmarkAttemptStepResult,
  BenchmarkModelResponse,
  BenchmarkRun,
  BenchmarkRunMetrics,
  BenchmarkQuestion,
  BenchmarkTopologyPrediction,
  ModelProfile,
} from '@/types/benchmark';
import { sendChatCompletion } from '@/services/lmStudioClient';
import {
  evaluateModelAnswer,
  evaluateTopologyPrediction,
  parseModelResponse,
  parseTopologyPrediction,
} from '@/services/evaluation';
import { createEmptyRunMetrics, defaultBenchmarkSteps } from '@/data/defaults';
import { questionTopology } from '@/data/topology';
import createId from '@/utils/createId';

/**
 * Builds question context FOR REFERENCE ONLY - without answer format instructions.
 * Used for topology classification where we don't want to confuse the model with answer format.
 */
const buildSimpleQuestionContext = (question: BenchmarkQuestion) => {
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

  return lines.join('\n');
};

/**
 * Builds full question context WITH answer format instructions.
 * Used for answer step where we need the model to return answer, explanation, confidence.
 */
const buildQuestionContext = (question: BenchmarkQuestion) => {
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

const stringifyPreviousOutputs = (steps: BenchmarkAttemptStepResult[]) => {
  if (steps.length === 0) {
    return '[]';
  }

  const summary = steps.map((step) => ({
    id: step.id,
    label: step.label,
    responseText: step.responseText,
    evaluation: step.evaluation,
    topologyPrediction: step.topologyPrediction,
    modelResponse: step.modelResponse,
  }));

  return JSON.stringify(summary, null, 2);
};

const applyTemplateReplacements = (template: string, replacements: Record<string, string>) => {
  return Object.entries(replacements).reduce(
    (result, [token, value]) => result.split(token).join(value),
    template
  );
};

const buildStepPrompt = (
  question: BenchmarkQuestion,
  stepId: string,
  stepTemplate: string,
  previousSteps: BenchmarkAttemptStepResult[],
  topologyPrediction?: BenchmarkTopologyPrediction
) => {
  const expectedTopology = question.metadata.topology ?? {};

  // Build complete topology catalog with IDs and names
  const topologyCatalog = questionTopology.map(subject => {
    const topics = subject.topics.map(topic => {
      const subtopics = topic.subtopics.map(st => `      - ${st.id} (${st.name})`).join('\n');
      return `    • ${topic.id} (${topic.name})${subtopics ? '\n' + subtopics : ''}`;
    }).join('\n');
    return `  ${subject.id} (${subject.name}):\n${topics}`;
  }).join('\n\n');

  const replacements: Record<string, string> = {
    '{{questionPrompt}}': question.prompt,
    '{{questionInstructions}}': question.instructions ?? 'None',
    '{{questionType}}': question.type,
    '{{questionOptions}}': question.options.length
      ? question.options
          .map((option, index) => `${String.fromCharCode(65 + index)}. ${option.text}`)
          .join('\n')
      : 'No options provided.',
    '{{previousStepOutputs}}': stringifyPreviousOutputs(previousSteps),
    '{{expectedTopology}}': JSON.stringify(expectedTopology, null, 2),
    '{{predictedTopology}}': JSON.stringify(topologyPrediction ?? {}, null, 2),
    '{{topologyCatalog}}': topologyCatalog,
  };

  const renderedInstructions = applyTemplateReplacements(stepTemplate ?? '', replacements);

  // Build prompt differently based on step type
  if (stepId === 'topology') {
    // For topology step: Classification instruction FIRST, then question context for reference
    const simpleContext = buildSimpleQuestionContext(question);

    console.log('[TOPOLOGY PROMPT BUILD] Question ID:', question.id);
    console.log('[TOPOLOGY PROMPT BUILD] Topology catalog subjects:', questionTopology.length);
    console.log('[TOPOLOGY PROMPT BUILD] Using REORDERED prompt: classification FIRST, question SECOND');

    // Classification instruction + catalog FIRST, question context SECOND (for reference only)
    const sections = [
      renderedInstructions,
      '\n---\nQUESTION FOR REFERENCE:\n',
      simpleContext
    ];

    return sections.filter(Boolean).join('\n').trim();
  } else {
    // For answer step and others: Question context with answer format FIRST, then instructions
    const fullContext = buildQuestionContext(question);
    const sections = [fullContext, renderedInstructions];

    if (question.type === 'NAT' && question.answer.kind === 'numeric') {
      if (question.answer.range.min != null && question.answer.range.max != null) {
        sections.push(
          `Numeric tolerance: [${question.answer.range.min}, ${question.answer.range.max}] (precision ${question.answer.range.precision ?? 'unspecified'}).`
        );
      } else if (question.answer.acceptedAnswers.length > 0) {
        sections.push(`Accepted numeric answers: ${question.answer.acceptedAnswers.join(', ')}`);
      }
    }

    return sections.filter(Boolean).join('\n\n').trim();
  }
};

const aggregateMetrics = (attempts: BenchmarkAttempt[]): BenchmarkRunMetrics => {
  if (attempts.length === 0) {
    return createEmptyRunMetrics();
  }

  const passedCount = attempts.filter((attempt) => attempt.evaluation.passed).length;
  const totalLatencyMs = attempts.reduce((acc, attempt) => acc + attempt.latencyMs, 0);
  const failedCount = attempts.length - passedCount;
  const topologyEvaluations = attempts.filter((attempt) => attempt.topologyEvaluation);
  const topologyPassedCount = topologyEvaluations.filter(
    (attempt) => attempt.topologyEvaluation?.passed
  ).length;
  const topologyFailedCount = topologyEvaluations.length - topologyPassedCount;

  return {
    passedCount,
    failedCount,
    totalLatencyMs,
    accuracy: passedCount / attempts.length,
    averageLatencyMs: totalLatencyMs / attempts.length,
    topologyPassedCount,
    topologyFailedCount,
    topologyAccuracy:
      topologyEvaluations.length > 0 ? topologyPassedCount / topologyEvaluations.length : 0,
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
    const stepsToRun =
      profile.benchmarkSteps?.filter((step) => step.enabled) ?? defaultBenchmarkSteps;
    const fallbackSteps =
      stepsToRun.length > 0 ? stepsToRun : defaultBenchmarkSteps.filter((step) => step.enabled);
    const executionSteps = fallbackSteps.length > 0 ? fallbackSteps : defaultBenchmarkSteps;
    const answerStepId =
      executionSteps.find((step) => step.id === 'answer')?.id ??
      executionSteps[executionSteps.length - 1]?.id;

    const attemptSteps: BenchmarkAttemptStepResult[] = [];
    const attemptStartedAtMs = Date.now();
    let topologyPrediction: BenchmarkTopologyPrediction | undefined;
    let finalResponseText = '';
    let finalResponsePayload: unknown;
    let finalModelResponse: BenchmarkModelResponse | undefined;
    let finalEvaluation: BenchmarkAttemptEvaluation | undefined;
    let topologyEvaluation: BenchmarkAttemptEvaluation | undefined;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalTokens = 0;

    try {

      for (let stepIndex = 0; stepIndex < executionSteps.length; stepIndex += 1) {
        const step = executionSteps[stepIndex];
        const prompt = buildStepPrompt(
          question,
          step.id ?? 'unknown',
          step.promptTemplate ?? '',
          attemptSteps,
          topologyPrediction
        );

        // Enhanced logging for both topology and answer steps
        if (step.id === 'topology') {
          console.log('\n═══════════════════════════════════════════════════════════════');
          console.log('[TOPOLOGY EXECUTION] Question ID:', question.id);
          console.log('[TOPOLOGY EXECUTION] Full prompt length:', prompt.length);
          console.log('[TOPOLOGY EXECUTION] Prompt contains taxonomy:',
            prompt.includes('Theory of Computation') || prompt.includes('Computer Networks'));
          console.log('[TOPOLOGY EXECUTION] First 1000 chars of prompt:');
          console.log(prompt.substring(0, 1000));
          console.log('═══════════════════════════════════════════════════════════════\n');
        }

        if (step.id === 'answer') {
          console.log('\n═══════════════════════════════════════════════════════════════');
          console.log('[ANSWER EXECUTION] Question ID:', question.id);
          console.log('[ANSWER EXECUTION] Full prompt length:', prompt.length);
          console.log('[ANSWER EXECUTION] Has previous step outputs:',
            prompt.includes('previousStepOutputs') || attemptSteps.length > 0);
          console.log('[ANSWER EXECUTION] First 1000 chars of prompt:');
          console.log(prompt.substring(0, 1000));
          console.log('═══════════════════════════════════════════════════════════════\n');
        }

        const stepStartedAt = Date.now();

        // Auto-detect thinking/reasoning models and set reasoning_effort to high
        const modelIdLower = profile.modelId.toLowerCase();
        const isThinkingModel =
          modelIdLower.includes('deepseek') ||
          modelIdLower.includes('thinking') ||
          modelIdLower.includes('r1') ||
          modelIdLower.includes('reasoning');

        const completion = await sendChatCompletion({
          profile,
          messages: [
            { role: 'system', content: profile.defaultSystemPrompt },
            { role: 'user', content: prompt },
          ],
          temperature: profile.temperature,
          maxTokens: profile.maxOutputTokens,
          preferJson: profile.metadata.supportsJsonMode ?? true,
          reasoningEffort: isThinkingModel ? 'high' : undefined,
          signal,
        });

        const stepLatencyMs = Date.now() - stepStartedAt;
        const usage = completion.usage ?? {};
        totalPromptTokens += usage.promptTokens ?? 0;
        totalCompletionTokens += usage.completionTokens ?? 0;
        totalTokens += usage.totalTokens ?? 0;

        const stepResult: BenchmarkAttemptStepResult = {
          id: step.id ?? `step-${stepIndex}`,
          label: step.label ?? `Step ${stepIndex + 1}`,
          order: stepIndex,
          prompt,
          requestPayload: {
            model: profile.modelId,
            temperature: profile.temperature,
            stepId: step.id,
          },
          responsePayload: completion.raw,
          responseText: completion.text,
          latencyMs: stepLatencyMs,
          usage,
        };

        if (step.id === 'topology') {
          const parsedTopology = parseTopologyPrediction(completion.text);
          const topologyEval = evaluateTopologyPrediction(question, parsedTopology);

          console.log('\n───────────────────────────────────────────────────────────────');
          console.log('[TOPOLOGY RESPONSE] Question ID:', question.id);
          console.log('[TOPOLOGY RESPONSE] Raw response (first 500 chars):');
          console.log(completion.text.substring(0, 500));
          console.log('[TOPOLOGY RESPONSE] Parsed prediction:', {
            subjectId: parsedTopology.subjectId,
            topicId: parsedTopology.topicId,
            subtopicId: parsedTopology.subtopicId,
            confidence: parsedTopology.confidence,
          });
          console.log('[TOPOLOGY RESPONSE] Expected:', {
            subjectId: question.metadata.topology?.subjectId,
            topicId: question.metadata.topology?.topicId,
            subtopicId: question.metadata.topology?.subtopicId,
          });
          console.log('[TOPOLOGY RESPONSE] Evaluation:', {
            passed: topologyEval.passed,
            score: topologyEval.score,
            expected: topologyEval.expected,
            received: topologyEval.received,
            notes: topologyEval.notes,
          });
          console.log('───────────────────────────────────────────────────────────────\n');

          topologyPrediction = parsedTopology;
          topologyEvaluation = topologyEval;
          stepResult.topologyPrediction = parsedTopology;
          stepResult.evaluation = topologyEval;
        } else if (step.id === answerStepId) {
          const parsedAnswer = parseModelResponse(completion.text);
          const answerEvaluation = evaluateModelAnswer(question, parsedAnswer);

          console.log('\n───────────────────────────────────────────────────────────────');
          console.log('[ANSWER RESPONSE] Question ID:', question.id);
          console.log('[ANSWER RESPONSE] Raw response (first 500 chars):');
          console.log(completion.text.substring(0, 500));
          console.log('[ANSWER RESPONSE] Parsed answer:', {
            answer: parsedAnswer.answer,
            confidence: parsedAnswer.confidence,
            explanation: parsedAnswer.explanation?.substring(0, 100) + '...',
          });
          console.log('[ANSWER RESPONSE] Expected answer:', answerEvaluation.expected);
          console.log('[ANSWER RESPONSE] Received answer:', answerEvaluation.received);
          console.log('[ANSWER RESPONSE] Evaluation:', {
            passed: answerEvaluation.passed,
            score: answerEvaluation.score,
            notes: answerEvaluation.notes,
          });
          console.log('[ANSWER RESPONSE] Token usage:', {
            prompt: usage.promptTokens,
            completion: usage.completionTokens,
            total: usage.totalTokens,
          });
          console.log('───────────────────────────────────────────────────────────────\n');

          finalModelResponse = parsedAnswer;
          finalEvaluation = answerEvaluation;
          finalResponseText = completion.text;
          finalResponsePayload = completion.raw;
          stepResult.modelResponse = parsedAnswer;
          stepResult.evaluation = answerEvaluation;
        }

        attemptSteps.push(stepResult);
      }

      const latencyMs = Date.now() - attemptStartedAtMs;
      const answerEvaluation: BenchmarkAttemptEvaluation =
        finalEvaluation ??
        {
          expected: '',
          received: '',
          passed: false,
          score: 0,
          notes: 'Answer step did not execute.',
        };

      const attempt: BenchmarkAttempt = {
        id: createId(),
        questionId: question.id,
        startedAt: requestStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
        promptTokens: totalPromptTokens || undefined,
        completionTokens: totalCompletionTokens || undefined,
        totalTokens: totalTokens || undefined,
        requestPayload: {
          model: profile.modelId,
          temperature: profile.temperature,
          steps: attemptSteps.map((step) => ({
            id: step.id,
            label: step.label,
            prompt: step.prompt,
          })),
        },
        responsePayload: finalResponsePayload,
        responseText: finalResponseText || attemptSteps[attemptSteps.length - 1]?.responseText || '',
        modelResponse: finalModelResponse,
        evaluation: answerEvaluation,
        topologyPrediction,
        topologyEvaluation,
        steps: attemptSteps,
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
      const latencyMs = Date.now() - attemptStartedAtMs;
      const attempt: BenchmarkAttempt = {
        id: createId(),
        questionId: question.id,
        startedAt: requestStartedAt.toISOString(),
        completedAt: new Date().toISOString(),
        latencyMs,
        promptTokens: totalPromptTokens || undefined,
        completionTokens: totalCompletionTokens || undefined,
        totalTokens: totalTokens || undefined,
        requestPayload: {
          model: profile.modelId,
          temperature: profile.temperature,
          steps: attemptSteps.map((step) => ({
            id: step.id,
            label: step.label,
            prompt: step.prompt,
          })),
        },
        responsePayload: attemptSteps[attemptSteps.length - 1]?.responsePayload,
        responseText: attemptSteps[attemptSteps.length - 1]?.responseText ?? '',
        evaluation: {
          expected: '',
          received: '',
          passed: false,
          score: 0,
          notes: (error as Error).message,
        },
        steps: attemptSteps,
        topologyPrediction,
        topologyEvaluation,
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
