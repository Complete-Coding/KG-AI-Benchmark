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
          content: 'Return the JSON object {"status":"ready"} with no additional text.',
        },
      ],
      temperature: 0,
      preferJson: true,
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

  try {
    logs.push(createLog('Step 1: Requesting topology classification.'));
    const topologyPrompt = buildTopologyPrompt(READINESS_DUMMY_QUESTION);
    const topologyCompletion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: topologyPrompt },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
    });

    logs.push(
      createLog(
        topologyCompletion.fallbackUsed
          ? 'Topology step fell back to plain text.'
          : 'Topology step responded in JSON mode.'
      )
    );

    const topologyPrediction = parseTopologyPrediction(topologyCompletion.text);
    const hasTopologyPrediction =
      Boolean(topologyPrediction.subject) ||
      Boolean(topologyPrediction.topic) ||
      Boolean(topologyPrediction.subtopic);

    logs.push(createLog(`Topology response: ${topologyCompletion.text}`));

    if (!hasTopologyPrediction) {
      logs.push(
        createLog(
          'Topology response missing subject/topic/subtopic fields required for readiness.',
          'warn'
        )
      );
    }

    const topologyContext = JSON.stringify(
      {
        subject: topologyPrediction.subject ?? null,
        topic: topologyPrediction.topic ?? null,
        subtopic: topologyPrediction.subtopic ?? null,
      },
      null,
      2
    );

    logs.push(createLog('Step 2: Requesting final answer using topology context.'));
    const answerPrompt = buildAnswerPromptWithTopology(READINESS_DUMMY_QUESTION, topologyContext);
    const answerCompletion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: answerPrompt },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
    });

    logs.push(
      createLog(
        answerCompletion.fallbackUsed
          ? 'Answer step fell back to plain text.'
          : 'Answer step replied with JSON mode enabled.'
      )
    );

    const parsed = parseModelResponse(answerCompletion.text);

    logs.push(createLog(`Answer response: ${answerCompletion.text}`));

    // Check format compliance, NOT answer correctness
    const hasAnswer = parsed.answer !== undefined && parsed.answer !== null && parsed.answer !== '';
    const hasValidFormat = typeof parsed.answer === 'string';

    const formatCompliant = hasTopologyPrediction && hasAnswer && hasValidFormat;

    if (!formatCompliant) {
      logs.push(
        createLog(
          'Protocol check failed: topology or answer step missing required fields.',
          'warn'
        )
      );
    } else {
      logs.push(
        createLog(
          `Protocol check passed: response contains properly formatted 'answer' field ("${parsed.answer}").`
        )
      );
      if (parsed.explanation) {
        logs.push(createLog(`Optional 'explanation' field present.`));
      }
      if (parsed.confidence !== undefined) {
        logs.push(createLog(`Optional 'confidence' field present: ${parsed.confidence}.`));
      }
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
      },
    };
  } catch (error) {
    logs.push(
      createLog(
        `Readiness check failed: ${(error as Error).message ?? 'unknown error'}`,
        'error'
      )
    );

    return {
      success: false,
      logs,
      supportsJsonMode: false,
      summary: 'Readiness request failed',
      metadata: {
        error: (error as Error).message,
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
