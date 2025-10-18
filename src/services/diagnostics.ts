import {
  BenchmarkQuestion,
  DiagnosticsLevel,
  DiagnosticsLogEntry,
  DiagnosticsResult,
  ModelProfile,
} from '@/types/benchmark';
import createId from '@/utils/createId';
import { sendChatCompletion, fetchModels } from '@/services/lmStudioClient';
import { expectedAnswerSummary, evaluateModelAnswer, parseModelResponse } from '@/services/evaluation';
import { questionDataset } from '@/data/questions';

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

const selectSampleQuestion = (question?: BenchmarkQuestion) => question ?? questionDataset[0];

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

const performReadinessCheck = async (
  profile: ModelProfile,
  question: BenchmarkQuestion
): Promise<ReadinessOutcome> => {
  const logs: DiagnosticsLogEntry[] = [];
  logs.push(createLog(`Running Level 2 readiness check using question ${question.questionId}.`));

  try {
    const completion = await sendChatCompletion({
      profile,
      messages: [
        { role: 'system', content: profile.defaultSystemPrompt },
        { role: 'user', content: formatQuestionPrompt(question) },
      ],
      temperature: profile.temperature,
      maxTokens: profile.maxOutputTokens,
      preferJson: true,
    });

    logs.push(
      createLog(
        completion.fallbackUsed
          ? 'Model replied after disabling JSON mode. Ensure prompts request JSON explicitly.'
          : 'Model replied with JSON mode enabled.'
      )
    );

    const parsed = parseModelResponse(completion.text);
    const evaluation = evaluateModelAnswer(question, parsed);

    logs.push(createLog(`Response body: ${completion.text}`));
    logs.push(
      createLog(
        `Evaluation: received "${evaluation.received}", expected "${evaluation.expected}".`
      )
    );

    return {
      success: evaluation.passed,
      logs,
      supportsJsonMode: !completion.fallbackUsed,
      summary: evaluation.passed
        ? 'Readiness check passed with correct answer.'
        : 'Readiness check completed but answer was incorrect.',
      metadata: {
        evaluation,
        expected: expectedAnswerSummary(question),
        questionId: question.id,
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
  question?: BenchmarkQuestion;
}

export const runDiagnostics = async ({
  profile,
  level,
  question,
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
    const chosenQuestion = selectSampleQuestion(question);
    const result = await performReadinessCheck(profile, chosenQuestion);
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
