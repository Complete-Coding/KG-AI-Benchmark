import {
  BenchmarkAttemptEvaluation,
  BenchmarkModelResponse,
  BenchmarkQuestion,
  BenchmarkQuestionOption,
  BenchmarkTopologyPrediction,
} from '@/types/benchmark';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const sanitize = (value: string) =>
  value
    .replace(/[`"'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const normalizeOptions = (options: BenchmarkQuestionOption[]) =>
  options.map((option, index) => ({
    ...option,
    letter: LETTERS[index] ?? String(index + 1),
    normalized: sanitize(option.text),
  }));

const extractJsonObject = (text: string) => {
  const match = /{[\s\S]*}/.exec(text);
  return match ? match[0] : text;
};

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readStringField = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() : undefined;

export const parseModelResponse = (text: string): BenchmarkModelResponse => {
  const trimmed = text.trim();
  const withoutCodeFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonCandidate = extractJsonObject(withoutCodeFence);
  const parsed = tryParseJson(jsonCandidate);

  if (isRecord(parsed)) {
    const answerField = parsed.answer;
    let answerValue = '';

    if (typeof answerField === 'string') {
      answerValue = answerField;
    } else if (
      Array.isArray(answerField) &&
      answerField.every((item): item is string => typeof item === 'string')
    ) {
      answerValue = answerField.join(', ');
    }

    const explanationField = parsed.explanation;
    const confidenceField = parsed.confidence;
    const explanation =
      typeof explanationField === 'string' ? explanationField.trim() : undefined;
    const confidence =
      typeof confidenceField === 'number'
        ? Math.max(0, Math.min(1, confidenceField))
        : undefined;
    const finalAnswer = answerValue !== '' ? answerValue : trimmed;

    return {
      answer: finalAnswer,
      explanation,
      confidence,
      raw: parsed,
    };
  }

  const fallbackMatch = /answer\s*[:\-]\s*(.*)/i.exec(trimmed);
  const extractedAnswer = fallbackMatch ? fallbackMatch[1] : trimmed;

  return {
    answer: extractedAnswer.trim(),
    explanation: undefined,
    confidence: undefined,
    raw: trimmed,
  };
};

const extractTopologyFromRecord = (record: Record<string, unknown>) => {
  const container = isRecord(record.topology) ? record.topology : record;

  const subject = readStringField(container.subject) ?? readStringField(container.Subject);
  const topic = readStringField(container.topic) ?? readStringField(container.Topic);
  const subtopic = readStringField(container.subtopic) ?? readStringField(container.Subtopic);
  const confidenceRaw = container.confidence ?? record.confidence;
  const confidence =
    typeof confidenceRaw === 'number'
      ? Math.max(0, Math.min(1, confidenceRaw))
      : undefined;

  return { subject, topic, subtopic, confidence };
};

const extractTopologyFromText = (text: string) => {
  const subjectMatch = /subject\s*[:=\-]\s*([^\n,]+)/i.exec(text);
  const topicMatch = /topic\s*[:=\-]\s*([^\n,]+)/i.exec(text);
  const subtopicMatch = /sub\s*-?\s*topic\s*[:=\-]\s*([^\n,]+)/i.exec(text);

  return {
    subject: subjectMatch ? subjectMatch[1].trim() : undefined,
    topic: topicMatch ? topicMatch[1].trim() : undefined,
    subtopic: subtopicMatch ? subtopicMatch[1].trim() : undefined,
    confidence: undefined,
  };
};

export const parseTopologyPrediction = (text: string): BenchmarkTopologyPrediction => {
  const trimmed = text.trim();
  const withoutCodeFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonCandidate = extractJsonObject(withoutCodeFence);
  const parsed = tryParseJson(jsonCandidate);

  if (isRecord(parsed)) {
    const topology = extractTopologyFromRecord(parsed);
    return {
      ...topology,
      raw: parsed,
    };
  }

  const fallback = extractTopologyFromText(trimmed);
  return {
    ...fallback,
    raw: trimmed,
  };
};

const expectedAnswerText = (question: BenchmarkQuestion, options = question.options): string => {
  if (question.answer.kind === 'single') {
    const normalizedOptions = normalizeOptions(options);
    const singleAnswer = question.answer;
    const option = normalizedOptions.find((item) => item.order === singleAnswer.correctOption);
    return option ? `${option.letter}) ${option.text}` : `${singleAnswer.correctOption}`;
  }

  if (question.answer.kind === 'multiple') {
    const normalized = normalizeOptions(options);
    const multipleAnswer = question.answer;
    const expectedSet = new Set(multipleAnswer.correctOptions);
    const selected = normalized.filter((item) => expectedSet.has(item.order));
    return selected.length > 0
      ? selected.map((item) => `${item.letter}) ${item.text}`).join(', ')
      : multipleAnswer.correctOptions.join(', ');
  }

  if (question.answer.kind === 'numeric') {
    if (question.answer.range.min != null && question.answer.range.max != null) {
      if (question.answer.range.min === question.answer.range.max) {
        return `${question.answer.range.min}`;
      }
      return `${question.answer.range.min} - ${question.answer.range.max}`;
    }
    if (question.answer.acceptedAnswers.length > 0) {
      return question.answer.acceptedAnswers.join(', ');
    }
    return 'Numeric answer';
  }

  if (question.answer.kind === 'boolean') {
    return question.answer.value ? 'True' : 'False';
  }

  if (question.answer.kind === 'descriptive') {
    return question.answer.acceptedAnswers.join(', ');
  }

  return '';
};

const matchOptionIndex = (value: string, options: ReturnType<typeof normalizeOptions>) => {
  const raw = sanitize(value);

  if (!raw) {
    return undefined;
  }

  const digitMatch = /(\d+)/.exec(raw);
  if (digitMatch) {
    const numeric = Number.parseInt(digitMatch[1], 10) - 1;
    const option = options.find((opt) => opt.order === numeric);
    if (option) {
      return option.order;
    }
  }

  const letterMatch = /[a-z]/.exec(raw);
  if (letterMatch) {
    const letterIndex = LETTERS.indexOf(letterMatch[0].toUpperCase());
    const option = options.find((opt) => opt.order === letterIndex);
    if (option) {
      return option.order;
    }
  }

  const matchingOption = options.find((opt) => raw === opt.normalized);
  if (matchingOption) {
    return matchingOption.order;
  }

  const containsOption = options.find((opt) => raw.includes(opt.normalized));
  if (containsOption) {
    return containsOption.order;
  }

  return undefined;
};

const parseMultipleIndices = (value: string, options: ReturnType<typeof normalizeOptions>) => {
  const segments = value
    .split(/[,;/]|and|\n/i)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const indices = new Set<number>();

  segments.forEach((segment) => {
    const index = matchOptionIndex(segment, options);
    if (typeof index === 'number') {
      indices.add(index);
    }
  });

  if (indices.size === 0) {
    const index = matchOptionIndex(value, options);
    if (typeof index === 'number') {
      indices.add(index);
    }
  }

  return indices;
};

const joinTopologyParts = (subject?: string | null, topic?: string | null, subtopic?: string | null) =>
  [subject, topic, subtopic]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' › ');

const normalizeTopologyValue = (value?: string) => (value ? sanitize(value) : '');

export const evaluateTopologyPrediction = (
  question: BenchmarkQuestion,
  prediction: BenchmarkTopologyPrediction
): BenchmarkAttemptEvaluation => {
  const expectedTopology = question.metadata.topology ?? {};
  const expectedSubject = expectedTopology.subject ?? null;
  const expectedTopic = expectedTopology.topic ?? null;
  const expectedSubtopic = expectedTopology.subtopic ?? null;

  const expectedFields = [
    { key: 'subject', expected: expectedSubject },
    { key: 'topic', expected: expectedTopic },
    { key: 'subtopic', expected: expectedSubtopic },
  ] as const;

  const comparisons = expectedFields
    .filter((item) => item.expected)
    .map((item) => {
      const predictedValue = (prediction as Record<string, string | undefined>)[item.key];
      const matches =
        normalizeTopologyValue(predictedValue) === normalizeTopologyValue(item.expected ?? undefined);
      return {
        key: item.key,
        expected: item.expected,
        received: predictedValue,
        matches,
      };
    });

  const totalComparisons = comparisons.length;
  const matchedCount = comparisons.filter((item) => item.matches).length;
  const score = totalComparisons === 0 ? 1 : matchedCount / totalComparisons;
  const passed = totalComparisons === 0 ? true : matchedCount === totalComparisons;
  const mismatches = comparisons.filter((item) => !item.matches);
  const expectedText = joinTopologyParts(expectedSubject, expectedTopic, expectedSubtopic) || '—';
  const receivedText =
    joinTopologyParts(prediction.subject, prediction.topic, prediction.subtopic) || '—';

  let notes: string | undefined;

  if (mismatches.length > 0) {
    notes = mismatches
      .map(
        (item) =>
          `${item.key} mismatch (expected "${item.expected ?? '—'}", received "${
            item.received ?? '—'
          }")`
      )
      .join('; ');
  } else if (totalComparisons === 0) {
    notes = 'Question has no topology metadata to compare.';
  }

  return {
    expected: expectedText,
    received: receivedText,
    passed,
    score,
    notes,
    metrics:
      typeof prediction.confidence === 'number'
        ? {
            confidence: Math.max(0, Math.min(1, prediction.confidence)),
          }
        : undefined,
  };
};

const evaluateSingleChoice = (
  question: BenchmarkQuestion,
  response: BenchmarkModelResponse
): BenchmarkAttemptEvaluation => {
  const normalizedOptions = normalizeOptions(question.options);
  const expectedIndex = question.answer.kind === 'single' ? question.answer.correctOption : -1;
  const predictedIndex = matchOptionIndex(response.answer ?? '', normalizedOptions);

  const passed = predictedIndex === expectedIndex;
  const expected = expectedAnswerText(question, normalizedOptions);

  return {
    expected,
    received: response.answer ?? '',
    passed,
    score: passed ? 1 : 0,
    metrics: {
      confidence: response.confidence,
    },
    notes: passed
      ? undefined
      : predictedIndex == null
        ? 'Could not parse selected option.'
        : undefined,
  };
};

const evaluateMultipleChoice = (
  question: BenchmarkQuestion,
  response: BenchmarkModelResponse
): BenchmarkAttemptEvaluation => {
  const normalizedOptions = normalizeOptions(question.options);
  const expected = new Set(question.answer.kind === 'multiple' ? question.answer.correctOptions : []);
  const predicted = parseMultipleIndices(response.answer ?? '', normalizedOptions);

  const passed = predicted.size === expected.size && [...expected].every((item) => predicted.has(item));

  return {
    expected: expectedAnswerText(question, normalizedOptions),
    received: response.answer ?? '',
    passed,
    score: passed ? 1 : 0,
    metrics: {
      confidence: response.confidence,
    },
    notes: passed
      ? undefined
      : `Expected ${expected.size} option(s), received ${predicted.size || 0}.`,
  };
};

const evaluateNumeric = (
  question: BenchmarkQuestion,
  response: BenchmarkModelResponse
): BenchmarkAttemptEvaluation => {
  const numeric = Number.parseFloat(response.answer ?? '');
  const { range, acceptedAnswers, caseSensitive } = question.answer.kind === 'numeric'
    ? question.answer
    : { range: {}, acceptedAnswers: [], caseSensitive: false };

  let passed = false;

  if (Number.isFinite(numeric)) {
    if (typeof range.min === 'number' && typeof range.max === 'number') {
      passed = numeric >= range.min && numeric <= range.max;
    } else {
      passed = acceptedAnswers.some((answer) => Number.parseFloat(answer) === numeric);
    }
  }

  if (!passed && acceptedAnswers.length > 0) {
    const normalized = caseSensitive
      ? response.answer?.trim()
      : response.answer?.trim().toLowerCase();

    passed = acceptedAnswers.some((answer) =>
      caseSensitive ? answer.trim() === normalized : answer.trim().toLowerCase() === normalized
    );
  }

  return {
    expected: expectedAnswerText(question),
    received: response.answer ?? '',
    passed,
    score: passed ? 1 : 0,
    metrics: {
      confidence: response.confidence,
    },
    notes: passed ? undefined : 'Numeric answer outside accepted tolerance.',
  };
};

const evaluateBoolean = (
  question: BenchmarkQuestion,
  response: BenchmarkModelResponse
): BenchmarkAttemptEvaluation => {
  const truthy = /^(true|t|yes|y|1)$/i;
  const falsy = /^(false|f|no|n|0)$/i;

  const raw = response.answer?.trim() ?? '';
  const predicted = truthy.test(raw) ? true : falsy.test(raw) ? false : undefined;
  const expected = question.answer.kind === 'boolean' ? question.answer.value : undefined;
  const passed = predicted === expected;

  return {
    expected: expectedAnswerText(question),
    received: response.answer ?? '',
    passed,
    score: passed ? 1 : 0,
    metrics: {
      confidence: response.confidence,
    },
    notes: predicted == null ? 'Could not parse boolean answer.' : undefined,
  };
};

const evaluateDescriptive = (
  question: BenchmarkQuestion,
  response: BenchmarkModelResponse
): BenchmarkAttemptEvaluation => {
  const accepted = question.answer.kind === 'descriptive' ? question.answer.acceptedAnswers : [];

  if (accepted.length === 0) {
    return {
      expected: 'Manual review',
      received: response.answer ?? '',
      passed: false,
      score: 0,
      metrics: {
        confidence: response.confidence,
      },
      notes: 'No reference answers available.',
    };
  }

  const normalizedResponse = sanitize(response.answer ?? '');
  const passed = accepted.some((answer) => sanitize(answer) === normalizedResponse);

  return {
    expected: accepted.join(', '),
    received: response.answer ?? '',
    passed,
    score: passed ? 1 : 0,
    metrics: {
      confidence: response.confidence,
    },
  };
};

export const evaluateModelAnswer = (
  question: BenchmarkQuestion,
  response: BenchmarkModelResponse
): BenchmarkAttemptEvaluation => {
  switch (question.type) {
    case 'MCQ':
      return evaluateSingleChoice(question, response);
    case 'MSQ':
      return evaluateMultipleChoice(question, response);
    case 'NAT':
      return evaluateNumeric(question, response);
    case 'TRUE_FALSE':
      return evaluateBoolean(question, response);
    default:
      return evaluateDescriptive(question, response);
  }
};

export const expectedAnswerSummary = expectedAnswerText;
