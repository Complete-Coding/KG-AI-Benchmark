import rawDataset from './benchmark-questions.json';
import {
  BenchmarkQuestion,
  BenchmarkQuestionAnswer,
  BenchmarkQuestionOption,
  BenchmarkQuestionMediaImage,
  BenchmarkQuestionMediaSource,
  QuestionDatasetSummary,
  QuestionType,
} from '@/types/benchmark';
import { richTextToPlain } from '@/utils/richText';
import createId from '@/utils/createId';

type RawNode =
  | string
  | {
      type?: string;
      text?: string;
      content?: RawNode[];
    };

interface RawOption {
  id?: number;
  order?: number;
  text?: RawNode;
  feedback?: RawNode;
}

interface RawAnswer {
  correctOption?: number | null;
  correctOptions?: number[] | null;
  acceptedAnswers?: string[] | null;
  range?: {
    min?: number;
    max?: number;
    precision?: number;
  } | null;
  caseSensitive?: boolean;
  correct?: boolean;
}

type RawTopologyValue =
  | null
  | string
  | {
      name?: string | null;
      canonicalName?: string | null;
    };

interface RawQuestion {
  id?: string | null;
  questionId: number;
  displayId?: string | null;
  type: QuestionType;
  difficulty?: string | null;
  topology?:
    | {
        subjectId?: string | null;
        topicId?: string | null;
        subtopicId?: string | null;
      }
    | null;
  pyq?:
    | {
        type?: string | null;
        year?: number | null;
        exam?: RawTopologyValue;
        branch?: RawTopologyValue;
        paper?: RawTopologyValue;
      }
    | null;
  content: {
    questionText?: RawNode;
    instructions?: RawNode;
    options?: RawOption[] | null;
  };
  answer: RawAnswer;
  solution?: RawNode | null;
  metadata?:
    | {
        status?: string;
        hasImages?: boolean;
        createdAt?: string;
        updatedAt?: string;
        tags?: string[];
      }
    | null;
}

interface RawDataset {
  generatedAt?: string;
  total?: number;
  requested?: number;
  filters?: {
    questionTypes?: QuestionType[];
    excludeImages?: boolean;
    status?: string[];
  };
  stats?: {
    poolSize?: number;
    poolWithoutImages?: number;
    countsByType?: Record<string, number>;
  };
  questions: RawQuestion[];
}

const dataset = (rawDataset as RawDataset) ?? { questions: [] as RawQuestion[] };
const rawQuestions = Array.isArray(dataset.questions) ? dataset.questions : [];

const countsByType =
  dataset.stats?.countsByType ??
  rawQuestions.reduce<Record<string, number>>((acc, question) => {
    const key = question.type ?? 'UNKNOWN';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

const markdownImagePattern = /!\[(?<alt>[^\]]*)\]\((?<url>[^)]+)\)/gi;
const htmlImagePattern =
  /<img\s[^>]*src=["'](?<url>[^"']+)["'][^>]*?(?:alt=["'](?<alt>[^"']*)["'])?[^>]*>/gi;
const plainImagePattern =
  /(https?:\/\/[^\s)]+?\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s)]*)?)/gi;

const normalizeImageUrl = (candidate?: string | null): string | null => {
  if (!candidate) {
    return null;
  }
  const cleaned = candidate.trim().replace(/^['"]|['"]$/g, '');
  if (!cleaned) {
    return null;
  }
  try {
    const url = new URL(cleaned);
    return url.toString();
  } catch (_error) {
    return null;
  }
};

const extractImagesFromText = (
  text: string | undefined,
  source: BenchmarkQuestionMediaSource,
  optionIndex?: number
): Omit<BenchmarkQuestionMediaImage, 'id'>[] => {
  if (!text) {
    return [];
  }

  const matches: Omit<BenchmarkQuestionMediaImage, 'id'>[] = [];
  const seen = new Set<string>();

  const register = (
    urlCandidate: string | null,
    alt: string | undefined | null,
    inferredFrom: BenchmarkQuestionMediaImage['inferredFrom']
  ) => {
    const normalized = normalizeImageUrl(urlCandidate);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    matches.push({
      url: normalized,
      source,
      optionIndex,
      altText: alt ?? null,
      inferredFrom,
    });
  };

  let match: RegExpExecArray | null;

  markdownImagePattern.lastIndex = 0;
  while ((match = markdownImagePattern.exec(text)) !== null) {
    register(match.groups?.url ?? null, match.groups?.alt, 'markdown');
  }

  htmlImagePattern.lastIndex = 0;
  while ((match = htmlImagePattern.exec(text)) !== null) {
    register(match.groups?.url ?? null, match.groups?.alt, 'html');
  }

  plainImagePattern.lastIndex = 0;
  while ((match = plainImagePattern.exec(text)) !== null) {
    register(match[1] ?? null, null, 'url');
  }

  return matches;
};

const collectImageReferences = (
  question: RawQuestion,
  prompt: string,
  instructions: string,
  solution: string,
  options: BenchmarkQuestionOption[]
): BenchmarkQuestionMediaImage[] => {
  const images: Omit<BenchmarkQuestionMediaImage, 'id'>[] = [];

  const rawPromptText =
    typeof question.content?.questionText === 'string'
      ? question.content?.questionText
      : prompt;
  images.push(...extractImagesFromText(rawPromptText, 'prompt'));

  const rawInstructionsText =
    typeof question.content?.instructions === 'string'
      ? question.content?.instructions
      : instructions;
  images.push(
    ...extractImagesFromText(rawInstructionsText, 'instructions')
  );

  options.forEach((option, index) => {
    images.push(
      ...extractImagesFromText(option.text, 'option', index)
    );
  });

  const rawSolutionText =
    typeof question.solution === 'string' ? question.solution : solution;
  images.push(...extractImagesFromText(rawSolutionText, 'solution'));

  const uniqueImages = new Map<string, BenchmarkQuestionMediaImage>();
  images.forEach((image) => {
    const key = image.url.toLowerCase();
    if (uniqueImages.has(key)) {
      return;
    }
    uniqueImages.set(key, {
      ...image,
      id: createId(),
    });
  });

  return Array.from(uniqueImages.values());
};

const buildOptions = (question: RawQuestion): BenchmarkQuestionOption[] => {
  if (question.type === 'TRUE_FALSE') {
    return [
      { id: 0, order: 0, text: 'True' },
      { id: 1, order: 1, text: 'False' },
    ];
  }

  if (!Array.isArray(question.content?.options)) {
    return [];
  }

  return question.content.options.map<BenchmarkQuestionOption>((option, index) => ({
    id: option.id ?? index,
    order: option.order ?? index,
    text: richTextToPlain(option.text),
  }));
};

const mapAnswer = (question: RawQuestion): BenchmarkQuestionAnswer => {
  const answer = question.answer ?? {};

  if (question.type === 'MCQ') {
    return {
      kind: 'single',
      correctOption: answer.correctOption ?? 0,
    };
  }

  if (question.type === 'MSQ') {
    return {
      kind: 'multiple',
      correctOptions: Array.isArray(answer.correctOptions) ? answer.correctOptions : [],
    };
  }

  if (question.type === 'NAT') {
    return {
      kind: 'numeric',
      range: answer.range ?? {},
      acceptedAnswers: Array.isArray(answer.acceptedAnswers) ? answer.acceptedAnswers : [],
      caseSensitive: Boolean(answer.caseSensitive),
    };
  }

  if (question.type === 'TRUE_FALSE') {
    const booleanValue =
      typeof answer.correct === 'boolean'
        ? answer.correct
        : typeof answer.correctOption === 'number'
        ? answer.correctOption === 1
        : undefined;
    return {
      kind: 'boolean',
      value: Boolean(booleanValue),
    };
  }

  return {
    kind: 'descriptive',
    acceptedAnswers: Array.isArray(answer.acceptedAnswers) ? answer.acceptedAnswers : [],
    caseSensitive: Boolean(answer.caseSensitive),
  };
};

const toTopologyValue = (value?: RawTopologyValue): string | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value || null;
  }

  if (typeof value === 'object') {
    return value.name ?? value.canonicalName ?? null;
  }

  return null;
};

const mapQuestion = (question: RawQuestion): BenchmarkQuestion => {
  const prompt = richTextToPlain(question.content?.questionText);
  const instructions = richTextToPlain(question.content?.instructions);
  const solution = richTextToPlain(question.solution);
  const metadata = question.metadata ?? {};
  const options = buildOptions(question);
  const imageReferences = collectImageReferences(
    question,
    prompt,
    instructions,
    solution,
    options
  );
  const hasImages = Boolean(metadata.hasImages || imageReferences.length > 0);

  return {
    id: (question.id ?? String(question.questionId)).toString(),
    questionId: question.questionId,
    displayId: question.displayId ?? null,
    type: question.type,
    difficulty: question.difficulty ?? 'UNKNOWN',
    prompt,
    instructions: instructions || undefined,
    options,
    answer: mapAnswer(question),
    solution: solution || undefined,
    metadata: {
      status: metadata.status ?? 'UNKNOWN',
      hasImages,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      topology: {
        subjectId: question.topology?.subjectId ?? null,
        topicId: question.topology?.topicId ?? null,
        subtopicId: question.topology?.subtopicId ?? null,
      },
      pyq: {
        type: question.pyq?.type ?? null,
        year: question.pyq?.year ?? null,
        exam: toTopologyValue(question.pyq?.exam),
        branch: toTopologyValue(question.pyq?.branch),
        paper: toTopologyValue(question.pyq?.paper),
      },
    },
    media: imageReferences.length > 0 ? { images: imageReferences } : undefined,
  };
};

const describeFilters = (filters?: RawDataset['filters']): string[] => {
  const summary: string[] = [];

  if (!filters) {
    return summary;
  }

  if (filters.questionTypes?.length) {
    summary.push(`Types: ${filters.questionTypes.join(', ')}`);
  }

  if (filters.status?.length) {
    summary.push(`Statuses: ${filters.status.join(', ')}`);
  }

  if (filters.excludeImages) {
    summary.push('Images excluded');
  }

  return summary;
};

export const questionDataset: BenchmarkQuestion[] = rawQuestions.map(mapQuestion);

const questionsWithImages = questionDataset.reduce(
  (count, question) => (question.metadata.hasImages ? count + 1 : count),
  0
);

const derivedPoolSize = dataset.stats?.poolSize ?? questionDataset.length;
const derivedPoolWithoutImages =
  dataset.stats?.poolWithoutImages ?? derivedPoolSize - questionsWithImages;

export const questionDatasetSummary: QuestionDatasetSummary = {
  label: 'GATE PYQ Sample',
  generatedAt: dataset.generatedAt ?? 'Unknown',
  total: dataset.total ?? rawQuestions.length,
  filters: describeFilters(dataset.filters),
  stats: {
    poolSize: derivedPoolSize,
    poolWithoutImages: Math.max(derivedPoolWithoutImages, 0),
    countsByType,
  },
};

export const questionLookup = new Map(questionDataset.map((item) => [item.id, item]));
