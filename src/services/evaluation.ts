import {
  BenchmarkAttemptEvaluation,
  BenchmarkModelResponse,
  BenchmarkQuestion,
  BenchmarkQuestionOption,
  BenchmarkTopologyPrediction,
  BenchmarkTopologyStageResult,
} from '@/types/benchmark';
import { formatTopologyIds, getTopologyNames } from '@/utils/topologyLookup';

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

const clampConfidence = (value?: number) =>
  typeof value === 'number' ? Math.max(0, Math.min(1, value)) : undefined;

export const parseModelResponse = (text: string): BenchmarkModelResponse => {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('Model returned empty response');
  }

  const withoutCodeFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonCandidate = extractJsonObject(withoutCodeFence);
  const parsed = tryParseJson(jsonCandidate);

  if (!isRecord(parsed)) {
    throw new Error(
      `Model did not return valid JSON. Response: ${trimmed.substring(0, 200)}...`
    );
  }

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

  if (!answerValue) {
    throw new Error(
      `Model JSON response missing required 'answer' field. Response: ${JSON.stringify(parsed)}`
    );
  }

  const explanationField = parsed.explanation;
  const confidenceField = parsed.confidence;
  const explanation =
    typeof explanationField === 'string' ? explanationField.trim() : undefined;
  const confidence =
    typeof confidenceField === 'number'
      ? Math.max(0, Math.min(1, confidenceField))
      : undefined;

  return {
    answer: answerValue,
    explanation,
    confidence,
    raw: parsed,
  };
};

const normalizeId = (value?: string) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'none' || lower === 'undefined') {
    return undefined;
  }

  return trimmed;
};

const extractTopologyFromRecord = (record: Record<string, unknown>) => {
  const container = isRecord(record.topology) ? record.topology : record;

  // Try ID fields first (new format), fall back to name fields (legacy)
  const subjectIdRaw =
    readStringField(container.subjectId) ??
    readStringField(container.SubjectId) ??
    readStringField(container.subject) ??
    readStringField(container.Subject);
  const topicIdRaw =
    readStringField(container.topicId) ??
    readStringField(container.TopicId) ??
    readStringField(container.topic) ??
    readStringField(container.Topic);
  const subtopicIdRaw =
    readStringField(container.subtopicId) ??
    readStringField(container.SubtopicId) ??
    readStringField(container.subtopic) ??
    readStringField(container.Subtopic);

  const confidenceRaw = container.confidence ?? record.confidence;
  const confidence =
    typeof confidenceRaw === 'number'
      ? Math.max(0, Math.min(1, confidenceRaw))
      : undefined;

  return {
    subjectId: normalizeId(subjectIdRaw),
    topicId: normalizeId(topicIdRaw),
    subtopicId: normalizeId(subtopicIdRaw),
    confidence,
  };
};

const parseTopologyJson = (text: string) => {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('Model returned empty topology response');
  }

  const withoutCodeFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const jsonCandidate = extractJsonObject(withoutCodeFence);
  const parsed = tryParseJson(jsonCandidate);

  if (!isRecord(parsed)) {
    throw new Error(
      `Model did not return valid JSON for topology. Response: ${trimmed.substring(0, 200)}...`
    );
  }

  return { parsed, topology: extractTopologyFromRecord(parsed) };
};

export const parseTopologySubjectPrediction = (text: string): BenchmarkTopologyStageResult => {
  const { parsed, topology } = parseTopologyJson(text);

  if (!topology.subjectId) {
    throw new Error(
      `Model JSON response missing 'subjectId'. Response: ${JSON.stringify(parsed).substring(0, 200)}`
    );
  }

  return {
    stage: 'subject',
    id: topology.subjectId,
    confidence: topology.confidence,
    raw: parsed,
  };
};

export const parseTopologyTopicPrediction = (text: string): BenchmarkTopologyStageResult => {
  const { parsed, topology } = parseTopologyJson(text);

  if (!topology.topicId) {
    throw new Error(
      `Model JSON response missing 'topicId'. Response: ${JSON.stringify(parsed).substring(0, 200)}`
    );
  }

  return {
    stage: 'topic',
    id: topology.topicId,
    confidence: topology.confidence,
    raw: parsed,
    subjectId: topology.subjectId,
  };
};

export const parseTopologySubtopicPrediction = (text: string): BenchmarkTopologyStageResult => {
  const { parsed, topology } = parseTopologyJson(text);

  if (!topology.subtopicId) {
    throw new Error(
      `Model JSON response missing 'subtopicId'. Response: ${JSON.stringify(parsed).substring(0, 200)}`
    );
  }

  return {
    stage: 'subtopic',
    id: topology.subtopicId,
    confidence: topology.confidence,
    raw: parsed,
    subjectId: topology.subjectId,
    topicId: topology.topicId,
  };
};

export const parseTopologyPrediction = (text: string): BenchmarkTopologyPrediction => {
  const { parsed, topology } = parseTopologyJson(text);

  if (!topology.subjectId && !topology.topicId && !topology.subtopicId) {
    throw new Error(
      `Model JSON response missing topology fields (subjectId, topicId, subtopicId). Response: ${JSON.stringify(parsed)}`
    );
  }

  return {
    ...topology,
    raw: parsed,
  };
};

const expectedAnswerText = (question: BenchmarkQuestion, options = question.options): string => {
  if (question.answer.kind === 'single') {
    const normalizedOptions = normalizeOptions(options);
    const singleAnswer = question.answer;
    const option = normalizedOptions.find((item) => item.order === singleAnswer.correctOption);
    return option ? option.letter : `${singleAnswer.correctOption}`;
  }

  if (question.answer.kind === 'multiple') {
    const normalized = normalizeOptions(options);
    const multipleAnswer = question.answer;
    const expectedSet = new Set(multipleAnswer.correctOptions);
    const selected = normalized.filter((item) => expectedSet.has(item.order));
    return selected.length > 0
      ? selected.map((item) => item.letter).join(',')
      : multipleAnswer.correctOptions.join(',');
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

export const evaluateTopologyPrediction = (
  question: BenchmarkQuestion,
  prediction: BenchmarkTopologyPrediction
): BenchmarkAttemptEvaluation => {
  const expectedTopology = question.metadata.topology ?? {};
  const expectedSubjectId = expectedTopology.subjectId ?? null;
  const expectedTopicId = expectedTopology.topicId ?? null;
  const expectedSubtopicId = expectedTopology.subtopicId ?? null;

  // Direct ID comparison (exact string matching)
  const subjectExpected = expectedSubjectId !== null && expectedSubjectId !== undefined;
  const topicExpected = expectedTopicId !== null && expectedTopicId !== undefined;
  const subtopicExpected = expectedSubtopicId !== null && expectedSubtopicId !== undefined;

  const subjectMatch = subjectExpected ? prediction.subjectId === expectedSubjectId : true;
  const topicMatch = topicExpected ? prediction.topicId === expectedTopicId : true;
  const subtopicMatch = subtopicExpected ? prediction.subtopicId === expectedSubtopicId : true;

  const expectedFields = [
    { key: 'subjectId', expected: expectedSubjectId, matches: subjectMatch },
    { key: 'topicId', expected: expectedTopicId, matches: topicMatch },
    { key: 'subtopicId', expected: expectedSubtopicId, matches: subtopicMatch },
  ] as const;

  const comparisons = expectedFields.filter((item) => item.expected);
  const totalComparisons = comparisons.length;
  const matchedCount = comparisons.filter((item) => item.matches).length;
  const score = totalComparisons === 0 ? 1 : matchedCount / totalComparisons;
  const passed = totalComparisons === 0 ? true : matchedCount === totalComparisons;
  const mismatches = comparisons.filter((item) => !item.matches);

  // Use lookup utilities to get names for display
  const expectedText = formatTopologyIds({
    subjectId: expectedSubjectId,
    topicId: expectedTopicId,
    subtopicId: expectedSubtopicId,
  });
  const receivedText = formatTopologyIds({
    subjectId: prediction.subjectId,
    topicId: prediction.topicId,
    subtopicId: prediction.subtopicId,
  });

  let notes: string | undefined;

  if (mismatches.length > 0) {
    const expectedNames = getTopologyNames({
      subjectId: expectedSubjectId,
      topicId: expectedTopicId,
      subtopicId: expectedSubtopicId,
    });
    const receivedNames = getTopologyNames({
      subjectId: prediction.subjectId,
      topicId: prediction.topicId,
      subtopicId: prediction.subtopicId,
    });

    notes = mismatches
      .map((item) => {
        const levelName = item.key.replace('Id', '');
        const expected = expectedNames[levelName as keyof typeof expectedNames];
        const received = receivedNames[levelName as keyof typeof receivedNames];
        return `${levelName} mismatch (expected "${expected ?? '—'}", received "${received ?? '—'}")`;
      })
      .join('; ');
  } else if (totalComparisons === 0) {
    notes = 'Question has no topology metadata to compare.';
  }

  const subjectConfidence =
    clampConfidence(prediction.subjectConfidence) ??
    clampConfidence(prediction.stages?.subject?.confidence);
  const topicConfidence =
    clampConfidence(prediction.topicConfidence) ??
    clampConfidence(prediction.stages?.topic?.confidence);
  const subtopicConfidence =
    clampConfidence(prediction.subtopicConfidence) ??
    clampConfidence(prediction.stages?.subtopic?.confidence);

  const metrics = {
    confidence: clampConfidence(
      prediction.confidence ?? prediction.subtopicConfidence ?? prediction.topicConfidence
    ),
    subjectConfidence,
    topicConfidence,
    subtopicConfidence,
    subjectMatch: subjectExpected ? subjectMatch : undefined,
    topicMatch: topicExpected ? topicMatch : undefined,
    subtopicMatch: subtopicExpected ? subtopicMatch : undefined,
    subjectExpected,
    topicExpected,
    subtopicExpected,
    subjectProvided: Boolean(prediction.subjectId),
    topicProvided: Boolean(prediction.topicId),
    subtopicProvided: Boolean(prediction.subtopicId),
  };

  return {
    expected: expectedText,
    received: receivedText,
    passed,
    score,
    notes,
    metrics,
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
