import rawDataset from '../../pyq-gate-sample.json';
import {
  BenchmarkQuestion,
  BenchmarkQuestionAnswer,
  BenchmarkQuestionOption,
  QuestionDatasetSummary,
  QuestionType,
} from '@/types/benchmark';
import { richTextToPlain } from '@/utils/richText';

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
  };
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
        subject?: RawTopologyValue;
        topic?: RawTopologyValue;
        subtopic?: RawTopologyValue;
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

  return {
    id: (question.id ?? String(question.questionId)).toString(),
    questionId: question.questionId,
    displayId: question.displayId ?? null,
    type: question.type,
    difficulty: question.difficulty ?? 'UNKNOWN',
    prompt,
    instructions: instructions || undefined,
    options: buildOptions(question),
    answer: mapAnswer(question),
    solution: solution || undefined,
    metadata: {
      status: metadata.status ?? 'UNKNOWN',
      hasImages: Boolean(metadata.hasImages),
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      tags: Array.isArray(metadata.tags) ? metadata.tags : [],
      topology: {
        subject: toTopologyValue(question.topology?.subject),
        topic: toTopologyValue(question.topology?.topic),
        subtopic: toTopologyValue(question.topology?.subtopic),
      },
      pyq: {
        type: question.pyq?.type ?? null,
        year: question.pyq?.year ?? null,
        exam: toTopologyValue(question.pyq?.exam),
        branch: toTopologyValue(question.pyq?.branch),
        paper: toTopologyValue(question.pyq?.paper),
      },
    },
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

export const questionDatasetSummary: QuestionDatasetSummary = {
  label: 'GATE PYQ Sample',
  generatedAt: dataset.generatedAt ?? 'Unknown',
  total: dataset.total ?? rawQuestions.length,
  filters: describeFilters(dataset.filters),
  stats: {
    poolSize: dataset.stats?.poolSize ?? rawQuestions.length,
    poolWithoutImages: dataset.stats?.poolWithoutImages ?? rawQuestions.length,
    countsByType,
  },
};

export const questionLookup = new Map(questionDataset.map((item) => [item.id, item]));
