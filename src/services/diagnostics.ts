import {
  BenchmarkQuestion,
  DiagnosticsLevel,
  DiagnosticsLogEntry,
  DiagnosticsResult,
  ModelProfile,
} from '@/types/benchmark';
import createId from '@/utils/createId';
import { sendChatCompletion, fetchModels } from '@/services/lmStudioClient';
import { parseModelResponse, parseTopologyPrediction } from '@/services/evaluation';

/**
 * Dummy question used exclusively for L2 readiness checks.
 * This simple MCQ verifies protocol compliance without testing model intelligence.
 */
const READINESS_DUMMY_QUESTION: BenchmarkQuestion = {
  id: 'diagnostics-dummy',
  questionId: -1,
  displayId: null,
  type: 'MCQ',
  difficulty: 'easy',
  prompt: 'What is 2 + 2?',
  options: [
    { id: 0, order: 0, text: '3' },
    { id: 1, order: 1, text: '4' },
    { id: 2, order: 2, text: '5' },
    { id: 3, order: 3, text: '6' },
  ],
  answer: {
    kind: 'single',
    correctOption: 1,
  },
  metadata: {
    status: 'active',
    tags: ['diagnostics', 'dummy'],
  },
};

const createLog = (message: string, severity: 'info' | 'warn' | 'error' = 'info') => ({
  id: createId(),
  timestamp: new Date().toISOString(),
  message,
  severity,
});

const formatQuestionPrompt = (question: BenchmarkQuestion) => {
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
    'Return a JSON object with keys `answer`, `explanation`, and `confidence` (0-1). For multiple answers, join values using commas (e.g., "A,C").'
  );

  if (question.type === 'NAT' && question.answer.kind === 'numeric') {
    if (question.answer.range.min != null && question.answer.range.max != null) {
      lines.push(
        `Accepted numeric range: [${question.answer.range.min}, ${question.answer.range.max}] with precision ${question.answer.range.precision ?? 'unspecified'}.`
      );
    }
  }

  return lines.join('\n');
};

const buildTopologyPrompt = (question: BenchmarkQuestion) => {
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
    'Classify the question before answering. Return JSON with keys `subject`, `topic`, `subtopic`, and optionally `confidence` (0-1).'
  );

  return lines.join('\n');
};

const buildAnswerPromptWithTopology = (
  question: BenchmarkQuestion,
  topologyJson: string | undefined
) => {
  const prompt = formatQuestionPrompt(question);
  const topologyContext = topologyJson ? `\n\nTopology classification: ${topologyJson}` : '';
  return `${prompt}${topologyContext}`;
};

interface HandshakeOutcome {
  success: boolean;
  logs: DiagnosticsLogEntry[];
  supportsJsonMode: boolean;
  summary: string;
}

const performHandshake = async (profile: ModelProfile): Promise<HandshakeOutcome> => {
  const logs: DiagnosticsLogEntry[] = [];
  logs.push(createLog('Starting Level 1 handshake diagnostic.'));

  try {
    logs.push(createLog('Fetching model list from LM Studio server...'));
    const models = await fetchModels(profile);
    const modelIds = models.map((model) => model.id).join(', ') || 'no models reported';
    logs.push(createLog(`Received models: ${modelIds}`));
  } catch (error) {
    logs.push(
      createLog(
        `Failed to fetch models: ${(error as Error).message ?? 'unknown error'}`,
        'error'
      )
    );
    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: 'Model list request failed',
    };
  }

  try {
    logs.push(createLog('Attempting JSON-mode test completion.'));

    const completion = await sendChatCompletion({
      profile,
      messages: [
        {
          role: 'system',
          content:
            'You are a diagnostics assistant. Follow the instructions exactly, returning only what is requested.',
        },
        {
          role: 'user',
          content: 'Return the JSON object {"answer":"ready"} with no additional text.',
        },
      ],
      temperature: 0,
      preferJson: true,
      schemaType: 'answer', // Use answer schema to match parseModelResponse expectations
    });

    logs.push(
      createLog(
        completion.fallbackUsed
          ? 'Server rejected JSON mode; fallback to plain text succeeded.'
          : 'JSON mode completion succeeded.'
      )
    );

    const parsed = parseModelResponse(completion.text);
    const status = parsed.answer?.toLowerCase() ?? '';
    const success = status.includes('ready');

    logs.push(createLog(`Model response: ${completion.text}`));

    if (!success) {
      logs.push(createLog('Handshake response did not confirm readiness.', 'warn'));
    } else {
      logs.push(createLog('Handshake confirmed JSON compliance.'));
    }

    return {
      success,
      logs,
      supportsJsonMode: !completion.fallbackUsed,
      summary: success
        ? 'Handshake succeeded'
        : 'Handshake completed but response was not in expected format',
    };
  } catch (error) {
    logs.push(
      createLog(
        `Handshake request failed: ${(error as Error).message ?? 'unknown error'}`,
        'error'
      )
    );
    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: 'Handshake request failed',
    };
  }
};

interface ReadinessOutcome {
  success: boolean;
  logs: DiagnosticsLogEntry[];
  supportsJsonMode: boolean;
  summary: string;
  metadata: Record<string, unknown>;
}

/**
 * Performs L2 readiness check using a simple dummy question.
 * This check verifies protocol compliance only - it does NOT check answer correctness.
 * Success criteria:
 * - Response received successfully
 * - Response can be parsed into expected format
 * - Response contains required 'answer' field
 */
const performReadinessCheck = async (profile: ModelProfile): Promise<ReadinessOutcome> => {
  const logs: DiagnosticsLogEntry[] = [];

  logs.push(
    createLog(
      'Running Level 2 readiness check using dummy question to verify protocol compliance.'
    )
  );

  logs.push(createLog(`Profile configuration: ${profile.name} (${profile.modelId})`));
  logs.push(createLog(`Test question: ${READINESS_DUMMY_QUESTION.type} - "${READINESS_DUMMY_QUESTION.prompt}"`));

  try {
    // STEP 1: TOPOLOGY CLASSIFICATION
    logs.push(createLog('Step 1: Requesting topology classification.'));
    const topologyPrompt = buildTopologyPrompt(READINESS_DUMMY_QUESTION);

    logs.push(createLog(`Topology prompt length: ${topologyPrompt.length} chars`));
    logs.push(createLog('Sending topology classification request to model...'));

    const topologyStartTime = Date.now();
    const topologyCompletion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: topologyPrompt },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
      schemaType: 'topology',
    });
    const topologyLatencyMs = Date.now() - topologyStartTime;

    logs.push(createLog(`Topology response received in ${topologyLatencyMs}ms`));

    const topologyPrediction = parseTopologyPrediction(topologyCompletion.text);

    const hasTopologyPrediction =
      Boolean(topologyPrediction.subjectId) ||
      Boolean(topologyPrediction.topicId) ||
      Boolean(topologyPrediction.subtopicId);

    logs.push(createLog(`Parsed topology: subjectId=${topologyPrediction.subjectId}, topicId=${topologyPrediction.topicId}, subtopicId=${topologyPrediction.subtopicId}`));

    if (!hasTopologyPrediction) {
      logs.push(
        createLog(
          'Topology validation FAILED: Missing subject/topic/subtopic fields.',
          'error'
        )
      );
    } else {
      logs.push(createLog('Topology validation PASSED'));
    }

    const topologyContext = JSON.stringify(
      {
        subjectId: topologyPrediction.subjectId ?? null,
        topicId: topologyPrediction.topicId ?? null,
        subtopicId: topologyPrediction.subtopicId ?? null,
      },
      null,
      2
    );

    // STEP 2: ANSWER WITH TOPOLOGY CONTEXT
    logs.push(createLog('Step 2: Requesting final answer using topology context.'));
    const answerPrompt = buildAnswerPromptWithTopology(READINESS_DUMMY_QUESTION, topologyContext);

    logs.push(createLog(`Answer prompt length: ${answerPrompt.length} chars`));
    logs.push(createLog('Sending answer request to model...'));

    const answerStartTime = Date.now();
    const answerCompletion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: answerPrompt },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
      schemaType: 'answer',
    });
    const answerLatencyMs = Date.now() - answerStartTime;

    logs.push(createLog(`Answer response received in ${answerLatencyMs}ms`));

    const parsed = parseModelResponse(answerCompletion.text);

    logs.push(createLog(`Parsed answer: "${parsed.answer}"`));

    // VALIDATION
    const hasAnswer = parsed.answer !== undefined && parsed.answer !== null && parsed.answer !== '';
    const hasValidFormat = typeof parsed.answer === 'string';

    logs.push(createLog(`Validation: hasTopology=${hasTopologyPrediction}, hasAnswer=${hasAnswer}, validFormat=${hasValidFormat}`));

    const formatCompliant = hasTopologyPrediction && hasAnswer && hasValidFormat;

    if (!formatCompliant) {
      const failureReasons: string[] = [];
      if (!hasTopologyPrediction) failureReasons.push('Missing topology prediction');
      if (!hasAnswer) failureReasons.push('Missing answer field');
      if (!hasValidFormat) failureReasons.push(`Answer is not a string`);

      logs.push(
        createLog(
          `Protocol check FAILED: ${failureReasons.join(', ')}`,
          'error'
        )
      );
    } else {
      logs.push(createLog(`Protocol check PASSED`));
    }

    if (formatCompliant) {
      logs.push(createLog('Readiness check PASSED - Model is ready for benchmarking'));
    }

    return {
      success: formatCompliant,
      logs,
      supportsJsonMode: !topologyCompletion.fallbackUsed && !answerCompletion.fallbackUsed,
      summary: formatCompliant
        ? 'Protocol compliance verified - response format is correct.'
        : 'Protocol check failed - response format is invalid.',
      metadata: {
        topologyResponse: topologyPrediction,
        parsedResponse: {
          hasAnswer,
          hasExplanation: parsed.explanation !== undefined,
          hasConfidence: parsed.confidence !== undefined,
        },
        rawResponses: {
          topology: topologyCompletion.text,
          answer: answerCompletion.text,
        },
        modelId: profile.modelId,
      },
    };
  } catch (error) {
    const errorMessage = (error as Error).message ?? 'unknown error';
    const errorStack = (error as Error).stack;

    logs.push(
      createLog(
        `Readiness check failed: ${errorMessage}`,
        'error'
      )
    );

    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: `Readiness request failed: ${errorMessage}`,
      metadata: {
        error: errorMessage,
        errorStack: errorStack,
        modelId: profile.modelId,
      },
    };
  }
};

interface DiagnosticsOptions {
  profile: ModelProfile;
  level: DiagnosticsLevel;
}

export const runDiagnostics = async ({
  profile,
  level,
}: DiagnosticsOptions): Promise<DiagnosticsResult> => {
  const startedAt = new Date().toISOString();
  let completedAt: string;
  let status: 'pass' | 'fail' = 'fail';
  let logs: DiagnosticsLogEntry[] = [];
  let summary = '';
  let supportsJsonMode = false;
  let metadata: Record<string, unknown> | undefined;

  if (level === 'HANDSHAKE') {
    const result = await performHandshake(profile);
    completedAt = new Date().toISOString();
    status = result.success ? 'pass' : 'fail';
    logs = result.logs;
    summary = result.summary;
    supportsJsonMode = result.supportsJsonMode;
  } else {
    const result = await performReadinessCheck(profile);
    completedAt = new Date().toISOString();
    status = result.success ? 'pass' : 'fail';
    logs = result.logs;
    summary = result.summary;
    supportsJsonMode = result.supportsJsonMode;
    metadata = result.metadata;
  }

  return {
    id: createId(),
    profileId: profile.id,
    level,
    startedAt,
    completedAt,
    status,
    summary,
    fallbackApplied: !supportsJsonMode,
    metadata: {
      ...(metadata ?? {}),
      supportsJsonMode,
    },
    logs,
  };
};
